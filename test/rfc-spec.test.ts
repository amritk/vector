import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  hexRuns,
  intLabelled,
  normativeSentences,
  parseRfc,
  sectionLines,
  sectionText,
} from "../src/rfc/rfctext.ts";
import { runNishTest, runSourceCommands } from "../src/rfc/run.ts";
import {
  LOOSE_SECTION,
  detectFormat,
  parseDocument,
  parseMarkdownSpec,
} from "../src/rfc/spectext.ts";

// Markdown specs, multi-document contracts and vector provenance. Every gate
// here has a refusing test next to its passing one.

/** A small markdown spec: BCP 14 boilerplate, numbered sections, a table, a fence, inline code. */
const SPEC = `# Hex Encoding

## 1. Introduction

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" in this document are to be interpreted as described in
BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all
capitals, as shown here.

## 2. Encoding

An encoder MUST emit two lowercase digits per byte.

### 2.1. Decoding

A decoder MUST return null for a string of odd length: \`abc\` decodes
to null.

## Notes

\`\`\`text
# not a heading
\`\`\`

## 3. Test Vectors

| bytes | \`toHex\` |
|-------|---------|
| [de ad be ef] | \`deadbeef\` |

## Appendix A. Sizes

Block Count: 4
`;

const rfc5869 = parseRfc(readFileSync("rfcs/rfc5869.txt", "utf8"));
const hkdf = hkdfContract as unknown as RfcContract;
const clone = <T>(x: T): T => structuredClone(x);
const vec = (c: RfcContract, id: string) =>
  c.clauses.find((k) => k.id === id) as VectorClause;

