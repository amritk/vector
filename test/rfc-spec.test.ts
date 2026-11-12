import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import hkdfContract from "../contracts/rfc5869-hkdf-sha256.json";
import { main } from "../src/cli.ts";
import { rfcMain } from "../src/rfc/cli.ts";
import {
  type RfcContract,
  type VectorClause,
  citeLabel,
  validateContractShape,
} from "../src/rfc/contract.ts";
import { type SourceRun, runGates } from "../src/rfc/gates.ts";
import { renderReport, reportJson } from "../src/rfc/report.ts";
import {
  type RfcDocument,
  hexValues,
  intLabelled,
  intRounds,
  parseRfc,
  sectionLines,
} from "../src/rfc/rfctext.ts";
import { runNishTest, runSourceCommands } from "../src/rfc/run.ts";
import {
  LOOSE_SECTION,
  hiddenText,
  parseDocument,
} from "../src/rfc/spectext.ts";
import { parseV3 } from "../src/rfc/xmlv3.ts";

// Spec contracts, multi-document contracts and vector provenance. Every gate
// here has a refusing test next to its passing one.

/** A paragraph's text with `code` as <tt> and each BCP 14 keyword tagged. */
const kw = (s: string): string =>
  s
    .replace(/`([^`]*)`/g, "<tt>$1</tt>")
    .replace(
      /\b(MUST NOT|MUST|SHALL NOT|SHALL|REQUIRED|SHOULD NOT|SHOULD|MAY)\b/g,
      "<bcp14>$1</bcp14>",
    );
/** A numbered section of RFC XML v3. */
const sec = (name: string, body: string): string =>
  `<section><name>${name}</name>\n${body}\n</section>`;
/** Artwork: its lines kept as printed. */
const art = (s: string): string => `<artwork><![CDATA[\n${s}\n]]></artwork>`;

/**
 * A small RFC XML v3 spec: BCP 14 boilerplate, numbered sections, a table, a
 * code block, inline code; `extra` sections follow Test Vectors.
 */
const spec = (extra = ""): string => `<?xml version="1.0" encoding="utf-8"?>
<rfc version="3" docName="draft-hex-00">
<front><title>Hex Encoding</title></front>
<middle>
<section anchor="intro"><name>Introduction</name>
<t>The key words "<bcp14>MUST</bcp14>", "<bcp14>MUST NOT</bcp14>", "<bcp14>REQUIRED</bcp14>", "<bcp14>SHALL</bcp14>", "<bcp14>SHALL NOT</bcp14>",
"<bcp14>SHOULD</bcp14>", "<bcp14>SHOULD NOT</bcp14>", "<bcp14>RECOMMENDED</bcp14>", "<bcp14>NOT RECOMMENDED</bcp14>", "<bcp14>MAY</bcp14>", and
"<bcp14>OPTIONAL</bcp14>" in this document are to be interpreted as described in
BCP 14 when, and only when, they appear in all
capitals, as shown here.</t>
</section>
<section anchor="encoding"><name>Encoding</name>
<t>An encoder <bcp14>MUST</bcp14> emit two lowercase digits per byte.</t>
<section anchor="decoding"><name>Decoding</name>
<t>A decoder <bcp14>MUST</bcp14> return null for a string of odd length: <tt>abc</tt> decodes
to null.</t>
</section>
</section>
<section anchor="vectors"><name>Test Vectors</name>
<table><thead><tr><th>bytes</th><th><tt>toHex</tt></th></tr></thead>
<tbody><tr><td>[de ad be ef]</td><td><tt>deadbeef</tt></td></tr></tbody></table>
</section>
${extra}
<section numbered="false" anchor="notes"><name>Notes</name>
<sourcecode type="text"># not a heading</sourcecode>
</section>
</middle>
<back>
<section anchor="sizes"><name>Sizes</name>
<t>Block Count: 4</t>
</section>
</back>
</rfc>
`;
const SPEC = spec();
const read = (xml: string): RfcDocument => parseV3(xml, "hex.xml");

const RFC5869_TEXT = readFileSync("rfcs/rfc5869.txt", "utf8");
const rfc5869 = parseRfc(RFC5869_TEXT);
const hkdf = hkdfContract as unknown as RfcContract;
const clone = <T>(x: T): T => structuredClone(x);
const vec = (c: RfcContract, id: string) =>
  c.clauses.find((k) => k.id === id) as VectorClause;

/** A contract for the spec above: one vector of each provenance. */
function hexContract(): RfcContract {
  return {
    contract: "hex-xml",
    source: { title: "Hex Encoding", main: "hex" },
    sources: [{ id: "hex", path: "hex.xml" }],
    target: { module: "nish/encoding/hex" },
    functions: [
      {
        name: "toHex",
        params: [{ name: "b", type: "bytes" }],
        returns: "string",
      },
      {
        name: "fromHex",
        params: [{ name: "s", type: "string" }],
        returns: "bytes?",
      },
    ],
    requirements: [
      {
        id: "R-LOWER",
        section: "2",
        level: "MUST",
        quote: "An encoder MUST emit two lowercase digits per byte.",
      },
      {
        id: "R-ODD",
        section: "2.1",
        level: "MUST",
        quote: "A decoder MUST return null for a string of odd length",
      },
    ],
    clauses: [
      {
        kind: "vector",
        id: "V-CITE",
        title: "the table's value",
        covers: ["R-LOWER"],
        source: { cite: { section: "3" } },
        call: "toHex",
        args: [{ hex: "deadbeef" }],
        expect: { str: "deadbeef" },
      },
      {
        kind: "vector",
        id: "V-SPEC",
        title: "odd length is refused",
        covers: ["R-ODD"],
        source: { spec: "2.1" },
        section: "2.1",
        call: "fromHex",
        args: [{ str: "abc" }],
        expect: { null: true },
      },
      {
        kind: "vector",
        id: "V-CMD",
        title: "a reference encoder agrees",
        covers: ["R-LOWER"],
        source: { command: "printf deadbeef" },
        section: "3",
        call: "toHex",
        args: [{ hex: "deadbeef" }],
        expect: { str: "deadbeef" },
      },
    ],
  } as RfcContract;
}

const doc = read(SPEC);
const section = (id: string) => {
  const s = doc.sections.get(id);
  if (!s) throw new Error(`no section ${id}`);
  return s;
};
const docs = (d: RfcDocument = doc, extra: [string, RfcDocument][] = []) =>
  new Map<string, RfcDocument>([["hex", d], ...extra]);
const passed = (id: string): Map<string, SourceRun> =>
  new Map([[id, { id, command: "printf deadbeef", outcome: "pass" }]]);
const messages = (r: ReturnType<typeof runGates>) =>
  r.issues.map((i) => `[${i.gate}] ${i.at}: ${i.message}`);
/** The refusal when requirement `id` is covered but never requires `word`. */
const GENERIC = (id: string, word = "null") =>
  `does not state the expected result: ${id} does not require "${word}" as the result (an affirmative MUST, SHALL or REQUIRED to, a result verb, then "${word}")`;

describe("reading a spec", () => {
  test("reads an RFC's plain text, and refuses XML handed to it", () => {
    expect(parseDocument(RFC5869_TEXT).number).toBe(5869);
    expect(() => parseDocument(SPEC)).toThrow("not a specification");
  });

  test("refuses a text that is neither", () => {
    expect(() => parseDocument("just some prose\nwith no headings")).toThrow(
      "nor RFC XML v3 (a .xml file)",
    );
    // A Request-for-Comments line without page breaks is not an RFC either.
    expect(() =>
      parseDocument("Request for Comments: 1\nno form feeds"),
    ).toThrow("not a specification");
  });

  // #26: what the gates read must be what a reviewer sees.
  test("refuses a keyword hidden from the completeness gate", () => {
    const extra = (word: string) =>
      `${RFC5869_TEXT}\nhexEncode ${word} pad its output.\n`;
    for (const [hidden, why] of [
      ["M​UST", "invisible character U+200B"],
      ["MU͏ST", "invisible character U+034F"],
      ["MUSТ", '"MUSТ" reads as MUST'],
      ["ЅHALL", "reads as SHALL"],
      ["ＭUST", "reads as MUST"],
      ["MÚST", "reads as MUST"],
      // Letters of another script beside ASCII ones, whatever the script.
      ["MՍST", '"MՍST" reads as MUST'],
      ["MUꓢT", "reads as MUST"],
      ["ꓟꓴꓢꓔ", "reads as MUST"],
    ])
      expect(() => parseDocument(extra(hidden)), hidden).toThrow(why);
  });

  test("ordinary text still reads", () => {
    const ok = `${RFC5869_TEXT}\nA café, Δx, &#169;, ДОМА, S_HALL, x*y*z, M&#85;ST.\n`;
    expect(hiddenText(ok)).toEqual([]);
    expect(() => parseDocument(ok)).not.toThrow();
    // A leading byte-order mark is an encoding marker.
    expect(hiddenText(`﻿${RFC5869_TEXT}`)).toEqual([]);
    for (const f of [
      "rfcs/rfc4648.txt",
      "rfcs/rfc5869.txt",
      "rfcs/rfc8439.txt",
    ])
      expect(hiddenText(readFileSync(f, "utf8")), f).toEqual([]);
  });

  test("a labelled int in an appendix", () => {
    const a = section("A");
    expect(intLabelled(sectionLines(a), "Block Count", 4)).toBe(true);
    expect(intLabelled(sectionLines(a), "Block Count", 5)).toBe(false);
  });

  test("a label and its value share a line and are not one digit group", () => {
    expect(intLabelled("the value of L\n5. Next", "L", 5)).toBe(false);
    expect(intLabelled("L = 1 000", "L", 1)).toBe(false);
    expect(intLabelled("L = 1,000", "L", 1)).toBe(false);
    expect(intLabelled("L = 1000", "L", 1000)).toBe(true);
  });
});

