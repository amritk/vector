// The TypeScript front end: reads the small subset of TypeScript a spec's
// `ts-interface` and `ts-property` blocks are written in and maps it onto the
// contract's functions and property clauses. It is hand-written on purpose:
// the subset is tiny, every construct outside it must be refused with a
// line and column the author can act on, and vector depends on no compiler.
//
// Expressions are typed as they are parsed, by the contract's own `typeOf`,
// so a block that parses is a clause the gates will type the same way.

import {
  ALPHABET_CLASSES,
  type Expr,
  type ExprTy,
  type FnSig,
  I32_MAX,
  I32_MIN,
  ID_RE,
  type Literal,
  MAX_BYTES_LEN,
  type Op,
  STRING_CHAR_RE,
  type SigTy,
  type TypeEnv,
  type ValueTy,
  type Var,
  assignable,
  nishModuleFile,
  typeOf,
  valueTy,
} from "../contract.ts";
import type { FrontEnd, FrontRefusal, ParsedProperty } from "./index.ts";

// ── Refusals ───────────────────────────────────────────────────────────────

interface Pos {
  line: number;
  col: number;
}

/** Thrown at the first construct the front end cannot map; carries its position. */
class Refusal extends Error {
  constructor(
    message: string,
    readonly pos: Pos,
  ) {
    super(message);
  }
}

function refusing<T>(run: () => T): T | { refusals: FrontRefusal[] } {
  try {
    return run();
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    return { refusals: [{ message: e.message, ...e.pos }] };
  }
}

// ── Lexer ──────────────────────────────────────────────────────────────────

type TokKind = "ident" | "num" | "str" | "bytes" | "punct" | "comment" | "eof";

interface Tok extends Pos {
  kind: TokKind;
  /** The source text of the token. */
  text: string;
  /** str: the decoded string; bytes: the hex digits; comment: the text inside. */
  value: string;
  /** Whether the comment was a `//` line comment. */
  lineComment?: boolean;
}

// Longest first, so `===` is not read as `==` then `=`.
const PUNCT = [
  ">>>",
  "===",
  "!==",
  "==>",
  "...",
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "??",
  "?.",
  "**",
  "<<",
  ">>",
  "++",
  "--",
  ..."()[]{},;:.<>=+-*/%!&|^~?",
];

/** `[00 0f f0 ff]`: lowercase hex pairs, single spaces; `[]` is empty. */
export const BYTES_RE = /^\[((?:[0-9a-f]{2}(?: [0-9a-f]{2})*)?)\]/;
export const BYTES_MESSAGE =
  "a bytes literal is lowercase hex pairs separated by single spaces, like [00 0f]";

