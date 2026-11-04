import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import hkdfContract from "../contracts/rfc5869-hkdf-sha256.json";
import aeadContract from "../contracts/rfc8439-chacha20-poly1305.json";
import {
  ALPHABET_CLASSES,
  type Expr,
  type PropertyClause,
  type RfcContract,
  type VectorClause,
  alphabetChars,
  callsIn,
  validateContractShape,
} from "../src/rfc/contract.ts";
import { emitNishTest } from "../src/rfc/emit-nish.ts";
import { runGates } from "../src/rfc/gates.ts";
import { intLabelled, parseRfc } from "../src/rfc/rfctext.ts";
import { parseTestOutput, runNishTest } from "../src/rfc/run.ts";
import {
  type PropertySamples,
  evalPure,
  sampleContract,
} from "../src/rfc/sample.ts";

// The contract language's strings, lets and labelled ints. Every gate here has
// a refusing test next to its passing one.

const rfc5869 = parseRfc(readFileSync("rfcs/rfc5869.txt", "utf8"));
const rfc8439 = parseRfc(readFileSync("rfcs/rfc8439.txt", "utf8"));
const hkdf = hkdfContract as unknown as RfcContract;
const aead = aeadContract as unknown as RfcContract;
const clone = <T>(x: T): T => structuredClone(x);
const clause = <K extends RfcContract["clauses"][number]>(
  c: RfcContract,
  id: string,
) => c.clauses.find((k) => k.id === id) as K;

const v = (name: string): Expr => ({ var: name });
const op = (o: string, ...args: Expr[]) => ({ op: o, args }) as Expr;
const call = (f: string, ...args: Expr[]): Expr => ({ call: f, args });
const str = (s: string): Expr => ({ str: s });
const int = (n: number): Expr => ({ int: n });

/** HKDF plus two string functions, with one property over a hex string. */
function langContract(assert: Expr, where?: Expr): RfcContract {
  const c = clone(hkdf);
  c.functions.push(
    {
      name: "toHex",
      module: "nish/encoding/hex",
      params: [{ name: "b", type: "bytes" }],
      returns: "string",
    },
    {
      name: "fromHex",
      module: "nish/encoding/hex",
      params: [{ name: "s", type: "string" }],
      returns: "bytes?",
    },
  );
  const p: PropertyClause = {
    kind: "property",
    id: "P-HEX",
    title: "hex round-trips",
    covers: ["R-EXTRACT"],
    forall: [
      {
        name: "s",
        type: "string",
        minLen: 0,
        maxLen: 6,
        alphabet: ["HEXDIGIT"],
      },
      { name: "k", type: "i32", min: 0, max: 9 },
    ],
    assert,
    samples: 12,
  };
  if (where) p.where = where;
  c.clauses = [p];
  return c;
}

const roundTrip = {
  let: [
    { name: "b", value: op("unwrap", call("fromHex", v("s"))) },
    { name: "h", value: call("toHex", v("b")) },
  ],
  in: op(
    "and",
    op("==", v("h"), op("lower", v("s"))),
    op("==", op("strLen", v("h")), op("*", op("len", v("b")), int(2))),
  ),
} as Expr;
const evenLen = op("==", op("%", op("strLen", v("s")), int(2)), int(0));

const typingIssues = (c: RfcContract) =>
  runGates(c)
    .issues.filter((i) => i.gate === "typing")
    .map((i) => i.message);

