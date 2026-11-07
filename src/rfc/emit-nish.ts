// An RfcContract (plus its samples) as a Nish test program.
//
// The program imports the functions under test from the contract's target
// module and checks every clause with `nish/testing`'s Suite, one line per
// clause: `PASS  [<clause id>] <title>`. The bracketed id is how `vector rfc
// run` maps the output back to the requirements.
//
// Nish has no closures, exceptions or generics, which shapes the output:
//   - a property is a loop over baked sample tables (the solver and the PRNG
//     ran at generation time, so a failure reproduces byte for byte);
//   - `unwrap` of a null cannot throw, so it records the null on an `Unwrap`
//     and the sample fails;
//   - every helper is spelled for one type, and only the ones used are emitted.

import { createHash } from "node:crypto";
import {
  type Clause,
  type Expr,
  type FnSig,
  type Literal,
  type PropertyClause,
  type RfcContract,
  type ValueTy,
  type VectorClause,
  bytesToHex,
  callsIn,
  declaredSources,
  isBytesLike,
  isStringLike,
  literalBytes,
  sourceOf,
  typeOf,
} from "./contract.ts";
import type { PropertySamples } from "./sample.ts";

const NISH_TY: Record<ValueTy, string> = {
  bytes: "u8[]",
  "bytes?": "u8[] | null",
  string: "string",
  "string?": "string | null",
  i32: "i32",
  u32: "u32",
  bool: "boolean",
};