function lex(source: string, subset: string): Tok[] {
  const text = source.replace(/\r\n?/g, "\n");
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const pos = (at: number): Pos => ({ line, col: at - lineStart + 1 });
  const push = (kind: TokKind, start: number, end: number, value = "") =>
    toks.push({
      kind,
      text: text.slice(start, end),
      value,
      ...pos(start),
    });
  while (i < text.length) {
    const c = text[i];
    if (c === "\n") {
      i++;
      line++;
      lineStart = i;
      continue;
    }
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    const rest = text.slice(i);
    if (rest.startsWith("//")) {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      push("comment", i, stop, text.slice(i + 2, stop));
      toks[toks.length - 1].lineComment = true;
      i = stop;
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) throw new Refusal("unterminated `/*` comment", pos(i));
      push("comment", i, end + 2, text.slice(i + 2, end));
      // A block comment may span lines; keep the line count true.
      for (let k = i; k < end; k++)
        if (text[k] === "\n") {
          line++;
          lineStart = k + 1;
        }
      i = end + 2;
      continue;
    }
    const word = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (word) {
      push("ident", i, i + word[0].length);
      i += word[0].length;
      continue;
    }
    const num = rest.match(/^[0-9][0-9A-Za-z_.]*/);
    if (num) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(num[0]))
        throw new Refusal(
          `\`${num[0]}\` is not in the ${subset} subset; write integers in decimal`,
          pos(i),
        );
      push("num", i, i + num[0].length);
      i += num[0].length;
      continue;
    }
    if (c === '"') {
      const m = rest.match(/^"(?:[^"\\\n]|\\.)*"/);
      let value: unknown;
      try {
        value = m && JSON.parse(m[0]);
      } catch {}
      if (typeof value !== "string")
        throw new Refusal("malformed string literal", pos(i));
      push("str", i, i + (m as RegExpMatchArray)[0].length, value);
      i += (m as RegExpMatchArray)[0].length;
      continue;
    }
    if (c === "'" || c === "`")
      throw new Refusal(
        `\`${c}\` strings are not in the ${subset} subset; use double quotes`,
        pos(i),
      );
    const bytes = rest.match(BYTES_RE);
    const prev = toks.findLast((t) => t.kind !== "comment");
    const operand = !(
      prev?.kind === "ident" ||
      (prev?.kind === "punct" && (prev.text === ")" || prev.text === "]"))
    );
    if (!bytes && operand && /^\[[0-9A-Fa-f ]+\]/.test(rest))
      throw new Refusal(BYTES_MESSAGE, pos(i));
    if (bytes) {
      push("bytes", i, i + bytes[0].length, bytes[1].replaceAll(" ", ""));
      i += bytes[0].length;
      continue;
    }
    const p = PUNCT.find((q) => rest.startsWith(q));
    if (p) {
      push("punct", i, i + p.length);
      i += p.length;
      continue;
    }
    const ch = String.fromCodePoint(rest.codePointAt(0) as number);
    throw new Refusal(`\`${ch}\` is not in the ${subset} subset`, pos(i));
  }
  push("eof", i, i);
  return toks;
}

/** A cursor over the tokens that skips comments unless asked for them. */
class Cursor {
  private i = 0;
  constructor(private readonly toks: Tok[]) {}

  /** The next token, comments included. */
  raw(): Tok {
    return this.toks[this.i];
  }
  peek(): Tok {
    while (this.toks[this.i].kind === "comment") this.i++;
    return this.toks[this.i];
  }
  next(): Tok {
    const t = this.peek();
    if (t.kind !== "eof") this.i++;
    return t;
  }
  /** Consume the raw next token (a comment the caller has looked at). */
  skipRaw(): void {
    this.i++;
  }
  is(text: string): boolean {
    const t = this.peek();
    return (t.kind === "punct" || t.kind === "ident") && t.text === text;
  }
  eat(text: string): boolean {
    if (!this.is(text)) return false;
    this.next();
    return true;
  }
  expect(text: string): Tok {
    if (!this.is(text))
      throw new Refusal(
        `expected \`${text}\`, got ${shown(this.peek())}`,
        at(this.peek()),
      );
    return this.next();
  }
  ident(what: string): Tok {
    const t = this.peek();
    if (t.kind !== "ident")
      throw new Refusal(`expected ${what}, got ${shown(t)}`, at(t));
    return this.next();
  }
}

const at = (t: Pos): Pos => ({ line: t.line, col: t.col });
const shown = (t: Tok) => (t.kind === "eof" ? "end of block" : `\`${t.text}\``);

// ── Types ──────────────────────────────────────────────────────────────────

const SIG_TYPES: Record<string, SigTy> = {
  "u8[]": "bytes",
  "u8[] | null": "bytes?",
  string: "string",
  "string | null": "string?",
  i32: "i32",
  u32: "u32",
  boolean: "bool",
  "Secret<u8[]>": "secret-bytes",
  "Secret<u8[]> | null": "secret-bytes?",
};

const TS_NAMES: Record<string, string> = {
  bytes: "u8[]",
  "bytes?": "u8[] | null",
  string: "string",
  "string?": "string | null",
  bool: "boolean",
};

/** An expression type as the block's author wrote it. */
const tsTy = (t: ExprTy) => TS_NAMES[t] ?? t;

/**
 * Read a type: identifiers, `[]`, `<`, `>` and `|`, stopping where none can
 * follow. Returns its normalised spelling (`null | T` reordered to
 * `T | null`) and the source position, so an unknown type can be named.
 */