describe("string values", () => {
  test("the shape accepts a string var, a let and a str literal", () => {
    expect(validateContractShape(langContract(roundTrip, evenLen))).toEqual([]);
    expect(typingIssues(langContract(roundTrip, evenLen))).toEqual([]);
  });

  test("the shape refuses a bad alphabet and bad lengths", () => {
    const bad = (patch: Record<string, unknown>) => {
      const c = langContract(roundTrip);
      Object.assign((c.clauses[0] as PropertyClause).forall[0], patch);
      return validateContractShape(c).join("\n");
    };
    expect(bad({ alphabet: ["base64"] })).toContain(
      "one printable ASCII character (or tab, LF, CR) or a class",
    );
    expect(bad({ alphabet: ["ab"] })).toContain("alphabet[0]");
    expect(bad({ alphabet: ["\u00e9"] })).toContain("alphabet[0]");
    expect(bad({ alphabet: [] })).toContain(
      "a non-empty array of characters and classes",
    );
    expect(bad({ alphabet: "hexdigit" })).toContain("a non-empty array");
    expect(bad({ minLen: 5, maxLen: 2 })).toContain(
      "string needs integer 0 <= minLen <= maxLen <= 4096",
    );
    expect(bad({ extra: 1 })).toContain('unknown field "extra"');
    expect(bad({ type: "text" })).toContain('"i32", "bytes" or "string"');
  });

  test("alphabets spell their classes once, and refuse an unknown one", () => {
    expect(alphabetChars(["digit", "0", "x"])).toEqual([
      ..."0123456789x".split(""),
    ]);
    expect(alphabetChars(["hexdigit", "HEXDIGIT"])?.length).toBe(22);
    expect(ALPHABET_CLASSES["ascii-printable"].length).toBe(95);
    expect(alphabetChars(["nope"])).toBeNull();
  });

  test("the shape refuses a str literal that is not printable ASCII", () => {
    const c = langContract(op("==", v("s"), str("caf\u00e9")));
    expect(validateContractShape(c).join("\n")).toContain(
      ".str: a string of printable ASCII, tab, LF or CR",
    );
    const ok = langContract(op("==", v("s"), str("a\tb\r\n")));
    expect(validateContractShape(ok)).toEqual([]);
  });

  test("typing refuses mixing strings with bytes and ints", () => {
    const bad = (e: Expr) => typingIssues(langContract(e)).join("\n");
    expect(bad(op("==", v("s"), { hex: "00" }))).toContain(
      "cannot compare string with bytes",
    );
    expect(bad(op("==", op("len", v("s")), int(1)))).toContain(
      "len wants bytes, got string",
    );
    expect(bad(op("==", op("strLen", { hex: "00" }), int(1)))).toContain(
      "strLen wants string, got bytes",
    );
    expect(bad(op("==", op("ascii", v("s")), str("")))).toContain(
      "ascii wants bytes, got string",
    );
    expect(bad(op("==", op("charAt", v("s"), str("0")), str("")))).toContain(
      "charAt wants i32, got string",
    );
    expect(bad(op("==", op("upper", v("s"), v("s")), str("")))).toContain(
      "upper takes 1 argument(s), got 2",
    );
    expect(bad(op("==", op("strConcat", v("s"), int(1)), str("")))).toContain(
      "strConcat wants string, got i32",
    );
    expect(
      validateContractShape(langContract({ text: "x" } as never)).join("\n"),
    ).toContain("not a literal (hex, ascii, str, int, bool, null, concat)");
    for (const part of [
      { int: 5 },
      { str: "a" },
      { bool: true },
      { null: true },
    ]) {
      expect(
        validateContractShape(
          langContract(
            op("==", op("utf8", v("s")), {
              concat: [{ ascii: "a" }, part],
            } as never),
          ),
        ).join("\n"),
      ).toContain(".concat[1]: a bytes literal (hex, ascii, concat)");
    }
    expect(bad(op("isNull", v("s")))).toContain(
      "isNull wants bytes? or string?, got string",
    );
    expect(bad(op("==", { null: true }, { null: true }))).toContain(
      "cannot compare null with null",
    );
    // A string? must be unwrapped before it is used as a string.
    expect(
      bad(op("==", op("strLen", op("ascii", op("utf8", v("s")))), int(0))),
    ).toContain("strLen wants string, got string?");
  });

  test("string? compares with null and unwraps to a string", () => {
    const ok = (e: Expr) => typingIssues(langContract(e));
    expect(ok(op("notNull", op("ascii", op("utf8", v("s")))))).toEqual([]);
    expect(
      ok(op("==", op("strConcat", v("s"), str("!")), op("upper", v("s")))),
    ).toEqual([]);
    expect(ok(op("==", op("ascii", { hex: "ff" }), { null: true }))).toEqual(
      [],
    );
    expect(
      ok(op("==", op("unwrap", op("ascii", op("utf8", v("s")))), v("s"))),
    ).toEqual([]);
  });

  test("the declared signature types read string and string | null", () => {
    // In the target module, so the signature gate reads them.
    const c = langContract(roundTrip, evenLen);
    for (const f of c.functions) f.module = undefined;
    const fromHex = c.functions.find((f) => f.name === "fromHex");
    if (fromHex) fromHex.params[0].type = "string?";
    const sigs = (toHex: string, fromHexSig: string) =>
      runGates(c, {
        moduleSource: [
          `export const toHex = ${toHex} => {`,
          `export const fromHex = ${fromHexSig} => {`,
        ].join("\n"),
      })
        .issues.filter((i) => i.gate === "signatures" && i.at.endsWith("Hex"))
        .map((i) => i.message);
    expect(
      sigs("(b: u8[]): string", "(s: string | null): u8[] | null"),
    ).toEqual([]);
    expect(
      sigs("(b: u8[]): string", "(s: null | string): u8[] | null"),
    ).toEqual([]);
    expect(sigs("(b: u8[]): u8[]", "(s: string): u8[] | null")).toEqual([
      "declared (bytes) -> string, but nish/crypto/hkdf has (u8[]): u8[]",
      "declared (string?) -> bytes?, but nish/crypto/hkdf has (string): u8[] | null",
    ]);
  });
});

