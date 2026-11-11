import { describe, expect, test } from "bun:test";
import hexContract from "../contracts/example-hex.json";
import type { FnSig, PropertyClause } from "../src/rfc/contract.ts";
import {
  type FrontEnd,
  type FrontRefusal,
  frontEndFor,
} from "../src/rfc/front/index.ts";

const ts = frontEndFor("ts-property") as FrontEnd;
const HEX_FNS = hexContract.functions as FnSig[];

/** Functions with every parameter type, for the mapping tests. */
const FNS: FnSig[] = [
  ...HEX_FNS,
  {
    name: "seal",
    params: [
      { name: "key", type: "secret-bytes" },
      { name: "n", type: "u32" },
    ],
    returns: "secret-bytes?",
  },
];

function parsed(text: string, fns = FNS) {
  const r = ts.parseProperty(text, fns);
  if ("refusals" in r) throw new Error(JSON.stringify(r.refusals));
  return r;
}

/** Where `needle` last occurs in `text`, as a refusal position. */
function posOf(text: string, needle: string): { line: number; col: number } {
  const i = text.lastIndexOf(needle);
  if (i < 0) throw new Error(`no ${needle} in ${text}`);
  const before = text.slice(0, i).split("\n");
  return { line: before.length, col: before[before.length - 1].length + 1 };
}

function refusal(r: object): FrontRefusal {
  if (!("refusals" in r)) throw new Error(`accepted: ${JSON.stringify(r)}`);
  const { refusals } = r as { refusals: FrontRefusal[] };
  expect(refusals).toHaveLength(1);
  return refusals[0];
}

// ── The acceptance test: example-hex, byte for byte ───────────────────────

const OTHER = hexContract.clauses.find((k) => k.id === "P-OTHER") as {
  forall: { alphabet: string[] }[];
};
const OTHER_EDGE = hexContract.clauses.find((k) => k.id === "P-OTHER-EDGE") as {
  forall: { alphabet: string[] }[];
};
const alpha = (k: typeof OTHER) =>
  JSON.stringify(k.forall[1].alphabet.join(""));
const EVEN = "where t.length % 2 === 0";
const HEX_T = "t: string /* 0..32 hexdigit HEXDIGIT */";
const otherText = (
  id: string,
  title: string,
  x: string,
) => `// ${id} covers R-DEC-REJECT — ${title}
forall (
  a: string /* 0..16 hexdigit HEXDIGIT */,
  x: string /* 1..1 ${x} */,
  z: string /* 0..16 hexdigit HEXDIGIT */,
) => hexDecode(a + (x + z)) === null
where (a + (x + z)).length % 2 === 0`;

const HEX_PROPERTIES: Record<string, string> = {
  "P-ENC-LEN": `// P-ENC-LEN covers R-ENC-LEN — two characters per byte
forall (b: u8[] /* 0..64 */) => hexEncode(b).length === 2 * b.length`,
  "P-ENC-LOWER": `// P-ENC-LOWER covers R-ENC-ONLY — the encoding has no uppercase digit
forall (b: u8[] /* 0..64 */) => {
  const e = hexEncode(b);
  return e === e.toLowerCase();
}`,
  "P-ROUND-TRIP": `// P-ROUND-TRIP covers R-ROUND-TRIP, R-ENC-ONLY — hexDecode(hexEncode(b)) is b
forall (b: u8[] /* 0..64 */) => {
  const d = hexDecode(hexEncode(b));
  return d !== null && unwrap(d) === b;
}`,
  "P-CANONICAL": `// P-CANONICAL covers R-ENC-DIGITS, R-DEC-ACCEPT — lowercase hex re-encodes to itself, high nibble first
forall (t: string /* 0..32 hexdigit */) => {
  const d = hexDecode(t);
  return d !== null && hexEncode(unwrap(d)) === t;
}
${EVEN}`,
  "P-ANY-CASE": `// P-ANY-CASE covers R-DEC-ACCEPT — any mix of case decodes as its lowercase
forall (${HEX_T}) => {
  const d = hexDecode(t);
  return d !== null && hexEncode(unwrap(d)) === t.toLowerCase();
}
${EVEN}`,
  "P-ODD": `// P-ODD covers R-DEC-REJECT — an odd length is refused
forall (t: string /* 1..33 hexdigit HEXDIGIT */) => hexDecode(t) === null
where t.length % 2 === 1`,
  "P-OTHER": otherText(
    "P-OTHER",
    "any other character, anywhere in an even-length text, is refused",
    alpha(OTHER),
  ),
  "P-OTHER-EDGE": otherText(
    "P-OTHER-EDGE",
    "the characters next to each digit range are refused",
    alpha(OTHER_EDGE),
  ),
  "P-PREFIX": `// P-PREFIX covers R-DEC-REJECT — a "0x" prefix is refused
forall (${HEX_T}) => hexDecode("0x" + t) === null
${EVEN};`,
};