function readType(c: Cursor): { name: string; pos: Pos } {
  const first = c.ident("a type");
  const parts = [first.text];
  for (;;) {
    const t = c.raw(); // a comment ends the type: it may be a bounds comment
    const last = parts[parts.length - 1];
    const afterSep = last === "<" || last === "|";
    if (t.kind === "ident" && afterSep) parts.push(t.text);
    else if (t.kind === "bytes" && t.value === "" && !afterSep)
      parts.push("[]");
    else if (t.kind === "punct" && ["<", ">", "|"].includes(t.text))
      parts.push(t.text);
    else break;
    c.next();
  }
  const alts = parts
    .join("")
    .split("|")
    .sort((a, b) => (a === "null" ? 1 : b === "null" ? -1 : 0));
  return { name: alts.join(" | "), pos: at(first) };
}

// ── ts-interface ───────────────────────────────────────────────────────────

const IFACE = "ts-interface";

function parseInterface(text: string): {
  module: string;
  functions: FnSig[];
  lines: number[];
} {
  const c = new Cursor(lex(text, IFACE));
  const head = c.raw();
  const m =
    head.kind === "comment" && head.lineComment
      ? head.value.match(/^\s*module:\s*(\S+)\s*$/)
      : null;
  if (!m || head.line !== 1)
    throw new Refusal("missing `// module: nish/<name>` first line", at(head));
  if (!nishModuleFile(m[1]))
    throw new Refusal(
      `\`${m[1]}\` is not a nish module; write nish/<path>`,
      at(head),
    );
  c.skipRaw();
  const functions: FnSig[] = [];
  const lines: number[] = [];
  while (c.peek().kind !== "eof") {
    c.expect("export");
    const isConst = c.eat("const");
    if (!isConst) c.expect("function");
    const name = c.ident("a function name");
    if (functions.some((f) => f.name === name.text))
      throw new Refusal(`\`${name.text}\` is declared twice`, at(name));
    if (CALL_OPS.has(name.text as Op))
      throw new Refusal(
        `\`${name.text}\` is a ts-property op; give the function another name`,
        at(name),
      );
    if (isConst) c.expect("=");
    c.expect("(");
    const params: FnSig["params"] = [];
    while (!c.is(")")) {
      const p = c.ident("a parameter name");
      if (params.some((q) => q.name === p.text))
        throw new Refusal(
          `\`${name.text}\` has two parameters named \`${p.text}\``,
          at(p),
        );
      c.expect(":");
      const type = sigType(c, false);
      params.push({ name: p.text, type });
      if (!c.eat(",")) break;
    }
    c.expect(")");
    c.expect(":");
    const returns = sigType(c, true);
    const body = c.peek();
    if (body.text === "=>" || body.text === "{")
      throw new Refusal(
        `a ts-interface declares signatures only; remove the body of \`${name.text}\``,
        at(body),
      );
    c.eat(";");
    functions.push({ name: name.text, params, returns });
    lines.push(name.line);
  }
  if (functions.length === 0)
    throw new Refusal(
      "a ts-interface declares at least one function",
      at(c.peek()),
    );
  return { module: m[1], functions, lines };
}

function sigType(c: Cursor, result: boolean): SigTy {
  const { name, pos } = readType(c);
  if (!Object.hasOwn(SIG_TYPES, name))
    throw new Refusal(
      `\`${name}\` is not a ts-interface type; use u8[], string, i32, u32, boolean or Secret<u8[]>, with \`| null\` on u8[], string or a Secret<u8[]> result`,
      pos,
    );
  const t = SIG_TYPES[name];
  if (t === "secret-bytes?" && !result)
    throw new Refusal(
      "`Secret<u8[]> | null` is allowed only as a result type",
      pos,
    );
  return t;
}

// ── ts-property ────────────────────────────────────────────────────────────

const PROP = "ts-property";

/** A typed expression: its contract form, its type and where it starts. */
interface V {
  e: Expr;
  t: ExprTy;
  pos: Pos;
  /** Set for a bare string literal, whose meaning (str or ascii) the context decides. */
  str?: string;
  /** How deep the expression nests; unset for a leaf. */
  depth?: number;
}

