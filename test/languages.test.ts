import { describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LANGUAGE_TABLES,
  type LanguageTable,
  moduleIn,
  nameIn,
  words,
} from "../src/rfc/languages/index.ts";
import { renderLanguagesSection } from "../src/rfc/languages/readme.ts";
import {
  basename,
  camel,
  capitalize,
  isAcronym,
  pascal,
  pascalSegment,
  segments,
  snake,
} from "../src/rfc/languages/table.ts";
import {
  BASE_TYPES,
  type BaseType,
  INT_RANGE,
  INT_TYPES,
  type IntType,
  LANGUAGES,
  LITERAL_KINDS,
  type Language,
  type LiteralKind,
  OUTCOMES,
  type Outcome,
} from "../src/rfc/vocab.ts";

interface Contract {
  target: { module: string };
  functions: {
    name: string;
    module?: string;
    params: { name: string }[];
  }[];
}

const CONTRACTS = [
  "example-hex",
  "rfc5869-hkdf-sha256",
  "rfc8439-chacha20-poly1305",
] as const;

const contract = (id: string): Contract =>
  JSON.parse(readFileSync(`contracts/${id}.json`, "utf8")) as Contract;

const expected = JSON.parse(
  readFileSync("test/fixtures/languages/expected.json", "utf8"),
) as {
  contracts: Record<string, Record<string, unknown>>;
  rules: Record<string, Record<string, { function: string; param: string }>>;
};

const tables = (): LanguageTable[] =>
  LANGUAGES.map((id) => LANGUAGE_TABLES[id]);

describe("every language has a table over the whole vocabulary", () => {
  test("one table per language, keyed by its own id", () => {
    expect(Object.keys(LANGUAGE_TABLES).sort()).toEqual([...LANGUAGES].sort());
    for (const id of LANGUAGES) expect(LANGUAGE_TABLES[id].id).toBe(id);
  });

  test.each(tables().map((t) => [t.id, t] as const))(
    "%s maps every base type, outcome and literal",
    (_, t) => {
      expect(Object.keys(t.types).sort()).toEqual([...BASE_TYPES].sort());
      expect(Object.keys(t.outcomes).sort()).toEqual([...OUTCOMES].sort());
      expect(Object.keys(t.literals).sort()).toEqual([...LITERAL_KINDS].sort());
      for (const m of [
        ...Object.values(t.types),
        ...Object.values(t.outcomes),
        ...Object.values(t.literals),
      ]) {
        if ("unsupported" in m)
          expect(m.unsupported.length).toBeGreaterThan(20);
        else expect(m.spelling.length).toBeGreaterThan(0);
      }
      for (const o of Object.values(t.outcomes))
        if ("spelling" in o) expect(o.spelling).toContain("{T}");
    },
  );

  test.each(tables().map((t) => [t.id, t] as const))(
    "%s cites its standards and states its choices",
    (_, t) => {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.typeStandard.length).toBeGreaterThan(10);
      expect(t.nameStandard.length).toBeGreaterThan(10);
      expect(t.nameRule.length).toBeGreaterThan(20);
      expect(t.module.note.length).toBeGreaterThan(20);
      expect(t.choices.length).toBeGreaterThan(0);
    },
  );

  test("PHP is the one language that cannot hold u64", () => {
    const unsupported = tables().flatMap((t) =>
      [
        ...Object.entries(t.types),
        ...Object.entries(t.outcomes),
        ...Object.entries(t.literals),
      ]
        .filter(([, m]) => "unsupported" in m)
        .map(([k]) => `${t.id}:${k}`),
    );
    expect(unsupported).toEqual(["php:u64"]);
  });
});

describe("the word split", () => {
  test.each([
    ["hkdfExpandSha256", ["hkdf", "Expand", "Sha256"]],
    ["chacha20Poly1305Seal", ["chacha20", "Poly1305", "Seal"]],
    ["parseHTTPRequest", ["parse", "HTTP", "Request"]],
    ["readIOStream", ["read", "IO", "Stream"]],
    ["HTTP", ["HTTP"]],
    ["utf8Decode", ["utf8", "Decode"]],
    ["x25519_publicKey", ["x25519", "public", "Key"]],
    ["sha256Sha256", ["sha256", "Sha256"]],
    ["b64", ["b64"]],
    ["_x", ["x"]],
    ["", []],
  ])("%s", (name, split) => {
    expect(words(name)).toEqual(split);
  });

  test("the casings and module helpers", () => {
    expect(isAcronym("HTTP")).toBe(true);
    expect(isAcronym("Http")).toBe(false);
    expect(capitalize("hTTP")).toBe("Http");
    expect(snake("parseHTTPRequest")).toBe("parse_http_request");
    expect(camel("ParseHTTPRequest", "word")).toBe("parseHttpRequest");
    expect(camel("readIOStream", "short-caps")).toBe("readIOStream");
    expect(pascal("parseHTTPRequest", "as-written")).toBe("ParseHTTPRequest");
    expect(segments("nish/crypto/hkdf")).toEqual(["nish", "crypto", "hkdf"]);
    expect(pascalSegment("big_int")).toBe("BigInt");
    expect(basename("package:nish/crypto/hkdf.dart")).toBe("hkdf");
  });
});