describe("let bindings", () => {
  test("a let may only open the assert (or a let's in)", () => {
    const nested = langContract(op("and", roundTrip, op(">=", v("k"), int(0))));
    expect(validateContractShape(nested).join("\n")).toContain(
      `a let may only open the assert (or a let's "in")`,
    );
    const inWhere = langContract(roundTrip, roundTrip);
    expect(validateContractShape(inWhere).join("\n")).toContain(
      "where: a let may only open",
    );
    const chained = langContract({
      let: [{ name: "a", value: v("s") }],
      in: { let: [{ name: "b", value: v("a") }], in: op("==", v("a"), v("b")) },
    } as Expr);
    expect(validateContractShape(chained)).toEqual([]);
    expect(typingIssues(chained)).toEqual([]);
  });

  test("the shape refuses bad names and empty or malformed bindings", () => {
    const shape = (e: unknown) =>
      validateContractShape(langContract(e as Expr)).join("\n");
    const tail = op("==", v("s"), v("s"));
    expect(shape({ let: [{ name: "1x", value: v("s") }], in: tail })).toContain(
      ".let[0].name: an identifier",
    );
    expect(shape({ let: [], in: tail })).toContain(
      ".let: a non-empty array of {name, value}",
    );
    expect(shape({ let: ["x"], in: tail })).toContain(".let[0]: an object");
    expect(
      shape({ let: [{ name: "x", value: v("s"), type: "i32" }], in: tail }),
    ).toContain('unknown field "type"');
  });

  test("typing refuses shadowing, a bare null and an unknown name", () => {
    const issues = (bs: { name: string; value: Expr }[], body: Expr) =>
      typingIssues(langContract({ let: bs, in: body } as Expr)).join("\n");
    const t = op("==", v("s"), v("s"));
    expect(issues([{ name: "s", value: str("x") }], t)).toContain(
      '"s" shadows a name already in scope',
    );
    expect(issues([{ name: "toHex", value: str("x") }], t)).toContain(
      '"toHex" shadows a name already in scope',
    );
    expect(
      issues(
        [
          { name: "a", value: str("x") },
          { name: "a", value: str("y") },
        ],
        t,
      ),
    ).toContain('"a" shadows');
    expect(issues([{ name: "n", value: { null: true } }], t)).toContain(
      "a bare null has no type to bind",
    );
    expect(issues([{ name: "n", value: v("nope") }], t)).toContain(
      'unknown variable "nope"',
    );
    // A binding is not in scope before it is bound.
    expect(
      issues(
        [
          { name: "a", value: v("b") },
          { name: "b", value: v("s") },
        ],
        t,
      ),
    ).toContain('unknown variable "b"');
    // ...nor outside its let.
    expect(
      typingIssues(
        langContract(roundTrip, op("==", op("strLen", v("h")), int(0))),
      ).join("\n"),
    ).toContain('unknown variable "h"');
  });

  test("calls are found inside bindings", () => {
    expect([...callsIn(roundTrip)].sort()).toEqual(["fromHex", "toHex"]);
  });

  test("the 8439 contract names its seal once and is still valid", () => {
    const g = runGates(aead, { rfc: rfc8439 });
    expect(g.issues).toEqual([]);
    const p = clause<PropertyClause>(aead, "P-TAG-IS-POLY1305");
    expect("let" in p.assert).toBe(true);
    expect(
      JSON.stringify(p.assert).match(/chacha20Poly1305Seal/g),
    ).toHaveLength(1);
  });
});