/** Deeper nesting is refused, so a hostile block cannot exhaust the stack. */
const MAX_DEPTH = 64;
const DEPTH_MESSAGE = `the expression nests more than ${MAX_DEPTH} deep; name a part with const`;

/** The depth of a node over these operands, refused past MAX_DEPTH. */
function depthOver(args: V[], pos: Pos): number {
  const depth = 1 + Math.max(0, ...args.map((a) => a.depth ?? 0));
  if (depth > MAX_DEPTH) throw new Refusal(DEPTH_MESSAGE, pos);
  return depth;
}

/** Infix operators of TypeScript the subset leaves out, refused by name. */
const NOT_INFIX = new Set([
  "/",
  "&",
  "|",
  "^",
  "<<",
  ">>",
  ">>>",
  "**",
  "??",
  "?",
  "=",
  "=>",
  "?.",
  "++",
  "--",
  "...",
]);

/** Ops written as plain calls: `xor(a, b)`. */
const CALL_OPS = new Set<Op>([
  "xor",
  "bitAnd",
  "bitOr",
  "fill",
  "zeros",
  "flipBit",
  "le64",
  "unwrap",
  "utf8",
  "ascii",
  "implies",
  "concat",
]);

/** Ops whose every argument is bytes: a string literal there is ASCII bytes. */
const BYTES_OPS = new Set<Op>(["concat", "xor", "bitAnd", "bitOr"]);

/** Methods: the op, how many arguments after the receiver. */
const METHODS: Record<string, [Op, number]> = {
  concat: ["concat", 1],
  slice: ["slice", 2],
  toLowerCase: ["lower", 0],
  toUpperCase: ["upper", 0],
  charAt: ["charAt", 1],
};

const COVERS_HINT = "missing `// P-ID covers R-ID — title` line";

class PropertyParser {
  private readonly c: Cursor;
  private readonly fns: Map<string, FnSig>;
  private vars = new Map<string, ValueTy>();
  /** True while parsing `where`, which may not call the implementation. */
  private inWhere = false;
  /** How many operands are being parsed inside one another. */
  private nest = 0;

  constructor(text: string, fns: FnSig[]) {
    this.c = new Cursor(lex(text, PROP));
    this.fns = new Map(fns.map((f) => [f.name, f]));
  }

  parse(): ParsedProperty {
    const { id, title, covers } = this.coversLine();
    const c = this.c;
    c.expect("forall");
    c.expect("(");
    const forall: Var[] = [];
    while (!c.is(")")) {
      forall.push(this.forallVar());
      if (!c.eat(",")) break;
    }
    c.expect(")");
    c.expect("=>");
    const outer = new Map(this.vars);
    const assert = this.boolean(this.body(), "the property");
    this.vars = outer;
    let where: V | undefined;
    if (c.eat("where")) {
      this.inWhere = true;
      where = this.boolean(this.expr(), "`where`");
    }
    c.eat(";");
    const end = c.peek();
    if (end.kind !== "eof")
      throw new Refusal(`unexpected ${shown(end)}`, at(end));
    const clause: ParsedProperty["clause"] = where
      ? { forall, where: where.e, assert: assert.e }
      : { forall, assert: assert.e };
    return { id, title, covers, clause };
  }

  private coversLine(): { id: string; title: string; covers: string[] } {
    const head = this.c.raw();
    const m =
      head.kind === "comment" && head.lineComment
        ? head.value.match(/^\s*(\S+)\s+covers\s+(.*)$/)
        : null;
    if (!m || head.line !== 1) throw new Refusal(COVERS_HINT, at(head));
    const dash = m[2].indexOf(" — ");
    const title = dash < 0 ? "" : m[2].slice(dash + 3).trim();
    if (!title)
      throw new Refusal(
        "missing title: end the covers line with ` — <title>`",
        at(head),
      );
    const covers = m[2]
      .slice(0, dash)
      .trim()
      .split(/\s*,\s*/);
    for (const id of [m[1], ...covers])
      if (!ID_RE.test(id))
        throw new Refusal(
          `\`${id}\` is not a clause or requirement id`,
          at(head),
        );
    this.c.skipRaw();
    return { id: m[1], title, covers };
  }