describe("every function of the three contracts, named in every language", () => {
  test.each(CONTRACTS.map((c) => [c]))("%s", (id) => {
    const k = contract(id);
    const got = Object.fromEntries(
      tables().map((t) => {
        const module = moduleIn(t, k.target.module);
        const functions = Object.fromEntries(
          k.functions.map((f) => {
            const name = nameIn(t, f.name, "function");
            const m = f.module ? moduleIn(t, f.module) : module;
            return [
              f.name,
              {
                name,
                ...(f.module ? { module: m } : {}),
                qualified: t.module.qualify(m, name),
                params: Object.fromEntries(
                  f.params.map((p) => [p.name, nameIn(t, p.name, "param")]),
                ),
              },
            ];
          }),
        );
        return [t.id, { module, functions }];
      }),
    );
    expect(got).toEqual(expected.contracts[id] as typeof got);
  });

  test.each(tables().map((t) => [t.id, t] as const))(
    "%s names acronyms and digits by its rule",
    (_, t) => {
      const rules = expected.rules[t.id];
      expect(rules).toBeDefined();
      for (const [n, want] of Object.entries(rules ?? {}))
        expect({
          function: t.name(n, "function"),
          param: t.name(n, "param"),
        }).toEqual(want);
    },
  );

  test("an override always wins over the rule", () => {
    for (const t of tables()) {
      expect(
        nameIn(t, "hkdfExpandSha256", "function", { [t.id]: "expand" }),
      ).toBe("expand");
      expect(moduleIn(t, "nish/crypto/hkdf", { [t.id]: "custom" })).toBe(
        "custom",
      );
      const other = LANGUAGES.find((l) => l !== t.id) as string;
      expect(nameIn(t, "hkdfExpandSha256", "function", { [other]: "x" })).toBe(
        t.name("hkdfExpandSha256", "function"),
      );
      expect(moduleIn(t, "nish/crypto/hkdf", { [other]: "x" })).toBe(
        t.module.apply("nish/crypto/hkdf"),
      );
    }
  });

  test("a one-segment Dart module is its package's main library", () => {
    expect(moduleIn(LANGUAGE_TABLES.dart, "nish")).toBe(
      "package:nish/nish.dart",
    );
  });
});

describe("the README matrix", () => {
  test("README.md's Languages section is the tables' rendering", () => {
    const readme = readFileSync("README.md", "utf8");
    const start = readme.indexOf("## Languages\n");
    const end = readme.indexOf("---\n\n## The idea\n");
    expect(start).toBeGreaterThan(0);
    expect(readme.slice(start, end)).toBe(`${renderLanguagesSection()}\n`);
    expect(readme).toContain(
      "  - [Writing a spec (kramdown-rfc)](#writing-a-spec-kramdown-rfc)\n- [Languages](#languages)\n- [The idea](#the-idea)\n",
    );
  });

  test("an unsupported construct is footnoted with its reason", () => {
    const s = renderLanguagesSection();
    expect(s).toContain("unsupported (1)");
    expect(s).toContain("1. PHP `u64`: PHP int is signed 64-bit");
    expect(s).toContain("`{T} \\| None`");
  });
});

// Compile-backed checks: each table's spellings are put into a program in its
// own language, which is compiled (where the language has a compiler) and run.
// Every literal kind is passed at its extremes as an argument to a function
// whose parameter has the mapped type, and every base type is written in each
// position: parameter, return, refusing return and optional input. The program
// prints each value canonically (an integer in decimal, an f64 as its 16 hex
// bits, a string as the hex of its UTF-8, bytes as hex), which is compared with
// the value the contract means. A language whose toolchain is absent is
// skipped, and says so.

type Lit =
  | { k: "int"; t: IntType; v: bigint }
  | { k: "f64"; bits: bigint }
  | { k: "str"; s: string }
  | { k: "hex"; b: readonly number[] }
  | { k: "ascii"; s: string }
  | { k: "concat" }
  | { k: "bool"; v: boolean };

const F64_BITS = [
  0x8000000000000000n, // -0
  0xbff8000000000000n, // -1.5
  0xfff8000000000001n, // a NaN with its sign set and a payload
  0x7ff0000000000000n, // +Infinity
  0xfff0000000000000n, // -Infinity
  0x3ff8000000000000n, // 1.5
];
const STRINGS = ["a\0b", "é", "éb", "😀", '$x #{x} \\ "', "\n", "abc", ""];
const LITS: Lit[] = [
  ...INT_TYPES.flatMap((t): Lit[] => [
    { k: "int", t, v: INT_RANGE[t].min },
    { k: "int", t, v: INT_RANGE[t].max },
  ]),
  ...F64_BITS.map((bits): Lit => ({ k: "f64", bits })),
  ...STRINGS.map((s): Lit => ({ k: "str", s })),
  { k: "hex", b: [] },
  { k: "hex", b: [0x0b, 0x0b] },
  { k: "hex", b: [0x00, 0xff] },
  { k: "ascii", s: "abc" },
  { k: "concat" },
  { k: "bool", v: true },
  { k: "bool", v: false },
];
/** The value each base type takes in the four positions. */
const SAMPLE: Record<BaseType, Lit> = {
  bytes: { k: "hex", b: [0x00, 0xff] },
  "secret-bytes": { k: "hex", b: [0x00, 0xff] },
  string: { k: "str", s: "é" },
  bool: { k: "bool", v: true },
  f64: { k: "f64", bits: 0xbff8000000000000n },
  ...(Object.fromEntries(
    INT_TYPES.map((t) => [t, { k: "int", t, v: INT_RANGE[t].max }]),
  ) as Record<IntType, Lit>),
};

const baseOfLit = (l: Lit): BaseType =>
  l.k === "int"
    ? l.t
    : l.k === "f64"
      ? "f64"
      : l.k === "str"
        ? "string"
        : l.k === "bool"
          ? "bool"
          : "bytes";
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const hex2 = (n: number): string => n.toString(16).padStart(2, "0");
const hexOf = (b: Iterable<number>): string => [...b].map(hex2).join("");
const bitsBytes = (bits: bigint): number[] =>
  [...Array(8)].map((_, i) => Number((bits >> BigInt(56 - 8 * i)) & 0xffn));
const isNaNBits = (bits: bigint): boolean =>
  ((bits >> 52n) & 0x7ffn) === 0x7ffn && (bits & ((1n << 52n) - 1n)) !== 0n;
const bytesOf = (l: Lit): number[] =>
  l.k === "hex"
    ? [...l.b]
    : l.k === "ascii"
      ? [...utf8(l.s)]
      : l.k === "concat"
        ? [0x0b, 0x61]
        : [];