/** A contract for the spec above: one vector of each provenance. */
function hexContract(): RfcContract {
  return {
    contract: "hex-md",
    source: { title: "Hex Encoding", main: "hex" },
    sources: [{ id: "hex", path: "hex.md" }],
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

const doc = parseMarkdownSpec(SPEC);
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

describe("reading a spec", () => {
  test("detects an RFC and a markdown spec", () => {
    expect(detectFormat(readFileSync("rfcs/rfc5869.txt", "utf8"))).toBe("rfc");
    expect(detectFormat(SPEC)).toBe("markdown");
    expect(parseDocument(SPEC).number).toBeNull();
    expect(parseDocument(readFileSync("rfcs/rfc5869.txt", "utf8")).number).toBe(
      5869,
    );
  });

  test("refuses a text that is neither", () => {
    expect(() => detectFormat("just some prose\nwith no headings")).toThrow(
      "not a specification",
    );
    // A Request-for-Comments line without page breaks is not an RFC either.
    expect(() =>
      detectFormat("Request for Comments: 1\nno form feeds"),
    ).toThrow("not a specification");
  });

  test("numbered headings are sections; a section includes its subsections", () => {
    expect([...doc.sections.keys()]).toEqual(["1", "2", "2.1", "3", "A"]);
    expect(doc.sections.get("2")?.title).toBe("Encoding");
    expect(doc.sections.get("A")?.title).toBe("Sizes");
    const two = section("2");
    expect(sectionText(two)).toContain("A decoder MUST return null");
    // Its own text stops at 2.1, and the unnumbered "Notes" ends both.
    expect(two.ownLines.join("\n")).not.toContain("decoder");
    expect(sectionText(two)).not.toContain("not a heading");
  });

  test("text under an unnumbered heading is loose; code in a fence is kept verbatim", () => {
    expect(doc.loose?.id).toBe(LOOSE_SECTION);
    const loose = doc.loose?.lines.join("\n") ?? "";
    expect(loose).toContain("Hex Encoding");
    expect(loose).toContain("# not a heading");
    expect(loose).not.toContain("```");
    expect(doc.sections.has("not a heading")).toBe(false);
  });

  test("table cells are lines, inline code loses its backticks, byte lists are hex", () => {
    const three = section("3");
    expect(three.lines).toContain("deadbeef");
    expect(three.lines).toContain("toHex");
    expect(three.lines.join("\n")).not.toContain("|");
    expect(three.lines.join("\n")).not.toContain("---");
    expect(hexRuns(three)).toContain("deadbeef");
    expect(sectionText(section("2.1"))).toContain("abc decodes to null");
  });

  test("an escaped pipe stays in its cell; a fence closes only on its own kind", () => {
    const d = parseMarkdownSpec(
      "## 1. T\n\n| a \\| b | c |\n\n~~~\n```\n# x\n~~~\n\n## 2. U\n",
    );
    expect(d.sections.get("1")?.lines).toContain("a | b");
    expect(d.sections.get("1")?.lines).toContain("# x");
    expect(d.sections.get("1")?.lines).toContain("```");
    expect([...d.sections.keys()]).toEqual(["1", "2"]);
  });

  test("the BCP 14 paragraph is not normative; every other MUST is", () => {
    const found = normativeSentences(doc).map((n) => n.section);
    expect(found).toEqual(["2", "2.1"]);
    expect(sectionText(section("1"))).not.toContain("BCP 14");
  });

  test("a labelled int in a markdown section", () => {
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

describe("a markdown contract", () => {
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
    const d = parseMarkdownSpec(
      SPEC.replace("## Notes\n", "## Notes\n\nImplementations MUST be fast.\n"),
    );
    const r = runGates(hexContract(), {
      docs: docs(d),
      commands: passed("V-CMD"),
    });
    expect(r.ok).toBe(false);
    expect(messages(r)).toEqual([
      `[completeness] ${LOOSE_SECTION}: MUST sentence is outside every numbered section, so it can be neither a requirement nor an exclusion: "Hex Encoding Notes Implementations MUST be fast."`,
    ]);
  });

  test("refuses a MUST of the main spec that is neither tested nor excluded", () => {
    const c = hexContract();
    c.requirements = c.requirements.filter((r) => r.id !== "R-ODD");
    for (const k of c.clauses) k.covers = ["R-LOWER"];
    const r = runGates(c, { docs: docs(), commands: passed("V-CMD") });
    expect(messages(r)).toEqual([
      '[completeness] §2.1: MUST sentence is neither a requirement nor an exclusion: "Decoding A decoder MUST return null for a string of odd length: abc decodes to null."',
    ]);
  });

  test("refuses a quote or value the cited markdown section does not print", () => {
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
      '[completeness] §2: MUST sentence is neither a requirement nor an exclusion: "Encoding An encoder MUST emit two lowercase digits per byte."',
    ]);
  });

  test("an exclusion accounts for a MUST, and must quote the section", () => {
    const c = hexContract();
    c.requirements = c.requirements.filter((r) => r.id !== "R-ODD");
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

  test("refuses a section the markdown spec does not have", () => {
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
      { id: "hex", path: "hex.md" },
      { id: "hex", path: "again.md" },
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
        "hex.md",
        { id: "has space", path: "hex.md" },
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
      { id: "hex", path: "hex.md" },
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
    const d = parseMarkdownSpec(
      SPEC.replace(
        "A decoder MUST return null for a string of odd length: `abc` decodes\nto null.",
        "A decoder MUST return null for a string of odd length: `abc` decodes\nto nothing.",
      ).replace(/return null/, "refuse"),
    );
    const c = hexContract();
    c.requirements[1].quote =
      "A decoder MUST refuse for a string of odd length";
    const r = runGates(c, { docs: docs(d), commands: passed("V-CMD") });
    expect(messages(r)).toEqual([
      '[provenance] V-SPEC.source: §2.1 ("Decoding") never says "null", so it does not state the expected result',
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
      '[fidelity] V-BOOL-CITE.expect: §2.1 ("Decoding") never says "true", so it does not state the expected result',
      '[provenance] V-BOOL-SPEC.source: §2.1 ("Decoding") never says "false", so it does not state the expected result',
    ]);
    const stated = parseMarkdownSpec(
      SPEC.replace("to null.", "to null. isHex is False for it, True never."),
    );
    expect(
      messages(runGates(c, { docs: docs(stated), commands: passed("V-CMD") })),
    ).toEqual([]);
  });

  test("a cite source for a null must say null", () => {
    const c = hexContract();
    vec(c, "V-SPEC").source = { cite: { section: "2" } };
    vec(c, "V-SPEC").section = undefined;
    vec(c, "V-SPEC").args = [{ str: "encoder" }];
    const r = runGates(c, { docs: docs(), commands: passed("V-CMD") });
    // §2 includes 2.1, which says null; §3 does not.
    expect(messages(r)).toEqual([]);
    vec(c, "V-SPEC").source = { cite: { section: "3" } };
    vec(c, "V-SPEC").args = [{ str: "toHex" }];
    expect(
      messages(runGates(c, { docs: docs(), commands: passed("V-CMD") })),
    ).toEqual([
      '[fidelity] V-SPEC.expect: §3 ("Test Vectors") never says "null", so it does not state the expected result',
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
    expect(notRun).toContain("hex-md · hex (Hex Encoding) · nish/encoding/hex");
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
    writeFileSync(join(dir, "hex.md"), SPEC);
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

  test("checks a markdown contract, running its commands with --run-sources", async () => {
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

  test("emit writes the nish test for a markdown contract", async () => {
    const file = join(dir, "main.ts");
    expect(await rfcMain(["emit", contract(), "-o", file])).toBe(0);
    expect(readFileSync(file, "utf8")).toContain(
      `vector spec emit ${contract()} -o ${file}`,
    );
    expect(out.join("\n")).toContain(`(written to ${file})`);
  });

  test("usage names vector spec, for the CLI and for extract", async () => {
    expect(await main([])).toBe(2);
    expect(err.join("\n")).toContain(
      "vector spec check|emit|run|extract …  (spec or RFC → contract → nish test; alias: vector rfc)",
    );
    expect(await rfcMain(["extract"])).toBe(2);
    expect(err.join("\n")).toContain("error: extract needs --spec <file>");
  });

  test("--spec gives the main source's text; --rfc is the same", async () => {
    const other = join(dir, "other.md");
    writeFileSync(other, SPEC.replace("deadbeef", "cafe"));
    expect(await rfcMain(["check", contract(), "--spec", other])).toBe(1);
    expect(out.join("\n")).toContain('the string "deadbeef" is not printed');
    expect(
      await rfcMain(["check", contract(), "--rfc", join(dir, "hex.md")]),
    ).toBe(0);
  });

  test("a legacy contract finds its RFC beside or above it", async () => {
    expect(
      await rfcMain(["check", resolve("contracts/rfc5869-hkdf-sha256.json")]),
    ).toBe(0);
  });

  test("refuses a spec it cannot read or that is not a spec", async () => {
    expect(
      await rfcMain(["check", contract(), "--spec", join(dir, "missing.md")]),
    ).toBe(2);
    expect(err.join("\n")).toContain("cannot read");
    const prose = join(dir, "prose.txt");
    writeFileSync(prose, "just prose");
    expect(await rfcMain(["check", contract(), "--spec", prose])).toBe(2);
    expect(err.join("\n")).toContain("not a specification");
  });

  test("refuses a contract whose source is found nowhere", async () => {
    const c = hexContract();
    c.sources = [
      { id: "hex", path: "hex.md" },
      { id: "rfc9999", rfc: 9999 },
    ];
    writeFileSync(contract(), JSON.stringify(c));
    expect(await rfcMain(["check", contract()])).toBe(1);
    expect(out.join("\n")).toContain(
      'the text of source "rfc9999" was not given',
    );
  });

  test("a contract of the wrong shape is refused without reading sources", async () => {
    const c = hexContract();
    (vec(c, "V-CMD") as Partial<VectorClause>).source = undefined;
    writeFileSync(contract(), JSON.stringify(c));
    expect(await rfcMain(["check", contract(), "--run-sources"])).toBe(1);
    expect(out.join("\n")).toContain("clauses[2].source");
  });
});