describe("a spec contract", () => {
  test("passes every gate when the commands ran and agreed", () => {
    const c = hexContract();
    expect(validateContractShape(c)).toEqual([]);
    const r = runGates(c, { docs: docs(), commands: passed("V-CMD") });
    expect(messages(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.message).join("\n")).not.toContain(
      "not run",
    );
  });

  test("refuses a MUST outside every numbered section", () => {
    const d = read(
      SPEC.replace(
        "<name>Notes</name>",
        "<name>Notes</name>\n<t>Implementations <bcp14>MUST</bcp14> be fast.</t>",
      ),
    );
    const r = runGates(hexContract(), {
      docs: docs(d),
      commands: passed("V-CMD"),
    });
    expect(r.ok).toBe(false);
    expect(messages(r)).toEqual([
      `[completeness] ${LOOSE_SECTION}: MUST sentence is outside every numbered section, so it can be neither a requirement nor an exclusion: "Implementations MUST be fast."`,
    ]);
  });

  test("refuses a MUST of the main spec that is neither tested nor excluded", () => {
    const c = hexContract();
    c.requirements = c.requirements.filter((r) => r.id !== "R-ODD");
    // With R-ODD gone nothing states V-SPEC's null, so V-SPEC goes too.
    c.clauses = c.clauses.filter((k) => k.id !== "V-SPEC");
    for (const k of c.clauses) k.covers = ["R-LOWER"];
    const r = runGates(c, { docs: docs(), commands: passed("V-CMD") });
    expect(messages(r)).toEqual([
      '[completeness] §2.1: MUST sentence is neither a requirement nor an exclusion: "A decoder MUST return null for a string of odd length: abc decodes to null."',
    ]);
  });

  test("refuses a quote or value the cited section does not print", () => {
    const c = hexContract();
    c.requirements[0].quote = "An encoder MUST emit uppercase digits.";
    vec(c, "V-CITE").args = [{ hex: "cafe" }];
    vec(c, "V-CITE").expect = { str: "cafe" };
    const r = runGates(c, { docs: docs(), commands: passed("V-CMD") });
    expect(messages(r)).toEqual([
      '[fidelity] R-LOWER: quote not found in §2 ("Encoding"): "An encoder MUST emit uppercase digits."',
      '[fidelity] V-CITE.args[0]: 2-byte value is not printed in §3 ("Test Vectors")',
      '[fidelity] V-CITE.expect: the string "cafe" is not printed in §3 ("Test Vectors")',
      // The completeness gate now finds §2's MUST unquoted.
      '[completeness] §2: MUST sentence is neither a requirement nor an exclusion: "An encoder MUST emit two lowercase digits per byte."',
    ]);
  });

  test("refuses a command or spec vector whose args its section does not print", () => {
    const c = hexContract();
    vec(c, "V-CMD").args = [{ hex: "cafe" }];
    vec(c, "V-SPEC").args = [{ str: "xyz" }];
    const r = runGates(c, { docs: docs(), commands: passed("V-CMD") });
    expect(messages(r)).toEqual([
      '[fidelity] V-SPEC.args[0]: the string "xyz" is not printed in §2.1 ("Decoding")',
      '[fidelity] V-CMD.args[0]: 2-byte value is not printed in §3 ("Test Vectors")',
    ]);
  });

  // The bytes de ad be ef split across two blocks: a cite or command vector
  // binds one printed value, so each split is refused, never joined.
  const SPLIT = [
    '[fidelity] V-CITE.args[0]: 4-byte value is not printed in §3 ("Test Vectors")',
    '[fidelity] V-CITE.expect: the string "deadbeef" is not printed in §3 ("Test Vectors")',
    '[fidelity] V-CMD.args[0]: 4-byte value is not printed in §3 ("Test Vectors")',
  ];
  const ROW =
    "<tr><td>[de ad be ef]</td><td><tt>deadbeef</tt></td></tr></tbody></table>";
  const splitRuns = (d: RfcDocument) =>
    messages(
      runGates(hexContract(), { docs: docs(d), commands: passed("V-CMD") }),
    );

  // Bytes split across two table cells, rows, code blocks or paragraphs.
  const SPLITS: [string, string][] = [
    ["two cells", "<tr><td>de ad</td><td>be ef</td></tr></tbody></table>"],
    [
      "two rows",
      "<tr><td>de ad</td><td></td></tr><tr><td>be ef</td><td></td></tr></tbody></table>",
    ],
    [
      "two artworks",
      `<tr><td>x</td><td>x</td></tr></tbody></table>\n${art("de ad")}\n${art("be ef")}`,
    ],
    [
      "two sourcecodes",
      "<tr><td>x</td><td>x</td></tr></tbody></table>\n<sourcecode>de ad</sourcecode>\n<sourcecode>be ef</sourcecode>",
    ],
    [
      "two paragraphs",
      "<tr><td>x</td><td>x</td></tr></tbody></table>\n<t>de ad</t>\n<t>be ef</t>",
    ],
    // Blocks nested in one cell, or in a v2 <list>, read as one line of text
    // but never as one value.
    [
      "two paragraphs in one cell",
      "<tr><td><t>de ad</t><t>be ef</t></td><td></td></tr></tbody></table>",
    ],
    [
      "two list items in one cell",
      "<tr><td><ul><li>de ad</li><li>be ef</li></ul></td><td></td></tr></tbody></table>",
    ],
    [
      "text and code in one cell",
      `<tr><td>de ad${art("be ef")}</td><td></td></tr></tbody></table>`,
    ],
    [
      "two items of a v2 list",
      "<tr><td>x</td><td>x</td></tr></tbody></table>\n<list><t>de ad</t><t>be ef</t></list>",
    ],
    [
      "two items of a v2 list in a paragraph",
      "<tr><td>x</td><td>x</td></tr></tbody></table>\n<t>Bytes:<list><t>de ad</t><t>be ef</t></list></t>",
    ],
  ];
  test.each(SPLITS)("bytes split across %s are never one value", (_, body) => {
    expect(splitRuns(read(SPEC.replace(ROW, body)))).toEqual(SPLIT);
  });

  // One value printed over two lines of one block, or around inline code,
  // stays one value: a block boundary splits, nothing else does.
  const WHOLE: [string, string][] = [
    [
      "a paragraph",
      "<tr><td>x</td><td>x</td></tr></tbody></table>\n<t>de ad\nbe ef</t>",
    ],
    [
      "a table cell",
      "<tr><td>de ad\n be ef</td><td></td></tr></tbody></table>",
    ],
    [
      "a sourcecode",
      "<tr><td>x</td><td>x</td></tr></tbody></table>\n<sourcecode>de ad\nbe ef</sourcecode>",
    ],
    [
      "an artwork",
      `<tr><td>x</td><td>x</td></tr></tbody></table>\n${art("de ad\nbe ef")}`,
    ],
    [
      "a paragraph with inline code",
      "<tr><td>x</td><td>x</td></tr></tbody></table>\n<t>de ad <tt>be ef</tt></t>",
    ],
  ];
  test.each(WHOLE)("bytes printed whole in %s are one value", (_, body) => {
    const runs = splitRuns(read(SPEC.replace(ROW, body)));
    expect(runs).not.toContain(SPLIT[0]);
    expect(runs).not.toContain(SPLIT[2]);
    expect(
      runs.filter((m) => m.includes("the value is printed in §3")),
    ).toHaveLength(2);
  });

  test("in RFC text, bytes split by a line of text are never one value", () => {
    const rfc = (vectors: string) =>
      parseDocument(
        [
          "Internet Engineering Task Force (IETF)                         A. Author",
          "Request for Comments: 9999                                      May 2026",
          "Category: Informational",
          "",
          "                              Hex Encoding",
          "",
          "1.  Introduction",
          "",
          '   The key words "MUST" and "MAY" in this document are to be',
          "   interpreted as described in BCP 14.",
          "",
          "2.  Encoding",
          "",
          "   An encoder MUST emit two lowercase digits per byte.",
          "",
          "2.1.  Decoding",
          "",
          '   A decoder MUST return null for a string of odd length: "abc"',
          "   decodes to null.",
          "",
          "3.  Test Vectors",
          "",
          vectors,
          "\f",
        ].join("\n"),
      );
    const rfcSplit = SPLIT.map((m) => m.replace("in §3", "in RFC §3"));
    // A blank line does not end a value (a dump survives a page break) ...
    expect(splitRuns(rfc("   de ad\n\n   be ef"))).toEqual(
      rfcSplit.slice(1, 2),
    );
    // ... a line of text does.
    expect(splitRuns(rfc("   de ad\n\n   and\n\n   be ef"))).toEqual(rfcSplit);
  });

  test("an exclusion accounts for a MUST, and must quote the section", () => {
    const c = hexContract();
    c.requirements = c.requirements.filter((r) => r.id !== "R-ODD");
    // With R-ODD gone nothing states V-SPEC's null, so V-SPEC goes too.
    c.clauses = c.clauses.filter((k) => k.id !== "V-SPEC");
    for (const k of c.clauses) k.covers = ["R-LOWER"];
    c.exclusions = [
      {
        section: "2.1",
        quote: "A decoder MUST return null for a string of odd length",
        reason: "tested elsewhere",
      },
    ];
    const ok = runGates(c, { docs: docs(), commands: passed("V-CMD") });
    expect(messages(ok)).toEqual([]);
    expect(ok.warnings).toContainEqual({
      at: "§2.1",
      message: "excluded: tested elsewhere",
    });
    expect(renderReport({ contract: c, gates: ok })).toContain(
      '§2.1 "A decoder MUST return null for a string of odd length" — tested elsewhere',
    );
    c.exclusions[0].quote = "A decoder MAY refuse";
    const r = runGates(c, { docs: docs(), commands: passed("V-CMD") });
    expect(messages(r)[0]).toBe(
      '[fidelity] exclusion §2.1: quote not found in §2.1: "A decoder MAY refuse"',
    );
  });

  test("refuses a section the spec does not have", () => {
    const c = hexContract();
    vec(c, "V-CITE").source = { cite: { section: "9" } };
    const r = runGates(c, { docs: docs(), commands: passed("V-CMD") });
    expect(messages(r)).toEqual([
      '[fidelity] V-CITE: source "hex" has no section 9',
    ]);
  });

  test("refuses a contract whose source text was not given", () => {
    const r = runGates(hexContract(), {
      docs: new Map(),
      commands: passed("V-CMD"),
    });
    expect(messages(r)).toEqual([
      '[fidelity] sources.hex: the text of source "hex" was not given, so nothing citing it can be checked',
    ]);
  });
});

