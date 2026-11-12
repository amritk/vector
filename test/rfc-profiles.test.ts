// RFC profile specs: a spec whose main source is an RFC, named by the
// front-matter keyword vector-main-RFC<N>, and the syntax extensions the two
// committed profiles (RFC 5869, RFC 8439) need.
import { describe, expect, spyOn, test } from "bun:test";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rfcMain } from "../src/rfc/cli.ts";
import { extract } from "../src/rfc/extract.ts";
import {
  LABELLED_MESSAGE,
  isLiteralError,
  parseLiteral,
} from "../src/rfc/literals.ts";
import {
  type RfcResolver,
  namesMainRfc,
  profileToContract,
} from "../src/rfc/profile.ts";
import { parseRfc } from "../src/rfc/rfctext.ts";
import { parseV3 } from "../src/rfc/xmlv3.ts";

const here = (p: string) => new URL(p, import.meta.url).pathname;
const read = (p: string) => readFileSync(here(p), "utf8");

const FIX = "fixtures/rfc-main";
const fixture = (name: string) => ({
  spec: here(`${FIX}/specs/${name}.xml`),
  contract: here(`${FIX}/contracts/${name}.json`),
});

/** RFC 9990 (v3 XML) and RFC 9991 (text) from the fixture's rfcs/. */
const resolver: RfcResolver = (n) => {
  if (n === 9990) {
    const p = here(`${FIX}/rfcs/rfc9990.xml`);
    return parseV3(readFileSync(p, "utf8"), p);
  }
  return parseRfc(read(`${FIX}/rfcs/rfc9991.txt`));
};

/** The passing XML fixture, with `edit` applied to its text. */
const BASE = read(`${FIX}/specs/mini-frame.xml`);
const variant = (edit: (xml: string) => string) => edit(BASE);
const run = (xml: string) =>
  profileToContract(
    parseV3(xml, "specs/mini-frame.xml"),
    "specs/mini-frame.xml",
    resolver,
  );
const messages = (xml: string) => {
  const r = run(xml);
  if (!("refusals" in r)) throw new Error("expected refusals");
  return r.refusals.map((x) => x.message);
};
const contract = (xml: string) => {
  const r = run(xml);
  if (!("contract" in r)) throw new Error(JSON.stringify(r.refusals));
  return r.contract;
};

const sub = (from: string, to: string) => (xml: string) => {
  expect(xml).toContain(from);
  return xml.replace(from, to);
};
const KEY = "<keyword>vector-main-RFC9990</keyword>";
const PREFIX_XREF = `<xref section="2" sectionFormat="of" target="RFC9990"/>`;
const LIMIT = `<blockquote anchor="R-LIMIT">
        <t>A sender MUST NOT frame more than 255 octets. ${PREFIX_XREF}</t>
      </blockquote>`;

describe("main source fixtures", () => {
  test("an RFC v3 XML main source: extract equals the committed contract", () => {
    for (const name of ["mini-frame", "mini-frame-excluded"]) {
      const { spec, contract: c } = fixture(name);
      const r = extract(spec, c);
      if (!("text" in r)) throw new Error(r.refusals.join("\n"));
      expect(r.text).toBe(readFileSync(c, "utf8"));
      const parsed = JSON.parse(r.text);
      expect(parsed.source.rfc).toBe(9990);
      expect(parsed.source.main).toBeUndefined();
      expect(parsed.sources.map((s: { id: string }) => s.id)).toEqual([
        "rfc9990",
      ]);
    }
  });

  test("an RFC .txt main source: extract equals the committed contract", () => {
    const { spec, contract: c } = fixture("mini-frame-txt");
    const r = extract(spec, c);
    if (!("text" in r)) throw new Error(r.refusals.join("\n"));
    expect(r.text).toBe(readFileSync(c, "utf8"));
    expect(JSON.parse(r.text).source.rfc).toBe(9991);
  });

  test("a binding RFC sentence neither required nor excluded is refused", () => {
    for (const [name, rfc] of [
      ["mini-frame-missing", 9990],
      ["mini-frame-txt-missing", 9991],
    ] as const) {
      const { spec } = fixture(name);
      const r = extract(spec, here(`${FIX}/contracts/${name}.json`));
      if (!("refusals" in r)) throw new Error("expected refusals");
      expect(r.refusals).toEqual([
        `${spec}:5: completeness: Section 2 of RFC${rfc}: MUST NOT sentence is neither a requirement nor an exclusion: "A sender MUST NOT frame more than 255 octets."`,
      ]);
    }
  });
});

