// The vector table's Call and Expected cells: `hexDecode("66")`, `"f"`,
// `[00 0f]`, `Key = 00ff`, `L = 42`, `22 × 0b`, `concat([00], [ff])`. A cell
// is read in two steps. First its text is parsed into raw literals, which do not yet know whether a
// quoted string is bytes or text. Then the callee's signature settles each
// one: a quoted string where bytes go becomes `{ascii}`, and where a string
// goes `{str}`; `L = 42` is the int 42 where an int goes and the byte 0x42
// anywhere else. Reading `"f"` the same way in both places would make the
// contract say something the table does not.

import {
  type FnSig,
  I32_MAX,
  I32_MIN,
  type Literal,
  STRING_CHAR_RE,
  type ValueTy,
  assignable,
  isBytesLike,
  isStringLike,
  typeOfLiteral,
  valueTy,
} from "./contract.ts";
import { BYTES_MESSAGE, BYTES_RE } from "./front/ts.ts";

/** A literal as the cell writes it, before a type says what a string is. */
export type RawLiteral =
  | { kind: "string"; value: string }
  | { kind: "bytes"; hex: string }
  | { kind: "empty" }
  | { kind: "null" }
  | { kind: "bool"; value: boolean }
  | { kind: "int"; value: number }
  | { kind: "labelled"; label: string; hex: string }
  /** `L = 42`; `hex` when the digits are also hex pairs (`L = 42`, not `L = 7`). */
  | { kind: "labelled-int"; label: string; value: number; hex?: string }
  /** `22 × 0b`: `hex` written `count` times, optionally labelled. */
  | { kind: "repeat"; count: number; hex: string; label?: string }
  | { kind: "concat"; parts: RawLiteral[] };

/** Why a cell was refused; `col` is 1-based in the cell's text. */
export interface LiteralError {
  message: string;
  col: number;
}

class Fail extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
  }
}

const STRING_RE = /^"(?:[^"\\\n]|\\.)*"/;
const INT_RE = /^(?:0|-?[1-9][0-9]*)(?![0-9A-Za-z_])/;
const WORD_RE = /^(null|true|false)(?![0-9A-Za-z_])/;
const LABEL_RE = /^([A-Za-z][A-Za-z0-9_-]*(?: [A-Za-z0-9_-]+)*) = /;
const HEX_RE = /^(?:[0-9a-f]{2})+$/;
/** A whole text that is a decimal integer: `L = 42]` is not one. */
const INT_TEXT_RE = /^(?:0|-?[1-9][0-9]*)$/;
/** A labelled value's text: up to a space, `,` or `)` (inside a call), or the end. */
const VALUE_RE = /^[^\s,)]*/;
/** `count × run`, or with an ASCII `x`; the run ends at a space, `,` or `)`. */
const REPEAT_RE = /^(-?[0-9]+) [×x] ([^\s,)]*)/;
/** The most times a run may repeat: enough for any RFC-printed run. */
export const MAX_REPEAT = 65536;
const LABELLED_MESSAGE =
  "a labelled value is `Label = hex` (lowercase hex pairs with no spaces), `Label = 42` or `Label = 22 × 0b`";