describe("contract sources", () => {
  test("refuses a citation of an undeclared source", () => {
    const c = hexContract();
    vec(c, "V-CITE").source = { cite: { source: "nope", section: "3" } };
    c.requirements[0].source = "nope";
    const errors = validateContractShape(c);
    expect(errors.length).toBe(2);
    for (const e of errors) expect(e).toContain('"nope"');
  });

  test("refuses duplicate ids, a main that is not declared, an entry with no text", () => {
    const c = hexContract() as unknown as {
      source: Record<string, unknown>;
      sources: unknown[];
    };
    c.sources = [
      { id: "hex", path: "hex.xml" },
      { id: "hex", path: "again.xml" },
      { id: "bare" },
    ];
    c.source.main = "other";
    const errors = validateContractShape(c).join("\n");
    expect(errors).toContain('duplicate source id "hex"');
    expect(errors).toContain('sources[2]: needs "rfc", "path" or both');
    expect(errors).toContain("contract.source.main: the id of the main source");
  });

  test("refuses an rfc number on source with sources, and main without them", () => {
    const multi = hexContract() as unknown as {
      source: Record<string, unknown>;
    };
    multi.source.rfc = 4648;
    expect(validateContractShape(multi).join("\n")).toContain(
      "give the RFC number on its entry there",
    );
    const legacy = clone(hkdf) as unknown as {
      source: Record<string, unknown>;
    };
    legacy.source.main = "rfc5869";
    expect(validateContractShape(legacy)).toContain(
      "contract.source.main: only with contract.sources",
    );
  });

  test("refuses a malformed source or sources", () => {
    const shape = (patch: Record<string, unknown>) =>
      validateContractShape({ ...hexContract(), ...patch }).join("\n");
    expect(shape({ source: "hex" })).toContain("contract.source: an object");
    expect(shape({ sources: [] })).toContain(
      "contract.sources: a non-empty array",
    );
    const legacy = clone(hkdf) as unknown as {
      source: Record<string, unknown>;
    };
    legacy.source.rfc = 0;
    expect(validateContractShape(legacy)).toContain(
      "contract.source.rfc: the RFC number",
    );
    const bad = shape({
      sources: [
        "hex.xml",
        { id: "has space", path: "hex.xml" },
        { id: "hex", rfc: 1.5, path: "" },
      ],
    });
    expect(bad).toContain("sources[0]: an object");
    expect(bad).toContain("sources[1].id: an id");
    expect(bad).toContain("sources[2].rfc: the RFC number");
    expect(bad).toContain("sources[2].path: a file path");
  });

  test("a legacy single-RFC contract still passes", () => {
    const r = runGates(hkdf, { rfc: rfc5869 });
    expect(messages(r)).toEqual([]);
    expect(citeLabel(hkdf, { section: "A.1" })).toBe("§A.1");
  });

  /** The hex spec as main, RFC 5869 as a second source cited for one vector. */
  function twoSources(): RfcContract {
    const c = hexContract();
    c.sources = [
      { id: "hex", path: "hex.xml" },
      { id: "rfc5869", rfc: 5869 },
    ];
    c.functions.push(clone(hkdf.functions[0]));
    c.requirements.push({
      id: "R-PRK",
      source: "rfc5869",
      section: "2.2",
      level: "DEFINITION",
      quote: "PRK = HMAC-Hash(salt, IKM)",
    });
    const prk = clone(vec(hkdf, "A.1-PRK"));
    prk.covers = ["R-PRK"];
    prk.source = { cite: { source: "rfc5869", section: "A.1" } };
    c.clauses.push(prk);
    return c;
  }

  test("fidelity reads the cited document; completeness only the main one", () => {
    const c = twoSources();
    const r = runGates(c, {
      docs: docs(doc, [["rfc5869", rfc5869]]),
      commands: passed("V-CMD"),
    });
    expect(messages(r)).toEqual([]);
    expect(citeLabel(c, { source: "rfc5869", section: "A.1" })).toBe(
      "rfc5869 §A.1",
    );
    expect(citeLabel(c, { source: "hex", section: "3" })).toBe("§3");
  });

  test("refuses a value the cited second document does not print", () => {
    const c = twoSources();
    vec(c, "A.1-PRK").source = { cite: { source: "rfc5869", section: "A.2" } };
    c.requirements[2].quote = "PRK = SHA-256(IKM)";
    const r = runGates(c, {
      docs: docs(doc, [["rfc5869", rfc5869]]),
      commands: passed("V-CMD"),
    });
    const m = messages(r).join("\n");
    expect(m).toContain('quote not found in rfc5869 §2.2 ("Step 1: Extract")');
    expect(m).toContain("is not printed in rfc5869 §A.2");
  });

  test("refuses a second document that is missing or is the wrong RFC", () => {
    const c = twoSources();
    expect(
      messages(runGates(c, { docs: docs(), commands: passed("V-CMD") })),
    ).toEqual([
      '[fidelity] sources.rfc5869: the text of source "rfc5869" was not given, so nothing citing it can be checked',
    ]);
    const wrong = parseRfc(readFileSync("rfcs/rfc8439.txt", "utf8"));
    expect(
      messages(
        runGates(c, {
          docs: docs(doc, [["rfc5869", wrong]]),
          commands: passed("V-CMD"),
        }),
      )[0],
    ).toBe(
      "[fidelity] sources.rfc5869.rfc: the contract cites RFC 5869 but the text is RFC 8439",
    );
  });
});

