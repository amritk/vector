import { afterAll, describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type PropertyClause,
  type RfcContract,
  validateContractShape,
} from "../src/rfc/contract.ts";
import { NishRefusal, emitNishTest } from "../src/rfc/emit-nish.ts";
import { extract } from "../src/rfc/extract.ts";
import { sampleContract } from "../src/rfc/sample.ts";
import {
  BASE_TYPES,
  INT_RANGE,
  INT_TYPES,
  LANGUAGES,
  LITERAL_KINDS,
  OUTCOMES,
  SIG_TYPES,
  baseOf,
  isOptional,
  outcomeOf,
} from "../src/rfc/vocab.ts";

const ROOT = join(import.meta.dir, "..");
type Json = unknown;
type Schema = Record<string, Json>;
const SCHEMA = JSON.parse(
  readFileSync(join(ROOT, "schemas/rfc-contract.json"), "utf8"),
) as Schema;
const DEFS = SCHEMA.$defs as Record<string, Schema>;

/** Keywords that describe and never constrain. */
const ANNOTATIONS = new Set([
  "$schema",
  "$comment",
  "$defs",
  "title",
  "description",
]);
const isObject = (v: Json): v is Record<string, Json> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** JSON Schema 2020-12 `type`, as §6.1.1 of its validation vocabulary reads it. */
function hasType(v: Json, t: Json): boolean {
  switch (t) {
    case "object":
      return isObject(v);
    case "array":
      return Array.isArray(v);
    case "string":
      return typeof v === "string";
    case "integer":
      return Number.isInteger(v);
    case "number":
      return typeof v === "number";
    case "boolean":
      return typeof v === "boolean";
    case "null":
      return v === null;
  }
  throw new Error(`unknown type ${JSON.stringify(t)}`);
}

/**
 * The errors `v` has against `s`, for exactly the JSON Schema 2020-12
 * keywords rfc-contract.json uses. Any other keyword throws, so a schema
 * change the validator cannot read fails the test instead of passing it.
 */
function check(s: Schema, v: Json, at = "$"): string[] {
  const errors: string[] = [];
  for (const [k, arg] of Object.entries(s)) {
    if (ANNOTATIONS.has(k)) continue;
    switch (k) {
      case "$ref": {
        const m = /^#\/\$defs\/([A-Za-z0-9]+)$/.exec(arg as string);
        if (!m || !DEFS[m[1]]) throw new Error(`unknown $ref ${arg}`);
        errors.push(...check(DEFS[m[1]], v, at));
        break;
      }
      case "type":
        if (!hasType(v, arg)) errors.push(`${at}: not ${arg}`);
        break;
      case "enum":
        if (!(arg as Json[]).includes(v)) errors.push(`${at}: not in enum`);
        break;
      case "const":
        if (v !== arg) errors.push(`${at}: not ${JSON.stringify(arg)}`);
        break;
      case "pattern":
        if (typeof v === "string" && !new RegExp(arg as string, "u").test(v))
          errors.push(`${at}: does not match ${arg}`);
        break;
      case "minLength":
        if (typeof v === "string" && [...v].length < (arg as number))
          errors.push(`${at}: shorter than ${arg}`);
        break;
      case "minimum":
        if (typeof v === "number" && v < (arg as number))
          errors.push(`${at}: below ${arg}`);
        break;
      case "maximum":
        if (typeof v === "number" && v > (arg as number))
          errors.push(`${at}: above ${arg}`);
        break;
      case "minItems":
        if (Array.isArray(v) && v.length < (arg as number))
          errors.push(`${at}: fewer than ${arg} items`);
        break;
      case "items":
        if (Array.isArray(v))
          v.forEach((x, i) =>
            errors.push(...check(arg as Schema, x, `${at}[${i}]`)),
          );
        break;
      case "required":
        if (isObject(v))
          for (const r of arg as string[])
            if (!(r in v)) errors.push(`${at}: missing ${r}`);
        break;
      case "properties":
        if (isObject(v))
          for (const [p, ps] of Object.entries(arg as Record<string, Schema>))
            if (p in v) errors.push(...check(ps, v[p], `${at}.${p}`));
        break;
      case "additionalProperties":
        if (arg !== false)
          throw new Error("additionalProperties other than false");
        if (isObject(v)) {
          const known = Object.keys((s.properties ?? {}) as Schema);
          for (const p of Object.keys(v))
            if (!known.includes(p)) errors.push(`${at}: unexpected ${p}`);
        }
        break;
      case "anyOf":
        if (!(arg as Schema[]).some((b) => check(b, v, at).length === 0))
          errors.push(`${at}: matches no anyOf branch`);
        break;
      default:
        throw new Error(`unknown keyword ${k}`);
    }
  }
  return errors;
}

const valid = (def: string, v: Json) => check({ $ref: `#/$defs/${def}` }, v);