/** What the program prints for `l`. */
const shown = (l: Lit, nanPayload: boolean): string => {
  switch (l.k) {
    case "int":
      return l.v.toString();
    case "f64":
      return !nanPayload && isNaNBits(l.bits)
        ? "nan"
        : l.bits.toString(16).padStart(16, "0");
    case "str":
      return hexOf(utf8(l.s));
    case "bool":
      return String(l.v);
    default:
      return hexOf(bytesOf(l));
  }
};

const spell = (t: LanguageTable, b: BaseType): string => {
  const m = t.types[b];
  if (!("spelling" in m)) throw new Error(`${t.id}: ${b} is unsupported`);
  return m.spelling;
};
const tpl = (t: LanguageTable, o: Outcome, ty: string): string => {
  const m = t.outcomes[o];
  if (!("spelling" in m)) throw new Error(`${t.id}: ${o} is unsupported`);
  return m.spelling.replaceAll("{T}", ty);
};
const lit = (t: LanguageTable, k: LiteralKind): string => {
  const m = t.literals[k];
  if (!("spelling" in m)) throw new Error(`${t.id}: ${k} is unsupported`);
  return m.spelling;
};
const ident = (b: BaseType): string => b.replace("-", "_");
const isBytes = (b: BaseType): boolean => b === "bytes" || b === "secret-bytes";

interface Call {
  b: BaseType;
  /** The argument(s) the literal is passed as. */
  e: string;
}

interface Gen {
  id: Language;
  file: string;
  /** Each command: compile steps, then the run, whose stdout is compared. */
  steps: string[][];
  /** Whether an f64 NaN keeps its payload. */
  nanPayload: boolean;
  int(t: IntType, v: bigint): string;
  f64(bits: bigint): string;
  str(s: string): string;
  hex(b: readonly number[]): string;
  ascii(s: string): string;
  bool(v: boolean): string;
  /** The concat literal over `a` (hex 0b) and `b` (ascii "a"). */
  concat: string;
  /** A value the table drops (beyond an unsupported type). */
  drops?(l: Lit): boolean;
  /** The argument list a literal is passed as, when not the expression. */
  arg?(l: Lit, e: string): string;
  program(t: LanguageTable, shows: Call[], positions: Call[]): string;
}

/** A string literal as UTF-8 bytes in \x escapes, split where a hex digit follows. */
const cString = (s: string, suffix = ""): string => {
  let out = '"';
  let afterHex = false;
  for (const byte of utf8(s)) {
    const ch = String.fromCharCode(byte);
    if (byte < 0x20 || byte >= 0x7f) {
      out += `\\x${hex2(byte)}`;
      afterHex = true;
      continue;
    }
    if (afterHex && /[0-9a-fA-F]/.test(ch)) out += '" "';
    out += ch === '"' || ch === "\\" || ch === "?" ? `\\${ch}` : ch;
    afterHex = false;
  }
  return `${out}"${suffix}`;
};

/** A string literal with `esc(cp)` for each non-ASCII or control scalar. */
const escString = (
  s: string,
  esc: (cp: number) => string,
  special: string,
): string => {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x20 || cp >= 0x7f) out += esc(cp);
    else out += special.includes(ch) ? `\\${ch}` : ch;
  }
  return `${out}"`;
};
const braceU = (cp: number): string => `\\u{${cp.toString(16)}}`;
const u4 = (n: number): string => `\\u${n.toString(16).padStart(4, "0")}`;
const utf16 = (cp: number): string =>
  cp > 0xffff
    ? u4(0xd800 + ((cp - 0x10000) >> 10)) +
      u4(0xdc00 + ((cp - 0x10000) & 0x3ff))
    : u4(cp);
const uOrBigU = (cp: number): string =>
  cp > 0xffff ? `\\U${cp.toString(16).padStart(8, "0")}` : u4(cp);
const hexList = (b: readonly number[]): string =>
  b.map((x) => `0x${hex2(x)}`).join(", ");
const signedInt = (t: IntType): boolean => t.startsWith("i");
const pres = (e: string, yes: string, no: string): string =>
  `${e} ? ${yes} : ${no}`;