// #24/#25: a vector's values are whole printed values, named by the label
// they are printed under, and from one test case.
describe("vector values are whole, named and from one test case", () => {
  const MAC = spec(
    [
      sec(
        "MAC Vectors",
        sec(
          "Case 1",
          art(`Key  = 0b0b0b0b0b0b0b0b
       0b0b0b0b         (12 bytes)
Data = 4869205468657265 ("Hi There")
MAC  = b0344c61d8db38535ca8afceaf0bf12b`),
        ) +
          sec(
            "Case 2",
            art(`Key  = 4a656665
Data = 7768617420646f2079612077616e7420
MAC  = 5bdcc146bf60754e6a042426089575c7`),
          ),
      ),
      sec(
        "Base64",
        '<t>BASE64("f") = "Zg=="</t>\n<t>BASE64("fo") = "Zm8="</t>',
      ),
      sec(
        "Extract",
        sec(
          "Case 1",
          art(`Salt = 00010203
IKM  = 0b0b0b0b
PRK  = 11111111`),
        ) +
          sec(
            "Case 2",
            art(`Salt = (0 octets)
IKM  = 0c0c0c0c
PRK  = 22222222`),
          ) +
          sec(
            "Case 3",
            art(`Salt = 0d0d0d0d
IKM  = 0e0e0e0e
PRK  = 33333333`),
          ),
      ),
      sec(
        "Decode",
        sec("First", "<t>Input: <tt>abab</tt></t>\n<t>Output = abab</t>") +
          sec("Second", "<t>Input: <tt>cdcd</tt></t>\n<t>Output = cdcd</t>"),
      ),
      sec(
        "Variants",
        art(`Key          = 0b0b0b0b
Data         = 4869205468657265
HMAC-SHA-256 = b0344c61d8db38535ca8afceaf0bf12b
HMAC-SHA-512 = 87aa7cdea5ef619d4ff0b4241a1d6cb0`),
      ),
      sec(
        "Numbered cases",
        art(`Input1  = 0c0c0c0c
Output1 = 1d1d1d1d
Input2  = 0e0e0e0e
Output2 = 2f2f2f2f`),
      ),
    ].join("\n"),
  );
  const KEY1 = "0b0b0b0b0b0b0b0b0b0b0b0b";
  const DATA1 = "4869205468657265";
  const MAC1 = "b0344c61d8db38535ca8afceaf0bf12b";
  const DATA2 = "7768617420646f2079612077616e7420";
  const MAC2 = "5bdcc146bf60754e6a042426089575c7";
  const macDoc = read(MAC);
  type Lit = VectorClause["expect"];
  /** The hex contract plus one vector `V` citing `section`. */
  const gate = (section: string, call: string, args: Lit[], out: Lit) => {
    const c = hexContract();
    c.functions.push(
      {
        name: "mac",
        params: [
          { name: "key", type: "bytes" },
          { name: "data", type: "bytes" },
        ],
        returns: "bytes",
      },
      {
        name: "b64",
        params: [{ name: "s", type: "string" }],
        returns: "string",
      },
      ...["mac256", "mac512"].map((name) => ({
        name,
        params: [
          { name: "key", type: "bytes" as const },
          { name: "data", type: "bytes" as const },
        ],
        returns: "bytes" as const,
      })),
      {
        name: "blake2s",
        params: [{ name: "data", type: "bytes" }],
        returns: "bytes",
      },
    );
    c.clauses.push({
      kind: "vector",
      id: "V",
      title: "a printed vector",
      covers: ["R-LOWER"],
      source: { cite: { section } },
      call,
      args,
      expect: out,
    } as VectorClause);
    expect(validateContractShape(c)).toEqual([]);
    return messages(
      runGates(c, { docs: docs(macDoc), commands: passed("V-CMD") }),
    );
  };
  const mac = (section: string, key: Lit, data: Lit, out: Lit) =>
    gate(section, "mac", [key, data], out);
  const h = (hex: string, label?: string): Lit =>
    (label === undefined ? { hex } : { hex, label }) as Lit;

  test("a label printed before its value on the same line is read", () => {
    expect(hexValues(section4("4.1"))).toEqual([
      { hex: KEY1, label: "Key" },
      { hex: DATA1, label: "Data" },
      { hex: MAC1, label: "MAC" },
    ]);
  });

  test("whole values under their own labels pass", () => {
    expect(
      mac("4.1", h(KEY1, "Key"), h(DATA1, "Data"), h(MAC1, "MAC")),
    ).toEqual([]);
    // In the parent, the second Key goes with the second Data and MAC.
    expect(
      mac("4", h("4a656665", "Key"), h(DATA2, "Data"), h(MAC2, "MAC")),
    ).toEqual([]);
  });

  test("a value printed under a name must say which", () => {
    expect(mac("4.1", h(KEY1), h(DATA1, "Data"), h(MAC1, "MAC"))).toEqual([
      '[fidelity] V.args[0]: the value is printed in §4.1 ("Case 1") under "Key": name it with "label", so the contract says which printed value it is',
    ]);
    expect(
      mac("4.1", h(KEY1, "Data"), h(DATA1, "Data"), h(MAC1, "MAC")),
    ).toEqual([
      '[fidelity] V.args[0]: the value is printed in §4.1 ("Case 1") under "Key", not under "Data"',
    ]);
  });

  test("part of a value is refused", () => {
    expect(
      mac("4.1", h("0b0b0b0b", "Key"), h(DATA1, "Data"), h(MAC1, "MAC")),
    ).toEqual([
      '[fidelity] V.args[0]: 4-byte value is only part of a value printed in §4.1 ("Case 1") (under "Key"): a vector uses whole printed values (concat them to join several)',
    ]);
    expect(
      mac("4.1", h(KEY1, "Key"), h(DATA1, "Data"), h(MAC1.slice(8), "MAC")),
    ).toEqual([
      '[fidelity] V.expect: 12-byte value is only part of a value printed in §4.1 ("Case 1") (under "MAC"): a vector uses whole printed values (concat them to join several)',
    ]);
  });

  test("an input is never the expected value", () => {
    expect(
      mac("4.1", h(KEY1, "Key"), h(DATA1, "Data"), h(KEY1, "Key")),
    ).toEqual([
      '[fidelity] V.expect: the expected value is the one printed under "Key", which args[0] is bound to as well: an input is not the expected result',
    ]);
    expect(
      mac("4.1", h(KEY1, "Key"), h(DATA1, "Data"), h(KEY1, "MAC")),
    ).toEqual([
      '[fidelity] V.expect: the value is printed in §4.1 ("Case 1") under "Key", not under "MAC"',
    ]);
  });

  test("values from two test cases are refused, even through the parent", () => {
    expect(mac("4", h(KEY1, "Key"), h(DATA2, "Data"), h(MAC1, "MAC"))).toEqual([
      '[fidelity] V: args[0] is the 1st of 2 "Key", args[1] is the 2nd of 2 "Data", expect is the 1st of 2 "MAC" in §4 ("MAC Vectors"), so they are from different test cases: use the values printed together (or cite the subsection that holds one test case)',
    ]);
  });

  test("printings are not paired by count when a case leaves one out", () => {
    // §6.2 prints its salt as "(0 octets)", so the 2nd "Salt" is case 3's
    // while the 2nd "IKM" and "PRK" are case 2's (RFC 5869 §A).
    const message =
      '[fidelity] V: "Salt" is printed 2 times, "IKM" is printed 3 times, "PRK" is printed 3 times in §6 ("Extract"), so which printings belong to one test case is unclear: cite the subsection that holds one test case';
    expect(
      mac(
        "6",
        h("0d0d0d0d", "Salt"),
        h("0c0c0c0c", "IKM"),
        h("22222222", "PRK"),
      ),
    ).toEqual([message]);
    // Even values that are from one case are refused through the parent...
    expect(
      mac(
        "6",
        h("00010203", "Salt"),
        h("0b0b0b0b", "IKM"),
        h("11111111", "PRK"),
      ),
    ).toEqual([message]);
    // ...and pass through the subsection that holds them.
    expect(
      mac(
        "6.3",
        h("0d0d0d0d", "Salt"),
        h("0e0e0e0e", "IKM"),
        h("33333333", "PRK"),
      ),
    ).toEqual([]);
  });

  test("a string pairs with a labelled value only where the label is printed once", () => {
    // §7.1's input with §7.2's output: the string has a line, the hex value a
    // round, and nothing relates the two.
    expect(
      gate("7", "fromHex", [{ str: "abab" }], h("cdcd", "Output")),
    ).toEqual([
      '[fidelity] V: args[0] "abab" and expect (one of 2 "Output") in §7 ("Decode"): nothing pairs a printed string with one of several labelled values: cite the subsection that holds one test case',
    ]);
    expect(
      gate("7.1", "fromHex", [{ str: "abab" }], h("abab", "Output")),
    ).toEqual([]);
  });

  test("a string is a whole printed value, paired on one line", () => {
    expect(gate("5", "b64", [{ str: "f" }], { str: "Zg==" })).toEqual([]);
    // RFC 4648 with the padding stripped: "Zg" is only part of "Zg==".
    expect(gate("5", "b64", [{ str: "f" }], { str: "Zg" })).toEqual([
      '[fidelity] V.expect: the string "Zg" is only part of a longer value in §5 ("Base64"): it must be printed whole (in quotes, on a line of its own, or ending a line after "=" or ":")',
    ]);
    expect(gate("5", "b64", [{ str: "fo" }], { str: "Zg==" })).toEqual([
      '[fidelity] V: args[0] "fo", expect "Zg==" are each printed in §5 ("Base64"), but never on one line together, so nothing pairs them as one test case',
    ]);
  });

  test("a variant's value is used only for the function that names it", () => {
    const SHA256 = "b0344c61d8db38535ca8afceaf0bf12b";
    const SHA512 = "87aa7cdea5ef619d4ff0b4241a1d6cb0";
    const args = [h("0b0b0b0b", "Key"), h(DATA1, "Data")];
    expect(gate("8", "mac512", args, h(SHA512, "HMAC-SHA-512"))).toEqual([]);
    expect(gate("8", "mac256", args, h(SHA256, "HMAC-SHA-256"))).toEqual([]);
    // RFC 4231's other row, printed for the same test case: refused.
    expect(gate("8", "mac512", args, h(SHA256, "HMAC-SHA-256"))).toEqual([
      '[fidelity] V.expect: the value is printed under "HMAC-SHA-256" in §8 ("Variants"), but mac512 names 512, as in "HMAC-SHA-512": a vector uses the value printed for the variant its function computes',
    ]);
  });

  test("numbered test cases are not variants", () => {
    // blake2s names 2, but Input1 and Input2 count cases (#32 review).
    const one = gate(
      "9",
      "blake2s",
      [h("0c0c0c0c", "Input1")],
      h("1d1d1d1d", "Output1"),
    );
    expect(one).toEqual([]);
    const two = gate(
      "9",
      "blake2s",
      [h("0e0e0e0e", "Input2")],
      h("2f2f2f2f", "Output2"),
    );
    expect(two).toEqual([]);
  });

  test("a function named for no variant is warned about", () => {
    const c = hexContract();
    c.functions.push({
      name: "mac",
      params: [
        { name: "key", type: "bytes" },
        { name: "data", type: "bytes" },
      ],
      returns: "bytes",
    });
    c.clauses.push({
      kind: "vector",
      id: "V",
      title: "a printed vector",
      covers: ["R-LOWER"],
      source: { cite: { section: "8" } },
      call: "mac",
      args: [h("0b0b0b0b", "Key"), h(DATA1, "Data")],
      expect: h("87aa7cdea5ef619d4ff0b4241a1d6cb0", "HMAC-SHA-512"),
    } as VectorClause);
    const r = runGates(c, { docs: docs(macDoc), commands: passed("V-CMD") });
    expect(messages(r)).toEqual([]);
    expect(r.warnings.map((w) => `${w.at}: ${w.message}`)).toContain(
      'V.expect: the value is printed under "HMAC-SHA-512", one of "HMAC-SHA-512" or "HMAC-SHA-256" in §8 ("Variants"), and nothing in the name mac says which variant it computes: not checked that this is its own',
    );
  });

  const section4 = (id: string) => {
    const s = macDoc.sections.get(id);
    if (!s) throw new Error(`no section ${id}`);
    return s;
  };
});

describe("reading values from RFC text", () => {
  const rfcSection = (lines: string[]) =>
    ({ id: "1", title: "T", lines, ownLines: lines }) as never;

  test("a label on the value's line starts it; the lines below continue it", () => {
    expect(
      hexValues(
        rfcSection([
          "   Key =          0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
          "                  0b0b0b0b                          (20 bytes)",
          '   Data =         4869205468657265                  ("Hi There")',
          "",
          "   Key            aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "                  aaaaaaaa                          (20 bytes)",
        ]),
      ),
    ).toEqual([
      { hex: "0b".repeat(20), label: "Key" },
      // All digits, but named: hex ("Hi There").
      { hex: "4869205468657265", label: "Data" },
      // RFC 4231 §4.4 prints no "=".
      { hex: "aa".repeat(20), label: "Key" },
    ]);
  });

  test("a number printed in base 10 is not bytes", () => {
    const decimal = "31029842492115040904895560451863089656";
    expect(
      hexValues(
        rfcSection([
          "   Input scalar:",
          "     a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4",
          "   Input scalar as a number (base 10):",
          `     ${decimal}`,
          "   Data:",
          "     4869205468657265",
        ]),
      ).map((v) => v.label),
    ).toEqual(["Input scalar", "Data"]);
    // With no name over it at all, digits in an RFC are a number too.
    expect(hexValues(rfcSection([`     ${decimal}`]))).toEqual([]);
  });

  test("intRounds says at which printing of a label the integer is", () => {
    const text = "L = 42\nL = 7\nL = 42";
    expect(intRounds(text, "L", 42)).toEqual([0, 2]);
    expect(intRounds(text, "L", 7)).toEqual([1]);
    expect(intRounds(text, "L", 4)).toEqual([]);
    expect(intLabelled(text, "L", 7)).toBe(true);
  });
});