const CALL_RE = /^([A-Za-z_][A-Za-z0-9_]*)\(/;

class Reader {
  i = 0;
  constructor(readonly text: string) {}

  private skip(): void {
    while (this.text[this.i] === " ") this.i++;
  }

  private expect(ch: string, what: string): void {
    this.skip();
    if (this.text[this.i] !== ch) throw new Fail(`expected ${what}`, this.i);
    this.i++;
  }

  end(): void {
    this.skip();
    if (this.i < this.text.length)
      throw new Fail("unexpected text after the value", this.i);
  }

  /** `(a, b, …)` after an opening paren already read; `inConcat` refuses a nested concat. */
  list(inConcat = false): RawLiteral[] {
    const out: RawLiteral[] = [];
    this.skip();
    if (this.text[this.i] === ")") {
      this.i++;
      return out;
    }
    for (;;) {
      out.push(this.literal(inConcat));
      this.skip();
      if (this.text[this.i] === ")") {
        this.i++;
        return out;
      }
      this.expect(",", "`,` or `)`");
    }
  }

  /** `22 × 0b` at the reader, or null. */
  private repeat(): Extract<RawLiteral, { kind: "repeat" }> | null {
    const m = this.text.slice(this.i).match(REPEAT_RE);
    if (!m) return null;
    const count = Number(m[1]);
    if (!/^[1-9][0-9]*$/.test(m[1]) || count > MAX_REPEAT)
      throw new Fail(
        `a repeat count is a whole number from 1 to ${MAX_REPEAT}`,
        this.i,
      );
    if (!HEX_RE.test(m[2]))
      throw new Fail(
        "a repeated run is whole bytes: lowercase hex pairs with no spaces",
        this.i + m[0].length - m[2].length,
      );
    this.i += m[0].length;
    return { kind: "repeat", count, hex: m[2] };
  }

  literal(inConcat = false): RawLiteral {
    this.skip();
    const at = this.i;
    const rest = this.text.slice(at);
    const str = rest.match(STRING_RE);
    if (str) {
      this.i += str[0].length;
      let value: unknown;
      try {
        value = JSON.parse(str[0]);
      } catch {}
      if (typeof value !== "string")
        throw new Fail("a quoted string is a JSON string; bad escape", at);
      return { kind: "string", value };
    }
    if (rest.startsWith("[")) {
      const m = rest.match(BYTES_RE);
      if (!m) throw new Fail(BYTES_MESSAGE, at);
      this.i += m[0].length;
      return { kind: "bytes", hex: m[1].replaceAll(" ", "") };
    }
    if (rest.startsWith("(empty)")) {
      this.i += 7;
      return { kind: "empty" };
    }
    if (rest.startsWith("concat(")) {
      // One level only: concatenation is associative, and a nested one would
      // recurse as deep as the cell is long.
      if (inConcat) throw new Fail("concat does not nest; list every part", at);
      this.i += 7;
      const parts = this.list(true);
      if (parts.length === 0)
        throw new Fail("concat needs at least one part", at);
      return { kind: "concat", parts };
    }
    const word = rest.match(WORD_RE);
    if (word) {
      this.i += word[0].length;
      return word[1] === "null"
        ? { kind: "null" }
        : { kind: "bool", value: word[1] === "true" };
    }
    const run = this.repeat();
    if (run) return run;
    const int = rest.match(INT_RE);
    if (int) {
      this.i += int[0].length;
      return { kind: "int", value: Number(int[0]) };
    }
    const lab = rest.match(LABEL_RE);
    if (lab) {
      this.i += lab[0].length;
      const label = lab[1];
      const labelled = this.repeat();
      if (labelled) return { ...labelled, label };
      const text = (this.text.slice(this.i).match(VALUE_RE) as string[])[0];
      const isHex = HEX_RE.test(text);
      const isInt = INT_TEXT_RE.test(text);
      if (!isInt && !isHex) throw new Fail(LABELLED_MESSAGE, at);
      this.i += text.length;
      if (!isInt) return { kind: "labelled", label, hex: text };
      return {
        kind: "labelled-int",
        label,
        value: Number(text),
        ...(isHex ? { hex: text } : {}),
      };
    }
    if (rest.startsWith("‖"))
      throw new Fail("`‖` is not a literal; write concat(a, b)", at);
    throw new Fail("not a literal", at);
  }
}

const caught = <T>(f: () => T): T | LiteralError => {
  try {
    return f();
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    return { message: e.message, col: e.at + 1 };
  }
};

/** `name(args…)`: the callee and its raw arguments. */
export function parseCall(
  text: string,
): { call: string; args: RawLiteral[] } | LiteralError {
  return caught(() => {
    const m = text.match(CALL_RE);
    if (!m) throw new Fail("a call is `name(args…)`", 0);
    const r = new Reader(text);
    r.i = m[0].length;
    const args = r.list();
    r.end();
    return { call: m[1], args };
  });
}

/** One literal filling the whole text. */
export function parseLiteral(text: string): RawLiteral | LiteralError {
  return caught(() => {
    const r = new Reader(text);
    const lit = r.literal();
    r.end();
    return lit;
  });
}

export const isLiteralError = (x: object): x is LiteralError =>
  "message" in x && "col" in x;

const U32_MAX = 4294967295;

/** What a literal is, as a refusal names it: "an int", "bytes", "null", … */
export const kindOf = (lit: Literal): string =>
  "int" in lit ? "an int" : typeOfLiteral(lit);

/** Does `lit` stand for a value of type `ty`? An int must be in range. */
function fits(lit: Literal, ty: ValueTy): boolean {
  if ("int" in lit) {
    if (ty === "u32") return lit.int >= 0 && lit.int <= U32_MAX;
    return ty === "i32" && lit.int >= I32_MIN && lit.int <= I32_MAX;
  }
  return assignable(typeOfLiteral(lit), ty);
}

const STRING_SET = "a quoted string is printable ASCII, tab, LF and CR only";

/**
 * The literal `raw` is where a value of type `ty` goes; undefined `ty` is a
 * place no signature types (an argument past the last parameter). A quoted
 * string is `{ascii}` where bytes go and `{str}` where a string goes; every
 * other literal is as written, and `fits` judges it against `ty`.
 */
export function settle(
  raw: RawLiteral,
  ty: ValueTy | undefined,
): Literal | string {
  switch (raw.kind) {
    case "string":
      if (!STRING_CHAR_RE.test(raw.value))
        return `${STRING_SET}; ${JSON.stringify(raw.value)} is not`;
      if (ty !== undefined && isBytesLike(ty)) return { ascii: raw.value };
      if (ty !== undefined && isStringLike(ty)) return { str: raw.value };
      return `the types do not settle ${JSON.stringify(raw.value)}: a quoted string goes where bytes or a string does, not ${ty ?? "past the last parameter"}`;
    case "bytes":
      return { hex: raw.hex };
    case "empty":
      return { ascii: "" };
    case "null":
      return { null: true };
    case "bool":
      return { bool: raw.value };
    case "int":
      return { int: raw.value };
    case "labelled":
      return { hex: raw.hex, label: raw.label };
    case "labelled-int":
      // An int where the signature takes one; hex pairs anywhere else.
      if (raw.hex === undefined || ty === "i32" || ty === "u32")
        return { int: raw.value, label: raw.label };
      return { hex: raw.hex, label: raw.label };
    case "repeat":
      return {
        hex: raw.hex,
        repeat: raw.count,
        ...(raw.label === undefined ? {} : { label: raw.label }),
      };
    case "concat": {
      const parts: Literal[] = [];
      for (const p of raw.parts) {
        const lit = settle(p, "bytes");
        if (typeof lit === "string") return lit;
        if (typeOfLiteral(lit) !== "bytes")
          return `a concat part is bytes, not ${kindOf(lit)}`;
        parts.push(lit);
      }
      return { concat: parts };
    }
  }
}

/** A refusal of one of a vector's cells. */
export interface CellError {
  cell: "Call" | "Expected";
  message: string;
}

/**
 * A vector's call and expected cells, settled and typed by `fn`'s signature:
 * as many arguments as parameters, each of its parameter's type, an int in
 * range, and an expected value of the return type. Every refusal is given.
 */
export function settleVector(
  fn: FnSig,
  args: RawLiteral[],
  expect: RawLiteral,
): { args: Literal[]; expect: Literal } | CellError[] {
  const errors: CellError[] = [];
  const call = (message: string) => errors.push({ cell: "Call", message });
  if (args.length !== fn.params.length)
    call(
      `${fn.name} takes ${fn.params.length} argument(s), not ${args.length}`,
    );
  const out: Literal[] = [];
  for (const [i, a] of args.entries()) {
    const p = fn.params[i];
    const ty = p && valueTy(p.type);
    const lit = settle(a, ty);
    if (typeof lit === "string") call(lit);
    else if (ty !== undefined && !fits(lit, ty))
      call(
        `argument ${i + 1} of ${fn.name} (${p.name}) is ${ty}, not ${kindOf(lit)}${"int" in lit ? ` ${lit.int}` : ""}`,
      );
    else out.push(lit);
  }
  const ret = valueTy(fn.returns);
  const e = settle(expect, ret);
  if (typeof e === "string") errors.push({ cell: "Expected", message: e });
  else if (!fits(e, ret))
    errors.push({
      cell: "Expected",
      message: `${fn.name} returns ${ret}, not ${kindOf(e)}${"int" in e ? ` ${e.int}` : ""}`,
    });
  if (errors.length > 0) return errors;
  return { args: out, expect: e as Literal };
}