const c: Gen = {
  id: "c",
  file: "main.c",
  steps: [
    [
      "gcc",
      "-std=c17",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-pedantic-errors",
      "-o",
      "main",
      "main.c",
    ],
    ["./main"],
  ],
  nanPayload: true,
  int: (t, v) =>
    signedInt(t) && v === INT_RANGE[t].min
      ? `INT${t.slice(1)}_MIN`
      : `${t.startsWith("u") ? "UINT" : "INT"}${t.slice(1)}_C(${v})`,
  f64: (bits) =>
    `((union { uint64_t u; double d; }){.u = 0x${bits.toString(16).padStart(16, "0")}u}).d`,
  str: (s) => cString(s),
  hex: (b) => `(const uint8_t[]){${b.length === 0 ? "0" : hexList(b)}}`,
  ascii: (s) => `(const uint8_t[]){"${s}"}`,
  bool: (v) => String(v),
  concat: "(const uint8_t[]){0x0b, 0x61}",
  drops: (l) => l.k === "str" && l.s.includes("\0"),
  arg: (l, e) =>
    ["hex", "ascii", "concat"].includes(l.k) ? `${e}, ${bytesOf(l).length}` : e,
  program(t, shows, positions) {
    const params = (b: BaseType): string =>
      spell(t, b)
        .split(", ")
        .map(
          (p, i) =>
            `${p}${p.endsWith("*") ? "" : " "}${i === 0 ? "x" : "x_len"}`,
        )
        .join(", ");
    const fns = BASE_TYPES.map((b) => {
      const n = ident(b);
      const P = params(b);
      const T = spell(t, b);
      if (isBytes(b))
        return `static void show_${n}(${P}) { for (size_t i = 0; i < x_len; i++) printf("%02x", x[i]); putchar('\\n'); }
static void r_${n}(${P}, uint8_t *out, size_t *out_len) { memcpy(out, x, x_len); *out_len = x_len; }
static int f_${n}(${P}, bool ok, uint8_t *out, size_t *out_len) { if (!ok) return 1; r_${n}(x, x_len, out, out_len); return 0; }
static bool o_${n}(${P}, bool y) { (void)x_len; return y && x != ${lit(t, "null")}; }`;
      if (b === "string")
        return `static void show_${n}(${P}) { for (const char *p = x; *p; p++) printf("%02x", (unsigned char)*p); putchar('\\n'); }
static void r_${n}(${P}, char *out, size_t out_cap) { snprintf(out, out_cap, "%s", x); }
static int f_${n}(${P}, bool ok, char *out, size_t out_cap) { if (!ok) return 1; r_${n}(x, out, out_cap); return 0; }
static bool o_${n}(${P}, bool y) { return y && x != ${lit(t, "null")}; }`;
      const body =
        b === "bool"
          ? 'puts(x ? "true" : "false");'
          : b === "f64"
            ? 'uint64_t u; memcpy(&u, &x, sizeof u); printf("%016" PRIx64 "\\n", u);'
            : signedInt(b as IntType)
              ? 'printf("%" PRId64 "\\n", (int64_t)x);'
              : 'printf("%" PRIu64 "\\n", (uint64_t)x);';
      const refusing = tpl(t, "refusing-return", T).replace(
        "f(...",
        `f_${n}(${P}, bool ok`,
      );
      return `static void show_${n}(${P}) { ${body} }
static ${T} r_${n}(${P}) { return x; }
static ${refusing} { if (!ok) return 1; *out = x; return 0; }
static bool o_${n}(${tpl(t, "optional-input", T)}x, bool y) { return y && x != ${lit(t, "null")}; }`;
    });
    const PA = '"present"';
    const AB = '"absent"';
    const main = positions.map(({ b, e }) => {
      const n = ident(b);
      if (isBytes(b))
        return `{ uint8_t out[16]; size_t n; r_${n}(${e}, out, &n); show_${n}(out, n);
  if (f_${n}(${e}, true, out, &n) == 0) show_${n}(out, n);
  if (f_${n}(${e}, false, out, &n) != 0) puts("refused");
  puts(${pres(`o_${n}(NULL, 0, true)`, PA, AB)}); puts(${pres(`o_${n}(${e}, true)`, PA, AB)}); }`;
      if (b === "string")
        return `{ char out[16]; r_${n}(${e}, out, sizeof out); show_${n}(out);
  if (f_${n}(${e}, true, out, sizeof out) == 0) show_${n}(out);
  if (f_${n}(${e}, false, out, sizeof out) != 0) puts("refused");
  puts(${pres(`o_${n}(NULL, true)`, PA, AB)}); puts(${pres(`o_${n}(${e}, true)`, PA, AB)}); }`;
      const T = spell(t, b);
      return `{ ${T} v; show_${n}(r_${n}(${e}));
  if (f_${n}(${e}, true, &v) == 0) show_${n}(v);
  if (f_${n}(${e}, false, &v) != 0) puts("refused");
  puts(${pres(`o_${n}(NULL, true)`, PA, AB)}); puts(${pres(`o_${n}(&(${T}){${e}}, true)`, PA, AB)}); }`;
    });
    return `#include <inttypes.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
${fns.join("\n")}
int main(void) {
${shows.map(({ b, e }) => `  show_${ident(b)}(${e});`).join("\n")}
${main.join("\n")}
  return 0;
}
`;
  },
};

const cpp: Gen = {
  id: "cpp",
  file: "main.cpp",
  steps: [
    [
      "g++",
      "-std=c++20",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-pedantic-errors",
      "-o",
      "main",
      "main.cpp",
    ],
    ["./main"],
  ],
  nanPayload: true,
  int: (t, v) => {
    const ty = `std::${t.startsWith("u") ? "uint" : "int"}${t.slice(1)}_t`;
    if (signedInt(t) && v === INT_RANGE[t].min)
      return `${ty}{-${INT_RANGE[t].max} - 1}`;
    return `${ty}{${v}${v > INT_RANGE.i64.max ? "u" : ""}}`;
  },
  f64: (bits) =>
    `std::bit_cast<double>(std::uint64_t{0x${bits.toString(16).padStart(16, "0")}})`,
  str: (s) => cString(s, "sv"),
  hex: (b) => `std::array<std::uint8_t, ${b.length}>{${hexList(b)}}`,
  ascii: (s) =>
    `std::array<std::uint8_t, ${s.length}>{${[...s].map((ch) => `'${ch}'`).join(", ")}}`,
  bool: (v) => String(v),
  concat: "std::array<std::uint8_t, 2>{0x0b, 0x61}",
  program(t, shows, positions) {
    const ret = (b: BaseType): string =>
      isBytes(b)
        ? "std::vector<std::uint8_t>"
        : b === "string"
          ? "std::string"
          : spell(t, b);
    const fns = BASE_TYPES.map((b) => {
      const n = ident(b);
      const P = spell(t, b);
      const R = ret(b);
      const body = isBytes(b)
        ? 'for (auto c : x) std::printf("%02x", static_cast<unsigned>(c)); std::printf("\\n");'
        : b === "string"
          ? 'for (char c : x) std::printf("%02x", static_cast<unsigned>(static_cast<unsigned char>(c))); std::printf("\\n");'
          : b === "bool"
            ? 'std::puts(x ? "true" : "false");'
            : b === "f64"
              ? 'std::printf("%016llx\\n", static_cast<unsigned long long>(std::bit_cast<std::uint64_t>(x)));'
              : signedInt(b as IntType)
                ? 'std::printf("%lld\\n", static_cast<long long>(x));'
                : 'std::printf("%llu\\n", static_cast<unsigned long long>(x));';
      const r = R === P ? "return x;" : `return ${R}(x.begin(), x.end());`;
      return `static void show_${n}(${P} x) { ${body} }
static ${R} r_${n}(${P} x) { ${r} }
static ${tpl(t, "refusing-return", R)} f_${n}(${P} x, bool ok) { if (!ok) return ${lit(t, "null")}; return r_${n}(x); }
static bool o_${n}(${tpl(t, "optional-input", P)} x, bool y) { return y && x.has_value(); }`;
    });
    const main = positions.map(({ b, e }) => {
      const n = ident(b);
      return `  show_${n}(r_${n}(${e}));
  if (auto v = f_${n}(${e}, true)) show_${n}(*v);
  if (!f_${n}(${e}, false)) std::puts("refused");
  std::puts(o_${n}(${lit(t, "null")}, true) ? "present" : "absent");
  std::puts(o_${n}(${e}, true) ? "present" : "absent");`;
    });
    return `#include <array>
#include <bit>
#include <cstdint>
#include <cstdio>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>
using namespace std::literals;
${fns.join("\n")}
int main() {
${shows.map(({ b, e }) => `  show_${ident(b)}(${e});`).join("\n")}
${main.join("\n")}
}
`;
  },
};