/**
 * A probe's text as RFC XML v3: "> " a blockquote, "| " a table, a ``` fence
 * source code, _x_ and **x** emphasis; otherwise paragraphs.
 */
const xmlOf = (text: string): string => {
  if (text.startsWith("> "))
    return `<blockquote><t>${kw(text.slice(2))}</t></blockquote>`;
  if (text.startsWith("| ")) {
    const cells = (row: string, tag: string) =>
      `<tr>${row
        .split("|")
        .slice(1, -1)
        .map((c) => `<${tag}>${kw(c.trim())}</${tag}>`)
        .join("")}</tr>`;
    const [head, , ...rows] = text.split("\n");
    return `<table><thead>${cells(head, "th")}</thead><tbody>${rows.map((r) => cells(r, "td")).join("")}</tbody></table>`;
  }
  if (text.startsWith("```")) {
    const lines = text.split("\n");
    return `<sourcecode type="${lines[0].slice(3)}">${lines.slice(1, -1).join("\n")}</sourcecode>`;
  }
  return text
    .split("\n\n")
    .map(
      (p) =>
        `<t>${kw(p)
          .replace(/\b_(\w+)_\b/g, "<em>$1</em>")
          .replace(/\*\*(\w+)\*\*/g, "<strong>$1</strong>")}</t>`,
    )
    .join("\n");
};

