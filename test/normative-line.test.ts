import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { RfcContract } from "../src/rfc/contract.ts";
import { runGates } from "../src/rfc/gates.ts";
import { loadSources } from "../src/rfc/sources.ts";
import type { V3Document } from "../src/rfc/xmlv3.ts";

// Section 1 says "A sender MUST pad the block." marked, then again in a
// paragraph with no <bcp14>. Section 2 says it twice, both marked.
const DIR = join(import.meta.dir, "fixtures/normative-line");
const SENTENCE = "A sender MUST pad the block.";

/** A contract on repeat.xml quoting `quotes` as MUST requirements. */
const contract = (quotes: [string, string][]): RfcContract => ({
  contract: "repeat",
  source: { title: "Repeat", main: "repeat" },
  sources: [{ id: "repeat", path: "repeat.xml" }],
  target: { module: "nish/repeat" },
  functions: [{ name: "f", params: [], returns: "string" }],
  requirements: quotes.map(([section, quote], i) => ({
    id: `R${i}`,
    section,
    level: "MUST",
    quote,
  })),
  clauses: [
    {
      kind: "vector",
      id: "V",
      title: "v",
      covers: quotes.map((_, i) => `R${i}`),
      source: { cite: { section: "1" } },
      call: "f",
      args: [],
      expect: { str: "x" },
    },
  ],
});

const load = (c: RfcContract) => loadSources(c, join(DIR, "c.json")).docs;

/** The completeness issues of `c`, after `edit` changes the read document. */
const uncovered = (
  quotes: [string, string][],
  edit: (d: V3Document) => void = () => {},
) => {
  const c = contract(quotes);
  const docs = load(c);
  edit(docs.get("repeat") as V3Document);
  return runGates(c, { docs })
    .issues.filter((i) => i.gate === "completeness")
    .map((i) => `${i.at} ${i.message}`);
};
const neither = (section: string) =>
  `§${section} MUST sentence is neither a requirement nor an exclusion: ${JSON.stringify(SENTENCE)}`;

// Quotes that cover each section's marked copies.
const MARKED: [string, string][] = [
  ["1", `${SENTENCE} Then more.`],
  ["2", SENTENCE],
];

describe("each normative entry records where its sentence is", () => {
  test("its section line, its offset there, and its source line", () => {
    const d = load(contract(MARKED)).get("repeat") as V3Document;
    expect(
      d.normative.map((n) => [n.section, n.level, n.sentence, n.line, n.start]),
    ).toEqual([
      ["1", "MUST", SENTENCE, 0, 0],
      ["1", "MAY", "A reader MAY stop.", 2, 0],
      ["2", "MUST", SENTENCE, 0, 0],
      ["2", "MUST", SENTENCE, 1, 0],
    ]);
    // Line 7 of the XML, five lines after <?line 10?> on line 5.
    expect(d.normative[0].loc).toEqual({ xmlLine: 7, mdLine: 12 });
    expect(d.normative[3].loc).toEqual({ xmlLine: 13, mdLine: 18 });
  });
});

describe("completeness locates each entry by its own position", () => {
  test("quoting the marked copy passes; the unmarked copy needs no quote", () => {
    expect(uncovered(MARKED)).toEqual([]);
  });

  test("quoting only the unmarked copy fails", () => {
    // "more. " pins the quote to the copy after the marked paragraph.
    expect(
      uncovered([
        ["1", `more. ${SENTENCE}`],
        ["2", SENTENCE],
      ]),
    ).toEqual([neither("1")]);
  });

  test("two marked copies: each must be quoted", () => {
    // Pinned to the second copy, the quote leaves the first uncovered.
    expect(
      uncovered([
        ["1", `${SENTENCE} Then more.`],
        ["2", `block. ${SENTENCE}`],
      ]),
    ).toEqual([neither("2")]);
  });

  test("an entry whose position does not hold its sentence is reported", () => {
    const at = (line: number, start: number) => (d: V3Document) => {
      d.normative[0].line = line;
      d.normative[0].start = start;
    };
    // A line past the section's end, a line holding other text, and an
    // offset past the sentence's start: each fails closed.
    expect(uncovered(MARKED, at(9, 0))).toEqual([neither("1")]);
    expect(uncovered(MARKED, at(2, 0))).toEqual([neither("1")]);
    expect(uncovered(MARKED, at(0, 1))).toEqual([neither("1")]);
  });

  test("an entry in a section the document lacks is reported", () => {
    expect(
      uncovered(MARKED, (d) => {
        d.normative[0].section = "9";
      }),
    ).toEqual([
      `9 MUST sentence is outside every numbered section, so it can be neither a requirement nor an exclusion: ${JSON.stringify(SENTENCE)}`,
    ]);
  });
});

describe("positions in paragraphs, list items, cells and subsections", () => {
  // Section 1 holds two marked sentences in one paragraph, a list item and
  // a table cell; its subsection 1.1 holds one more, on its second line.
  const QUOTES: [string, string][] = [
    ["1", "First a sender MUST pad."],
    ["1", "Then a sender SHALL send."],
    ["1", "A list item MUST hold."],
    ["1", "A cell MUST hold."],
    ["1.1", "A sub MUST hold."],
  ];
  const positions = (quotes: [string, string][]) => {
    const c = contract(quotes);
    c.sources = [{ id: "repeat", path: "positions.xml" }];
    return c;
  };

  test("each entry's line and offset hold its sentence", () => {
    const d = load(positions(QUOTES)).get("repeat") as V3Document;
    expect(
      d.normative.map((n) => [n.section, n.sentence, n.line, n.start]),
    ).toEqual([
      ["1", "First a sender MUST pad.", 0, 0],
      ["1", "Then a sender SHALL send.", 0, 25],
      ["1", "A list item MUST hold.", 1, 0],
      ["1", "A cell MUST hold.", 2, 0],
      ["1.1", "A sub MUST hold.", 1, 0],
    ]);
    for (const n of d.normative) {
      const line = d.sections.get(n.section)?.ownLines[n.line] ?? "";
      expect(line.slice(n.start)).toStartWith(n.sentence);
    }
  });

  test("quoting each covers it; leaving one out reports it alone", () => {
    const docs = load(positions(QUOTES));
    const issues = (q: [string, string][]) => {
      return runGates(positions(q), { docs })
        .issues.filter((i) => i.gate === "completeness")
        .map((i) => i.message);
    };
    expect(issues(QUOTES)).toEqual([]);
    expect(issues(QUOTES.filter((_, i) => i !== 1))).toEqual([
      'SHALL sentence is neither a requirement nor an exclusion: "Then a sender SHALL send."',
    ]);
    expect(issues(QUOTES.filter((_, i) => i !== 4))).toEqual([
      'MUST sentence is neither a requirement nor an exclusion: "A sub MUST hold."',
    ]);
  });
});