const HELPERS: Record<string, string> = {
  hexOf: `/** \`bytes\` as lowercase hex, the way the RFC prints them. */
const hexOf = (bytes: u8[]): string => {
  const digits: string = "0123456789abcdef";
  const parts: string[] = [];
  for (const b of bytes) {
    const v: i32 = toI32(b);
    parts.push(digits.substring(v >> 4, (v >> 4) + 1));
    parts.push(digits.substring(v & 15, (v & 15) + 1));
  }
  return parts.join("");
};`,
  hexOrNull: `/** \`bytes\` as hex, or \`null\` spelled out. */
const hexOrNull = (bytes: u8[] | null): string => {
  if (bytes !== null) {
    return hexOf(bytes);
  }
  return "null";
};`,
  unhex: `/** The bytes a lowercase hex string spells. */
const unhex = (hex: string): u8[] => {
  const n: i32 = toI32(hex.length) >> 1;
  const out: u8[] = new Array<u8>(n);
  for (let i: i32 = 0; i < n; i += 1) {
    out[i] = toU8(nibble(hex.charCodeAt(2 * i)) * 16 + nibble(hex.charCodeAt(2 * i + 1)));
  }
  return out;
};`,
  nibble: `/** One hex digit's value. */
const nibble = (c: number): i32 => {
  const v: i32 = toI32(c);
  if (v >= 97) {
    return v - 87;
  }
  return v - 48;
};`,
  bytesEq: `/** Equal contents, or both null. */
const bytesEq = (a: u8[] | null, b: u8[] | null): boolean => {
  if (a === null || b === null) {
    return a === null && b === null;
  }
  const n: i32 = toI32(a.length);
  if (n !== toI32(b.length)) {
    return false;
  }
  for (let i: i32 = 0; i < n; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
};`,
  isNullBytes: "const isNullBytes = (b: u8[] | null): boolean => b === null;",
  concatBytes: `const concatBytes = (a: u8[], b: u8[]): u8[] => {
  const out: u8[] = [];
  for (const x of a) {
    out.push(x);
  }
  for (const x of b) {
    out.push(x);
  }
  return out;
};`,
  sliceBytes: `/** \`b[from, to)\`, both ends clamped into the array. */
const sliceBytes = (b: u8[], from: i32, to: i32): u8[] => {
  const n: i32 = toI32(b.length);
  let lo: i32 = from;
  if (lo < 0) {
    lo = 0;
  }
  if (lo > n) {
    lo = n;
  }
  let hi: i32 = to;
  if (hi < lo) {
    hi = lo;
  }
  if (hi > n) {
    hi = n;
  }
  const out: u8[] = [];
  for (let i: i32 = lo; i < hi; i += 1) {
    out.push(b[i]);
  }
  return out;
};`,
  fillBytes: `/** \`n\` copies of the byte \`v\` (none when n < 0). */
const fillBytes = (v: i32, n: i32): u8[] => {
  const out: u8[] = [];
  for (let i: i32 = 0; i < n; i += 1) {
    out.push(toU8(v & 255));
  }
  return out;
};`,
  flipBit: `/** A copy of \`b\` with bit \`bit\` (mod 8 * length) inverted. */
const flipBit = (b: u8[], bit: i32): u8[] => {
  const out: u8[] = sliceBytes(b, 0, toI32(b.length));
  const bits: i32 = toI32(b.length) * 8;
  if (bits === 0) {
    return out;
  }
  const at: i32 = ((bit % bits) + bits) % bits;
  const byte: i32 = at >> 3;
  const mask: i32 = 1 << (at & 7);
  out[byte] = toU8(toI32(out[byte]) ^ mask);
  return out;
};`,
  le64: `/** \`n\` as 8 little-endian bytes. */
const le64 = (n: i32): u8[] => {
  const out: u8[] = [];
  let v: i64 = toI64(n);
  for (let i: i32 = 0; i < 8; i += 1) {
    out.push(toU8(toI32(v & toI64(255))));
    v = v >> toI64(8);
  }
  return out;
};`,
  strEq: `/** Equal characters, or both null. */
const strEq = (a: string | null, b: string | null): boolean => {
  if (a === null || b === null) {
    return a === null && b === null;
  }
  const n: i32 = toI32(a.length);
  if (n !== toI32(b.length)) {
    return false;
  }
  for (let i: i32 = 0; i < n; i += 1) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) {
      return false;
    }
  }
  return true;
};`,
  isNullStr: "const isNullStr = (s: string | null): boolean => s === null;",
  strOrNull: `/** \`s\` in double quotes, or \`null\` spelled out. */
const strOrNull = (s: string | null): string => {
  if (s !== null) {
    return \`"\${s}"\`;
  }
  return "null";
};`,
  shiftCase: `/** \`s\` with every byte in [lo, hi] moved by \`delta\` (ASCII case mapping). */
const shiftCase = (s: string, lo: i32, hi: i32, delta: i32): string => {
  const parts: string[] = [];
  const n: i32 = toI32(s.length);
  for (let i: i32 = 0; i < n; i += 1) {
    let c: i32 = toI32(s.charCodeAt(i));
    if (c >= lo && c <= hi) {
      c = c + delta;
    }
    parts.push(String.fromCharCode(c));
  }
  return parts.join("");
};`,
  utf8Bytes: `/** The bytes of \`s\`. */
const utf8Bytes = (s: string): u8[] => {
  const out: u8[] = [];
  const n: i32 = toI32(s.length);
  for (let i: i32 = 0; i < n; i += 1) {
    out.push(toU8(toI32(s.charCodeAt(i))));
  }
  return out;
};`,
  asciiOrNull: `/** \`b\` as a string, or null when any byte is not ASCII. */
const asciiOrNull = (b: u8[]): string | null => {
  for (const x of b) {
    if (toI32(x) >= 128) {
      return null;
    }
  }
  return String.fromBytes(b, 0, toI32(b.length));
};`,
  charAtStr: `/** The character at \`i\`, or "" out of range. */
const charAtStr = (s: string, i: i32): string => {
  if (i < 0 || i >= toI32(s.length)) {
    return "";
  }
  return s.slice(i, i + 1);
};`,
  Unwrap: `/**
 * \`unwrap\` without exceptions: a null is recorded and stands in as no bytes,
 * and the sample that saw it fails.
 */
class Unwrap {
  sawNull: boolean

  constructor() {
    this.sawNull = false
  }

  get(b: u8[] | null): u8[] {
    if (b !== null) {
      return b
    }
    this.sawNull = true
    return []
  }
}`,
};