const rust: Gen = {
  id: "rust",
  file: "main.rs",
  steps: [
    ["rustc", "--edition", "2021", "-D", "warnings", "-o", "main", "main.rs"],
    ["./main"],
  ],
  nanPayload: true,
  int: (t, v) => `${v}${t}`,
  f64: (bits) => `f64::from_bits(0x${bits.toString(16).padStart(16, "0")})`,
  str: (s) => escString(s, braceU, '"\\'),
  hex: (b) => `&[${hexList(b)}]`,
  ascii: (s) => `b"${s}"`,
  bool: (v) => String(v),
  concat: "&[a, b].concat()",
  program(t, shows, positions) {
    const ret = (b: BaseType): string =>
      isBytes(b) ? "Vec<u8>" : b === "string" ? "String" : spell(t, b);
    const fns = BASE_TYPES.map((b) => {
      const n = ident(b);
      const P = spell(t, b);
      const R = ret(b);
      const body = isBytes(b)
        ? 'for c in x { print!("{:02x}", c); } println!();'
        : b === "string"
          ? 'for c in x.bytes() { print!("{:02x}", c); } println!();'
          : b === "f64"
            ? 'println!("{:016x}", x.to_bits());'
            : 'println!("{}", x);';
      const r = isBytes(b)
        ? "x.to_vec()"
        : b === "string"
          ? "x.to_string()"
          : "x";
      return `fn show_${n}(x: ${P}) { ${body} }
fn r_${n}(x: ${P}) -> ${R} { ${r} }
fn f_${n}(x: ${P}, ok: bool) -> ${tpl(t, "refusing-return", R)} { if ok { Some(r_${n}(x)) } else { ${lit(t, "null")} } }
fn o_${n}(x: ${tpl(t, "optional-input", P)}, y: bool) -> bool { y && x.is_some() }`;
    });
    const main = positions.map(({ b, e }) => {
      const n = ident(b);
      const amp = isBytes(b) || b === "string" ? "&" : "";
      return `    show_${n}(${amp}r_${n}(${e}));
    if let Some(v) = f_${n}(${e}, true) { show_${n}(${amp}v); }
    if f_${n}(${e}, false).is_none() { println!("refused"); }
    println!("{}", if o_${n}(${lit(t, "null")}, true) { "present" } else { "absent" });
    println!("{}", if o_${n}(Some(${e}), true) { "present" } else { "absent" });`;
    });
    return `${fns.join("\n")}
fn main() {
    let a: &[u8] = ${rust.hex([0x0b])};
    let b: &[u8] = ${rust.ascii("a")};
${shows.map(({ b, e }) => `    show_${ident(b)}(${e});`).join("\n")}
${main.join("\n")}
}
`;
  },
};

const go: Gen = {
  id: "go",
  file: "main.go",
  steps: [["go", "build", "-o", "main", "main.go"], ["./main"]],
  nanPayload: true,
  int: (t, v) => `${spell(LANGUAGE_TABLES.go, t)}(${v})`,
  f64: (bits) =>
    `math.Float64frombits(0x${bits.toString(16).padStart(16, "0")})`,
  str: (s) => escString(s, uOrBigU, '"\\'),
  hex: (b) => `[]byte{${hexList(b)}}`,
  ascii: (s) => `[]byte("${s}")`,
  bool: (v) => String(v),
  concat: "append(append([]byte{}, a...), b...)",
  program(t, shows, positions) {
    const fns = BASE_TYPES.map((b) => {
      const n = ident(b);
      const P = spell(t, b);
      const body =
        isBytes(b) || b === "string"
          ? 'fmt.Printf("%x\\n", x)'
          : b === "f64"
            ? 'fmt.Printf("%016x\\n", math.Float64bits(x))'
            : "fmt.Println(x)";
      const r = isBytes(b) ? "append([]byte{}, x...)" : "x";
      return `func show_${n}(x ${P}) { ${body} }
func r_${n}(x ${P}) ${P} { return ${r} }
func f_${n}(x ${P}, ok bool) ${tpl(t, "refusing-return", P)} {
	if !ok {
		var zero ${P}
		return zero, errors.New("refused")
	}
	return r_${n}(x), nil
}
func o_${n}(x ${tpl(t, "optional-input", P)}, y bool) bool { return y && x != ${lit(t, "null")} }`;
    });
    const main = positions.map(({ b, e }) => {
      const n = ident(b);
      return `	show_${n}(r_${n}(${e}))
	if v, err := f_${n}(${e}, true); err == nil {
		show_${n}(v)
	}
	if _, err := f_${n}(${e}, false); err != nil {
		fmt.Println("refused")
	}
	fmt.Println(present(o_${n}(${lit(t, "null")}, true)))
	fmt.Println(present(o_${n}(ptr(${e}), true)))`;
    });
    return `package main

import (
	"errors"
	"fmt"
	"math"
)

func ptr[T any](v T) *T { return &v }

func present(p bool) string {
	if p {
		return "present"
	}
	return "absent"
}

${fns.join("\n")}

func main() {
	a := ${go.hex([0x0b])}
	b := ${go.ascii("a")}
${shows.map(({ b, e }) => `	show_${ident(b)}(${e})`).join("\n")}
${main.join("\n")}
}
`;
  },
};