describe("the main-source keyword", () => {
  test("passes when the RFC is normative and cited", () => {
    const c = contract(BASE);
    expect(c.source).toEqual({ rfc: 9990, title: "Mini Framing profile" });
    expect(c.requirements.map((q) => q.id)).toEqual(["R-PREFIX", "R-LIMIT"]);
  });

  test("an RFC that is not a normative reference is refused", () => {
    const xml = variant(
      sub(
        "<name>Normative References</name>",
        "<name>Informative References</name>",
      ),
    );
    expect(messages(xml)).toContain(
      "vector-main-RFC9990 names RFC9990, which is not a normative reference; list it under normative:",
    );
  });

  test("an RFC that nothing cites is refused", () => {
    const xml = variant(
      sub(
        "</references>",
        `<reference anchor="RFC9991"><front><title>T</title></front><seriesInfo name="RFC" value="9991"/></reference></references>`,
      ),
    ).replace(KEY, "<keyword>vector-main-RFC9991</keyword>");
    expect(messages(xml)).toContain(
      "RFC9991 is the main source, but nothing cites it; quote it in a requirement",
    );
  });

  test("two keys are refused", () => {
    const xml = variant(
      sub(KEY, `${KEY}<keyword>vector-main-RFC9991</keyword>`),
    );
    expect(messages(xml)).toContain(
      "a spec has one main source; keyword vector-main-RFC9991 names a second",
    );
  });

  test("a misspelt key is refused", () => {
    for (const key of [
      "vector-main-rfc9990",
      "Vector-Main-RFC9990",
      "vector_main_RFC9990",
      "vector-main RFC9990",
    ])
      expect(
        messages(variant(sub(KEY, `<keyword>${key}</keyword>`))),
      ).toContain(`the main-source keyword is vector-main-RFC<N>, not ${key}`);
  });

  test("a BCP 14 sentence in an unanchored blockquote with no Untested: is refused", () => {
    const xml = variant(
      sub(
        "</section>\n  </middle>",
        "<blockquote><t>The implementation <bcp14>MUST</bcp14> zero the key after use.</t></blockquote></section>\n  </middle>",
      ),
    );
    const r = run(xml);
    if (!("refusals" in r)) throw new Error("expected refusals");
    const line = xml
      .split("\n")
      .findIndex((l) => l.includes("zero the key after use"));
    expect(r.refusals).toContainEqual(
      expect.objectContaining({
        file: "specs/mini-frame.xml",
        line: line + 1,
        message:
          'this BCP 14 sentence is the spec\'s own text, but the main source is RFC9990; quote the RFC in a blockquote ending {{Section N of RFC9990}}: "The implementation MUST zero the key after use."',
      }),
    );
  });

  test("a key that only starts like vector-main is not a main key", () => {
    const xml = variant(
      sub(KEY, `${KEY}<keyword>vector-maintenance</keyword>`),
    );
    expect(contract(xml).source.rfc).toBe(9990);
    expect(namesMainRfc(parseV3(BASE, "x.xml"))).toBe(true);
    const plain = BASE.replace(KEY, "<keyword>vector-maintenance</keyword>");
    expect(namesMainRfc(parseV3(plain, "x.xml"))).toBe(false);
  });

  test("the spec's own BCP 14 text is refused in main mode", () => {
    const xml = variant(
      sub(
        "</section>\n  </middle>",
        `<t anchor="R-OWN">A frame <bcp14>MUST</bcp14> be short.</t></section>\n  </middle>`,
      ),
    );
    expect(messages(xml).join("\n")).toContain(
      "R-OWN, a BCP 14 paragraph, is the spec's own text, but the main source is RFC9990",
    );
  });
});