describe("example-hex", () => {
  test("ts-interface gives the contract's module and functions", () => {
    const r = (frontEndFor("ts-interface") as FrontEnd).parseInterface(
      `// module: nish/hex
export function hexEncode(bytes: u8[]): string;
export const hexDecode = (text: string): u8[] | null;
`,
    );
    expect(r).toEqual({
      module: hexContract.target.module,
      functions: HEX_FNS,
    });
    expect(JSON.stringify(r)).toBe(
      JSON.stringify({ module: "nish/hex", functions: HEX_FNS }),
    );
  });

  const properties = hexContract.clauses.filter(
    (k) => k.kind === "property",
  ) as PropertyClause[];
  test("every property clause has a ts-property text", () => {
    expect(properties.map((k) => k.id)).toEqual(Object.keys(HEX_PROPERTIES));
  });
  for (const k of properties)
    test(`${k.id} is reproduced byte for byte`, () => {
      const { id, title, covers, clause } = parsed(
        HEX_PROPERTIES[k.id],
        HEX_FNS,
      );
      expect(
        JSON.stringify({ kind: "property", id, title, covers, ...clause }),
      ).toBe(JSON.stringify(k));
    });
});

// ── Registry ───────────────────────────────────────────────────────────────

describe("frontEndFor", () => {
  test("keys on the language prefix", () => {
    expect(frontEndFor("ts-interface")).toBe(ts);
    expect(frontEndFor("ts-whatever")).toBe(ts);
    for (const t of ["rust-interface", "ts", "-ts", "constructor-x", ""])
      expect(frontEndFor(t)).toBeUndefined();
  });
});

// ── ts-interface ───────────────────────────────────────────────────────────