/** Spliced into Unwrap when a string? is unwrapped. */
const UNWRAP_STR = `
  str(s: string | null): string {
    if (s !== null) {
      return s
    }
    this.sawNull = true
    return ""
  }`;

const HELPER_DEPS: Record<string, string[]> = {
  hexOrNull: ["hexOf"],
  unhex: ["nibble"],
  flipBit: ["sliceBytes"],
  unwrapStr: ["Unwrap"],
};
const HELPER_ORDER = Object.keys(HELPERS);

class Emitter {
  readonly used = new Set<string>();
  readonly fns: Map<string, FnSig>;
  /** The types of the names in scope: the forall vars, then let bindings. */
  vars = new Map<string, ValueTy>();

  constructor(readonly c: RfcContract) {
    this.fns = new Map(c.functions.map((f) => [f.name, f]));
  }

  use(h: string): string {
    this.used.add(h);
    for (const d of HELPER_DEPS[h] ?? []) this.use(d);
    return h;
  }

  bytesLit(b: Uint8Array): string {
    return `${this.use("unhex")}("${bytesToHex(b)}")`;
  }

  /** A literal at a known type. */
  literal(lit: Literal, ty: ValueTy | "null"): string {
    if ("null" in lit) return "null";
    if ("bool" in lit) return String(lit.bool);
    if ("int" in lit) {
      if (ty === "u32") return `toU32(${lit.int})`;
      return lit.int < 0 ? `(${lit.int})` : String(lit.int);
    }
    if ("str" in lit) return jsString(lit.str);
    return this.bytesLit(literalBytes(lit) as Uint8Array);
  }

  /** The type of a (contract-checked) expression in the current scope. */
  typeOf(e: Expr): ValueTy | "null" {
    const env = { fns: this.fns, vars: this.vars, allowCalls: true };
    return typeOf(e, env, "", []) as ValueTy | "null";
  }

  /**
   * `const` locals for the lets that open `e` (each evaluated once, in order),
   * pushed onto `out`; returns the expression they scope over.
   */
  bindings(assert: Expr, indent: string, out: string[]): Expr {
    let e = assert;
    while ("let" in e) {
      for (const b of e.let) {
        const ty = this.typeOf(b.value) as ValueTy;
        out.push(
          `${indent}const v_${b.name}: ${NISH_TY[ty]} = ${this.expr(b.value)};`,
        );
        this.vars.set(b.name, ty);
      }
      e = e.in;
    }
    return e;
  }