  private forallVar(): Var {
    const c = this.c;
    const name = c.ident("a variable name");
    this.bind(name);
    c.expect(":");
    const { name: tsName, pos } = readType(c);
    const type =
      tsName === "u8[]"
        ? "bytes"
        : tsName === "string" || tsName === "i32"
          ? tsName
          : undefined;
    if (!type)
      throw new Refusal(
        `\`${tsName}\` is not a forall type; use u8[], string or i32`,
        pos,
      );
    const raw = c.raw();
    if (raw.kind !== "comment" || raw.lineComment)
      throw new Refusal(
        `\`${name.text}\` needs a bounds comment, like /* 0..64 */`,
        at(raw),
      );
    c.skipRaw();
    this.vars.set(name.text, type);
    return bounded(name.text, type, raw);
  }

  /** Refuse a name already bound or naming an interface function. */
  private bind(name: Tok): void {
    if (this.vars.has(name.text))
      throw new Refusal(`\`${name.text}\` is bound twice`, at(name));
    if (this.fns.has(name.text))
      throw new Refusal(
        `\`${name.text}\` names an interface function`,
        at(name),
      );
  }

  /** `expr`, or `{ const n = e; … return e; }`, which maps to a let. */
  private body(): V {
    const c = this.c;
    const open = c.peek();
    if (!c.eat("{")) return this.expr();
    const lets: { name: string; value: Expr }[] = [];
    for (;;) {
      const t = c.peek();
      if (c.eat("return")) break;
      if (c.eat("const")) {
        const name = c.ident("a const name");
        this.bind(name);
        c.expect("=");
        const value = this.expr();
        if (value.t === "null")
          throw new Refusal(
            `\`${name.text}\` is a bare null, which has no type`,
            value.pos,
          );
        c.eat(";");
        lets.push({ name: name.text, value: value.e });
        this.vars.set(name.text, value.t as ValueTy);
        continue;
      }
      if (t.kind === "ident")
        throw new Refusal(
          `\`${t.text}\` is not in the ts-property subset`,
          at(t),
        );
      throw new Refusal(
        `expected \`const\` or \`return\`, got ${shown(t)}`,
        at(t),
      );
    }
    const result = this.expr();
    c.eat(";");
    c.expect("}");
    if (lets.length === 0) return result;
    return { e: { let: lets, in: result.e }, t: result.t, pos: at(open) };
  }

  private boolean(v: V, what: string): V {
    if (v.t !== "bool")
      throw new Refusal(`${what} must be boolean, got ${tsTy(v.t)}`, v.pos);
    return v;
  }

  // Precedence, loosest first: || && equality relational additive
  // multiplicative unary postfix.

  private expr(): V {
    return this.chain("||", "or", () =>
      this.chain("&&", "and", () => this.equality()),
    );
  }

  /** `a && b && c` is one n-ary `and`. */
  private chain(tok: string, op: Op, operand: () => V): V {
    const args = [operand()];
    while (this.c.eat(tok)) args.push(operand());
    if (args.length === 1) return args[0];
    return this.typed({ op, args: args.map((a) => a.e) }, args, `\`${tok}\``);
  }

  private equality(): V {
    let l = this.relational();
    for (;;) {
      const t = this.c.peek();
      if (!["===", "!==", "==", "!="].includes(t.text) || t.kind !== "punct")
        return l;
      this.c.next();
      const r = this.relational();
      const eq = t.text.startsWith("=");
      const name = `\`${t.text}\``;
      const nullSide = "null" in r.e ? l : "null" in l.e ? r : undefined;
      if (nullSide && nullSide.t !== "null") {
        const op = eq ? "isNull" : "notNull";
        l = this.typed(
          { op, args: [nullSide.e] },
          [nullSide],
          `\`${t.text} null\``,
          l.pos,
        );
        continue;
      }
      l = this.typed({ op: eq ? "==" : "!=", args: [l.e, r.e] }, [l, r], name);
    }
  }