describe("an excluded RFC blockquote", () => {
  const excluded = variant(
    sub(
      LIMIT,
      `<blockquote>
        <t>A sender MUST NOT frame more than 255 octets. ${PREFIX_XREF}</t>
      </blockquote>
      <t>Untested: the limit is left out.</t>`,
    ),
  );

  test("an unanchored blockquote followed by Untested: excludes the sentence", () => {
    const xml = excluded.replace(
      /<sourcecode type="ts-property"><!\[CDATA\[\n\/\/ P-LIMIT[\s\S]*?<\/sourcecode>/,
      "",
    );
    const c = contract(xml);
    expect(c.requirements.map((q) => q.id)).toEqual(["R-PREFIX"]);
    expect(c.exclusions).toEqual([
      expect.objectContaining({
        section: "2",
        reason: "the limit is left out.",
      }),
    ]);
  });

  test("an Untested: that does not directly follow the blockquote is refused", () => {
    const xml = excluded
      .replace("<t>Untested: the limit is left out.</t>", "")
      .replace(
        "</section>\n  </middle>",
        "<t>Untested: the limit is left out.</t></section>\n  </middle>",
      );
    expect(messages(xml)).toContain(
      "this Untested: paragraph excludes nothing; it must directly follow the requirement or BCP 14 paragraph it excludes",
    );
  });

  test("an unanchored blockquote with no BCP 14 keyword is refused", () => {
    const xml = excluded.replace(
      "A sender MUST NOT frame more than 255 octets.",
      "A sender frames octets.",
    );
    expect(messages(xml)).toContain(
      "an excluded blockquote holds no BCP 14 keyword, so it excludes nothing; anchor it to exclude a definition",
    );
  });

  test("an excluded blockquote that does not end in its section xref is refused", () => {
    const xml = excluded.replace(`255 octets. ${PREFIX_XREF}`, "255 octets.");
    expect(messages(xml)).toContain(
      "an excluded blockquote must be <t> paragraphs, the last ending with {{Section N of RFCx}}",
    );
  });
});

describe("Note: paragraphs", () => {
  test("a Note: right after a requirement is the requirement's note", () => {
    const xml = variant(
      sub(
        "</blockquote>\n      <sourcecode",
        "</blockquote>\n      <t>Note: one octet holds 0..255.</t>\n      <sourcecode",
      ),
    );
    const c = contract(xml);
    expect(c.requirements[0]).toMatchObject({
      id: "R-PREFIX",
      note: "one octet holds 0..255.",
    });
  });

  test("a Note: that follows no requirement is refused", () => {
    const xml = variant(
      sub(
        '<section anchor="framing">\n      <name>Framing</name>',
        `<section anchor="framing">\n      <name>Framing</name>\n      <t>Note: nothing here.</t>`,
      ),
    );
    expect(messages(xml)).toContain(
      "this Note: paragraph notes nothing; it must directly follow the requirement it notes",
    );
  });
});

describe("reference modules in a ts-interface", () => {
  const IFACE = `// module: nish/mini/frame
export function frame(data: u8[]): u8[] | null`;
  const withIface = (code: string) => variant(sub(IFACE, code));

  test("a comment between a signature and its ; is skipped", () => {
    for (const end of [" /* frame */;", " // frames\n;"]) {
      const c = contract(withIface(`${IFACE}${end}`));
      expect(c.functions.map((f) => f.name)).toEqual(["frame"]);
    }
  });

  test("functions after a later // module: line name that module", () => {
    const c = contract(
      withIface(
        `${IFACE}\n// module: nish/mini/len\nexport function len(data: u8[]): i32`,
      ),
    );
    expect(c.functions.map((f) => [f.name, f.module])).toEqual([
      ["frame", undefined],
      ["len", "nish/mini/len"],
    ]);
  });

  for (const [why, code, message] of [
    [
      "a module outside nish",
      `${IFACE}\n// module: std/len\nexport function len(data: u8[]): i32`,
      "`std/len` is not a nish module; write nish/<path>",
    ],
    [
      "a module line in a block comment",
      `${IFACE}\n/* module: nish/mini/len */\nexport function len(data: u8[]): i32`,
      "a module line is a line comment; write `// module: nish/mini/len`",
    ],
    ...[
      "// Module: nish/mini/len",
      "//module nish/mini/len",
      "// module: nish/a nish/b",
    ].map(
      (line) =>
        [
          `the near-miss \`${line}\``,
          `${IFACE}\n${line}\nexport function len(data: u8[]): i32`,
          `a module line is \`// module: nish/<path>\`, one module, not \`${line}\``,
        ] as const,
    ),
    [
      "a module line before the previous signature's ;",
      `${IFACE}\n// module: nish/mini/len\n;`,
      "end `frame` with its `;` before this module line",
    ],
    [
      "the same module twice in a row",
      `${IFACE}\n// module: nish/mini/len\n// module: nish/mini/len\nexport function len(data: u8[]): i32`,
      "the functions above are already from nish/mini/len",
    ],
    [
      "the module under test again",
      `${IFACE}\n// module: nish/mini/len\nexport function len(data: u8[]): i32\n// module: nish/mini/frame\nexport function unframe(data: u8[]): u8[]`,
      "nish/mini/frame is the module under test; declare its functions first, before any `// module:` line",
    ],
  ] as const)
    test(`${why} is refused`, () => {
      expect(messages(withIface(code)).join("\n")).toContain(message);
    });
});

describe("a label that starts with a digit", () => {
  test("`32-bit fixed-common part = hex` is a labelled value", () => {
    expect(parseLiteral("32-bit fixed-common part = 07000000")).toEqual({
      kind: "labelled",
      label: "32-bit fixed-common part",
      hex: "07000000",
    });
  });

  test("a label of digits alone is refused", () => {
    const r = parseLiteral("32 = 07000000");
    expect(isLiteralError(r)).toBe(true);
    expect(r).toMatchObject({ message: "unexpected text after the value" });
    // A digit-start word with a letter is a label, but a label needs a value.
    expect(parseLiteral("32-bit = ")).toMatchObject({
      message: LABELLED_MESSAGE,
    });
  });
});

describe("the RFC profiles", () => {
  for (const name of ["rfc5869-hkdf-sha256", "rfc8439-chacha20-poly1305"])
    test(`${name}: two extracts are byte-identical and equal the committed contract`, () => {
      const spec = here(`../specs/${name}.xml`);
      const c = here(`../contracts/${name}.json`);
      const a = extract(spec, c);
      const b = extract(spec, c);
      if (!("text" in a) || !("text" in b))
        throw new Error("extract refused the profile");
      expect(a.text).toBe(b.text);
      expect(a.text).toBe(readFileSync(c, "utf8"));
      const parsed = JSON.parse(a.text);
      expect(parsed.source.rfc).toBe(Number(name.slice(3, 7)));
      expect(parsed.$schema).toBe("../schemas/rfc-contract.json");
    });
});

/** Runs the CLI, capturing what it prints. */
async function cli(argv: string[]) {
  const out: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...a) => {
    out.push(a.join(" "));
  });
  const error = spyOn(console, "error").mockImplementation((...a) => {
    out.push(a.join(" "));
  });
  try {
    return { code: await rfcMain(argv), out: out.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

describe("spec check --spec <profile>.xml", () => {
  const { spec, contract: c } = fixture("mini-frame");

  test("the profile that extracts to the contract passes", async () => {
    const r = await cli(["check", c, "--spec", spec]);
    expect(r.out).toContain("CONTRACT_VALID");
    expect(r.code).toBe(0);
  });

  test("the RFC itself, or no --spec, also passes", async () => {
    for (const extra of [["--spec", here(`${FIX}/rfcs/rfc9990.xml`)], []]) {
      const r = await cli(["check", c, ...extra]);
      expect(r.out).toContain("CONTRACT_VALID");
    }
  });

  test("a profile of another contract is refused", async () => {
    const other = fixture("mini-frame-excluded").spec;
    const r = await cli(["check", c, "--spec", other]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(
      `${other} is the profile of contract "mini-frame-excluded" (docName "draft-mini-frame-excluded-00"), not of mini-frame`,
    );
  });

  test("a profile that extracts to something else is refused", async () => {
    const d = mkdtempSync(join(tmpdir(), "profile-check-"));
    for (const dir of ["specs", "contracts", "rfcs"])
      Bun.spawnSync(["mkdir", "-p", join(d, dir)]);
    const s = join(d, "specs/mini-frame.xml");
    const k = join(d, "contracts/mini-frame.json");
    copyFileSync(here(`${FIX}/rfcs/rfc9990.xml`), join(d, "rfcs/rfc9990.xml"));
    copyFileSync(c, k);
    writeFileSync(
      s,
      BASE.replace(
        "</blockquote>\n      <sourcecode",
        "</blockquote>\n      <t>Note: one octet.</t>\n      <sourcecode",
      ),
    );
    const r = await cli(["check", k, "--spec", s]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(
      `${k} is not what ${s} states; run: vector spec extract ${s} -o ${k}`,
    );
  });
});