  /** An expression; contract names are emitted as `v_<name>` locals. */
  expr(e: Expr, want?: ValueTy): string {
    if ("var" in e)
      return want === "u32" && this.vars.get(e.var) !== "u32"
        ? `toU32(v_${e.var})`
        : `v_${e.var}`;
    if ("call" in e) {
      const sig = this.fns.get(e.call) as FnSig;
      const args = e.args.map((a, i) => this.expr(a, sig.params[i].type));
      return `${e.call}(${args.join(", ")})`;
    }
    if ("let" in e) throw new Error("a let may only open the assert");
    if (!("op" in e)) {
      const lit = e as Literal;
      if ("int" in lit && want === "u32") return `toU32(${lit.int})`;
      return this.literal(lit, want ?? "bytes");
    }
    const a = (i: number, w?: ValueTy) => this.expr(e.args[i], w);
    const wrapU32 = (s: string) => (want === "u32" ? `toU32(${s})` : s);
    switch (e.op) {
      case "len":
        return wrapU32(`toI32(${a(0)}.length)`);
      case "concat":
        return `${this.use("concatBytes")}(${a(0)}, ${a(1)})`;
      case "slice":
        return `${this.use("sliceBytes")}(${a(0)}, ${a(1)}, ${a(2)})`;
      case "zeros":
        return `${this.use("fillBytes")}(0, ${a(0)})`;
      case "fill":
        return `${this.use("fillBytes")}(${a(0)}, ${a(1)})`;
      case "flipBit":
        return `${this.use("flipBit")}(${a(0)}, ${a(1)})`;
      case "unwrap":
        if (this.typeOf(e.args[0]) === "string?") {
          this.use("unwrapStr");
          return `u.str(${a(0)})`;
        }
        this.use("Unwrap");
        return `u.get(${a(0)})`;
      case "isNull":
      case "notNull": {
        const h =
          this.typeOf(e.args[0]) === "string?" ? "isNullStr" : "isNullBytes";
        return `${e.op === "notNull" ? "!" : ""}${this.use(h)}(${a(0)})`;
      }
      case "+":
      case "-":
      case "*":
      case "%":
        return wrapU32(`(${a(0)} ${e.op} ${a(1)})`);
      case "le64":
        return `${this.use("le64")}(${a(0)})`;
      case "<":
      case "<=":
      case ">":
      case ">=":
        return `(${a(0)} ${e.op} ${a(1)})`;
      case "==":
      case "!=": {
        // A null literal takes its kind from the other side.
        const l = this.typeOf(e.args[0]);
        const side = l === "null" ? this.typeOf(e.args[1]) : l;
        const h = isBytesLike(side)
          ? "bytesEq"
          : isStringLike(side)
            ? "strEq"
            : null;
        if (h) {
          const eq = `${this.use(h)}(${a(0)}, ${a(1)})`;
          return e.op === "==" ? eq : `!${eq}`;
        }
        return `(${a(0)} ${e.op === "==" ? "===" : "!=="} ${a(1)})`;
      }
      case "and":
        return `(${e.args.map((_, i) => a(i)).join(" && ")})`;
      case "or":
        return `(${e.args.map((_, i) => a(i)).join(" || ")})`;
      case "not":
        return `!${a(0)}`;
      case "implies":
        return `(!${a(0)} || ${a(1)})`;
      case "strLen":
        return wrapU32(`toI32(${a(0)}.length)`);
      case "strConcat":
        return `\`\${${a(0)}}\${${a(1)}}\``;
      case "lower":
        return `${this.use("shiftCase")}(${a(0)}, 65, 90, 32)`;
      case "upper":
        return `${this.use("shiftCase")}(${a(0)}, 97, 122, -32)`;
      case "utf8":
        return `${this.use("utf8Bytes")}(${a(0)})`;
      case "ascii":
        return `${this.use("asciiOrNull")}(${a(0)})`;
      case "charAt":
        return `${this.use("charAtStr")}(${a(0)}, ${a(1)})`;
    }
  }
}

/** A test name: "[id] title (covers R1, R2)". */
const testName = (k: Clause) => `[${k.id}] ${k.title} (${k.covers.join(", ")})`;

const jsString = (s: string) => JSON.stringify(s);

const fnName = (k: Clause) => `clause_${k.id.replace(/[^A-Za-z0-9_]/g, "_")}`;

/** A source as a reader knows it: "RFC 8439", or its id for a spec that is not an RFC. */
function sourceName(c: RfcContract, id: string): string {
  const rfc = declaredSources(c).list.find((s) => s.id === id)?.rfc;
  return rfc ? `RFC ${rfc}` : id;
}

function docComment(c: RfcContract, k: Clause): string {
  const lines = ["/**", ` * ${k.title}`];
  for (const id of k.covers) {
    const r = c.requirements.find((x) => x.id === id);
    if (!r) continue;
    lines.push(
      " *",
      ` * ${r.id} — ${sourceName(c, sourceOf(c, r.source))} §${r.section}, ${r.level}:`,
    );
    for (const l of wrap(r.quote, 72))
      lines.push(` *   ${l.replace(/\*\//g, "* /")}`);
  }
  lines.push(" */");
  return lines.join("\n");
}

function wrap(text: string, width: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > width) {
      out.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}