describe("the pure evaluator", () => {
  test("evaluates every string op as the emitted helpers do", () => {
    const env = { s: "Ab0z" };
    const ev = (e: Expr) => evalPure(e, env);
    expect(ev(op("strLen", v("s")))).toBe(4);
    expect(ev(op("strConcat", v("s"), str("!")))).toBe("Ab0z!");
    expect(ev(op("lower", v("s")))).toBe("ab0z");
    expect(ev(op("upper", v("s")))).toBe("AB0Z");
    expect(ev(op("utf8", v("s")))).toEqual(Uint8Array.from([65, 98, 48, 122]));
    expect(ev(op("ascii", { hex: "41007f" }))).toBe("A\x00\x7f");
    expect(ev(op("ascii", { hex: "4180" }))).toBeNull();
    expect(ev(op("charAt", v("s"), int(1)))).toBe("b");
    expect(ev(op("charAt", v("s"), int(4)))).toBe("");
    expect(ev(op("charAt", v("s"), int(-1)))).toBe("");
    expect(ev(op("==", op("charAt", v("s"), int(9)), str("")))).toBe(true);
    expect(ev(op("==", v("s"), str("Ab0z")))).toBe(true);
    expect(ev(op("!=", v("s"), str("ab0z")))).toBe(true);
    expect(ev(op("==", op("ascii", { hex: "ff" }), { null: true }))).toBe(true);
  });

  test("evaluates bindings in order, each seeing the ones before", () => {
    const e = {
      let: [
        { name: "a", value: op("upper", v("s")) },
        { name: "b", value: op("strConcat", v("a"), v("a")) },
      ],
      in: op("strLen", v("b")),
    } as Expr;
    expect(evalPure(e, { s: "xy" })).toBe(4);
  });

  test("a binding named __proto__ is an ordinary name", () => {
    for (const name of ["__proto__", "constructor", "toString"]) {
      const e = { let: [{ name, value: int(5) }], in: v(name) } as Expr;
      expect(evalPure(e, {})).toBe(5);
    }
  });
});

describe("sampling string variables", () => {
  test("lengths hit the bounds, characters come from the alphabet", async () => {
    const c = langContract(roundTrip, evenLen);
    const s = await sampleContract(c);
    expect(s.ok).toBe(true);
    const got = (s.properties.get("P-HEX") as PropertySamples).samples.map(
      (x) => x.s as string,
    );
    expect(got.length).toBeGreaterThanOrEqual(12);
    const lens = new Set(got.map((x) => x.length));
    expect(lens.has(0)).toBe(true);
    expect(lens.has(6)).toBe(true);
    for (const x of got) {
      expect(x.length % 2).toBe(0);
      expect(x).toMatch(/^[0-9A-F]*$/);
    }
    // Deterministic: the same contract samples the same strings.
    const again = await sampleContract(c);
    expect(
      (again.properties.get("P-HEX") as PropertySamples).samples.map(
        (x) => x.s,
      ),
    ).toEqual(got);
  });

  test("a let-bound comparison still steers the solver", async () => {
    const c = langContract({
      let: [{ name: "n", value: op("strLen", v("s")) }],
      in: op(
        "implies",
        op(">=", v("n"), int(5)),
        op("==", op("charAt", v("s"), op("-", v("n"), int(1))), str("A")),
      ),
    } as Expr);
    const s = await sampleContract(c);
    expect(s.ok).toBe(true);
    const lens = new Set(
      (s.properties.get("P-HEX") as PropertySamples).samples.map(
        (x) => (x.s as string).length,
      ),
    );
    expect(lens.has(4)).toBe(true);
    expect(lens.has(5)).toBe(true);
  });

  test("lengths of str literals, concatenations and charAt are linear terms", async () => {
    const c = langContract(
      op("==", v("s"), v("s")),
      op(
        "==",
        op(
          "strLen",
          op(
            "strConcat",
            op("lower", v("s")),
            op("strConcat", str("ab"), op("charAt", v("s"), v("k"))),
          ),
        ),
        int(5),
      ),
    );
    const s = await sampleContract(c);
    expect(s.ok).toBe(true);
    for (const x of (s.properties.get("P-HEX") as PropertySamples).samples) {
      const n = (x.s as string).length;
      const k = x.k as number;
      expect(n + 2 + (k < n ? 1 : 0)).toBe(5);
    }
  });

  test("a domain no string can meet is refused as vacuous", async () => {
    const c = langContract(
      op("==", v("s"), v("s")),
      op(">", op("strLen", op("upper", v("s"))), int(6)),
    );
    const s = await sampleContract(c);
    expect(s.ok).toBe(false);
    expect(s.issues[0].message).toContain("vacuously");
  });
});

