// RFC profile specs: a spec whose main source is an RFC, named by the
// front-matter keyword vector-main-RFC<N>, and the syntax extensions the two
// committed profiles (RFC 5869, RFC 8439) need.
import { describe, expect, spyOn, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rfcMain } from "../src/rfc/cli.ts";
import type { Clause, FnSig, RfcContract } from "../src/rfc/contract.ts";
import { extract } from "../src/rfc/extract.ts";
import { runGates } from "../src/rfc/gates.ts";
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
          'this BCP 14 sentence is an RFC quote with no anchor and no Untested: paragraph; anchor the blockquote to require it, or follow it with Untested: to exclude it: "The implementation MUST zero the key after use."',
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
});

describe("the spec's own text in main mode", () => {
  const OWN =
    "is the spec's own text, but the main source is RFC9990; quote the RFC in a blockquote ending {{Section N of RFC9990}}";
  const END = "</section>\n  </middle>";
  /** The refusals of BASE with `extra` at the end of the framing section,
   * and the 1-based line `extra` starts on. */
  const refused = (extra: string) => {
    const xml = variant(sub(END, `${extra}${END}`));
    const r = run(xml);
    if (!("refusals" in r)) throw new Error("expected refusals");
    const line = xml.split("\n").findIndex((l) => l.includes(extra)) + 1;
    return { refusals: r.refusals, line };
  };
  for (const [why, extra, message] of [
    [
      "an anchored BCP 14 paragraph",
      `<t anchor="R-OWN">A frame <bcp14>MUST</bcp14> be short.</t>`,
      `R-OWN, a BCP 14 paragraph, ${OWN}`,
    ],
    [
      "an unanchored BCP 14 paragraph with no Untested:",
      "<t>A frame <bcp14>MUST</bcp14> be short.</t>",
      `this BCP 14 sentence ${OWN}: "A frame MUST be short."`,
    ],
    [
      "a Definition: paragraph",
      `<t anchor="D-FRAME">Definition: a frame is a length octet and data.</t>`,
      `a Definition: paragraph ${OWN}`,
    ],
    [
      "an excluded paragraph",
      "<t>The implementation <bcp14>MUST</bcp14> zero the key after use.</t><t>Untested: not observable.</t>",
      `an excluded paragraph ${OWN}`,
    ],
    [
      "a vector whose Source is a section of the spec",
      `<table><thead><tr><th>Id</th><th>Call</th><th>Expected</th><th>Covers</th><th>Source</th><th>Title</th></tr></thead><tbody><tr><td>V1</td><td><tt>frame(data = 00)</tt></td><td><tt>result = 0100</tt></td><td>R-PREFIX</td><td><xref target="framing"/></td><td>one octet</td></tr></tbody></table>`,
      `Source framing, a section of the spec, ${OWN}`,
    ],
  ] as const)
    test(`${why} is refused`, () => {
      const { refusals, line } = refused(extra);
      expect(refusals).toContainEqual(
        expect.objectContaining({
          file: "specs/mini-frame.xml",
          line,
          message,
        }),
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

  test("other comments that start with module are skipped", () => {
    for (const comment of ["// module-level helper", "// module under test"]) {
      const after = contract(withIface(`${IFACE}\n${comment}\n;`));
      expect(after.functions.map((f) => f.name)).toEqual(["frame"]);
      const between = contract(
        withIface(
          `${IFACE};\n${comment}\nexport function len(data: u8[]): i32`,
        ),
      );
      expect(between.functions.map((f) => [f.name, f.module])).toEqual([
        ["frame", undefined],
        ["len", undefined],
      ]);
    }
  });

  test("a module under test that declares no function is refused", () => {
    const xml = withIface(
      "// module: nish/mini/frame\n// module: nish/mini/other\nexport function frame(data: u8[]): u8[] | null",
    );
    const r = run(xml);
    if (!("refusals" in r)) throw new Error("expected refusals");
    const line =
      xml.split("\n").findIndex((l) => l === "// module: nish/mini/other") + 1;
    expect(r.refusals).toContainEqual(
      expect.objectContaining({
        file: "specs/mini-frame.xml",
        line,
        message:
          "nish/mini/frame, the module under test, declares no function; declare its functions before `// module: nish/mini/other`",
      }),
    );
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
      "a module that is not a module path",
      `${IFACE}\n// module: Std/len\nexport function len(data: u8[]): i32`,
      "`Std/len` is not a module path; write <root>/<path>, lowercase segments split by /",
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
      "/// module: nish/mini/len",
      "/* Module: nish/mini/len */",
      "/* module nish/mini/len */",
      "/** MODULE: nish/mini/len */",
    ].map(
      (line) =>
        [
          `the near-miss \`${line}\``,
          `${IFACE}\n${line}\nexport function len(data: u8[]): i32`,
          `a module line is \`// module: <root>/<path>\`, one module, not \`${line}\``,
        ] as const,
    ),
    [
      "a module line inside a signature",
      "// module: nish/mini/frame\nexport function frame(\n// module: nish/mini/len\ndata: u8[]): u8[] | null",
      "a module line goes between signatures, on its own line; move it out of this one",
    ],
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
      expect(messages(withIface(code))).toContain(message);
    });
});

describe("clauses test the module under test", () => {
  const IFACE = `// module: nish/mini/frame
export function frame(data: u8[]): u8[] | null`;
  const REF = `${IFACE}\n// module: nish/mini/ref\nexport function g(data: u8[]): u8[] | null`;
  const ASSERT = "unwrap(frame(data)).length === data.length + 1";
  const END = "</section>\n  </middle>";
  const VECTORS = (call: string) =>
    `<table><thead><tr><th>Id</th><th>Call</th><th>Expected</th><th>Covers</th><th>Source</th><th>Title</th></tr></thead><tbody><tr><td>V1</td><td><tt>${call}(data = 00)</tt></td><td><tt>result = 0100</tt></td><td>R-PREFIX</td><td>${PREFIX_XREF}</td><td>one octet</td></tr></tbody></table>`;
  /** The refusals of `xml`, and the 1-based line holding `needle`. */
  const refusedAt = (xml: string, needle: string) => {
    const r = run(xml);
    if (!("refusals" in r)) throw new Error("expected refusals");
    const line = xml.split("\n").findIndex((l) => l.includes(needle)) + 1;
    return { refusals: r.refusals, line };
  };

  test("a property whose assertion calls only reference functions is refused", () => {
    const xml = variant((x) =>
      sub(
        ASSERT,
        "unwrap(g(data)).length === data.length + 1",
      )(sub(IFACE, REF)(x)),
    );
    const { refusals, line } = refusedAt(xml, "P-PREFIX covers");
    expect(refusals).toContainEqual(
      expect.objectContaining({
        file: "specs/mini-frame.xml",
        line,
        message:
          "property P-PREFIX's assertion calls only reference functions (g); call a function of nish/mini/frame, the module under test",
      }),
    );
  });

  test("a property that also calls a function under test passes", () => {
    const c = contract(
      variant((x) =>
        sub(
          ASSERT,
          "unwrap(frame(data)).length === unwrap(g(data)).length",
        )(sub(IFACE, REF)(x)),
      ),
    );
    expect(c.functions.map((f) => [f.name, f.module])).toEqual([
      ["frame", undefined],
      ["g", "nish/mini/ref"],
    ]);
  });

  test("a vector whose Call is a reference function is refused", () => {
    const xml = variant((x) =>
      sub(END, `${VECTORS("g")}${END}`)(sub(IFACE, REF)(x)),
    );
    const { refusals, line } = refusedAt(xml, "<tt>g(data = 00)</tt>");
    expect(refusals).toContainEqual(
      expect.objectContaining({
        file: "specs/mini-frame.xml",
        line,
        message:
          "Call: g is a reference function of nish/mini/ref; a vector tests nish/mini/frame, the module under test, so call one of its functions",
      }),
    );
  });

  describe("spec check refuses a hand-written contract that", () => {
    const base = () =>
      JSON.parse(read(`${FIX}/contracts/mini-frame.json`)) as RfcContract;
    const coverage = (c: RfcContract) =>
      runGates(c)
        .issues.filter((i) => i.gate === "coverage")
        .map(({ at, message }) => ({ at, message }));
    const G: FnSig = {
      name: "g",
      module: "nish/mini/ref",
      params: [{ name: "data", type: "bytes" }],
      returns: "bytes?",
    };
    /** `e` with every call to frame made a call to g. */
    const toG = (e: unknown): unknown =>
      Array.isArray(e)
        ? e.map(toG)
        : e && typeof e === "object"
          ? Object.fromEntries(
              Object.entries(e).map(([k, v]) => [
                k,
                k === "call" && v === "frame" ? "g" : toG(v),
              ]),
            )
          : e;

    test("passes as committed", () => {
      expect(coverage(base())).toEqual([]);
    });

    test("tests a property only through a reference function", () => {
      const c = base();
      c.functions.push(G);
      c.clauses[0] = toG(c.clauses[0]) as Clause;
      expect(coverage(c)).toEqual([
        {
          at: "P-PREFIX",
          message:
            "the assertion calls only reference functions (g), none of nish/mini/frame, the module under test, so it checks nothing here",
        },
      ]);
    });

    test("calls a reference function from a vector", () => {
      const c = base();
      c.functions.push(G);
      c.clauses.push({
        kind: "vector",
        id: "V1",
        title: "one octet",
        covers: ["R-PREFIX"],
        source: { cite: { section: "2" } },
        call: "g",
        args: [{ hex: "00", label: "data" }],
        expect: { hex: "0100", label: "result" },
      });
      expect(coverage(c)).toEqual([
        {
          at: "V1",
          message:
            "calls g, a reference function, not a function of nish/mini/frame, the module under test, so it checks nothing here",
        },
      ]);
    });

    test("declares no function of the module under test", () => {
      const c = base();
      c.functions = [{ ...c.functions[0], module: "nish/mini/ref" }];
      expect(coverage(c)).toContainEqual({
        at: "functions",
        message:
          "nish/mini/frame, the module under test, declares no function, so no clause can test it",
      });
    });
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
    const r = await cli(["check", c, "--spec", spec, "--run-sources"]);
    expect(r.out).toContain("CONTRACT_VALID");
    expect(r.code).toBe(0);
  });

  test("the RFC itself, or no --spec, also passes", async () => {
    for (const extra of [["--spec", here(`${FIX}/rfcs/rfc9990.xml`)], []]) {
      const r = await cli(["check", c, ...extra]);
      expect(r.out).toContain("CONTRACT_VALID");
      expect(r.code).toBe(0);
    }
  });

  test("a profile of another contract is refused", async () => {
    const other = fixture("mini-frame-excluded").spec;
    const r = await cli(["check", c, "--spec", other, "--run-sources"]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(
      `${other} is the profile of contract "mini-frame-excluded" (docName "draft-mini-frame-excluded-00"), not of mini-frame`,
    );
  });

  test("a profile that extracts to something else is refused", async () => {
    const d = mkdtempSync(join(tmpdir(), "profile-check-"));
    try {
      for (const dir of ["specs", "contracts", "rfcs"])
        mkdirSync(join(d, dir), { recursive: true });
      const s = join(d, "specs/mini-frame.xml");
      const k = join(d, "contracts/mini-frame.json");
      copyFileSync(
        here(`${FIX}/rfcs/rfc9990.xml`),
        join(d, "rfcs/rfc9990.xml"),
      );
      copyFileSync(c, k);
      writeFileSync(
        s,
        BASE.replace(
          "</blockquote>\n      <sourcecode",
          "</blockquote>\n      <t>Note: one octet.</t>\n      <sourcecode",
        ),
      );
      const r = await cli(["check", k, "--spec", s, "--run-sources"]);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain(
        `${k} is not what ${s} states; run: vector spec extract ${s} -o ${k}`,
      );
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