const JAVA_BOX: Record<string, string> = {
  boolean: "Boolean",
  byte: "Byte",
  short: "Short",
  int: "Integer",
  long: "Long",
  double: "Double",
};
const java: Gen = {
  id: "java",
  file: "Main.java",
  steps: [
    ["javac", "-Xlint:all", "-Werror", "-d", ".", "Main.java"],
    ["java", "-cp", ".", "Main"],
  ],
  nanPayload: true,
  int: (t, v) => {
    if (t === "i8" || t === "i16")
      return `(${spell(LANGUAGE_TABLES.java, t)}) ${v}`;
    if (t === "u64" && v > INT_RANGE.i64.max) return `0x${v.toString(16)}L`;
    return spell(LANGUAGE_TABLES.java, t) === "long" ? `${v}L` : `${v}`;
  },
  f64: (bits) =>
    `Double.longBitsToDouble(0x${bits.toString(16).padStart(16, "0")}L)`,
  str: (s) =>
    escString(
      s,
      (cp) =>
        cp < 0x20 || cp === 0x7f
          ? `\\${cp.toString(8).padStart(3, "0")}`
          : utf16(cp),
      '"\\',
    ),
  hex: (b) => `HexFormat.of().parseHex("${hexOf(b)}")`,
  ascii: (s) => `"${s}".getBytes(StandardCharsets.US_ASCII)`,
  bool: (v) => String(v),
  concat: "ByteBuffer.allocate(a.length + b.length).put(a).put(b).array()",
  program(t, shows, positions) {
    const box = (P: string): string => JAVA_BOX[P] ?? P;
    const fns = BASE_TYPES.map((b) => {
      const n = ident(b);
      const P = spell(t, b);
      const body = isBytes(b)
        ? "HexFormat.of().formatHex(x)"
        : b === "string"
          ? "HexFormat.of().formatHex(x.getBytes(StandardCharsets.UTF_8))"
          : b === "f64"
            ? 'String.format("%016x", Double.doubleToRawLongBits(x))'
            : b === "u64"
              ? "Long.toUnsignedString(x)"
              : "x";
      const opt = P.endsWith("[]")
        ? P.replace("[]", "@Nullable []")
        : tpl(t, "optional-input", box(P));
      return `  static void show_${n}(${P} x) { System.out.println(${body}); }
  static ${P} r_${n}(${P} x) { return ${isBytes(b) ? "x.clone()" : "x"}; }
  static ${tpl(t, "refusing-return", box(P))} f_${n}(${P} x, boolean ok) { return ok ? Optional.of(r_${n}(x)) : Optional.empty(); }
  static boolean o_${n}(${opt} x, boolean y) { return y && x != ${lit(t, "null")}; }`;
    });
    const main = positions.map(({ b, e }) => {
      const n = ident(b);
      return `    show_${n}(r_${n}(${e}));
    f_${n}(${e}, true).ifPresent(v -> show_${n}(v));
    if (f_${n}(${e}, false).isEmpty()) System.out.println("refused");
    System.out.println(o_${n}(${lit(t, "null")}, true) ? "present" : "absent");
    System.out.println(o_${n}(${e}, true) ? "present" : "absent");`;
    });
    return `import java.lang.annotation.ElementType;
import java.lang.annotation.Target;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.Optional;

/** JSpecify's @Nullable, declared here as the same TYPE_USE annotation. */
@Target(ElementType.TYPE_USE)
@interface Nullable {}

public class Main {
${fns.join("\n")}
  public static void main(String[] args) {
    byte[] a = ${java.hex([0x0b])};
    byte[] b = ${java.ascii("a")};
${shows.map(({ b, e }) => `    show_${ident(b)}(${e});`).join("\n")}
${main.join("\n")}
  }
}
`;
  },
};

const php: Gen = {
  id: "php",
  file: "main.php",
  steps: [
    ["php", "-l", "main.php"],
    [
      "php",
      "-d",
      "error_reporting=-1",
      "-d",
      "display_errors=stderr",
      "-d",
      "log_errors=0",
      "main.php",
    ],
  ],
  nanPayload: true,
  int: (t, v) =>
    t === "i64" && v === INT_RANGE.i64.min ? "PHP_INT_MIN" : `${v}`,
  f64: (bits) =>
    `unpack('E', hex2bin('${bits.toString(16).padStart(16, "0")}'))[1]`,
  str: (s) => escString(s, braceU, '"\\$'),
  hex: (b) => `hex2bin("${hexOf(b)}")`,
  ascii: (s) => `'${s}'`,
  bool: (v) => String(v),
  concat: "$a . $b",
  program(t, shows, positions) {
    const fns = BASE_TYPES.filter((b) => "spelling" in t.types[b]).map((b) => {
      const n = ident(b);
      const P = spell(t, b);
      const attr = b === "secret-bytes" ? "#[\\SensitiveParameter] " : "";
      const body =
        isBytes(b) || b === "string"
          ? "bin2hex($x)"
          : b === "bool"
            ? '($x ? "true" : "false")'
            : b === "f64"
              ? "bin2hex(pack('E', $x))"
              : "$x";
      return `function show_${n}(${attr}${P} $x): void { echo ${body}, "\\n"; }
function r_${n}(${attr}${P} $x): ${P} { return $x; }
function f_${n}(${attr}${P} $x, bool $ok): ${tpl(t, "refusing-return", P)} { return $ok ? r_${n}($x) : null; }
function o_${n}(${attr}${tpl(t, "optional-input", P)}, bool $y): bool { return $y && $x !== null; }`;
    });
    const main = positions.map(({ b, e }) => {
      const n = ident(b);
      return `show_${n}(r_${n}(${e}));
$v = f_${n}(${e}, true); if ($v !== null) show_${n}($v);
if (f_${n}(${e}, false) === null) echo "refused\\n";
echo o_${n}(${lit(t, "null")}, true) ? "present" : "absent", "\\n";
echo o_${n}(${e}, true) ? "present" : "absent", "\\n";`;
    });
    return `<?php
declare(strict_types=1);
${fns.join("\n")}
$a = ${php.hex([0x0b])};
$b = ${php.ascii("a")};
${shows.map(({ b, e }) => `show_${ident(b)}(${e});`).join("\n")}
${main.join("\n")}
`;
  },
};