describe("emitting strings and lets", () => {
  const emitted = async (c: RfcContract) =>
    emitNishTest(c, (await sampleContract(c)).properties);

  test("bindings become const locals before the assertion", async () => {
    const src = await emitted(langContract(roundTrip, evenLen));
    expect(src).toContain(
      `import { fromHex, toHex } from "nish/encoding/hex";`,
    );
    expect(src).toContain("const table_s: string[] = [");
    expect(src).toContain("const v_s: string = table_s[i];");
    expect(src).toContain("const v_b: u8[] = u.get(fromHex(v_s));");
    expect(src).toContain("const v_h: string = toHex(v_b);");
    expect(src).toContain(
      "const holds: boolean = (strEq(v_h, shiftCase(v_s, 65, 90, 32)) && (toI32(v_h.length) === (toI32(v_b.length) * 2)));",
    );
    expect(src.indexOf("const v_h")).toBeLessThan(src.indexOf("const holds"));
    expect(src).toContain("const strEq = ");
    expect(src).toContain("const shiftCase = ");
    expect(src).not.toContain("const unhex");
    expect(src).not.toContain("str(s: string | null)");
  });

  test("each string op maps to its helper", async () => {
    const src = await emitted(
      langContract(
        op(
          "and",
          op("==", op("upper", v("s")), op("strConcat", v("s"), str("\t"))),
          op("isNull", op("ascii", op("utf8", v("s")))),
          op("notNull", op("ascii", { hex: "41" })),
          op("==", op("charAt", v("s"), v("k")), str("x")),
          op("!=", { null: true }, op("ascii", { hex: "41" })),
          op("==", { null: true }, call("fromHex", v("s"))),
          op("==", op("unwrap", op("ascii", { hex: "41" })), str("A")),
          op("==", op("utf8", v("s")), { hex: "" }),
        ),
      ),
    );
    for (const h of [
      "const shiftCase",
      "const utf8Bytes",
      "const asciiOrNull",
      "const charAtStr",
      "const isNullStr",
      "const strEq",
      "const bytesEq",
    ]) {
      expect(src).toContain(h);
    }
    expect(src).toContain("shiftCase(v_s, 97, 122, -32)");
    expect(src).toContain('`${v_s}${"\\t"}`');
    expect(src).toContain("isNullStr(asciiOrNull(utf8Bytes(v_s)))");
    expect(src).toContain("!isNullStr(asciiOrNull(");
    expect(src).toContain("charAtStr(v_s, v_k)");
    expect(src).toContain("!strEq(null, asciiOrNull(");
    expect(src).toContain("bytesEq(null, fromHex(v_s))");
    expect(src).toContain("u.str(asciiOrNull(");
    expect(src).toContain("str(s: string | null): string {");
    expect(src).toContain("bytesEq(utf8Bytes(v_s), ");
    expect(src).not.toContain("isNullBytes");
  });

  test("a vector returning string or string? compares as text", () => {
    const c = langContract(op("==", v("s"), v("s")));
    c.functions.push({
      name: "parse",
      module: "nish/encoding/hex",
      params: [{ name: "b", type: "bytes" }],
      returns: "string?",
    });
    const vec = (id: string, fn: string, expect: VectorClause["expect"]) =>
      ({
        kind: "vector",
        id,
        title: id,
        covers: ["R-EXTRACT"],
        source: { cite: { section: "2.2" } },
        call: fn,
        args: [{ hex: "41" }],
        expect,
      }) as VectorClause;
    c.clauses = [
      vec("V-STR", "toHex", { str: "41" }),
      vec("V-OPT", "parse", { str: "A" }),
      vec("V-NULL", "parse", { null: true }),
    ];
    const src = emitNishTest(c, new Map());
    expect(src).toContain(`(R-EXTRACT)", toHex(unhex("41")), "41")`);
    expect(src).toContain(`(R-EXTRACT)", strOrNull(parse(`);
    expect(src).toContain(`"\\"A\\""`);
    expect(src).toContain(`strOrNull(parse(unhex("41"))), "null")`);
    expect(src).toContain("const strOrNull = ");
  });

  test("a let that is not at the top cannot be emitted", () => {
    const c = langContract(op("not", roundTrip));
    const one: PropertySamples = {
      clauseId: "P-HEX",
      samples: [{ s: "", k: 0 }],
      boundary: 1,
      random: 0,
      inhabited: "z3",
      notes: [],
    };
    expect(() => emitNishTest(c, new Map([["P-HEX", one]]))).toThrow(
      "a let may only open the assert",
    );
  });

  test("the shipped contracts emit lets as locals", async () => {
    const src = await emitted(aead);
    expect(src).toContain("const v_sealed: u8[] = u.get(chacha20Poly1305Seal(");
  });
});