describe("vector provenance", () => {
  test("refuses a vector with no source", () => {
    const c = hexContract();
    (vec(c, "V-CITE") as Partial<VectorClause>).source = undefined;
    expect(validateContractShape(c).join("\n")).toContain("clauses[0].source");
  });

  test("refuses a malformed vector source", () => {
    const shape = (source: unknown) => {
      const c = hexContract();
      (vec(c, "V-CMD") as { source: unknown }).source = source;
      return validateContractShape(c).join("\n");
    };
    expect(shape({})).toContain(
      'clauses[2].source: exactly one of "cite", "command", "spec"',
    );
    expect(shape({ cite: { section: "3" }, spec: "3" })).toContain(
      "exactly one of",
    );
    expect(shape({ cite: "3" })).toContain(
      'clauses[2].source.cite: {"source"?',
    );
    expect(shape({ cite: { section: "three" } })).toContain(
      "clauses[2].source.cite.section: a section number",
    );
    expect(shape({ command: " " })).toContain(
      "clauses[2].source.command: a shell command",
    );
    const spec = hexContract();
    (vec(spec, "V-SPEC").source as { spec: string }).spec = "two";
    expect(validateContractShape(spec).join("\n")).toContain(
      "clauses[1].source.spec: a main-source section number",
    );
  });

  test("refuses a section on a cite source, and none on a command or spec", () => {
    const c = hexContract();
    vec(c, "V-CITE").section = "3";
    vec(c, "V-SPEC").section = undefined;
    vec(c, "V-CMD").section = undefined;
    const errors = validateContractShape(c).join("\n");
    expect(errors).toContain("clauses[0].section");
    expect(errors).toContain("clauses[1].section");
    expect(errors).toContain("clauses[2].section");
  });

  test("refuses a spec source for a non-null, non-bool expected value", () => {
    const c = hexContract();
    vec(c, "V-SPEC").expect = { hex: "ab" };
    vec(c, "V-CMD").expect = { null: true };
    const errors = validateContractShape(c).join("\n");
    expect(errors).toContain("clauses[1]");
    expect(errors).toContain("clauses[2]");
  });

  test("a spec source must say the null it expects", () => {
    const d = read(
      SPEC.replace(
        "<bcp14>MUST</bcp14> return null for a string of odd length: <tt>abc</tt> decodes\nto null.",
        "<bcp14>MUST</bcp14> refuse for a string of odd length: <tt>abc</tt> decodes\nto nothing.",
      ),
    );
    const c = hexContract();
    c.requirements[1].quote =
      "A decoder MUST refuse for a string of odd length";
    const r = runGates(c, { docs: docs(d), commands: passed("V-CMD") });
    expect(messages(r)).toEqual([
      `[provenance] V-SPEC.source: §2.1 ("Decoding") ${GENERIC("R-ODD")}`,
    ]);
  });

  test("a spec or cite source for a bool must say true or false", () => {
    const c = hexContract();
    c.functions.push({
      name: "isHex",
      params: [{ name: "s", type: "string" }],
      returns: "bool",
    });
    c.clauses.push(
      {
        kind: "vector",
        id: "V-BOOL-SPEC",
        title: "x",
        covers: ["R-ODD"],
        source: { spec: "2.1" },
        section: "2.1",
        call: "isHex",
        args: [{ str: "abc" }],
        expect: { bool: false },
      },
      {
        kind: "vector",
        id: "V-BOOL-CITE",
        title: "x",
        covers: ["R-ODD"],
        source: { cite: { section: "2.1" } },
        call: "isHex",
        args: [{ str: "abc" }],
        expect: { bool: true },
      },
    );
    const bare = runGates(c, { docs: docs(), commands: passed("V-CMD") });
    expect(messages(bare)).toEqual([
      `[fidelity] V-BOOL-CITE.expect: §2.1 ("Decoding") ${GENERIC("R-ODD", "true")}`,
      `[provenance] V-BOOL-SPEC.source: §2.1 ("Decoding") ${GENERIC("R-ODD", "false")}`,
    ]);
    // "is True never" names the word but no keyword makes it the result, so
    // only "MUST be False" counts. The new MUST sentence is a requirement.
    c.requirements.push({
      id: "R-ISHEX",
      section: "2.1",
      level: "MUST",
      quote: "isHex MUST be False for it",
    });
    for (const v of ["V-BOOL-SPEC", "V-BOOL-CITE"])
      vec(c, v).covers.push("R-ISHEX");
    const onePolarity = read(
      SPEC.replace(
        "to null.",
        "to null. isHex <bcp14>MUST</bcp14> be False for it. It is True never.",
      ),
    );
    expect(
      messages(
        runGates(c, { docs: docs(onePolarity), commands: passed("V-CMD") }),
      ),
    ).toEqual([
      `[fidelity] V-BOOL-CITE.expect: §2.1 ("Decoding") ${GENERIC("R-ODD", "true")}; ${GENERIC("R-ISHEX", "true").replace("does not state the expected result: ", "")}`,
    ]);
    const stated = read(
      SPEC.replace(
        "to null.",
        "to null. isHex <bcp14>MUST</bcp14> be False for it. It <bcp14>MUST</bcp14> return true for abcd.",
      ),
    );
    c.requirements.push({
      id: "R-ISHEX-TRUE",
      section: "2.1",
      level: "MUST",
      quote: "It MUST return true for abcd.",
    });
    vec(c, "V-BOOL-CITE").covers.push("R-ISHEX-TRUE");
    expect(
      messages(runGates(c, { docs: docs(stated), commands: passed("V-CMD") })),
    ).toEqual([]);
  });

  test("only an affirmative requirement states the result", () => {
    // `quote` set: the vector covers a requirement in §4 with that quote.
    // Unset: the sentence is only section text, and the vector covers R-ODD,
    // a requirement elsewhere (§2.1).
    const probe = (sentence: string, bool?: boolean, quote?: string) => {
      const d = read(spec(sec("Probe", xmlOf(sentence))));
      const c = hexContract();
      const v = vec(c, "V-SPEC");
      v.source = { spec: "4" };
      if (quote !== undefined) {
        c.requirements.push({
          id: "R-PROBE",
          section: "4",
          level: "MUST",
          // Inline code and emphasis read as their text.
          quote: quote
            .replaceAll("`", "")
            .replace(/\b_(\w+)_\b/g, "$1")
            .replace(/\*\*(\w+)\*\*/g, "$1"),
        });
        v.covers.push("R-PROBE");
      }
      if (bool !== undefined) {
        c.functions.push({
          name: "isHex",
          params: [{ name: "s", type: "string" }],
          returns: "bool",
        });
        v.call = "isHex";
        v.expect = { bool };
      }
      // The probe's own quote must be found, or the case proves nothing.
      return messages(
        runGates(c, { docs: docs(d), commands: passed("V-CMD") }),
      ).filter((m) => m.startsWith("[provenance]") || m.includes("R-PROBE:"));
    };
    const at = '[provenance] V-SPEC.source: §4 ("Probe") ';
    const REASON = "does not state the expected result: ";
    const uncovered = (word = "null") => [
      `${at}does not state the expected result: V-SPEC covers no requirement cited to it, so nothing there requires the result "${word}"`,
    ];
    const refused = (word = "null") => [`${at}${GENERIC("R-PROBE", word)}`];
    const because = (why: string) => [
      `${at}does not state the expected result: R-PROBE ${why}`,
    ];
    for (const sentence of [
      // Round 2.
      "hexDecode MUST NOT return null for any input.",
      "The key MUST NOT be null.",
      "The key SHALL NOT be null.",
      "f never returns null.",
      "f doesn't return null.",
      "If the input is null, f returns 5.",
      "When the key is null the call fails.",
      "f MUST return an empty array, not null.",
      "The flag is set to null.",
      // Round 3.
      "f MUST NOT, for any input, return null.",
      "f MUST NOT: for any input, return null.",
      "f MUST NOT, e.g. for odd input, return null.",
      "f MUST avoid returning null.",
      "f is forbidden from returning null.",
      "f is prohibited from returning null.",
      "f prevents returning null.",
      "f refuses to return null.",
      "f rejects input rather than returning null.",
      "Instead of returning null, f throws.",
      "Rather than returning null, f throws.",
      "f doesn\u2019t return null.",
      "f won't return null.",
      "f _never_ returns null.",
      "f **not** once returns null.",
      "f returns 5 except it returns null.",
      "f returns 5 without it returns null.",
      "Unless the key is set, f returns null.",
      "It fails to return null.",
      "It is an error to return null.",
      "When the text is odd, hexDecode returns null.",
      "Whether f returns null is unspecified.",
      "Assume f returns null.",
      "No input is null.",
      "None of the outputs is null.",
      "f returns null-terminated strings.",
      "Returning null is not allowed.",
      "Returning null is forbidden.",
      "Returning null is prohibited for any input.",
      "f returning null is wrong.",
      "f returns null, but never for valid input.",
      "Returning null here is a bug.",
      "Returning null is an error.",
      "f returns null rather than throwing, never.",
      "Under no circumstances does f return null.",
      "It is an error for f to return null.",
      // Round 4: no affirmative keyword governs the value, so even a
      // descriptive statement is refused, by design.
      "Implementations that return null are non-conforming.",
      "Implementations MUST NOT, e.g. Python or Go, return null.",
      "f returns null on failure.",
      "f MUST, for every input, return null.",
      "The string is null-terminated.",
      "The string MUST be null-terminated.",
      "f MUST return `null`-terminated strings.",
      "abc decodes to null.",
      "f returns null for invalid input.",
      "It is not hex. So f returns null.",
      "f MUST then return null.",
      "f must return null.",
      "f MUST returns null.",
      "If the input is odd, f MUST return null.",
      "Unless told otherwise, f SHALL return null.",
      "f MUST NOT always return null.",
    ]) {
      expect([sentence, probe(sentence)]).toEqual([sentence, uncovered()]);
      // Covered, its quote still does not state the value (for one reason
      // or another; the reasons are pinned below).
      const got = probe(sentence, undefined, sentence);
      expect([sentence, got.length]).toEqual([sentence, 1]);
      expect([sentence, got[0]?.startsWith(`${at}${REASON}R-PROBE `)]).toEqual([
        sentence,
        true,
      ]);
    }
    for (const [sentence, bool] of [
      ["f SHALL be true.", false],
      ["f MUST NOT return true.", true],
    ] as const) {
      expect(probe(sentence, bool)).toEqual(uncovered(String(bool)));
      expect(probe(sentence, bool, sentence)).toEqual(refused(String(bool)));
    }
    // Round 5: the section text alone never states the value, whatever it
    // says or wherever it says it.
    for (const text of [
      "Earlier drafts said that f MUST return null, but this was removed in draft 04.",
      "Some implementations MUST return null, which is a bug.",
      "For example, a Python decoder MUST return null.",
      "> f MUST return null",
      "| call | result |\n|------|--------|\n| f | MUST return null |",
      "```js\n// f MUST return null\n```",
      "f MUST return null or throw.",
      "f MUST return null\u2011terminated strings.",
      "f MUST return null.",
    ])
      expect([text, probe(text)]).toEqual([text, uncovered()]);
    // Nor does a covered requirement that says it some other way.
    const covered: [string, string, string[]][] = [
      [
        "Earlier drafts said that f MUST return null, but this was removed in draft 04.",
        "Earlier drafts said that f MUST return null, but this was removed in draft 04.",
        refused(),
      ],
      [
        "f MUST return null, but this was removed in draft 04.",
        "f MUST return null, but this was removed in draft 04.",
        because('retracts "null" after stating it ("but")'),
      ],
      [
        "Some implementations MUST return null, which is a bug.",
        "Some implementations MUST return null, which is a bug.",
        refused(),
      ],
      [
        "f MUST return null, which is a bug.",
        "f MUST return null, which is a bug.",
        because('retracts "null" after stating it ("bug")'),
      ],
      [
        "f MUST return null. This is deprecated.",
        "f MUST return null. This is deprecated.",
        because('retracts "null" after stating it ("deprecated")'),
      ],
      [
        "f MUST return null; that is wrong.",
        "f MUST return null; that is wrong.",
        because('retracts "null" after stating it ("wrong")'),
      ],
      [
        "f MUST return null, which is incorrect.",
        "f MUST return null, which is incorrect.",
        because('retracts "null" after stating it ("incorrect")'),
      ],
      [
        "f MUST return null, which is an error.",
        "f MUST return null, which is an error.",
        because('retracts "null" after stating it ("an error")'),
      ],
      [
        "f MUST return null; that is not allowed.",
        "f MUST return null; that is not allowed.",
        because('retracts "null" after stating it ("not")'),
      ],
      [
        "f MUST return null, which is forbidden.",
        "f MUST return null, which is forbidden.",
        because('retracts "null" after stating it ("forbidden")'),
      ],
      [
        "f MUST return null, now removed.",
        "f MUST return null, now removed.",
        because('retracts "null" after stating it ("removed")'),
      ],
      [
        "f MUST return null; this is obsolete.",
        "f MUST return null; this is obsolete.",
        because('retracts "null" after stating it ("obsolete")'),
      ],
      [
        "For example, a Python decoder MUST return null.",
        "For example, a Python decoder MUST return null.",
        refused(),
      ],
      [
        "> f MUST return null",
        "f MUST return null",
        because("is not in its prose (only in code, a blockquote or a table)"),
      ],
      [
        "| call | result |\n|------|--------|\n| f | MUST return null |",
        "MUST return null",
        because("is not in its prose (only in code, a blockquote or a table)"),
      ],
      [
        "```js\n// f MUST return null\n```",
        "f MUST return null",
        because("is not in its prose (only in code, a blockquote or a table)"),
      ],
      [
        "f MUST return null or throw.",
        "f MUST return null or throw.",
        because(
          'offers an alternative right after "null" ("or"), so "null" is not the whole result',
        ),
      ],
      [
        "f MUST return null, and 5 otherwise.",
        "f MUST return null, and 5 otherwise.",
        because(
          'offers an alternative right after "null" (", and"), so "null" is not the whole result',
        ),
      ],
      [
        "f MUST return null/undefined.",
        "f MUST return null/undefined.",
        because(
          'offers an alternative right after "null" ("/"), so "null" is not the whole result',
        ),
      ],
      // U+2011 is not here: the XML reader reads it as "-".
      ...["-", "\u2010", "\u2013", "\u2212"].map(
        (h): [string, string, string[]] => [
          `f MUST return null${h}terminated strings.`,
          `f MUST return null${h}terminated strings.`,
          because(
            `offers an alternative right after "null" ("${h}"), so "null" is not the whole result`,
          ),
        ],
      ),
    ];
    for (const [text, quote, want] of covered)
      expect([text, probe(text, undefined, quote)]).toEqual([text, want]);
    // #27: an alternative in an aside or after a colon, a hedge, or a second
    // result anywhere after the value.
    for (const [text, bool, why] of [
      [
        "f MUST return null (or an empty array).",
        undefined,
        'offers an alternative right after "null" ("(or"), so "null" is not the whole result',
      ],
      [
        "f MUST return null: or so the old text said.",
        undefined,
        'offers an alternative right after "null" (": or"), so "null" is not the whole result',
      ],
      [
        "f MUST return true at most once.",
        true,
        'hedges "true" after stating it ("at most"), so it is not the result each time',
      ],
      [
        "f MUST return null in some cases.",
        undefined,
        'hedges "null" after stating it ("some"), so it is not the result each time',
      ],
      [
        "f MUST return true with probability one half.",
        true,
        'hedges "true" after stating it ("probability"), so it is not the result each time',
      ],
      [
        "f MUST return false here and true elsewhere.",
        false,
        'hedges "false" after stating it ("elsewhere"), so it is not the result each time',
      ],
      [
        "f MUST return null, then retry and return 5.",
        undefined,
        'states another result after "null" ("return"), so "null" is not the whole result',
      ],
      [
        "f MUST return null when the key is set, and true otherwise.",
        undefined,
        'states another result after "null" ("true"), so "null" is not the whole result',
      ],
    ] as const)
      expect([text, probe(text, bool, text)]).toEqual([text, because(why)]);
    // The same value again, and a plain condition, still state it.
    for (const text of [
      "f MUST return null for a string of odd length: abc decodes to null.",
      "f MUST return null when the text has an odd length or contains any other character.",
      "f MUST return null upon failure.",
    ])
      expect([text, probe(text, undefined, text)]).toEqual([text, []]);
    // A vector covering a different requirement of the same section is
    // refused: the stating requirement must be one it covers.
    {
      const d = read(
        spec(
          sec(
            "Probe",
            xmlOf("f MUST return null on odd input. f MUST emit hex."),
          ),
        ),
      );
      const c = hexContract();
      c.requirements.push(
        {
          id: "R-NULL",
          section: "4",
          level: "MUST",
          quote: "f MUST return null on odd input.",
        },
        {
          id: "R-EMIT",
          section: "4",
          level: "MUST",
          quote: "f MUST emit hex.",
        },
      );
      vec(c, "V-CITE").covers.push("R-NULL");
      const v = vec(c, "V-SPEC");
      v.source = { spec: "4" };
      v.covers = ["R-EMIT"];
      const run = () =>
        messages(runGates(c, { docs: docs(d), commands: passed("V-CMD") }));
      expect(run()).toEqual([
        // R-ODD is now covered by nothing.
        "[coverage] R-ODD: MUST requirement (§2.1) is not checked by any clause",
        `${at}${GENERIC("R-EMIT")}`,
      ]);
      v.covers = ["R-ODD", "R-EMIT", "R-NULL"];
      expect(run()).toEqual([]);
    }
    // These pass: the keyword governs the value, and a condition after the
    // value is not the value's.
    for (const sentence of [
      "hexDecode MUST return null when the text has an odd length.",
      "f MUST always return null on odd input.",
      "f SHALL return null.",
      "f is REQUIRED to return null.",
      "f MUST yield null.",
      "f MUST evaluate to null.",
      "f MUST return `null` for odd input.",
      "It is not hex. So f MUST return null.",
      "It is not hex.\n\nf MUST return null.",
    ]) {
      // Only as a covered requirement (quoting the paragraph that states
      // it); as bare text, never.
      const quote = sentence.split("\n\n").at(-1) as string;
      expect([sentence, probe(sentence, undefined, quote)]).toEqual([
        sentence,
        [],
      ]);
      expect([sentence, probe(sentence)]).toEqual([sentence, uncovered()]);
    }
    // #27: the value must end its clause or lead into a condition; a value
    // that runs on into a longer phrase is a word, not the result.
    for (const [sentence, bool, next] of [
      ["hexDecode MUST return null checks to its caller.", undefined, "checks"],
      ["f MUST return null pointers.", undefined, "pointers"],
      ["f is REQUIRED to be true to RFC 4648.", true, "to"],
      ["f MUST return false positives rarely.", false, "positives"],
    ] as const) {
      const word = String(bool ?? null);
      expect([sentence, probe(sentence, bool, sentence)]).toEqual([
        sentence,
        because(
          `continues past "${word}" ("${word} ${next}"), so "${word}" is a word in a longer phrase, not the stated result (end the clause after it, or follow it with a condition such as "when …")`,
        ),
      ]);
    }
    for (const sentence of [
      "f MUST return null.",
      "f MUST return null when the input is odd.",
      "f MUST return null if the input is odd.",
      "f MUST return null (see below).",
      "f MUST return null; nothing else is allowed.",
      "f MUST return null upon failure.",
      "f MUST return null",
    ])
      expect([sentence, probe(sentence, undefined, sentence)]).toEqual([
        sentence,
        [],
      ]);
    for (const [sentence, bool] of [
      ["f MUST return true for valid input.", true],
      ["f SHALL be false.", false],
      ["f MUST give False for it.", false],
    ] as const) {
      expect(probe(sentence, bool, sentence)).toEqual([]);
      expect(probe(sentence, bool)).toEqual(uncovered(String(bool)));
    }
    // Round 7: a fragment quote is judged with the prose sentence around it.
    for (const [quote, sentence, why] of [
      [
        "MUST return null",
        "Earlier drafts said that f MUST return null, but this was removed in draft 04.",
        'is cut from a sentence that qualifies it before the quote ("Earlier"), so the sentence does not require "null"',
      ],
      [
        "a Python decoder MUST return null",
        "For example, a Python decoder MUST return null.",
        'is cut from a sentence that qualifies it before the quote ("example"), so the sentence does not require "null"',
      ],
      [
        "f MUST return null",
        "If the input is odd, f MUST return null.",
        'is cut from a sentence that qualifies it before the quote ("If"), so the sentence does not require "null"',
      ],
      [
        "f MUST return null",
        "f MUST return null, but this was removed in draft 04.",
        'retracts "null" after stating it ("but")',
      ],
      [
        "f MUST return null",
        "f MUST return null or throw.",
        'offers an alternative right after "null" ("or"), so "null" is not the whole result',
      ],
    ] as const) {
      expect([quote, sentence, probe(sentence, undefined, quote)]).toEqual([
        quote,
        sentence,
        because(why),
      ]);
      // The full sentence as the quote is refused too.
      expect(probe(sentence, undefined, sentence).length).toBe(1);
    }
  });

  test("the hex spec's §4.2 still states null for V7 to V9", () => {
    const hex = parseV3(
      readFileSync("specs/example-hex.xml", "utf8"),
      "example-hex.xml",
    );
    const c = hexContract();
    c.requirements = [
      {
        id: "R-REJECT",
        section: "4.2",
        level: "MUST",
        quote:
          'hexDecode MUST return null when the text has an odd length or contains any other character, including whitespace and a "0x" prefix.',
      },
    ];
    const base = vec(c, "V-SPEC");
    c.clauses = [
      ["V7", "abc"],
      ["V8", "0x00"],
      ["V9", "ab cd"],
    ].map(([id, arg]) => ({
      ...base,
      id,
      covers: ["R-REJECT"],
      source: { spec: "4.2" },
      section: "6",
      args: [{ str: arg }],
    }));
    const provenance = () =>
      messages(runGates(c, { docs: docs(hex) })).filter(
        (m) => m.startsWith("[provenance]") || m.startsWith("[fidelity]"),
      );
    expect(provenance()).toEqual([]);
    // A fragment of the same sentence states it too.
    const [reject] = c.requirements;
    if (reject) {
      reject.quote =
        "hexDecode MUST return null when the text has an odd length";
    }
    expect(provenance()).toEqual([]);
    vec(c, "V7").source = { spec: "4.3" };
    expect(provenance()).toEqual([
      '[provenance] V7.source: §4.3 ("Empty input") does not state the expected result: V7 covers no requirement cited to it, so nothing there requires the result "null"',
    ]);
  });

  test("a cite source for a null must say null", () => {
    const c = hexContract();
    vec(c, "V-SPEC").source = { cite: { section: "2" } };
    vec(c, "V-SPEC").section = undefined;
    vec(c, "V-SPEC").args = [{ str: "abc" }];
    // §2 prints `abc` (in §2.1, which it holds), but V-SPEC's R-ODD is cited
    // to §2.1, not §2: the stating requirement must be cited to the very
    // section.
    expect(
      messages(runGates(c, { docs: docs(), commands: passed("V-CMD") })),
    ).toEqual([
      '[fidelity] V-SPEC.expect: §2 ("Encoding") does not state the expected result: V-SPEC covers no requirement cited to it, so nothing there requires the result "null"',
    ]);
    vec(c, "V-SPEC").source = { cite: { section: "2.1" } };
    vec(c, "V-SPEC").args = [{ str: "abc" }];
    expect(
      messages(runGates(c, { docs: docs(), commands: passed("V-CMD") })),
    ).toEqual([]);
    vec(c, "V-SPEC").source = { cite: { section: "3" } };
    vec(c, "V-SPEC").args = [{ str: "toHex" }];
    expect(
      messages(runGates(c, { docs: docs(), commands: passed("V-CMD") })),
    ).toEqual([
      '[fidelity] V-SPEC.expect: §3 ("Test Vectors") does not state the expected result: V-SPEC covers no requirement cited to it, so nothing there requires the result "null"',
    ]);
  });

  test("a command source not run is a warning, never a pass", () => {
    const r = runGates(hexContract(), { docs: docs() });
    expect(r.ok).toBe(true);
    expect(r.warnings).toContainEqual({
      at: "V-CMD.source",
      message:
        "source command not run (pass --run-sources): the expected value is unverified: $ printf deadbeef",
    });
  });

  test("a failed command source is a gate failure", () => {
    const r = runGates(hexContract(), {
      docs: docs(),
      commands: new Map([
        [
          "V-CMD",
          {
            id: "V-CMD",
            command: "printf deadbeef",
            outcome: "fail",
            detail: "exited 1",
          },
        ],
      ]),
    });
    expect(messages(r)).toEqual([
      "[provenance] V-CMD.source: source command exited 1: $ printf deadbeef",
    ]);
  });

  test("a test runner that cannot start is reported, not passed", async () => {
    const r = await runNishTest(hexContract(), "", "/nonexistent/nish");
    expect(r.status).toBe("ERROR");
    expect(r.stderr).toContain("failed to start /nonexistent/nish");
  });

  /** The hex contract with V-CMD's command and expected value replaced. */
  const withCommand = (command: string, expect: VectorClause["expect"]) => {
    const c = hexContract();
    vec(c, "V-CMD").source = { command };
    vec(c, "V-CMD").expect = expect;
    return c;
  };

  test("runs a command and compares its trimmed output", async () => {
    const ok = await runSourceCommands(hexContract());
    expect([...ok.values()]).toEqual([
      { id: "V-CMD", command: "printf deadbeef", outcome: "pass" },
    ]);
    // Bytes compare as hex, case-insensitively; surrounding whitespace is trimmed.
    const hex = await runSourceCommands(
      withCommand("echo '  DEADBEEF  '", { hex: "deadbeef" }),
    );
    expect(hex.get("V-CMD")?.outcome).toBe("pass");
  });

  test("refuses a command that prints something else", async () => {
    const r = await runSourceCommands(
      withCommand("printf cafe", { str: "deadbeef" }),
    );
    expect(r.get("V-CMD")).toEqual({
      id: "V-CMD",
      command: "printf cafe",
      outcome: "fail",
      detail: 'printed "cafe", the vector expects "deadbeef"',
    });
    const long = await runSourceCommands(
      withCommand(`printf '${"a".repeat(100)}'`, { str: "deadbeef" }),
    );
    expect(long.get("V-CMD")?.detail).toContain(`${"a".repeat(77)}..."`);
  });

  test("refuses a command that fails or exits non-zero", async () => {
    const r = await runSourceCommands(
      withCommand("echo nope >&2; exit 3", { str: "deadbeef" }),
    );
    expect(r.get("V-CMD")?.detail).toBe("exited 3 (nope)");
    const quiet = await runSourceCommands(
      withCommand("exit 4", { str: "deadbeef" }),
    );
    expect(quiet.get("V-CMD")?.detail).toBe("exited 4");
  });

  test("refuses a command that times out", async () => {
    const r = await runSourceCommands(
      withCommand("sleep 5", { str: "deadbeef" }),
      { timeoutMs: 100 },
    );
    expect(r.get("V-CMD")).toMatchObject({
      outcome: "fail",
      detail: "timed out after 100 ms",
    });
  });

  test("the report shows each command, run or not", () => {
    const c = hexContract();
    const gates = runGates(c, { docs: docs() });
    const notRun = renderReport({ contract: c, gates });
    expect(notRun).toContain(
      "hex-xml · hex (Hex Encoding) · nish/encoding/hex",
    );
    expect(notRun).toContain("Vector sources run");
    expect(notRun).toMatch(/· +V-CMD/);
    expect(notRun).toContain("$ printf deadbeef");
    const failed = new Map<string, SourceRun>([
      [
        "V-CMD",
        {
          id: "V-CMD",
          command: "printf deadbeef",
          outcome: "fail",
          detail: "exited 1",
        },
      ],
    ]);
    const shown = renderReport({ contract: c, gates, sources: failed });
    expect(shown).toContain("exited 1");
    expect(
      (
        reportJson({ contract: c, gates, sources: failed }) as {
          sources: unknown;
        }
      ).sources,
    ).toEqual({
      "V-CMD": {
        command: "printf deadbeef",
        outcome: "fail",
        detail: "exited 1",
      },
    });
    expect(
      (reportJson({ contract: null, gates }) as { sources: unknown }).sources,
    ).toBeUndefined();
    expect(
      (reportJson({ contract: c, gates }) as { sources: unknown }).sources,
    ).toEqual({
      "V-CMD": { command: "printf deadbeef", outcome: "not-run" },
    });
  });
});