describe("ts-interface", () => {
  test("maps every type, either null order, comments and blank lines", () => {
    const r = ts.parseInterface(`//   module:   nish/crypto/x
// a comment line
export function a(p: u8[], q: null | u8[], r: string, s: string | null): i32;
export const b = (p: u32, q: boolean, k: Secret<u8[]>,): Secret<u8[]> | null /* trailing */
export function c(): null | string // trailing
export function d(): Secret<u8[]>
export const e = (): u8[] | null`);
    expect(r).toEqual({
      module: "nish/crypto/x",
      functions: [
        {
          name: "a",
          params: [
            { name: "p", type: "bytes" },
            { name: "q", type: "bytes?" },
            { name: "r", type: "string" },
            { name: "s", type: "string?" },
          ],
          returns: "i32",
        },
        {
          name: "b",
          params: [
            { name: "p", type: "u32" },
            { name: "q", type: "bool" },
            { name: "k", type: "secret-bytes" },
          ],
          returns: "secret-bytes?",
        },
        { name: "c", params: [], returns: "string?" },
        { name: "d", params: [], returns: "secret-bytes" },
        { name: "e", params: [], returns: "bytes?" },
      ],
    });
  });

  test("CRLF line ends parse as LF", () => {
    const lf = "// module: nish/m\n// c\nexport function f(a: u8[]): i32\n";
    expect(ts.parseInterface(lf.replace(/\n/g, "\r\n"))).toEqual(
      ts.parseInterface(lf),
    );
    expect(ts.parseInterface(lf.replace(/\n/g, "\r"))).toEqual(
      ts.parseInterface(lf),
    );
  });

  const cases: [string, string, string][] = [
    // [text after the module line, refusal, where it points]
    [
      "export function f(a: u8[], a: i32): i32",
      "`f` has two parameters named `a`",
      "a: i32",
    ],
    [
      "export function f(): i32\nexport const f = (): i32",
      "`f` is declared twice",
      "f = (",
    ],
    [
      "export function f(a: number): i32",
      "`number` is not a ts-interface type; use u8[], string, i32, u32, boolean or Secret<u8[]>, with `| null` on u8[], string or a Secret<u8[]> result",
      "number",
    ],
    [
      "export function f(): null | boolean",
      "`boolean | null` is not a ts-interface type; use u8[], string, i32, u32, boolean or Secret<u8[]>, with `| null` on u8[], string or a Secret<u8[]> result",
      "null |",
    ],
    [
      "export function f(k: Secret<u8[]> | null): i32",
      "`Secret<u8[]> | null` is allowed only as a result type",
      "Secret",
    ],
    [
      "export const f = (a: i32): i32 => a",
      "a ts-interface declares signatures only; remove the body of `f`",
      "=>",
    ],
    [
      "export function f(a: i32): i32 { return a; }",
      "a ts-interface declares signatures only; remove the body of `f`",
      "{",
    ],
    ["function f(): i32", "expected `export`, got `function`", "function"],
    ["export let f = 1", "expected `function`, got `let`", "let"],
    ["export function (): i32", "expected a function name, got `(`", "("],
    ["export function f(a: ): i32", "expected a type, got `)`", "): i32"],
    ["export function f(a: i32", "expected `)`, got end of block", ""],
    ["", "a ts-interface declares at least one function", ""],
    [
      "// only a comment\n",
      "a ts-interface declares at least one function",
      "",
    ],
    [
      "export function xor(a: u8[]): u8[]",
      "`xor` is a ts-property op; give the function another name",
      "xor",
    ],
    [
      "export const concat = (a: string): string",
      "`concat` is a ts-property op; give the function another name",
      "concat",
    ],
  ];
  for (const [body, message, needle] of cases)
    test(message, () => {
      const text = `// module: nish/m\n${body}`;
      const lines = text.split("\n");
      const pos = needle
        ? posOf(text, needle)
        : { line: lines.length, col: lines[lines.length - 1].length + 1 };
      expect(refusal(ts.parseInterface(text))).toEqual({ message, ...pos });
    });

  test("the module line", () => {
    expect(refusal(ts.parseInterface(""))).toEqual({
      message: "missing `// module: nish/<name>` first line",
      line: 1,
      col: 1,
    });
    expect(refusal(ts.parseInterface("\n  export function f(): i32"))).toEqual({
      message: "missing `// module: nish/<name>` first line",
      line: 2,
      col: 3,
    });
    expect(
      refusal(
        ts.parseInterface("\n// module: nish/m\nexport function f(): i32"),
      ),
    ).toEqual({
      message: "missing `// module: nish/<name>` first line",
      line: 2,
      col: 1,
    });
    expect(refusal(ts.parseInterface("/* module: nish/m */"))).toEqual({
      message: "missing `// module: nish/<name>` first line",
      line: 1,
      col: 1,
    });
    expect(refusal(ts.parseInterface("// module: crypto/hex"))).toEqual({
      message: "`crypto/hex` is not a nish module; write nish/<path>",
      line: 1,
      col: 1,
    });
  });
});

// ── ts-property: mappings ──────────────────────────────────────────────────

const VARS =
  "b: u8[] /* 0..4 */, t: string /* 0..4 hexdigit */, i: i32 /* -5..5 */";
const prop = (body: string, where = "") =>
  `// P-X covers R-X — a title\nforall (${VARS}) => ${body}${where}`;
const assertOf = (body: string) => parsed(prop(body)).clause.assert;

const b = { var: "b" };
const t = { var: "t" };
const i = { var: "i" };