  private relational(): V {
    let l = this.additive();
    for (;;) {
      const t = this.c.peek();
      if (t.kind !== "punct" || !["<", "<=", ">", ">="].includes(t.text))
        return l;
      this.c.next();
      const r = this.additive();
      l = this.typed(
        { op: t.text as Op, args: [l.e, r.e] },
        [l, r],
        `\`${t.text}\``,
      );
    }
  }

  private additive(): V {
    let l = this.multiplicative();
    for (;;) {
      const t = this.c.peek();
      if (t.kind !== "punct" || (t.text !== "+" && t.text !== "-")) return l;
      this.c.next();
      const r = this.multiplicative();
      const op: Op =
        t.text === "+" && (l.t === "string" || r.t === "string")
          ? "strConcat"
          : (t.text as Op);
      l = this.typed({ op, args: [l.e, r.e] }, [l, r], `\`${t.text}\``);
    }
  }

  private multiplicative(): V {
    let l = this.unary();
    for (;;) {
      const t = this.c.peek();
      if (t.kind !== "punct" || (t.text !== "*" && t.text !== "%")) {
        this.refuseInfix(t);
        return l;
      }
      this.c.next();
      const r = this.unary();
      if (t.text === "%" && "int" in r.e && r.e.int === 0)
        throw new Refusal(
          "`% 0` is NaN in TypeScript and 0 in the contract",
          r.pos,
        );
      l = this.typed(
        { op: t.text as Op, args: [l.e, r.e] },
        [l, r],
        `\`${t.text}\``,
      );
    }
  }

  /** An infix operator TypeScript has and the subset does not. */
  private refuseInfix(t: Tok): void {
    if (t.kind !== "punct") return;
    if (t.text === "==>")
      throw new Refusal(
        "`==>` is not in the ts-property subset; use implies(a, b)",
        at(t),
      );
    if (NOT_INFIX.has(t.text))
      throw new Refusal(
        `\`${t.text}\` is not in the ts-property subset`,
        at(t),
      );
  }

  private unary(): V {
    const t = this.c.peek();
    if (++this.nest > MAX_DEPTH) throw new Refusal(DEPTH_MESSAGE, at(t));
    const v = this.operand(t);
    this.nest--;
    return v;
  }

  private operand(t: Tok): V {
    const c = this.c;
    if (c.eat("!")) {
      const a = this.unary();
      return this.typed({ op: "not", args: [a.e] }, [a], "`!`", at(t));
    }
    if (c.eat("-")) {
      const n = c.peek();
      if (n.kind !== "num")
        throw new Refusal(
          "unary `-` applies only to integer literals; write 0 - x",
          at(t),
        );
      c.next();
      return int(-Number(n.text), `-${n.text}`, at(t));
    }
    if (t.kind === "punct" && ["+", "~", "++", "--", "..."].includes(t.text))
      throw new Refusal(
        `\`${t.text}\` is not in the ts-property subset`,
        at(t),
      );
    return this.postfix(this.primary());
  }

  private postfix(operand: V): V {
    const c = this.c;
    let v = operand;
    for (;;) {
      const t = c.peek();
      if (t.kind === "punct" && t.text === "[")
        throw new Refusal(
          "indexing is not in the ts-property subset; use slice or charAt",
          at(t),
        );
      if (!c.eat(".")) return v;
      const m = c.ident("a property name");
      const name = `\`.${m.text}\``;
      if (!c.is("(")) {
        if (m.text !== "length")
          throw new Refusal(`${name} is not in the ts-property subset`, at(m));
        const op: Op = v.t === "string" ? "strLen" : "len";
        v = this.typed({ op, args: [v.e] }, [v], name, v.pos);
        continue;
      }
      if (!Object.hasOwn(METHODS, m.text))
        throw new Refusal(`${name} is not in the ts-property subset`, at(m));
      const [op, n] = METHODS[m.text];
      const argsAt = c.peek();
      const args = this.args();
      if (args.length !== n)
        throw new Refusal(
          `${name} takes ${n} argument(s), got ${args.length}`,
          at(argsAt),
        );
      for (const a of op === "slice" ? args : [])
        if ("int" in a.e && a.e.int < 0)
          throw new Refusal(
            "a negative `.slice` index counts from the end in TypeScript and clamps to 0 in the contract",
            a.pos,
          );
      // `.concat` is TypeScript's: string concat on a string, array concat on u8[].
      const real = op === "concat" && v.t === "string" ? "strConcat" : op;
      const all = [v, ...args];
      v = this.typed({ op: real, args: all.map((a) => a.e) }, all, name, v.pos);
    }
  }