function emitVector(em: Emitter, k: VectorClause): string {
  const sig = em.fns.get(k.call) as FnSig;
  const args = k.args.map((a, i) => em.literal(a, sig.params[i].type));
  const call = `${k.call}(${args.join(", ")})`;
  const name = jsString(testName(k));
  let body: string;
  switch (sig.returns) {
    case "bytes":
      body = `t.eqStr(${name}, ${em.use("hexOf")}(${call}), ${jsString(bytesToHex(literalBytes(k.expect) as Uint8Array))})`;
      break;
    case "bytes?": {
      const b = literalBytes(k.expect);
      body = `t.eqStr(${name}, ${em.use("hexOrNull")}(${call}), ${jsString(b ? bytesToHex(b) : "null")})`;
      break;
    }
    case "bool":
      body = `t.eqBool(${name}, ${call}, ${(k.expect as { bool: boolean }).bool})`;
      break;
    case "i32":
      body = `t.eqI32(${name}, ${call}, ${(k.expect as { int: number }).int})`;
      break;
    case "u32":
      body = `t.eqStr(${name}, \`\${${call}}\`, ${jsString(String((k.expect as { int: number }).int))})`;
      break;
    case "string":
      body = `t.eqStr(${name}, ${call}, ${jsString((k.expect as { str: string }).str)})`;
      break;
    case "string?": {
      const want = "str" in k.expect ? `"${k.expect.str}"` : "null";
      body = `t.eqStr(${name}, ${em.use("strOrNull")}(${call}), ${jsString(want)})`;
      break;
    }
  }
  return `const ${fnName(k)} = (t: Suite): boolean => ${body};`;
}

function emitProperty(
  em: Emitter,
  k: PropertyClause,
  ps: PropertySamples,
): string {
  const name = jsString(testName(k));
  const count = ps.samples.length;
  const out: string[] = [];
  out.push(`const ${fnName(k)} = (t: Suite): boolean => {`);
  if (count === 0) {
    out.push(`  t.skip(${name}, "no samples");`, "  return true;", "};");
    return out.join("\n");
  }
  for (const v of k.forall) {
    if (v.type === "i32") {
      const vals = ps.samples.map((s) => String(s[v.name] as number));
      out.push(`  const table_${v.name}: i32[] = [${vals.join(", ")}];`);
    } else {
      if (v.type === "bytes") em.use("unhex");
      const vals = ps.samples.map((s) =>
        jsString(
          v.type === "bytes"
            ? bytesToHex(s[v.name] as Uint8Array)
            : (s[v.name] as string),
        ),
      );
      out.push(`  const table_${v.name}: string[] = [`);
      for (const x of vals) out.push(`    ${x},`);
      out.push("  ];");
    }
  }
  const usesUnwrap = JSON.stringify(k.assert).includes('"op":"unwrap"');
  out.push(`  for (let i: i32 = 0; i < ${count}; i += 1) {`);
  em.vars = new Map(k.forall.map((v) => [v.name, v.type]));
  for (const v of k.forall) {
    if (v.type === "bytes")
      out.push(`    const v_${v.name}: u8[] = unhex(table_${v.name}[i]);`);
    else out.push(`    const v_${v.name}: ${v.type} = table_${v.name}[i];`);
  }
  if (usesUnwrap) out.push("    const u: Unwrap = new Unwrap();");
  const body = em.bindings(k.assert, "    ", out);
  out.push(`    const holds: boolean = ${em.expr(body)};`);
  const failCond = usesUnwrap ? "u.sawNull || !holds" : "!holds";
  const shown = k.forall
    .map((v) =>
      v.type === "i32"
        ? `${v.name} = \${v_${v.name}}`
        : `len(${v.name}) = \${toI32(v_${v.name}.length)}`,
    )
    .join(", ");
  out.push(`    if (${failCond}) {`);
  if (usesUnwrap) {
    out.push(`      let why: string = "the assertion is false";`);
    out.push(
      "      if (u.sawNull) {",
      `        why = "unwrap met a null";`,
      "      }",
    );
    out.push(
      `      return t.fail(${name}, \`sample \${i + 1} of ${count} (${shown}): \${why}\`);`,
    );
  } else {
    out.push(
      `      return t.fail(${name}, \`sample \${i + 1} of ${count} (${shown}): the assertion is false\`);`,
    );
  }
  out.push("    }", "  }");
  out.push(
    `  return t.pass(${jsString(`${testName(k)} — ${count} samples`)});`,
    "};",
  );
  return out.join("\n");
}