describe("vector spec (the command)", () => {
  let dir: string;
  let out: string[];
  let err: string[];
  let logSpy: ReturnType<typeof spyOn>;
  let errSpy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vector-spec-"));
    writeFileSync(join(dir, "hex.xml"), SPEC);
    writeFileSync(join(dir, "hex.json"), JSON.stringify(hexContract()));
    out = [];
    err = [];
    logSpy = spyOn(console, "log").mockImplementation((...a) => {
      out.push(a.join(" "));
    });
    errSpy = spyOn(console, "error").mockImplementation((...a) => {
      err.push(a.join(" "));
    });
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });
  const contract = () => join(dir, "hex.json");

  test("spec check refuses the hidden keyword with its line", async () => {
    const p = join(dir, "hidden.txt");
    writeFileSync(p, `${RFC5869_TEXT}\nhexEncode M\u200bUST pad.\n`);
    expect(await rfcMain(["check", contract(), "--spec", p])).toBe(2);
    expect(err.join("\n")).toMatch(/line \d+: invisible character U\+200B/);
  });

  test("checks a spec contract, running its commands with --run-sources", async () => {
    expect(
      await rfcMain(["check", contract(), "--run-sources", "--json"]),
    ).toBe(0);
    const r = JSON.parse(out.join("\n"));
    expect(r.status).toBe("CONTRACT_VALID");
    expect(r.sources["V-CMD"].outcome).toBe("pass");
  });

  test("without --run-sources the command is reported as not run", async () => {
    expect(await rfcMain(["check", contract()])).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("source command not run (pass --run-sources)");
    expect(text).toMatch(/· +V-CMD/);
  });

  test("a command source that disagrees fails the check", async () => {
    const c = hexContract();
    vec(c, "V-CMD").source = { command: "printf cafe" };
    writeFileSync(contract(), JSON.stringify(c));
    expect(await rfcMain(["check", contract(), "--run-sources"])).toBe(1);
    expect(out.join("\n")).toContain(
      'source command printed "cafe", the vector expects "deadbeef"',
    );
  });

  test("vector spec and vector rfc are the same command", async () => {
    expect(await main(["spec", "check", contract()])).toBe(0);
    expect(await main(["rfc", "check", contract()])).toBe(0);
    expect(await rfcMain(["help"])).toBe(2);
    expect(err.join("\n")).toContain("Usage: vector spec check");
    expect(err.join("\n")).toContain("vector rfc … is the same command");
  });

  test("emit writes the nish test for a spec contract", async () => {
    const file = join(dir, "main.ts");
    expect(await rfcMain(["emit", contract(), "-o", file])).toBe(0);
    expect(readFileSync(file, "utf8")).toContain(
      `vector spec emit ${contract()} -o ${file}`,
    );
    expect(out.join("\n")).toContain(`(written to ${file})`);
  });

  test("usage names vector spec; extract reads built XML, never a model", async () => {
    expect(await main([])).toBe(2);
    expect(err.join("\n")).toContain(
      "vector spec check|emit|run|extract|mutate|frozen|stale|exports …  (spec or RFC → contract → nish test; alias: vector rfc)",
    );
    expect(await rfcMain(["extract"])).toBe(2);
    expect(err.join("\n")).toContain("error: extract needs <spec.xml>");
    expect(await rfcMain(["help"])).toBe(2);
    expect(err.join("\n")).toContain("Usage: vector spec check");
    expect(err.join("\n")).toContain(
      "vector spec extract <spec.xml> [-o <contract.json>] [--check]",
    );
  });

  test("--spec gives the main source's text; --rfc is the same", async () => {
    const other = join(dir, "other.xml");
    writeFileSync(other, SPEC.replace("deadbeef", "cafe"));
    expect(await rfcMain(["check", contract(), "--spec", other])).toBe(1);
    expect(out.join("\n")).toContain('the string "deadbeef" is not printed');
    expect(
      await rfcMain(["check", contract(), "--rfc", join(dir, "hex.xml")]),
    ).toBe(0);
  });

  test("a legacy contract finds its RFC beside or above it", async () => {
    expect(
      await rfcMain(["check", resolve("contracts/rfc5869-hkdf-sha256.json")]),
    ).toBe(0);
  });

  test("refuses a spec it cannot read or that is not a spec", async () => {
    expect(
      await rfcMain(["check", contract(), "--spec", join(dir, "missing.xml")]),
    ).toBe(2);
    expect(err.join("\n")).toContain("cannot read");
    const prose = join(dir, "prose.txt");
    writeFileSync(prose, "just prose");
    expect(await rfcMain(["check", contract(), "--spec", prose])).toBe(2);
    expect(err.join("\n")).toContain("not a specification");
  });

  test("refuses a contract whose RFC is found nowhere, saying how to fetch it", async () => {
    const c = hexContract();
    c.sources = [
      { id: "hex", path: "hex.xml" },
      { id: "rfc9999", rfc: 9999 },
    ];
    writeFileSync(contract(), JSON.stringify(c));
    expect(await rfcMain(["check", contract()])).toBe(2);
    expect(err.join("\n")).toContain(
      "error: rfc9999 not found; fetch it: curl -sSfL -o rfcs/rfc9999.xml https://www.rfc-editor.org/rfc/rfc9999.xml",
    );
  });

  describe("a contract's source paths reach only spec text (#29)", () => {
    /** The contract in dir/proj/contracts/, its source at `path`. */
    const at = (path: string) => {
      const c = hexContract();
      c.sources = [{ id: "hex", path }];
      const p = join(dir, "proj/contracts/hex.json");
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(c));
      return p;
    };
    const put = (rel: string) => {
      const p = join(dir, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, SPEC);
    };

    test("beside the contract, or in specs/ or rfcs/ beside its directory", async () => {
      put("proj/contracts/hex.xml");
      put("proj/specs/hex.xml");
      put("proj/rfcs/sub/hex.xml");
      expect(await rfcMain(["check", at("hex.xml")])).toBe(0);
      expect(await rfcMain(["check", at("../specs/hex.xml")])).toBe(0);
      expect(await rfcMain(["check", at("../rfcs/sub/hex.xml")])).toBe(0);
    });

    for (const [why, file, path] of [
      ["above the contract", "secret.xml", "../../secret.xml"],
      ["in a hidden directory", "proj/.git/hex.xml", "../.git/hex.xml"],
      [
        "in a hidden directory beside it",
        "proj/contracts/.ssh/hex.xml",
        ".ssh/hex.xml",
      ],
      [
        "under specs/ but hidden",
        "proj/specs/.env/hex.xml",
        "../specs/.env/hex.xml",
      ],
    ] as const)
      test(`refuses a file ${why}, without reading it`, async () => {
        put(file);
        expect(await rfcMain(["check", at(path)])).toBe(2);
        const e = err.join("\n");
        expect(e).toContain(`source hex is ${path}, which is not spec text`);
        expect(e).toContain("give it with --spec");
        expect(out.join("\n")).not.toContain("deadbeef");
      });

    test("a symlink beside the contract is judged by where it leads", async () => {
      put("outside/hex.xml");
      mkdirSync(join(dir, "proj/contracts"), { recursive: true });
      symlinkSync(
        join(dir, "outside/hex.xml"),
        join(dir, "proj/contracts/hex.xml"),
      );
      expect(await rfcMain(["check", at("hex.xml")])).toBe(2);
      expect(err.join("\n")).toContain("which is not spec text");
    });

    test("a symlinked specs/ is no root: it could lead anywhere", async () => {
      put("outside/hex.xml");
      mkdirSync(join(dir, "proj"), { recursive: true });
      symlinkSync(join(dir, "outside"), join(dir, "proj/specs"));
      expect(await rfcMain(["check", at("../specs/hex.xml")])).toBe(2);
      expect(err.join("\n")).toContain(
        "source hex is ../specs/hex.xml, which is not spec text",
      );
      expect(out.join("\n")).not.toContain("deadbeef");
    });

    test("an implicit rfc<N>.txt is judged the same way", async () => {
      const c = hexContract();
      c.sources = [{ id: "hex", rfc: 4648 }];
      const p = join(dir, "proj/contracts/hex.json");
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(c));
      put("outside/.ssh/id");
      symlinkSync(
        join(dir, "outside/.ssh/id"),
        join(dir, "proj/contracts/rfc4648.txt"),
      );
      expect(await rfcMain(["check", p])).toBe(2);
      expect(err.join("\n")).toContain("which is not spec text");
      expect(out.join("\n")).not.toContain("deadbeef");
      // The same name as a plain file beside the contract is read.
      err.length = 0;
      rmSync(join(dir, "proj/contracts/rfc4648.txt"));
      put("proj/contracts/rfc4648.txt");
      await rfcMain(["check", p]);
      expect(err.join("\n")).not.toContain("not spec text");
    });

    test("--spec names the file the user chose, wherever it is", async () => {
      put("outside/hex.xml");
      expect(
        await rfcMain([
          "check",
          at("../../outside/hex.xml"),
          "--spec",
          join(dir, "outside/hex.xml"),
        ]),
      ).toBe(0);
    });
  });

  test("a contract of the wrong shape is refused without reading sources", async () => {
    const c = hexContract();
    (vec(c, "V-CMD") as Partial<VectorClause>).source = undefined;
    writeFileSync(contract(), JSON.stringify(c));
    expect(await rfcMain(["check", contract(), "--run-sources"])).toBe(1);
    expect(out.join("\n")).toContain("clauses[2].source");
  });
});