  /** `( expr, … )` */
  private args(): V[] {
    const c = this.c;
    c.expect("(");
    const args: V[] = [];
    while (!c.is(")")) {
      args.push(this.expr());
      if (!c.eat(",")) break;
    }
    c.expect(")");
    return args;
  }

  private primary(): V {
    const c = this.c;
    const t = c.next();
    const pos = at(t);
    switch (t.kind) {
      case "num":
        return int(Number(t.text), t.text, pos);
      case "str":
        if (!STRING_CHAR_RE.test(t.value))
          throw new Refusal(
            "a string literal holds only printable ASCII, tab, LF and CR",
            pos,
          );
        return { e: { str: t.value }, t: "string", pos, str: t.value };
      case "bytes":
        return { e: { hex: t.value }, t: "bytes", pos };
      case "ident":
        return this.name(t);
      case "punct":
        if (t.text === "(") {
          const v = this.expr();
          c.expect(")");
          return { ...v, pos };
        }
        if (t.text === "[") throw new Refusal(BYTES_MESSAGE, pos);
        this.refuseInfix(t);
    }
    throw new Refusal(`unexpected ${shown(t)}`, pos);
  }

  /** A variable, literal keyword or call. */
  private name(t: Tok): V {
    const pos = at(t);
    if (t.text === "true" || t.text === "false")
      return { e: { bool: t.text === "true" }, t: "bool", pos };
    if (t.text === "null") return { e: { null: true }, t: "null", pos };
    const ty = this.vars.get(t.text);
    if (!this.c.is("(")) {
      if (!ty) throw new Refusal(`unknown identifier \`${t.text}\``, pos);
      return { e: { var: t.text }, t: ty, pos };
    }
    if (ty) throw new Refusal(`\`${t.text}\` is not a function`, pos);
    const sig = this.fns.get(t.text);
    if (sig && CALL_OPS.has(sig.name as Op))
      throw new Refusal(
        `\`${sig.name}\` is both an interface function and a ts-property op`,
        pos,
      );
    if (sig) return this.call(sig, pos);
    if (!CALL_OPS.has(t.text as Op))
      throw new Refusal(`unknown function \`${t.text}\``, pos);
    const op = t.text as Op;
    let args = this.args();
    if (BYTES_OPS.has(op)) args = args.map(asBytes);
    if (op === "flipBit" && args.length > 0) args[0] = asBytes(args[0]);
    return this.typed(
      { op, args: args.map((a) => a.e) },
      args,
      `\`${op}\``,
      pos,
    );
  }

  private call(sig: FnSig, pos: Pos): V {
    if (this.inWhere)
      throw new Refusal(
        `\`where\` may not call \`${sig.name}\`: the domain must not depend on the implementation`,
        pos,
      );
    const args = this.args();
    if (args.length !== sig.params.length)
      throw new Refusal(
        `\`${sig.name}\` takes ${sig.params.length} argument(s), got ${args.length}`,
        pos,
      );
    const typed = args.map((a, i) => {
      const want = valueTy(sig.params[i].type);
      if (!assignable(a.t, want))
        throw new Refusal(
          `\`${sig.name}\` expects ${tsTy(want)}, got ${tsTy(a.t)}`,
          a.pos,
        );
      return a.e;
    });
    return {
      e: { call: sig.name, args: typed },
      t: valueTy(sig.returns),
      pos,
      depth: depthOver(args, pos),
    };
  }