describe("labelled ints", () => {
  test("a label pins the integer to the name the RFC prints it under", () => {
    const text = "Block Count = 1.  L = 42\nZ=420  W=1.5  N: 0x2A  M 0X0b";
    expect(intLabelled(text, "Block Count", 1)).toBe(true);
    expect(intLabelled(text, "L", 42)).toBe(true);
    expect(intLabelled(text, "N", 42)).toBe(true);
    expect(intLabelled(text, "M", 11)).toBe(true);
    expect(intLabelled(text, "Z", 42)).toBe(false);
    expect(intLabelled(text, "W", 1)).toBe(false);
    expect(intLabelled(text, "l", 42)).toBe(false);
    expect(intLabelled(text, "Count", 1)).toBe(true);
    expect(intLabelled(text, "ount", 1)).toBe(false);
    expect(intLabelled("x = -3", "x", -3)).toBe(true);
    expect(intLabelled("x = 3", "x", -3)).toBe(false);
    expect(intLabelled("a.b (c) = 7", "a.b (c)", 7)).toBe(true);
  });

  test("the label and the number both end at a real boundary", () => {
    for (const t of [
      "(L = 42)",
      "L = 42, M = 1",
      "L = 42.",
      "L = 0x2A;",
      "L = 42/",
    ])
      expect(intLabelled(t, "L", 42)).toBe(true);
    // The label is the tail of a longer identifier.
    for (const t of [
      "MAX_L = 42",
      "key_L: 42",
      "T-L = 42",
      "x.L = 42",
      "XL = 42",
    ])
      expect(intLabelled(t, "L", 42)).toBe(false);
    // The number is the head of a longer one.
    for (const [t, n] of [
      ["L = 1,000", 1],
      ["L = 4-5", 4],
      ["L = 12:30", 12],
      ["L = 255/256", 255],
      ["L = 1.5", 1],
      ["L = 42_0", 42],
      ["L = 0x2a,0x2b", 42],
      ["L = 0x2a-0x2b", 42],
      ["L = 0x2ab", 42],
      ["L = -42", 42],
    ] as const)
      expect(intLabelled(t, "L", n)).toBe(false);
  });

  test("the shipped contracts label every vector int, and they are found", () => {
    for (const [c, rfc] of [
      [hkdf, rfc5869],
      [aead, rfc8439],
    ] as const) {
      const g = runGates(c, { rfc });
      expect(g.issues).toEqual([]);
      expect(
        g.warnings.filter((w) => w.message.includes('no "label"')),
      ).toEqual([]);
    }
  });

  test("an unlabelled int is a warning; a wrong label is refused", () => {
    const c = clone(hkdf);
    const k = clause<VectorClause>(c, "A.1-OKM");
    const len = k.args.find((a) => "int" in a) as {
      int: number;
      label?: string;
    };
    len.label = undefined;
    let g = runGates(c, { rfc: rfc5869 });
    expect(g.ok).toBe(true);
    expect(g.warnings.map((w) => w.message)).toContain(
      `not checked against the RFC: the integer ${len.int} has no "label" to find it by`,
    );
    len.label = "IKM";
    g = runGates(c, { rfc: rfc5869 });
    expect(g.ok).toBe(false);
    expect(g.issues.map((i) => i.message)).toContain(
      `RFC §A.1 does not print "IKM" followed by ${len.int}`,
    );
    len.label = "L";
    len.int += 1;
    g = runGates(c, { rfc: rfc5869 });
    expect(g.ok).toBe(false);
    expect(g.issues.map((i) => i.message)).toContain(
      `RFC §A.1 does not print "L" followed by ${len.int}`,
    );
  });

  test("the shape refuses a label without a letter", () => {
    for (const label of [" ", "=", ": ", "-", "5", "1 2"]) {
      const c = clone(hkdf);
      const k = clause<VectorClause>(c, "A.1-OKM");
      (k.args.find((a) => "int" in a) as { label: string }).label = label;
      expect(validateContractShape(c).join("\n")).toContain(
        ".label: the name the RFC prints the value under, with a letter",
      );
    }
  });
});