const ruby: Gen = {
  id: "ruby",
  file: "main.rb",
  steps: [
    ["ruby", "-wc", "main.rb"],
    ["ruby", "-w", "main.rb"],
  ],
  nanPayload: true,
  int: (_, v) => `${v}`,
  f64: (bits) =>
    `["${bits.toString(16).padStart(16, "0")}"].pack("H*").unpack1("G")`,
  str: (s) => escString(s, braceU, '"\\#'),
  hex: (b) => `["${hexOf(b)}"].pack("H*")`,
  ascii: (s) => `"${s}".b`,
  bool: (v) => String(v),
  concat: "a + b",
  program(t, shows, positions) {
    const fns = BASE_TYPES.map((b) => {
      const n = ident(b);
      const check = isBytes(b)
        ? "x.is_a?(String) && x.encoding == Encoding::ASCII_8BIT"
        : b === "string"
          ? "x.is_a?(String) && x.encoding == Encoding::UTF_8 && x.valid_encoding?"
          : b === "bool"
            ? "x == true || x == false"
            : b === "f64"
              ? "x.is_a?(Float)"
              : `x.is_a?(Integer) && (${INT_RANGE[b as IntType].min}..${INT_RANGE[b as IntType].max}).cover?(x)`;
      const body =
        isBytes(b) || b === "string"
          ? 'x.unpack1("H*")'
          : b === "f64"
            ? '[x].pack("G").unpack1("H*")'
            : "x";
      return `def show_${n}(x)
  raise "not ${b}: #{x.inspect}" unless ${check}
  puts ${body}
end
def r_${n}(x) = x
def f_${n}(x, ok) = ok ? r_${n}(x) : nil
def o_${n}(x, y) = y && !x.nil?`;
    });
    const main = positions.map(({ b, e }) => {
      const n = ident(b);
      return `show_${n}(r_${n}(${e}))
v = f_${n}(${e}, true)
show_${n}(v) unless v.nil?
puts "refused" if f_${n}(${e}, false).nil?
puts o_${n}(${lit(t, "null")}, true) ? "present" : "absent"
puts o_${n}(${e}, true) ? "present" : "absent"`;
    });
    return `${fns.join("\n")}
a = ${ruby.hex([0x0b])}
b = ${ruby.ascii("a")}
${shows.map(({ b, e }) => `show_${ident(b)}(${e})`).join("\n")}
${main.join("\n")}
`;
  },
};

const python: Gen = {
  id: "python",
  file: "main.py",
  steps: [
    ["python3", "-I", "-W", "error", "-m", "py_compile", "main.py"],
    ["python3", "-I", "-W", "error", "main.py"],
  ],
  nanPayload: true,
  int: (_, v) => `${v}`,
  f64: (bits) =>
    `struct.unpack(">d", bytes.fromhex("${bits.toString(16).padStart(16, "0")}"))[0]`,
  str: (s) => escString(s, uOrBigU, '"\\'),
  hex: (b) => `bytes.fromhex("${hexOf(b)}")`,
  ascii: (s) => `b"${s}"`,
  bool: (v) => (v ? "True" : "False"),
  concat: "a + b",
  program(t, shows, positions) {
    const fns = BASE_TYPES.map((b) => {
      const n = ident(b);
      const P = spell(t, b);
      const body = isBytes(b)
        ? "x.hex()"
        : b === "string"
          ? "x.encode().hex()"
          : b === "bool"
            ? '"true" if x else "false"'
            : b === "f64"
              ? 'struct.pack(">d", x).hex()'
              : "x";
      return `def show_${n}(x: ${P}) -> None:
    assert type(x) is ${P}
    print(${body})
def r_${n}(x: ${P}) -> ${P}:
    return x
def f_${n}(x: ${P}, ok: bool) -> ${tpl(t, "refusing-return", P)}:
    return r_${n}(x) if ok else ${lit(t, "null")}
def o_${n}(x: ${tpl(t, "optional-input", P)}, y: bool) -> bool:
    return y and x is not ${lit(t, "null")}`;
    });
    const main = positions.map(({ b, e }) => {
      const n = ident(b);
      return `show_${n}(r_${n}(${e}))
v = f_${n}(${e}, True)
if v is not None:
    show_${n}(v)
if f_${n}(${e}, False) is None:
    print("refused")
print("present" if o_${n}(${lit(t, "null")}, True) else "absent")
print("present" if o_${n}(${e}, True) else "absent")`;
    });
    return `import struct
${fns.join("\n")}
a = ${python.hex([0x0b])}
b = ${python.ascii("a")}
${shows.map(({ b, e }) => `show_${ident(b)}(${e})`).join("\n")}
${main.join("\n")}
`;
  },
};