describe("the validator", () => {
  test("refuses a keyword it does not know", () => {
    expect(() => check({ oneOf: [] }, 1)).toThrow("unknown keyword oneOf");
    expect(() => check({ type: "decimal" }, 1)).toThrow("unknown type");
    expect(() => check({ $ref: "#/$defs/nope" }, 1)).toThrow("unknown $ref");
    expect(() => check({ additionalProperties: {} }, {})).toThrow();
  });

  test("reads every keyword of the schema", () => {
    expect(() => check(SCHEMA, {})).not.toThrow();
    for (const d of Object.values(DEFS))
      expect(() => check(d, null)).not.toThrow();
  });

  test("checks each keyword", () => {
    expect(check({ type: "integer" }, 1.5)).toHaveLength(1);
    expect(check({ type: "number" }, 1.5)).toEqual([]);
    expect(check({ type: "null" }, null)).toEqual([]);
    expect(check({ minLength: 2 }, "é")).toHaveLength(1);
    expect(check({ minimum: 0, maximum: 1 }, 2)).toHaveLength(1);
    expect(check({ minItems: 1, items: { type: "string" } }, [])).toHaveLength(
      1,
    );
    expect(check({ items: { type: "string" } }, ["a", 1])).toEqual([
      "$[1]: not string",
    ]);
  });
});