describe("ts-property mappings", () => {
  test("the covers line, forall and its bounds", () => {
    const r = parsed(`// P-1.a_b covers R-1,R-2 ,  R-3 — a title — with a dash
forall (
  b: u8[] /* 1..4096 */, // a comment
  i: i32 /* -2147483648..2147483647 */,
  t: string /* 0..2 ascii-printable space */,
  s: string /*
    3..3 "a\\t\\"b"
  */
) => true;`);
    expect(r).toEqual({
      id: "P-1.a_b",
      title: "a title — with a dash",
      covers: ["R-1", "R-2", "R-3"],
      clause: {
        forall: [
          { name: "b", type: "bytes", minLen: 1, maxLen: 4096 },
          { name: "i", type: "i32", min: -2147483648, max: 2147483647 },
          {
            name: "t",
            type: "string",
            minLen: 0,
            maxLen: 2,
            alphabet: ["ascii-printable", "space"],
          },
          {
            name: "s",
            type: "string",
            minLen: 3,
            maxLen: 3,
            alphabet: ["a", "\t", '"', "b"],
          },
        ],
        assert: { bool: true },
      },
    });
    expect(
      JSON.stringify(Object.keys(parsed(prop("true", " where true")).clause)),
    ).toBe('["forall","where","assert"]');
    expect(parsed(prop("true", " where true")).clause.where).toEqual({
      bool: true,
    });
  });

  const cases: [string, unknown][] = [
    [
      "b.length === 0",
      { op: "==", args: [{ op: "len", args: [b] }, { int: 0 }] },
    ],
    [
      "t.length !== 0",
      { op: "!=", args: [{ op: "strLen", args: [t] }, { int: 0 }] },
    ],
    [
      "hexDecode(t) === null",
      { op: "isNull", args: [{ call: "hexDecode", args: [t] }] },
    ],
    [
      "null == hexDecode(t)",
      { op: "isNull", args: [{ call: "hexDecode", args: [t] }] },
    ],
    [
      "hexDecode(t) !== null",
      { op: "notNull", args: [{ call: "hexDecode", args: [t] }] },
    ],
    [
      "hexDecode(t) != null",
      { op: "notNull", args: [{ call: "hexDecode", args: [t] }] },
    ],
    [
      "b.concat(b) == b",
      { op: "==", args: [{ op: "concat", args: [b, b] }, b] },
    ],
    [
      "b.slice(0, 2) != b",
      {
        op: "!=",
        args: [{ op: "slice", args: [b, { int: 0 }, { int: 2 }] }, b],
      },
    ],
    [
      "t.toLowerCase() === t.toUpperCase()",
      {
        op: "==",
        args: [
          { op: "lower", args: [t] },
          { op: "upper", args: [t] },
        ],
      },
    ],
    [
      "t.charAt(i) === t",
      { op: "==", args: [{ op: "charAt", args: [t, i] }, t] },
    ],
    [
      't + t + "x" === t',
      {
        op: "==",
        args: [
          {
            op: "strConcat",
            args: [{ op: "strConcat", args: [t, t] }, { str: "x" }],
          },
          t,
        ],
      },
    ],
    [
      "i + 1 - 2 * i % 3 === -5",
      {
        op: "==",
        args: [
          {
            op: "-",
            args: [
              { op: "+", args: [i, { int: 1 }] },
              {
                op: "%",
                args: [{ op: "*", args: [{ int: 2 }, i] }, { int: 3 }],
              },
            ],
          },
          { int: -5 },
        ],
      },
    ],
    [
      "(i < 1) == (i <= 1)",
      {
        op: "==",
        args: [
          { op: "<", args: [i, { int: 1 }] },
          { op: "<=", args: [i, { int: 1 }] },
        ],
      },
    ],
    [
      "i > 1 || i >= 2",
      {
        op: "or",
        args: [
          { op: ">", args: [i, { int: 1 }] },
          { op: ">=", args: [i, { int: 2 }] },
        ],
      },
    ],
    [
      "true && !false && true || false",
      {
        op: "or",
        args: [
          {
            op: "and",
            args: [
              { bool: true },
              { op: "not", args: [{ bool: false }] },
              { bool: true },
            ],
          },
          { bool: false },
        ],
      },
    ],
    [
      "implies(i > 0, i >= 0)",
      {
        op: "implies",
        args: [
          { op: ">", args: [i, { int: 0 }] },
          { op: ">=", args: [i, { int: 0 }] },
        ],
      },
    ],
    [
      "xor(b, bitAnd(b, bitOr(b, b))) === b",
      {
        op: "==",
        args: [
          {
            op: "xor",
            args: [
              b,
              { op: "bitAnd", args: [b, { op: "bitOr", args: [b, b] }] },
            ],
          },
          b,
        ],
      },
    ],
    [
      "fill(1, 2) === zeros(3)",
      {
        op: "==",
        args: [
          { op: "fill", args: [{ int: 1 }, { int: 2 }] },
          { op: "zeros", args: [{ int: 3 }] },
        ],
      },
    ],
    [
      "flipBit(b, 0) === le64(i)",
      {
        op: "==",
        args: [
          { op: "flipBit", args: [b, { int: 0 }] },
          { op: "le64", args: [i] },
        ],
      },
    ],
    [
      "ascii(utf8(t)) !== null",
      {
        op: "notNull",
        args: [{ op: "ascii", args: [{ op: "utf8", args: [t] }] }],
      },
    ],
    [
      "concat(b, b) === b",
      { op: "==", args: [{ op: "concat", args: [b, b] }, b] },
    ],
    // A string literal is ASCII bytes in a contract op's bytes argument.
    [
      'concat("a", b) === b.concat(b)',
      {
        op: "==",
        args: [
          { op: "concat", args: [{ ascii: "a" }, b] },
          { op: "concat", args: [b, b] },
        ],
      },
    ],
    // `.concat` on a string is TypeScript's string concat.
    [
      '"ab".concat("cd") === t.concat(t)',
      {
        op: "==",
        args: [
          { op: "strConcat", args: [{ str: "ab" }, { str: "cd" }] },
          { op: "strConcat", args: [t, t] },
        ],
      },
    ],
    [
      'flipBit("a", 0) === xor("a", b)',
      {
        op: "==",
        args: [
          { op: "flipBit", args: [{ ascii: "a" }, { int: 0 }] },
          { op: "xor", args: [{ ascii: "a" }, b] },
        ],
      },
    ],
    [
      'hexDecode("0a") === [0a]',
      {
        op: "==",
        args: [{ call: "hexDecode", args: [{ str: "0a" }] }, { hex: "0a" }],
      },
    ],
    [
      "unwrap(hexDecode(t)) === [] && [00 0f f0 ff] !== b",
      {
        op: "and",
        args: [
          {
            op: "==",
            args: [
              { op: "unwrap", args: [{ call: "hexDecode", args: [t] }] },
              { hex: "" },
            ],
          },
          { op: "!=", args: [{ hex: "000ff0ff" }, b] },
        ],
      },
    ],
    [
      "seal(b, 7) === null",
      { op: "isNull", args: [{ call: "seal", args: [b, { int: 7 }] }] },
    ],
    ['"a\\tb" === t', { op: "==", args: [{ str: "a\tb" }, t] }],
    ["{ return true; }", { bool: true }],
    [
      "{ const x = i; const y = x + 1; return y > x }",
      {
        let: [
          { name: "x", value: i },
          { name: "y", value: { op: "+", args: [{ var: "x" }, { int: 1 }] } },
        ],
        in: { op: ">", args: [{ var: "y" }, { var: "x" }] },
      },
    ],
    ["/* why */ true // because", { bool: true }],
  ];
  for (const [body, want] of cases)
    test(body, () =>
      expect(assertOf(body)).toEqual(want as PropertyClause["assert"]));

  test("const bindings are not in scope in where", () => {
    const text = prop("{ const x = 1; return x > 0; }", " where x > 0");
    expect(refusal(ts.parseProperty(text, FNS))).toEqual({
      message: "unknown identifier `x`",
      ...posOf(text, "x > 0"),
    });
  });

  test("CRLF line ends parse as LF", () => {
    const lf = prop("{\n  const n = b.length;\n  return n >= 0;\n}");
    expect(parsed(lf.replace(/\n/g, "\r\n"))).toEqual(parsed(lf));
  });

  test("a long && chain is not nesting", () => {
    const r = parsed(prop(Array(1000).fill("i > 0").join(" && ")));
    expect(r.clause.assert).toMatchObject({ op: "and" });
  });
});

