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
  literalBytes,
} from "./contract.ts";
import type { PropertySamples } from "./sample.ts";

const NISH_TY: Record<ValueTy, string> = {
  bytes: "u8[]",
  "bytes?": "u8[] | null",
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

const HELPER_DEPS: Record<string, string[]> = {
  hexOrNull: ["hexOf"],
  unhex: ["nibble"],
  flipBit: ["sliceBytes"],
};
const HELPER_ORDER = Object.keys(HELPERS);

class Emitter {
  readonly used = new Set<string>();
  readonly fns: Map<string, FnSig>;

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
    return this.bytesLit(literalBytes(lit) as Uint8Array);
  }

  /** An expression; `vars` maps contract names to emitted locals. */
  expr(e: Expr, want?: ValueTy): string {
    if ("var" in e) return want === "u32" ? `toU32(v_${e.var})` : `v_${e.var}`;
    if ("call" in e) {
      const sig = this.fns.get(e.call) as FnSig;
      const args = e.args.map((a, i) => this.expr(a, sig.params[i].type));
      return `${e.call}(${args.join(", ")})`;
    }
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
        this.use("Unwrap");
        return `u.get(${a(0)})`;
      case "isNull":
        return `${this.use("isNullBytes")}(${a(0)})`;
      case "notNull":
        return `!${this.use("isNullBytes")}(${a(0)})`;
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
        if (isBytesish(e.args[0], this) || isBytesish(e.args[1], this)) {
          const eq = `${this.use("bytesEq")}(${a(0)}, ${a(1)})`;
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
    }
  }
}

function isBytesish(e: Expr, em: Emitter): boolean {
  if ("hex" in e || "ascii" in e || "concat" in e || "null" in e) return true;
  if ("call" in e) {
    const r = em.fns.get(e.call)?.returns;
    return r === "bytes" || r === "bytes?";
  }
  if ("op" in e) {
    return [
      "concat",
      "slice",
      "zeros",
      "fill",
      "flipBit",
      "unwrap",
      "le64",
    ].includes(e.op);
  }
  return false;
}

/** A test name: "[id] title (covers R1, R2)". */
const testName = (k: Clause) => `[${k.id}] ${k.title} (${k.covers.join(", ")})`;

const jsString = (s: string) => JSON.stringify(s);

const fnName = (k: Clause) => `clause_${k.id.replace(/[^A-Za-z0-9_]/g, "_")}`;

function docComment(c: RfcContract, k: Clause): string {
  const lines = ["/**", ` * ${k.title}`];
  for (const id of k.covers) {
    const r = c.requirements.find((x) => x.id === id);
    if (!r) continue;
    lines.push(
      " *",
      ` * ${r.id} — RFC ${c.source.rfc} §${r.section}, ${r.level}:`,
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
      em.use("unhex");
      const vals = ps.samples.map((s) =>
        jsString(bytesToHex(s[v.name] as Uint8Array)),
      );
      out.push(`  const table_${v.name}: string[] = [`);
      for (const x of vals) out.push(`    ${x},`);
      out.push("  ];");
    }
  }
  const assertCode = em.expr(k.assert);
  const usesUnwrap = JSON.stringify(k.assert).includes('"op":"unwrap"');
  out.push(`  for (let i: i32 = 0; i < ${count}; i += 1) {`);
  for (const v of k.forall) {
    if (v.type === "i32")
      out.push(`    const v_${v.name}: i32 = table_${v.name}[i];`);
    else out.push(`    const v_${v.name}: u8[] = unhex(table_${v.name}[i]);`);
  }
  if (usesUnwrap) out.push("    const u: Unwrap = new Unwrap();");
  out.push(`    const holds: boolean = ${assertCode};`);
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
    `// GENERATED by vector from the contract "${c.contract}" (RFC ${c.source.rfc},`,
    `// ${c.source.title}). Do not edit: change the contract and regenerate${opts.regenerate ? ` with\n//   ${opts.regenerate}` : ""}.`,
    "//",
    "// Each check names its clause in brackets and the requirements it covers in",
    "// parentheses; every requirement's RFC text is quoted above its checks.",
    "// Property samples were chosen by Z3 (boundaries) and a seeded PRNG.",
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
  const helpers = HELPER_ORDER.filter((h) => em.used.has(h)).map(
    (h) => HELPERS[h],
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