const TSC = [Bun.which("tsc"), `${process.cwd()}/node_modules/.bin/tsc`].find(
  (p) => p !== null && existsSync(p),
);
const typescript: Gen = {
  id: "typescript",
  file: "main.ts",
  steps: [
    [
      TSC ?? "tsc",
      "--strict",
      "--noEmit",
      "--target",
      "es2022",
      "--lib",
      "es2022,dom",
      "main.ts",
    ],
    [process.execPath, "main.ts"],
  ],
  nanPayload: false,
  int: (t, v) =>
    spell(LANGUAGE_TABLES.typescript, t) === "bigint" ? `${v}n` : `${v}`,
  f64: (bits) =>
    `new DataView(Uint8Array.of(${bitsBytes(bits)
      .map((x) => (x === 0 ? "0" : `0x${hex2(x)}`))
      .join(", ")}).buffer).getFloat64(0)`,
  str: (s) => escString(s, braceU, '"\\'),
  hex: (b) => `Uint8Array.of(${hexList(b)})`,
  ascii: (s) => `new TextEncoder().encode("${s}")`,
  bool: (v) => String(v),
  concat: "Uint8Array.of(...a, ...b)",
  program(t, shows, positions) {
    const hex = '[...x].map((c) => c.toString(16).padStart(2, "0")).join("")';
    const fns = BASE_TYPES.map((b) => {
      const n = ident(b);
      const P = spell(t, b);
      const body = isBytes(b)
        ? `console.log(${hex});`
        : b === "string"
          ? `{ const u = new TextEncoder().encode(x); console.log([...u].map((c) => c.toString(16).padStart(2, "0")).join("")); }`
          : b === "f64"
            ? `{ const d = new DataView(new ArrayBuffer(8)); d.setFloat64(0, x); console.log(Number.isNaN(x) ? "nan" : d.getBigUint64(0).toString(16).padStart(16, "0")); }`
            : "console.log(String(x));";
      return `function show_${n}(x: ${P}): void ${body.startsWith("{") ? body : `{ ${body} }`}
function r_${n}(x: ${P}): ${P} { return x; }
function f_${n}(x: ${P}, ok: boolean): ${tpl(t, "refusing-return", P)} { return ok ? r_${n}(x) : ${lit(t, "null")}; }
function o_${n}(x: ${tpl(t, "optional-input", P)}, y: boolean): boolean { return y && x !== undefined; }`;
    });
    const main = positions.map(({ b, e }) => {
      const n = ident(b);
      return `show_${n}(r_${n}(${e}));
{ const v = f_${n}(${e}, true); if (v !== null) show_${n}(v); }
if (f_${n}(${e}, false) === null) console.log("refused");
console.log(o_${n}(undefined, true) ? "present" : "absent");
console.log(o_${n}(${e}, true) ? "present" : "absent");`;
    });
    return `${fns.join("\n")}
const a: Uint8Array = ${typescript.hex([0x0b])};
const b: Uint8Array = ${typescript.ascii("a")};
${shows.map(({ b, e }) => `show_${ident(b)}(${e});`).join("\n")}
${main.join("\n")}
export {};
`;
  },
};

const GENS: Gen[] = [c, cpp, rust, go, java, php, ruby, python, typescript];

const litExpr = (g: Gen, l: Lit): string => {
  const e =
    l.k === "int"
      ? g.int(l.t, l.v)
      : l.k === "f64"
        ? g.f64(l.bits)
        : l.k === "str"
          ? g.str(l.s)
          : l.k === "hex"
            ? g.hex(l.b)
            : l.k === "ascii"
              ? g.ascii(l.s)
              : l.k === "concat"
                ? g.concat
                : g.bool(l.v);
  return g.arg ? g.arg(l, e) : e;
};

const kept = (g: Gen, l: Lit): boolean =>
  "spelling" in LANGUAGE_TABLES[g.id].types[baseOfLit(l)] && !g.drops?.(l);

describe("each table's spellings, at the example value, are the literals the checks write", () => {
  test.each(GENS.map((g) => [g.id, g] as const))("%s", (_, g) => {
    const t = LANGUAGE_TABLES[g.id];
    expect(g.int("u32", 42n)).toBe(lit(t, "int"));
    expect(g.f64(0x3ff8000000000000n)).toBe(lit(t, "f64"));
    expect(g.str("abc")).toBe(lit(t, "str"));
    expect(g.hex([0x0b, 0x0b])).toBe(lit(t, "hex"));
    expect(g.ascii("abc")).toBe(lit(t, "ascii"));
    expect(g.bool(true)).toBe(lit(t, "bool"));
    expect(g.concat).toBe(lit(t, "concat"));
  });
});

describe("each table compiles and runs in its own language", () => {
  setDefaultTimeout(180_000);
  for (const g of GENS) {
    const tool = g.steps[0]?.[0] ?? "";
    const missing = Bun.which(tool) === null && !existsSync(tool);
    // On CI a missing toolchain fails the check rather than skipping it, so a
    // runner image that drops one cannot turn the check off unseen.
    const ci = Boolean(process.env.CI);
    if (missing && !ci)
      console.log(
        `skipping the ${g.id} compile check: ${tool} is not installed`,
      );
    test.skipIf(missing && !ci)(g.id, () => {
      if (missing)
        throw new Error(`the ${g.id} compile check needs ${tool} on CI`);
      const t = LANGUAGE_TABLES[g.id];
      const lits = LITS.filter((l) => kept(g, l));
      const bases = BASE_TYPES.filter((b) => "spelling" in t.types[b]);
      const dir = mkdtempSync(join(tmpdir(), `vector-${g.id}-`));
      try {
        writeFileSync(
          join(dir, g.file),
          g.program(
            t,
            lits.map((l) => ({ b: baseOfLit(l), e: litExpr(g, l) })),
            bases.map((b) => ({ b, e: litExpr(g, SAMPLE[b]) })),
          ),
        );
        let out = "";
        for (const cmd of g.steps) {
          const run = Bun.spawnSync(cmd, {
            cwd: dir,
            env: { ...process.env, GOCACHE: join(dir, ".gocache") },
          });
          const err = run.stderr.toString();
          if (
            run.exitCode !== 0 ||
            ((g.id === "ruby" || g.id === "php") && err !== "")
          )
            throw new Error(`${cmd.join(" ")} failed:\n${err}${run.stdout}`);
          out = run.stdout.toString();
        }
        const want = [
          ...lits.map((l) => shown(l, g.nanPayload)),
          ...bases.flatMap((b) => {
            const v = shown(SAMPLE[b], g.nanPayload);
            return [v, v, "refused", "absent", "present"];
          }),
        ];
        expect(out.trimEnd().split("\n")).toEqual(want);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
