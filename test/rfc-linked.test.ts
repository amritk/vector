import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { rfcMain } from "../src/rfc/cli.ts";
import type { RfcContract } from "../src/rfc/contract.ts";
import { sha256 } from "../src/rfc/emit-nish.ts";
import { VECTOR_ROOT, frozenCheck, sourceFile } from "../src/rfc/frozen.ts";
import { runGates } from "../src/rfc/gates.ts";
import {
  MissingRfcFile,
  MissingRfcFiles,
  SourcePathError,
  fetchHint,
  loadSource,
  loadSources,
  readDocument,
  rfcDecl,
} from "../src/rfc/sources.ts";
import type { V3Document } from "../src/rfc/xmlv3.ts";
import linked from "./fixtures/linked/rfc8707-resource.json";

// Linked RFCs: a source resolves to rfc<N>.xml before rfc<N>.txt, an XML
// source is read by the v3 reader in every gate, and an RFC found nowhere is
// an error that says how to fetch it (vector never touches the network).

const FIXTURE = linked as unknown as RfcContract;
const clone = (): RfcContract => JSON.parse(JSON.stringify(FIXTURE));
const RFC8707 = readFileSync(join(VECTOR_ROOT, "rfcs/rfc8707.xml"), "utf8");
const RFC4648 = readFileSync(join(VECTOR_ROOT, "rfcs/rfc4648.txt"), "utf8");

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "vector-linked-")));
  dirs.push(d);
  return d;
};
const write = (d: string, rel: string, s: string) => {
  mkdirSync(dirname(join(d, rel)), { recursive: true });
  writeFileSync(join(d, rel), s);
};
/** `c` at contracts/c.json in a fresh repo holding rfcs/rfc8707.xml. */
const project = (c: RfcContract = clone()) => {
  const d = tmp();
  cpSync(join(VECTOR_ROOT, "rfcs/rfc8707.xml"), join(d, "rfcs/rfc8707.xml"));
  write(d, "contracts/c.json", JSON.stringify(c));
  return { d, contract: join(d, "contracts/c.json") };
};

async function cli(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...a) => {
    out.push(a.join(" "));
  });
  const error = spyOn(console, "error").mockImplementation((...a) => {
    err.push(a.join(" "));
  });
  try {
    return {
      code: await rfcMain(argv),
      out: out.join("\n"),
      err: err.join("\n"),
    };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}
const check = (c: RfcContract) => cli(["check", project(c).contract]);