describe("str fidelity", () => {
  const withStr = (s: string) => {
    const c = langContract(op("==", v("s"), v("s")));
    c.clauses = [
      {
        kind: "vector",
        id: "V-STR",
        title: "x",
        covers: ["R-EXTRACT"],
        source: { cite: { section: "2.2" } },
        call: "toHex",
        args: [{ hex: "00", unchecked: "not an RFC value" }],
        expect: { str: s },
      },
    ];
    return runGates(c, { rfc: rfc5869 }).issues.filter(
      (i) => i.gate === "fidelity",
    );
  };

  test("a str literal must be printed in the cited section", () => {
    expect(withStr("HKDF-Extract(salt, IKM)")).toEqual([]);
    expect(withStr("HKDF-Extract(salt, IKM, X)").map((i) => i.message)).toEqual(
      [
        `the string "HKDF-Extract(salt, IKM, X)" is not printed in RFC §2.2 ("Step 1: Extract")`,
      ],
    );
  });

  test("an empty or unnormalised str is refused, not matched", () => {
    for (const s of ["", " ", "HKDF-Extract(salt,   IKM)", " HKDF", "HKDF\n"]) {
      expect(withStr(s).map((i) => i.message)).toEqual([
        `the string ${JSON.stringify(s)} is empty or has leading, trailing or repeated whitespace, so it cannot be matched against the RFC text`,
      ]);
    }
  });
});

// Against a real nish (VECTOR_NISH=<path to a nish binary>): the string helpers
// compile and agree with the evaluator. Skips without one, unless
// VECTOR_REQUIRE_NISH=1 makes that a failure.
const nish = process.env.VECTOR_NISH;
if (process.env.VECTOR_REQUIRE_NISH === "1" && !nish)
  test("VECTOR_NISH is set (VECTOR_REQUIRE_NISH=1)", () => {
    throw new Error(
      "VECTOR_REQUIRE_NISH=1 but VECTOR_NISH is unset: the live nish tests would skip",
    );
  });
describe.skipIf(!nish)("against nish", () => {
  test("the string helpers hold the evaluator's laws", async () => {
    const c = clone(hkdf);
    c.clauses = [
      {
        kind: "property",
        id: "P-STRINGS",
        title: "string helpers",
        covers: ["R-EXTRACT"],
        forall: [
          {
            name: "s",
            type: "string",
            minLen: 0,
            maxLen: 12,
            alphabet: ["ascii-printable", "space"],
          },
          { name: "k", type: "i32", min: -2, max: 14 },
        ],
        assert: {
          let: [
            { name: "lo", value: op("lower", v("s")) },
            { name: "b", value: op("utf8", v("s")) },
          ],
          in: op(
            "and",
            op("==", op("lower", op("upper", v("lo"))), v("lo")),
            op("==", op("strLen", v("lo")), op("len", v("b"))),
            op("==", op("unwrap", op("ascii", v("b"))), v("s")),
            op("isNull", op("ascii", op("concat", v("b"), { hex: "80" }))),
            op(
              "implies",
              op(
                "and",
                op(">=", v("k"), int(0)),
                op("<", v("k"), op("strLen", v("s"))),
              ),
              op("==", op("strLen", op("charAt", v("s"), v("k"))), int(1)),
            ),
            op(
              "implies",
              op(">=", v("k"), op("strLen", v("s"))),
              op("==", op("charAt", v("s"), v("k")), str("")),
            ),
            op(
              "==",
              op("strConcat", v("s"), str("!")),
              op("unwrap", op("ascii", op("concat", v("b"), { hex: "21" }))),
            ),
          ),
        },
      } as PropertyClause,
    ];
    const s = await sampleContract(c);
    expect(s.ok).toBe(true);
    const run = await runNishTest(
      c,
      emitNishTest(c, s.properties),
      nish as string,
    );
    expect(run.stderr).toBe("");
    expect(parseTestOutput(c, run.stdout).get("P-STRINGS")?.outcome).toBe(
      "pass",
    );
  }, 600_000);
});