  /**
   * Type a new node with the contract's `typeOf` (its arguments are already
   * typed, so any error is this node's), refusing at the argument it names.
   */
  private typed(e: Expr, args: V[], name: string, pos = args[0].pos): V {
    const env: TypeEnv = { fns: this.fns, vars: this.vars, allowCalls: true };
    const errors: string[] = [];
    const t = typeOf(e, env, "", errors);
    if (t === null) {
      const m = errors[0].match(
        /^(?:\.args\[(\d+)\])?: (.*)$/s,
      ) as RegExpMatchArray;
      const op = (e as { op: string }).op;
      const msg = m[2].startsWith(`${op} `)
        ? name + m[2].slice(op.length)
        : m[2];
      throw new Refusal(
        msg.replace(/\b(bytes|string|bool)\b(\??)/g, (w) => tsTy(w as ExprTy)),
        m[1] === undefined ? pos : args[Number(m[1])].pos,
      );
    }
    return { e, t, pos, depth: depthOver(args, pos) };
  }
}

/** A string literal where bytes are wanted is its ASCII bytes. */
function asBytes(v: V): V {
  return v.str === undefined
    ? v
    : { e: { ascii: v.str }, t: "bytes", pos: v.pos };
}

function int(n: number, text: string, pos: Pos): V {
  if (n < I32_MIN || n > I32_MAX)
    throw new Refusal(`\`${text}\` is outside i32`, pos);
  return { e: { int: n } satisfies Literal, t: "i32", pos };
}

/**
 * The bounds comment of a forall variable: `lo..hi` (length for u8[] and
 * string, value for i32), then for a string its alphabet, as class names or
 * one JSON string whose characters are the alphabet in order.
 */
function bounded(name: string, type: "bytes" | "string" | "i32", c: Tok): Var {
  const pos = at(c);
  const m = c.value.trim().match(/^(-?\d+)\.\.(-?\d+)(?:\s+([\s\S]*))?$/);
  if (!m)
    throw new Refusal(
      `the bounds of \`${name}\` must read \`lo..hi\`, like /* 0..64 */`,
      pos,
    );
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  const alpha = m[3];
  if (type !== "string" && alpha !== undefined)
    throw new Refusal(
      `an alphabet applies only to string variables, not \`${name}\``,
      pos,
    );
  if (type === "i32") {
    if (!(I32_MIN <= lo && lo <= hi && hi <= I32_MAX))
      throw new Refusal(
        `the bounds of \`${name}\` must satisfy ${I32_MIN} <= lo <= hi <= ${I32_MAX}`,
        pos,
      );
    return { name, type, min: lo, max: hi };
  }
  if (!(0 <= lo && lo <= hi && hi <= MAX_BYTES_LEN))
    throw new Refusal(
      `the length bounds of \`${name}\` must satisfy 0 <= lo <= hi <= ${MAX_BYTES_LEN}`,
      pos,
    );
  if (type === "bytes") return { name, type, minLen: lo, maxLen: hi };
  if (alpha === undefined)
    throw new Refusal(
      `\`${name}\` needs an alphabet after its bounds: class names (${Object.keys(ALPHABET_CLASSES).join(", ")}) or a JSON string`,
      pos,
    );
  return { name, type, minLen: lo, maxLen: hi, alphabet: alphabet(alpha, pos) };
}

function alphabet(text: string, pos: Pos): string[] {
  if (!text.startsWith('"')) {
    const names = text.split(/\s+/);
    for (const n of names)
      if (!Object.hasOwn(ALPHABET_CLASSES, n))
        throw new Refusal(
          `unknown alphabet class \`${n}\`; use ${Object.keys(ALPHABET_CLASSES).join(", ")} or a JSON string`,
          pos,
        );
    return names;
  }
  let s: unknown;
  try {
    s = JSON.parse(text);
  } catch {}
  if (typeof s !== "string")
    throw new Refusal("the alphabet must be one JSON string", pos);
  if (s === "") throw new Refusal("the alphabet is empty", pos);
  if (!STRING_CHAR_RE.test(s))
    throw new Refusal(
      "the alphabet holds only printable ASCII, tab, LF and CR",
      pos,
    );
  return [...s];
}

export const tsFrontEnd: FrontEnd = {
  parseInterface: (text) => refusing(() => parseInterface(text)),
  parseProperty: (text, fns) =>
    refusing(() => new PropertyParser(text, fns).parse()),
};