describe("an RFC source resolves to rfc<N>.xml before rfc<N>.txt", () => {
  const decl = { id: "rfc4648", rfc: 4648 };

  test("beside the contract", () => {
    const d = tmp();
    write(d, "rfc4648.txt", RFC4648);
    expect(sourceFile(decl, join(d, "c.json"))).toBe(join(d, "rfc4648.txt"));
    write(d, "rfc4648.xml", RFC8707);
    expect(sourceFile(decl, join(d, "c.json"))).toBe(join(d, "rfc4648.xml"));
  });

  test("an .xml in a nearer place wins over a .txt further away, and back", () => {
    const d = tmp();
    write(d, "rfcs/rfc4648.txt", RFC4648);
    write(d, "contracts/rfc4648.xml", RFC8707);
    const c = join(d, "contracts/c.json");
    expect(sourceFile(decl, c)).toBe(join(d, "contracts/rfc4648.xml"));
    rmSync(join(d, "contracts/rfc4648.xml"));
    write(d, "contracts/rfc4648.txt", RFC4648);
    write(d, "rfcs/rfc4648.xml", RFC8707);
    expect(sourceFile(decl, c)).toBe(join(d, "contracts/rfc4648.txt"));
  });

  test("a recorded file is the one read, though an .xml sits beside it", () => {
    // An RFC vector's own rfcs/ lacks, so only these files can be found.
    const r = { id: "r", rfc: 9996 };
    const d = tmp();
    write(d, "rfcs/rfc9996.txt", RFC4648);
    write(d, "rfcs/rfc9996.xml", RFC8707);
    const c = join(d, "contracts/c.json");
    const txt = join(d, "rfcs/rfc9996.txt");
    expect(sourceFile({ ...r, file: "rfcs/rfc9996.txt" }, c)).toBe(txt);
    expect(sourceFile(r, c)).toBe(join(d, "rfcs/rfc9996.xml"));
    // Nor does one at a nearer place: beside the contract.
    write(d, "contracts/rfc9996.xml", RFC8707);
    expect(sourceFile({ ...r, file: "rfcs/rfc9996.txt" }, c)).toBe(txt);
    expect(sourceFile(r, c)).toBe(join(d, "contracts/rfc9996.xml"));
    rmSync(join(d, "contracts/rfc9996.xml"));
    // A recorded file found nowhere: the first found is read, and
    // recordedProblem reports that it is not the one recorded.
    rmSync(txt);
    expect(sourceFile({ ...r, file: "rfcs/rfc9996.txt" }, c)).toBe(
      join(d, "rfcs/rfc9996.xml"),
    );
  });

  test("vector's own rfcs/ holds rfc8707.xml", () => {
    expect(sourceFile({ id: "r", rfc: 8707 }, join(tmp(), "c.json"))).toBe(
      join(VECTOR_ROOT, "rfcs/rfc8707.xml"),
    );
  });

  test("an rfc<N>.xml is held to the same path rules as a .txt", () => {
    const d = tmp();
    write(d, ".hidden/rfc8707.xml", RFC8707);
    mkdirSync(join(d, "rfcs"));
    symlinkSync(join(d, ".hidden/rfc8707.xml"), join(d, "rfcs/rfc8707.xml"));
    const c = join(d, "contracts/c.json");
    expect(() => loadSource({ id: "rfc8707", rfc: 8707 }, c)).toThrow(
      SourcePathError,
    );
    expect(() => loadSource({ id: "rfc8707", rfc: 8707 }, c)).toThrow(
      "which is not spec text",
    );
  });
});