export interface EmitOptions {
  /** Shown in the header: how to regenerate the file. */
  regenerate?: string;
  /**
   * The sha256 of the contract file's bytes, written as a
   * `// vector-contract-sha256: <hex>` line that `vector spec stale` checks.
   */
  contractSha256?: string;
}

export const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** The hex of each `// vector-contract-sha256: <hex>` line in a test. */
export const contractShaLines = (test: string): string[] =>
  [...test.matchAll(/^\/\/ vector-contract-sha256: ([0-9a-f]{64})$/gm)].map(
    (m) => m[1],
  );

/**
 * Whether a generated test was emitted from these contract bytes: null when
 * it was, else why not. A test with no `vector-contract-sha256` line, or more
 * than one, is refused, as is one naming other bytes.
 */
export function staleReason(
  test: string,
  contractBytes: Uint8Array,
): string | null {
  const found = contractShaLines(test);
  if (found.length === 0)
    return "no `// vector-contract-sha256: <hex>` line: regenerate it with vector spec emit";
  if (found.length > 1)
    return `${found.length} vector-contract-sha256 lines: a test names one contract`;
  const want = sha256(contractBytes);
  if (found[0] !== want)
    return `stale: emitted from a contract with sha256 ${found[0]}, but the contract's is ${want}: regenerate it with vector spec emit`;
  return null;
}

/** The whole test program. */
export function emitNishTest(
  c: RfcContract,
  samples: Map<string, PropertySamples>,
  opts: EmitOptions = {},
): string {
  const em = new Emitter(c);
  const bodies: string[] = [];
  const called = new Set<string>();
  for (const k of c.clauses) {
    if (k.kind === "vector") {
      called.add(k.call);
      bodies.push(`${docComment(c, k)}\n${emitVector(em, k)}`);
    } else {
      callsIn(k.assert, called);
      const ps = samples.get(k.id) ?? {
        clauseId: k.id,
        samples: [],
        boundary: 0,
        random: 0,
        inhabited: "failed" as const,
        notes: [],
      };
      bodies.push(`${docComment(c, k)}\n${emitProperty(em, k, ps)}`);
    }
  }
  const header = [
    `// GENERATED by vector from the contract "${c.contract}" (${sourceName(c, declaredSources(c).main)},`,
    `// ${c.source.title}). Do not edit: change the contract and regenerate${opts.regenerate ? ` with\n//   ${opts.regenerate}` : ""}.`,
    "//",
    "// Each check names its clause in brackets and the requirements it covers in",
    "// parentheses; every requirement's RFC text is quoted above its checks.",
    "// Property samples were chosen by Z3 (boundaries) and a seeded PRNG.",
    ...(opts.contractSha256
      ? ["//", `// vector-contract-sha256: ${opts.contractSha256}`]
      : []),
  ];
  const byModule = new Map<string, string[]>();
  for (const name of [...called].sort()) {
    const mod = em.fns.get(name)?.module ?? c.target.module;
    byModule.set(mod, [...(byModule.get(mod) ?? []), name]);
  }
  const imports = [
    `import { Suite } from "nish/testing";`,
    ...[...byModule.entries()].map(
      ([mod, names]) => `import { ${names.join(", ")} } from ${jsString(mod)};`,
    ),
  ];
  const helpers = HELPER_ORDER.filter((h) => em.used.has(h)).map((h) =>
    h === "Unwrap" && em.used.has("unwrapStr")
      ? HELPERS.Unwrap.replace(/\n\}$/, `\n${UNWRAP_STR}\n}`)
      : HELPERS[h],
  );
  const main = [
    "export const main = (): i32 => {",
    `  const t: Suite = new Suite(${jsString(c.contract)});`,
    ...c.clauses.map((k) => `  ${fnName(k)}(t);`),
    "  return t.done();",
    "};",
  ];
  return `${[header.join("\n"), imports.join("\n"), ...helpers, ...bodies, main.join("\n")].join("\n\n")}\n`;
}

export { NISH_TY };