// ── ts-property: refusals ──────────────────────────────────────────────────

const DEPTH = "the expression nests more than 64 deep; name a part with const";

describe("ts-property refusals", () => {
  // [text, message, the text the refusal points at]
  const cases: [string, string, string][] = [
    // The covers line.
    [
      "forall (b: u8[] /* 0..1 */) => true",
      "missing `// P-ID covers R-ID — title` line",
      "forall",
    ],
    [
      "// P-X R-X — t\nforall () => true",
      "missing `// P-ID covers R-ID — title` line",
      "// P-X",
    ],
    [
      "/* P-X covers R-X — t */ forall () => true",
      "missing `// P-ID covers R-ID — title` line",
      "/*",
    ],
    [
      "// P-X covers R-X\nforall () => true",
      "missing title: end the covers line with ` — <title>`",
      "// P-X",
    ],
    [
      "// P-X covers R-X —  \nforall () => true",
      "missing title: end the covers line with ` — <title>`",
      "// P-X",
    ],
    [
      "// P!X covers R-X — t\nforall () => true",
      "`P!X` is not a clause or requirement id",
      "// P!X",
    ],
    [
      "// P-X covers R X — t\nforall () => true",
      "`R X` is not a clause or requirement id",
      "// P-X",
    ],
    // forall and its bounds.
    [
      "// P-X covers R-X — t\nexists () => true",
      "expected `forall`, got `exists`",
      "exists",
    ],
    [
      "// P-X covers R-X — t\nforall (b: number /* 0..1 */) => true",
      "`number` is not a forall type; use u8[], string or i32",
      "number",
    ],
    [
      "// P-X covers R-X — t\nforall (n: u32 /* 0..1 */) => true",
      "`u32` is not a forall type; use u8[], string or i32",
      "u32",
    ],
    [
      "// P-X covers R-X — t\nforall (b: u8[]) => true",
      "`b` needs a bounds comment, like /* 0..64 */",
      ")",
    ],
    [
      "// P-X covers R-X — t\nforall (b: u8[] // 0..1\n) => true",
      "`b` needs a bounds comment, like /* 0..64 */",
      "// 0",
    ],
    [
      "// P-X covers R-X — t\nforall (b: u8[] /* 64 */) => true",
      "the bounds of `b` must read `lo..hi`, like /* 0..64 */",
      "/*",
    ],
    [
      "// P-X covers R-X — t\nforall (b: u8[] /* 0..4 hexdigit */) => true",
      "an alphabet applies only to string variables, not `b`",
      "/*",
    ],
    [
      '// P-X covers R-X — t\nforall (i: i32 /* 0..1 "a" */) => true',
      "an alphabet applies only to string variables, not `i`",
      "/*",
    ],
    [
      "// P-X covers R-X — t\nforall (i: i32 /* 2..1 */) => true",
      "the bounds of `i` must satisfy -2147483648 <= lo <= hi <= 2147483647",
      "/*",
    ],
    [
      "// P-X covers R-X — t\nforall (i: i32 /* 0..2147483648 */) => true",
      "the bounds of `i` must satisfy -2147483648 <= lo <= hi <= 2147483647",
      "/*",
    ],
    [
      "// P-X covers R-X — t\nforall (b: u8[] /* 0..4097 */) => true",
      "the length bounds of `b` must satisfy 0 <= lo <= hi <= 4096",
      "/*",
    ],
    [
      "// P-X covers R-X — t\nforall (s: string /* -1..2 digit */) => true",
      "the length bounds of `s` must satisfy 0 <= lo <= hi <= 4096",
      "/*",
    ],
    [
      "// P-X covers R-X — t\nforall (s: string /* 0..2 */) => true",
      "`s` needs an alphabet after its bounds: class names (hexdigit, HEXDIGIT, digit, alpha, space, ascii-printable) or a JSON string",
      "/*",
    ],
    [
      "// P-X covers R-X — t\nforall (s: string /* 0..2 hex */) => true",
      "unknown alphabet class `hex`; use hexdigit, HEXDIGIT, digit, alpha, space, ascii-printable or a JSON string",
      "/*",
    ],
    [
      '// P-X covers R-X — t\nforall (s: string /* 0..2 "ab" "c" */) => true',
      "the alphabet must be one JSON string",
      "/*",
    ],
    [
      '// P-X covers R-X — t\nforall (s: string /* 0..2 "" */) => true',
      "the alphabet is empty",
      "/*",
    ],
    [
      '// P-X covers R-X — t\nforall (s: string /* 0..2 "é" */) => true',
      "the alphabet holds only printable ASCII, tab, LF and CR",
      "/*",
    ],
    [
      "// P-X covers R-X — t\nforall (b: u8[] /* 0..1 */, b: u8[] /* 0..1 */) => true",
      "`b` is bound twice",
      "b: u8[] /* 0..1 */)",
    ],
    [
      "// P-X covers R-X — t\nforall (hexEncode: u8[] /* 0..1 */) => true",
      "`hexEncode` names an interface function",
      "hexEncode",
    ],
    [
      "// P-X covers R-X — t\nforall (b: u8[] /* 0..1 */) true",
      "expected `=>`, got `true`",
      "true",
    ],
    // Bodies.
    [prop("{ const b = 1; return true; }"), "`b` is bound twice", "b = 1"],
    [
      prop("{ const n = null; return true; }"),
      "`n` is a bare null, which has no type",
      "null",
    ],
    [
      prop("{ let n = 1; return true; }"),
      "`let` is not in the ts-property subset",
      "let",
    ],
    [
      prop("{ if (true) return true; }"),
      "`if` is not in the ts-property subset",
      "if",
    ],
    [prop("{ 1 }"), "expected `const` or `return`, got `1`", "1 }"],
    [prop("{ return true; false }"), "expected `}`, got `false`", "false"],
    [prop("b.length"), "the property must be boolean, got i32", "b.length"],
    [prop("true", " where t"), "`where` must be boolean, got string", "t"],
    [
      prop("true", " where hexEncode(b) === t"),
      "`where` may not call `hexEncode`: the domain must not depend on the implementation",
      "hexEncode",
    ],
    [prop("true false"), "unexpected `false`", "false"],
    [prop("("), "unexpected end of block", ""],
    [prop(")"), "unexpected `)`", ")"],
    // Operators and forms outside the subset.
    [
      prop("i > 0 ==> i >= 0"),
      "`==>` is not in the ts-property subset; use implies(a, b)",
      "==>",
    ],
    [prop("i / 2 === 0"), "`/` is not in the ts-property subset", "/ 2"],
    [prop("i > 0 ? true : false"), "`?` is not in the ts-property subset", "?"],
    [prop("(x) => true"), "unknown identifier `x`", "x)"],
    [prop("b?.length === 0"), "`?.` is not in the ts-property subset", "?."],
    [prop("/ 2"), "`/` is not in the ts-property subset", "/ 2"],
    [prop("~i === 0"), "`~` is not in the ts-property subset", "~"],
    [
      prop("-i === 0"),
      "unary `-` applies only to integer literals; write 0 - x",
      "-i",
    ],
    [prop("i === 3000000000"), "`3000000000` is outside i32", "3000000000"],
    [prop("i === -2147483649"), "`-2147483649` is outside i32", "-2147483649"],
    [
      prop("b[0] === 0"),
      "indexing is not in the ts-property subset; use slice or charAt",
      "[0]",
    ],
    [
      prop("[0] === b"),
      "a bytes literal is lowercase hex pairs separated by single spaces, like [00 0f]",
      "[0]",
    ],
    [
      prop("[b] === b"),
      "a bytes literal is lowercase hex pairs separated by single spaces, like [00 0f]",
      "[b]",
    ],
    [
      prop("[0A] === b"),
      "a bytes literal is lowercase hex pairs separated by single spaces, like [00 0f]",
      "[0A]",
    ],
    [prop("b.map(f) === b"), "`.map` is not in the ts-property subset", "map"],
    [
      prop("b.byteLength === 0"),
      "`.byteLength` is not in the ts-property subset",
      "byteLength",
    ],
    [prop("b.slice(1) === b"), "`.slice` takes 2 argument(s), got 1", "(1)"],
    [prop("b.1"), "expected a property name, got `1`", "1"],
    [prop("y === 0"), "unknown identifier `y`", "y"],
    [prop("foo(b)"), "unknown function `foo`", "foo"],
    [prop("b(1)"), "`b` is not a function", "b(1)"],
    [
      prop("hexEncode(b, b) === t"),
      "`hexEncode` takes 1 argument(s), got 2",
      "hexEncode",
    ],
    [
      prop("hexEncode(t) === t"),
      "`hexEncode` expects u8[], got string",
      "t) ===",
    ],
    [
      prop("hexEncode(hexDecode(t)) === t"),
      "`hexEncode` expects u8[], got u8[] | null",
      "hexDecode",
    ],
    [prop("xor(b) === b"), "`xor` takes 2 argument(s), got 1", "xor"],
    [prop("b.length + true === 1"), "`+` wants i32, got boolean", "true"],
    [prop("t + 1 === t"), "`+` wants string, got i32", "1 ==="],
    [prop("b === 1"), "cannot compare u8[] with i32", "b === 1"],
    [
      prop("b === null"),
      "`=== null` wants u8[] | null or string | null, got u8[]",
      "b === null",
    ],
    [prop("null === null"), "cannot compare null with null", "null === null"],
    [prop("!1"), "`!` wants boolean, got i32", "1"],
    [prop("true && 1"), "`&&` wants boolean, got i32", "1"],
    [prop("(1).length === 1"), "`.length` wants u8[], got i32", "(1)"],
    [prop("t.slice(0, 1) === t"), "`.slice` wants u8[], got string", "t.slice"],
    [prop("i < t"), "`<` wants i32, got string", "t"],
    [prop("i * t === 1"), "`*` wants i32, got string", "t ==="],
    // The lexer.
    [
      prop("t === 'a'"),
      "`'` strings are not in the ts-property subset; use double quotes",
      "'a'",
    ],
    [
      prop("t === `a`"),
      "``` strings are not in the ts-property subset; use double quotes",
      "`a`",
    ],
    [
      prop("i === 0x10"),
      "`0x10` is not in the ts-property subset; write integers in decimal",
      "0x10",
    ],
    [
      prop("i === 007"),
      "`007` is not in the ts-property subset; write integers in decimal",
      "007",
    ],
    [prop('t === "a'), "malformed string literal", '"a'],
    [prop('t === "\\q"'), "malformed string literal", '"\\q'],
    [
      prop('t === "\\u00e9"'),
      "a string literal holds only printable ASCII, tab, LF and CR",
      '"\\u',
    ],
    [prop("b ‖ b"), "`‖` is not in the ts-property subset", "‖"],
    [prop("$ === 0"), "`$` is not in the ts-property subset", "$"],
    [prop("true /* open"), "unterminated `/*` comment", "/* open"],
    // Text whose TypeScript meaning differs from the contract's.
    [prop('b === "ab"'), "cannot compare u8[] with string", "b ==="],
    [prop('"ab" !== b'), "cannot compare string with u8[]", '"ab" !=='],
    [
      prop('hexEncode("a") === "61"'),
      "`hexEncode` expects u8[], got string",
      '"a"',
    ],
    [prop('b.concat("cd") === b'), "`.concat` wants u8[], got string", '"cd"'],
    [prop('"ab".concat(b) === t'), "`.concat` wants string, got u8[]", "b)"],
    [
      prop("b.slice(-2, 5) === b"),
      "a negative `.slice` index counts from the end in TypeScript and clamps to 0 in the contract",
      "-2",
    ],
    [
      prop("b.slice(0, -1) === b"),
      "a negative `.slice` index counts from the end in TypeScript and clamps to 0 in the contract",
      "-1",
    ],
    [
      prop("i % 0 === 0"),
      "`% 0` is NaN in TypeScript and 0 in the contract",
      "0 ===",
    ],
    // Nesting is bounded.
    [prop(`${"(".repeat(65)}true${")".repeat(65)}`), DEPTH, "(true"],
    [
      prop(`${Array(70).fill("i").join(" + ")} > 0`),
      DEPTH,
      `${Array(70).fill("i").join(" + ")} > 0`,
    ],
    [prop(`${"!".repeat(70)}true`), DEPTH, `${"!".repeat(6)}true`],
    [
      prop(`${"b.concat(".repeat(70)}b${")".repeat(70)} === b`),
      DEPTH,
      `${"b.concat(".repeat(6)}b)`,
    ],
  ];
  for (const [text, message, needle] of cases)
    test(message, () => {
      const r = refusal(ts.parseProperty(text, FNS));
      const pos = needle
        ? posOf(text, needle)
        : (() => {
            const lines = text.split("\n");
            return {
              line: lines.length,
              col: lines[lines.length - 1].length + 1,
            };
          })();
      expect(r).toEqual({ message, ...pos });
    });

  test("an interface function named like an op", () => {
    const fns = [
      ...FNS,
      { name: "xor", params: [], returns: "bytes" },
    ] as FnSig[];
    const text = prop("xor(b, b) === b");
    expect(refusal(ts.parseProperty(text, fns))).toEqual({
      message: "`xor` is both an interface function and a ts-property op",
      ...posOf(text, "xor"),
    });
  });

  test("the covers line is the first line", () => {
    const text = `\n${prop("true")}`;
    expect(refusal(ts.parseProperty(text, FNS))).toEqual({
      message: "missing `// P-ID covers R-ID — title` line",
      line: 2,
      col: 1,
    });
  });
});