describe("the schema spells the vocabulary", () => {
  const props = (s: Schema) => Object.keys(s.properties as Schema);

  test("signature types are every base type, plain and optional", () => {
    expect<string[]>([...SIG_TYPES]).toEqual(
      BASE_TYPES.flatMap((b) => [b, `${b}?`]),
    );
    expect(DEFS.paramType.enum).toEqual([...SIG_TYPES]);
    expect(DEFS.returnType.enum).toEqual([...SIG_TYPES]);
  });

  test("integer types", () => {
    expect(DEFS.intType.enum).toEqual([...INT_TYPES]);
    expect(Object.keys(INT_RANGE)).toEqual([...INT_TYPES]);
  });

  test("literal kinds are the literal forms' keys", () => {
    const keys = (DEFS.literal.anyOf as Schema[]).map((b) => props(b)[0]);
    expect(keys).toEqual([...LITERAL_KINDS]);
  });

  test("name and module overrides are keyed by language", () => {
    expect(props(DEFS.nameOverrides)).toEqual([...LANGUAGES]);
    expect(props(DEFS.moduleOverrides)).toEqual([...LANGUAGES]);
  });

  test("the descriptions name no language", () => {
    const text = JSON.stringify(SCHEMA).replace(/nish\/[a-z0-9/_]+/g, "");
    expect(text).not.toMatch(/\bnish\b|Secret<|expose\(|secret\(/i);
  });
});

describe("the vocabulary's helpers", () => {
  test("baseOf and isOptional", () => {
    expect(baseOf("u64?")).toBe("u64");
    expect(baseOf("secret-bytes")).toBe("secret-bytes");
    expect(isOptional("f64?")).toBe(true);
    expect(isOptional("bytes")).toBe(false);
  });

  test("outcomeOf reads B? by position", () => {
    expect(OUTCOMES).toEqual(["refusing-return", "optional-input"]);
    expect(outcomeOf("return", "bytes?")).toBe("refusing-return");
    expect(outcomeOf("param", "bytes?")).toBe("optional-input");
    expect(outcomeOf("return", "bytes")).toBeUndefined();
    expect(outcomeOf("param", "i8")).toBeUndefined();
  });

  test("INT_RANGE is two's complement and unsigned per width", () => {
    expect(INT_RANGE.i8).toEqual({ min: -128n, max: 127n });
    expect(INT_RANGE.u8).toEqual({ min: 0n, max: 255n });
    expect(INT_RANGE.i32).toEqual({ min: -2147483648n, max: 2147483647n });
    expect(INT_RANGE.u32.max).toBe(4294967295n);
    expect(INT_RANGE.i64).toEqual({
      min: -9223372036854775808n,
      max: 9223372036854775807n,
    });
    expect(INT_RANGE.u64.max).toBe(18446744073709551615n);
  });
});

describe("the committed contracts validate", () => {
  const files = readdirSync(join(ROOT, "contracts")).filter(
    (f) => f.endsWith(".json") && !f.endsWith(".survivors.json"),
  );
  test("they are the three committed contracts", () =>
    expect(files.sort()).toEqual([
      "example-hex.json",
      "rfc5869-hkdf-sha256.json",
      "rfc8439-chacha20-poly1305.json",
    ]));
  for (const f of files)
    test(f, () => {
      const c = JSON.parse(readFileSync(join(ROOT, "contracts", f), "utf8"));
      expect(check(SCHEMA, c)).toEqual([]);
    });
});

describe("a spec over the new types, end to end", () => {
  // extract-mini.xml with its interface on a non-nish module and three more
  // functions over i8, i16, u16, u64, i64, f64 and `T | null`, and a property
  // over the new integer widths.
  const xml = readFileSync(
    join(ROOT, "test/fixtures/extract/extract-mini.xml"),
    "utf8",
  )
    .replace("// module: nish/hex\n", "// module: lib/hex\n")
    .replace(
      "export const hexDecode = (text: string): u8[] | null\n",
      `export const hexDecode = (text: string): u8[] | null
export const widen = (a: i8, b: i16, c: u16, d: u64): i64
export const half = (x: f64): f64
export const low = (x: u32 | null): u8 | null
`,
    )
    .replace(
      "forall (b: u8[] /* 0..64 */) => hexEncode(b).length === 2 * b.length\n]]></sourcecode>",
      `forall (b: u8[] /* 0..64 */) => hexEncode(b).length === 2 * b.length
]]></sourcecode>
        <sourcecode type="ts-property"><![CDATA[
// P-WIDEN covers R-ENC-LEN — every width reaches i64
forall (a: i8 /* -128..127 */, b: i16 /* -32768..32767 */, c: u16 /* 0..65535 */, d: u64 /* 0..18446744073709551615 */) => widen(a, b, c, d) >= -9223372036854775808
]]></sourcecode>`,
    );
  const d = mkdtempSync(join(tmpdir(), "vector-type-flow-"));
  afterAll(() => rmSync(d, { recursive: true, force: true }));
  for (const sub of ["specs", "contracts", "rfcs"]) mkdirSync(join(d, sub));
  cpSync(join(ROOT, "rfcs/rfc4648.txt"), join(d, "rfcs/rfc4648.txt"));
  writeFileSync(join(d, "specs/extract-mini.xml"), xml);

  test("extracts, validates against the schema and the shape check, and samples every width", async () => {
    expect(xml).toContain("P-WIDEN");
    expect(xml).toContain("// module: lib/hex");
    const r = extract(
      join(d, "specs/extract-mini.xml"),
      join(d, "contracts/extract-mini.json"),
    );
    if (!("text" in r)) throw new Error(r.refusals.join("\n"));
    const c = JSON.parse(r.text) as RfcContract;
    expect(check(SCHEMA, c)).toEqual([]);
    expect(validateContractShape(c)).toEqual([]);
    expect(c.target.module).toBe("lib/hex");
    const sig = (n: string) => c.functions.find((f) => f.name === n);
    expect(sig("widen")).toEqual({
      name: "widen",
      params: [
        { name: "a", type: "i8" },
        { name: "b", type: "i16" },
        { name: "c", type: "u16" },
        { name: "d", type: "u64" },
      ],
      returns: "i64",
    });
    expect(sig("half")?.returns).toBe("f64");
    expect(sig("low")?.params[0]?.type).toBe("u32?");
    expect(sig("low")?.returns).toBe("u8?");
    const p = c.clauses.find((k) => k.id === "P-WIDEN") as PropertyClause;
    expect(
      p.forall.map((f) => [f.type, "min" in f && f.min, "max" in f && f.max]),
    ).toEqual([
      ["i8", -128, 127],
      ["i16", -32768, 32767],
      ["u16", 0, 65535],
      ["u64", 0, "18446744073709551615"],
    ]);
    const s = await sampleContract(c);
    const rows = s.properties.get("P-WIDEN")?.samples ?? [];
    expect(rows.map((x) => x.a)).toContain(-128);
    expect(rows.map((x) => x.b)).toContain(32767);
    expect(rows.map((x) => x.d)).toContain(18446744073709551615n);
    // Nish is the only emitter: a lib/ module is refused, with its name.
    expect(() => emitNishTest(c, s.properties)).toThrow(
      new NishRefusal(
        "Nish is the only emitter, and lib/hex is not a nish/ module",
      ),
    );
  });
});

describe("each new shape has a valid and an invalid example", () => {
  const cases: [string, Json[], Json[]][] = [
    [
      "paramType",
      ["i8", "u64?", "f64", "secret-bytes?", "bool?"],
      ["i128", "u64??", "float", "?"],
    ],
    [
      "literal",
      [
        { int: 42, label: "L" },
        { int: "18446744073709551615" },
        { int: "-9223372036854775808" },
        { f64: "0.1" },
        { f64: "-0", bits: "8000000000000000" },
        { f64: "NaN", bits: "7ff8000000000001" },
        { f64: "Infinity" },
        { f64: "1.5e-300", label: "x", unchecked: "computed" },
        { hex: "0b", label: "Key" },
        { ascii: "ab", label: "Info" },
      ],
      [
        { int: 9007199254740992 },
        { int: "42" },
        { int: "007199254740993000" },
        { int: 1.5 },
        { f64: 0.1 },
        { f64: "1." },
        { f64: ".5" },
        { f64: "nan" },
        { f64: "1", bits: "3FF0000000000000" },
        { f64: "1", bits: "3ff0" },
        { f64: "1", tolerance: { ulps: 1 } },
        { hex: "0b", label: "42" },
      ],
    ],
    [
      "tolerance",
      [
        { ulps: 4, section: "2.1", quote: "within 4 ulps" },
        { abs: "1e-9", source: "ieee", section: "A.1", quote: "to 1e-9" },
      ],
      [
        { ulps: -1, section: "2.1", quote: "q" },
        { abs: "-1", section: "2.1", quote: "q" },
        { abs: 0.1, section: "2.1", quote: "q" },
        { ulps: 1, abs: "0", section: "2.1", quote: "q" },
        { ulps: 1, section: "2.1" },
        { ulps: 1, section: "2.1", quote: "" },
      ],
    ],
    [
      "modulePath",
      ["nish/crypto/hkdf", "std/hash/sha2_256"],
      [
        "nish",
        "Nish/hex",
        "nish/crypto-hkdf",
        "nish//hex",
        "/nish/hex",
        "nish/2x",
      ],
    ],
    [
      "nameOverrides",
      [{}, { rust: "hkdf_expand", go: "Expand" }],
      [{ cobol: "X" }, { rust: "" }, { go: 1 }],
    ],
    [
      "moduleOverrides",
      [{ java: "org.example.Hkdf", c: "hkdf.h" }],
      [{ nish: "nish/hex" }, { java: "" }],
    ],
  ];
  for (const [def, good, bad] of cases)
    describe(def, () => {
      for (const v of good)
        test(`accepts ${JSON.stringify(v)}`, () =>
          expect(valid(def, v)).toEqual([]));
      for (const v of bad)
        test(`refuses ${JSON.stringify(v)}`, () =>
          expect(valid(def, v)).not.toEqual([]));
    });

  const vector = {
    kind: "vector",
    id: "T-1",
    title: "t",
    covers: ["R-1"],
    source: { cite: { section: "2" } },
    call: "f",
    args: [{ f64: "1" }],
    expect: { f64: "2" },
  };
  test("a vector takes a tolerance", () => {
    const tolerance = { ulps: 1, section: "2", quote: "one ulp" };
    expect(valid("vectorClause", { ...vector, tolerance })).toEqual([]);
    expect(valid("vectorClause", { ...vector, tolerance: {} })).not.toEqual([]);
  });

  const property = (forall: Json[]) => ({
    kind: "property",
    id: "P-1",
    title: "t",
    covers: ["R-1"],
    forall,
    assert: { bool: true },
  });
  test("a forall takes every integer width, with exact 64-bit bounds", () => {
    for (const type of INT_TYPES)
      expect(
        valid(
          "propertyClause",
          property([{ name: "n", type, min: 0, max: 1 }]),
        ),
      ).toEqual([]);
    const u64 = { name: "n", type: "u64", min: 0, max: "18446744073709551615" };
    expect(valid("propertyClause", property([u64]))).toEqual([]);
    const i128 = { name: "n", type: "i128", min: 0, max: 1 };
    expect(valid("propertyClause", property([i128]))).not.toEqual([]);
  });
  test("a forall records an f64 domain", () => {
    const f = { name: "x", type: "f64", min: "-1.5", max: "Infinity" };
    expect(valid("propertyClause", property([f]))).toEqual([]);
    const lenBound = { name: "x", type: "f64", minLen: 0, maxLen: 1 };
    expect(valid("propertyClause", property([lenBound]))).not.toEqual([]);
    expect(
      valid("propertyClause", property([{ ...f, min: -1.5 }])),
    ).not.toEqual([]);
    for (const nan of [
      { ...f, min: "NaN" },
      { ...f, max: "NaN" },
    ])
      expect(valid("propertyClause", property([nan]))).not.toEqual([]);
  });

  test("functions and params take names, the target takes modules", () => {
    const fn = {
      name: "hkdfExpand",
      names: { rust: "expand" },
      module: "nish/crypto/hmac",
      params: [{ name: "prk", names: { python: "prk" }, type: "secret-bytes" }],
      returns: "bytes?",
    };
    expect(valid("function", fn)).toEqual([]);
    expect(valid("function", { ...fn, names: { klingon: "x" } })).not.toEqual(
      [],
    );
    expect(valid("function", { ...fn, module: "nish" })).not.toEqual([]);
    const target = SCHEMA.properties as Record<string, Schema>;
    const t = { module: "nish/hex", modules: { go: "hex" } };
    expect(check(target.target, t)).toEqual([]);
    expect(check(target.target, { modules: { go: "hex" } })).not.toEqual([]);
  });
});
