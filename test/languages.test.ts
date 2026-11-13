import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
  LANGUAGES,
  LITERAL_KINDS,
  OUTCOMES,
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