describe("an RFC found nowhere says how to fetch it", () => {
  test("XML from RFC 8700 on, text before 8650, either in between", () => {
    expect(fetchHint(8707)).toBe(
      "curl -sSfL -o rfcs/rfc8707.xml https://www.rfc-editor.org/rfc/rfc8707.xml",
    );
    expect(fetchHint(8649)).toBe(
      "curl -sSfL -o rfcs/rfc8649.txt https://www.rfc-editor.org/rfc/rfc8649.txt",
    );
    expect(fetchHint(8650)).toBe(
      "curl -sSfL -o rfcs/rfc8650.xml https://www.rfc-editor.org/rfc/rfc8650.xml (or, if it has no XML, curl -sSfL -o rfcs/rfc8650.txt https://www.rfc-editor.org/rfc/rfc8650.txt)",
    );
    expect(fetchHint(8699)).toContain("rfcs/rfc8699.xml");
    expect(fetchHint(8699)).toContain("rfcs/rfc8699.txt");
  });

  test("loadSource throws MissingRfcFile carrying the RFC and the command", () => {
    let caught: unknown;
    try {
      loadSource({ id: "rfc1", rfc: 1 }, join(tmp(), "c.json"));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MissingRfcFile);
    const m = caught as MissingRfcFile;
    expect(m.rfc).toBe(1);
    expect(m.hint).toBe(fetchHint(1));
    expect(m.name).toBe("MissingRfcFile");
    expect(m.message).toBe(
      "rfc1 not found; fetch it: curl -sSfL -o rfcs/rfc1.txt https://www.rfc-editor.org/rfc/rfc1.txt",
    );
  });

  test("spec check exits 2 with the command", async () => {
    const c = clone();
    c.sources?.push({ id: "rfc9998", rfc: 9998 });
    const r = await check(c);
    expect(r.code).toBe(2);
    expect(r.err).toBe(
      "error: rfc9998 not found; fetch it: curl -sSfL -o rfcs/rfc9998.xml https://www.rfc-editor.org/rfc/rfc9998.xml",
    );
  });

  test("every RFC found nowhere is named, each with its command", async () => {
    const c = clone();
    c.sources?.push({ id: "rfc9998", rfc: 9998 }, { id: "rfc1", rfc: 1 });
    const r = await check(c);
    expect(r.code).toBe(2);
    expect(r.err).toBe(
      [
        "error: rfc9998 not found; fetch it: curl -sSfL -o rfcs/rfc9998.xml https://www.rfc-editor.org/rfc/rfc9998.xml",
        "error: rfc1 not found; fetch it: curl -sSfL -o rfcs/rfc1.txt https://www.rfc-editor.org/rfc/rfc1.txt",
      ].join("\n"),
    );
    let thrown: unknown;
    try {
      loadSources(c, project(c).contract);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(MissingRfcFiles);
    const missing = (thrown as MissingRfcFiles).missing;
    expect(missing.map((m) => m.rfc)).toEqual([9998, 1]);
    expect((thrown as Error).message.split("\n")).toEqual(
      missing.map((m) => m.message),
    );
  });
});

describe("loading a source", () => {
  test("an XML source is read by the v3 reader", () => {
    const got = loadSource({ id: "r", rfc: 8707 }, join(tmp(), "c.json"));
    expect(got.file).toBe(join(VECTOR_ROOT, "rfcs/rfc8707.xml"));
    expect(got.sha256).toBe(sha256(Buffer.from(RFC8707)));
    expect(got.doc.number).toBe(8707);
    expect((got.doc as V3Document).normative.length).toBeGreaterThan(0);
  });

  test("the name decides the reader: .xml is RFC XML, and only .xml", () => {
    expect("normative" in readDocument("x.xml", RFC8707)).toBe(true);
    expect("normative" in readDocument("x.txt", RFC4648)).toBe(false);
    expect(() => readDocument("x.txt", RFC8707)).toThrow(
      /^x\.txt: not a specification/,
    );
  });

  test("a refusal names the file", () => {
    expect(() => readDocument("bad.txt", "no headings here\n")).toThrow(
      /^bad\.txt: /,
    );
    expect(() => readDocument("bad.xml", "<rfc><middle>")).toThrow(
      /^bad\.xml:\d+: /,
    );
  });

  test("a source it cannot open", () => {
    const c = join(tmp(), "c.json");
    expect(() => loadSource({ id: "x", path: "gone.txt" }, c)).toThrow(
      `cannot read ${join(dirname(c), "gone.txt")}`,
    );
  });

  test("a file the user gives is read wherever it is", () => {
    const d = tmp();
    write(d, ".hidden/spec.xml", RFC8707);
    const got = loadSource(
      { id: "r", rfc: 8707 },
      join(d, "c.json"),
      join(d, ".hidden/spec.xml"),
    );
    expect(got.doc.number).toBe(8707);
  });

  test("rfcDecl: the entry that records an RFC's file and bytes", () => {
    const { contract } = project();
    expect(rfcDecl(8707, contract)).toEqual({
      id: "rfc8707",
      rfc: 8707,
      file: "rfcs/rfc8707.xml",
      sha256: sha256(Buffer.from(RFC8707)),
    });
    expect(() => rfcDecl(9997, contract)).toThrow(MissingRfcFile);
  });

  test("loadSources reports a recorded file or sha256 that differs", () => {
    const c = clone();
    const { contract } = project(c);
    const decl = rfcDecl(8707, contract);
    c.sources = [{ ...decl, sha256: "0".repeat(64) }];
    const got = loadSources(c, contract);
    expect(got.docs.get("rfc8707")?.number).toBe(8707);
    expect(got.problems.get("rfc8707")).toStartWith(
      "source rfc8707 (rfcs/rfc8707.xml) has sha256 ",
    );
    c.sources = [decl];
    expect(loadSources(c, contract).problems.size).toBe(0);
  });

  test("a main source it may not read says how to give another", () => {
    const d = tmp();
    write(d, ".hidden/rfc8707.xml", RFC8707);
    const c = clone();
    c.sources = [{ id: "rfc8707", rfc: 8707, path: "../.hidden/rfc8707.xml" }];
    write(d, "contracts/c.json", JSON.stringify(c));
    const contract = join(d, "contracts/c.json");
    expect(() => loadSources(c, contract)).toThrow(
      "(to check against another file, give it with --spec",
    );
    // Not for a source other than the main one.
    c.source.main = "spec";
    c.sources.push({ id: "spec", path: "spec.txt" });
    write(d, "contracts/spec.txt", RFC4648);
    let message = "";
    try {
      loadSources(c, contract);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toStartWith(`${contract}: source rfc8707 is `);
    expect(message).not.toContain("--spec");
  });
});

describe("the gates read an XML source", () => {
  test("a contract citing rfc8707.xml checks", async () => {
    const r = await cli([
      "check",
      join(VECTOR_ROOT, "test/fixtures/linked/rfc8707-resource.json"),
    ]);
    expect(r.out).toContain("Status: CONTRACT_VALID");
    expect(r.code).toBe(0);
  });

  test("a section the RFC does not have", async () => {
    const c = clone();
    c.requirements[0].section = "2.9";
    const r = await check(c);
    expect(r.code).toBe(1);
    expect(r.out).toContain("RFC 8707 has no section 2.9");
  });

  test("a quote that is not in its section", async () => {
    const c = clone();
    c.requirements[0].section = "2.1";
    const r = await check(c);
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      'quote not found in RFC §2.1 ("Authorization Request"): "Its value MUST be an absolute URI',
    );
  });

  test("a vector's value that is not in its section", async () => {
    const c = clone();
    (c.clauses[0] as { expect: unknown }).expect = { str: "invalid_scope" };
    const r = await check(c);
    expect(r.code).toBe(1);
    expect(r.out).toContain('"invalid_scope"');
  });

  test("completeness counts the <bcp14> MUST NOT left out", async () => {
    const c = clone();
    c.exclusions = [];
    const r = await check(c);
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      'MUST NOT sentence is neither a requirement nor an exclusion: "The URI MUST NOT include a fragment component."',
    );
    // Its SHOULDs and MAYs bind nothing.
    expect(r.out).not.toContain("SHOULD sentence");
    expect(r.out).not.toContain("MAY sentence");
  });

  /** A small RFC XML document: section 1, then an unnumbered section. */
  const xml = (body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9990" docName="x" category="std" ipr="trust200902" version="3">
<front><title>X</title></front>
<middle>
<section anchor="one"><name>One</name>
${body}
<t>A writer <bcp14>MAY</bcp14> rest.</t>
</section>
<section numbered="false"><name>Note</name>
<t>A reader <bcp14>MUST</bcp14> read this note.</t>
</section>
</middle>
</rfc>
`;
  // A contract of valid shape; only its exclusion matters here.
  const contract = (quote: string): RfcContract => ({
    contract: "x",
    source: { title: "X", main: "x" },
    sources: [{ id: "x", path: "x.xml" }],
    target: { module: "nish/x" },
    functions: [{ name: "f", params: [], returns: "string" }],
    requirements: [
      { id: "R", section: "1", level: "MAY", quote: "A writer MAY rest." },
    ],
    exclusions: [{ section: "1", quote, reason: "r" }],
    clauses: [
      {
        kind: "vector",
        id: "V",
        title: "v",
        covers: ["R"],
        source: { cite: { section: "1" } },
        call: "f",
        args: [],
        expect: { str: "rest" },
      },
    ],
  });
  const gates = (body: string, quote: string) => {
    const d = tmp();
    write(d, "x.xml", xml(body));
    const c = contract(quote);
    const { docs } = loadSources(c, join(d, "c.json"));
    return runGates(c, { docs }).issues.map((i) => i.message);
  };

  test("a MUST outside every numbered section, and one a quote covers", () => {
    const issues = gates(
      "<t>A writer <bcp14>SHALL</bcp14> write.</t>",
      "A writer SHALL write.",
    );
    expect(issues).toContain(
      'MUST sentence is outside every numbered section, so it can be neither a requirement nor an exclusion: "A reader MUST read this note."',
    );
    expect(issues.filter((m) => m.includes("SHALL"))).toEqual([]);
  });

  test("a quote must cover the keyword, not only touch the sentence", () => {
    const issues = gates(
      "<t>A writer <bcp14>SHALL</bcp14> write.</t>",
      "write.",
    );
    expect(issues).toContain(
      'SHALL sentence is neither a requirement nor an exclusion: "A writer SHALL write."',
    );
  });
});

describe("completeness tells each <bcp14> keyword in a sentence apart", () => {
  /** An RFC XML document of section 1 holding `blocks`. */
  const xml = (blocks: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9990" docName="x" category="std" ipr="trust200902" version="3">
<front><title>X</title></front>
<middle>
<section anchor="one"><name>One</name>
${blocks}
<t>A writer <bcp14>MAY</bcp14> rest.</t>
</section>
</middle>
</rfc>
`;
  /** The completeness issues when a requirement quotes `quote`. */
  const uncoveredIn = (blocks: string, quote: string) => {
    const d = tmp();
    write(d, "x.xml", xml(blocks));
    const c: RfcContract = {
      contract: "x",
      source: { title: "X", main: "x" },
      sources: [{ id: "x", path: "x.xml" }],
      target: { module: "nish/x" },
      functions: [{ name: "f", params: [], returns: "string" }],
      requirements: [
        { id: "R", section: "1", level: "MAY", quote: "A writer MAY rest." },
        { id: "Q", section: "1", level: "MUST", quote },
      ],
      clauses: [
        {
          kind: "vector",
          id: "V",
          title: "v",
          covers: ["R", "Q"],
          source: { cite: { section: "1" } },
          call: "f",
          args: [],
          expect: { str: "rest" },
        },
      ],
    };
    const { docs } = loadSources(c, join(d, "c.json"));
    return runGates(c, { docs })
      .issues.filter((i) => i.gate === "completeness")
      .map((i) => i.message);
  };
  /** As uncoveredIn, with section 1 holding the paragraph `body`. */
  const uncovered = (body: string, quote: string) =>
    uncoveredIn(`<t>${body}</t>`, quote);
  const neither = (keyword: string, sentence: string) =>
    `${keyword} sentence is neither a requirement nor an exclusion: ${JSON.stringify(sentence)}`;

  const TWO =
    "A writer <bcp14>MUST NOT</bcp14> do A and <bcp14>MUST</bcp14> do B.";
  const TWO_TEXT = "A writer MUST NOT do A and MUST do B.";
  test("two keywords: a quote of the first does not cover the second", () => {
    expect(uncovered(TWO, "A writer MUST NOT do A")).toEqual([
      neither("MUST", TWO_TEXT),
    ]);
    expect(uncovered(TWO, "and MUST do B.")).toEqual([
      neither("MUST NOT", TWO_TEXT),
    ]);
    expect(uncovered(TWO, TWO_TEXT)).toEqual([]);
  });

  const TWICE =
    "A writer <bcp14>MUST</bcp14> do A and <bcp14>MUST</bcp14> do B.";
  const TWICE_TEXT = "A writer MUST do A and MUST do B.";
  test("the same keyword twice: a quote must cover each", () => {
    expect(uncovered(TWICE, "A writer MUST do A")).toEqual([
      neither("MUST", TWICE_TEXT),
    ]);
    expect(uncovered(TWICE, "and MUST do B.")).toEqual([
      neither("MUST", TWICE_TEXT),
    ]);
    expect(uncovered(TWICE, TWICE_TEXT)).toEqual([]);
  });

  const QUOTED =
    'The "MUST" label and the MUSTER field: a writer <bcp14>MUST</bcp14> set it.';
  const QUOTED_TEXT =
    'The "MUST" label and the MUSTER field: a writer MUST set it.';
  test("the keyword's text inside a quoted or longer word is not it", () => {
    expect(uncovered(QUOTED, "a writer MUST set it.")).toEqual([]);
    expect(uncovered(QUOTED, 'The "MUST" label and the MUSTER field:')).toEqual(
      [neither("MUST", QUOTED_TEXT)],
    );
  });

  test("a keyword its markup marks but the text runs on from is reported", () => {
    // "MUSTn't" is not a keyword as used, so nothing locates it and no quote
    // can cover it: it is reported rather than passed.
    expect(
      uncovered(
        "A writer <bcp14>MUST</bcp14>n't stop.",
        "A writer MUSTn't stop.",
      ),
    ).toEqual([neither("MUST", "A writer MUSTn't stop.")]);
  });

  const X = "The server <bcp14>MUST NOT</bcp14> send X.";
  const X_TEXT = "The server MUST NOT send X.";
  test("a sentence said twice: a quote of one occurrence covers it alone", () => {
    // In a paragraph and then a list item: quoting the paragraph's sentence
    // (with what follows it there) leaves the list item's uncovered.
    expect(
      uncoveredIn(
        `<t>${X} Then more.</t><ul><li>${X}</li></ul>`,
        `${X_TEXT} Then more.`,
      ),
    ).toEqual([neither("MUST NOT", X_TEXT)]);
    // In two paragraphs, and in a paragraph and a table cell.
    expect(
      uncoveredIn(`<t>${X} Then more.</t><t>${X}</t>`, `${X_TEXT} Then more.`),
    ).toEqual([neither("MUST NOT", X_TEXT)]);
    expect(
      uncoveredIn(
        `<t>${X} Then more.</t><table><tbody><tr><td>${X}</td></tr></tbody></table>`,
        `${X_TEXT} Then more.`,
      ),
    ).toEqual([neither("MUST NOT", X_TEXT)]);
    // Twice in one paragraph, with the second quoted.
    expect(uncoveredIn(`<t>${X} ${X}</t>`, `X. ${X_TEXT}`)).toEqual([
      neither("MUST NOT", X_TEXT),
    ]);
  });

  test("a copy in <artwork> or <sourcecode> is not an occurrence", () => {
    // The copy comes first: the marked paragraph's quote covers its keyword.
    const ART = `<artwork>${X_TEXT}</artwork>`;
    expect(
      uncoveredIn(`${ART}<t>${X} Then more.</t>`, `${X_TEXT} Then more.`),
    ).toEqual([]);
    // Quoting the copy alone does not cover the marked paragraph.
    const OUT = `<sourcecode>Out: ${X_TEXT}</sourcecode>`;
    expect(uncoveredIn(`${OUT}<t>${X}</t>`, `Out: ${X_TEXT}`)).toEqual([
      neither("MUST NOT", X_TEXT),
    ]);
  });

  test("a copy in a paragraph with no <bcp14> is not the one to quote", () => {
    // The reader records which paragraph is marked, so quoting it is
    // enough, and quoting only the unmarked copy covers nothing.
    const UNMARKED = `<t>${X_TEXT}</t><t>${X} Then more.</t>`;
    expect(uncoveredIn(UNMARKED, `${X_TEXT} Then more.`)).toEqual([]);
    expect(
      uncoveredIn(
        `<t>${X} Then more.</t><t>${X_TEXT} Again.</t>`,
        `${X_TEXT} Again.`,
      ),
    ).toEqual([neither("MUST NOT", X_TEXT)]);
  });

  test("a sentence inside a longer one is not one of its occurrences", () => {
    // "Note: The server MUST NOT send X." holds the shorter sentence's text,
    // but is a sentence of its own: quoting it covers it, not the shorter.
    const NOTE = `Note: ${X}`;
    expect(uncoveredIn(`<t>${NOTE}</t><t>${X}</t>`, `Note: ${X_TEXT}`)).toEqual(
      [neither("MUST NOT", X_TEXT)],
    );
    // The shorter text alone is found in both, so covers both keywords.
    expect(uncoveredIn(`<t>${NOTE}</t><t>${X}</t>`, X_TEXT)).toEqual([]);
  });
});

describe("spec frozen flags a changed rfc<N>.xml", () => {
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  const repo = () => {
    const c = clone();
    const p = project(c);
    c.source.sha256 = sha256(Buffer.from(RFC8707));
    c.sources = [rfcDecl(8707, p.contract)];
    writeFileSync(p.contract, JSON.stringify(c));
    git(p.d, "init", "-q");
    git(p.d, "config", "user.email", "t@example.com");
    git(p.d, "config", "user.name", "t");
    git(p.d, "config", "commit.gpgsign", "false");
    git(p.d, "add", "-A");
    git(p.d, "commit", "-qm", "c");
    return p.d;
  };
  const problem = (d: string) =>
    frozenCheck({ repo: d, base: "HEAD" }).contracts[0].problem;

  test("unchanged: no problem", () => {
    expect(problem(repo())).toBeUndefined();
  });

  test("changed: the spec changed under the contract", () => {
    const d = repo();
    write(d, "rfcs/rfc8707.xml", `${RFC8707}\n`);
    expect(problem(d)).toStartWith(
      `its main source ${join(d, "contracts/../rfcs/rfc8707.xml")} has sha256 `,
    );
  });
});
