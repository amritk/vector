import { afterAll, describe, expect, spyOn, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rfcMain } from "../src/rfc/cli.ts";
import type { RfcContract } from "../src/rfc/contract.ts";
import { gateRefusals } from "../src/rfc/extract.ts";
import { VECTOR_ROOT } from "../src/rfc/frozen.ts";
import { locate, shapeRefusals } from "../src/rfc/profile.ts";

// A refusal at a markdown line names the markdown file the XML was built
// from (specs/<name>.md beside specs/<name>.xml); one with no markdown line,
// or with no such file on disk, names the XML at its XML line.

const FIXTURE = join(VECTOR_ROOT, "test/fixtures/extract/extract-mini");
const MINI = readFileSync(`${FIXTURE}.xml`, "utf8");
const MINI_MD = readFileSync(`${FIXTURE}.md`, "utf8");

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** specs/<name>.xml and its .md, contracts/, and rfcs/, as vector lays out. */
const tree = (xml: string, md: string | undefined, name = "extract-mini") => {
  const d = mkdtempSync(join(tmpdir(), "vector-md-path-"));
  dirs.push(d);
  mkdirSync(join(d, "specs"));
  mkdirSync(join(d, "contracts"));
  mkdirSync(join(d, "rfcs"));
  cpSync(join(VECTOR_ROOT, "rfcs/rfc4648.txt"), join(d, "rfcs/rfc4648.txt"));
  const xmlPath = join(d, `specs/${name}.xml`);
  const mdPath = join(d, `specs/${name}.md`);
  writeFileSync(xmlPath, xml);
  if (md !== undefined) writeFileSync(mdPath, md);
  return { d, xml: xmlPath, md: mdPath };
};

/** `vector spec extract <xml>`: its exit code and its stderr lines. */
async function extract(xml: string) {
  const err: string[] = [];
  const stdout = spyOn(process.stdout, "write").mockImplementation(() => true);
  const log = spyOn(console, "log").mockImplementation(() => {});
  const error = spyOn(console, "error").mockImplementation((...a) => {
    err.push(a.join(" "));
  });
  try {
    const code = await rfcMain(["extract", xml]);
    return { code, err: err.join("\n").split("\n") };
  } finally {
    stdout.mockRestore();
    log.mockRestore();
    error.mockRestore();
  }
}

/** The line `n` (from 1) of the text `s`. */
const lineAt = (s: string, n: number): string => s.split("\n")[n - 1];

/** Each `file:line` refusal's file and line. */
const at = (lines: string[]) =>
  lines.map((l) => {
    const m = l.match(/^(.*?):(\d+): /);
    if (!m) throw new Error(`not file:line: ${l}`);
    return { file: m[1], line: Number(m[2]) };
  });

describe("an XML reader refusal", () => {
  test("names the markdown at its line when the .md is beside the XML", async () => {
    const t = tree('<?xml version="1.0"?>\n<?line 10?>\n<foo/>\n', "", "bad");
    const r = await extract(t.xml);
    expect(r.code).toBe(1);
    expect(r.err).toEqual([
      `${t.md}:11: not RFC XML: the root element is <foo>, not <rfc>`,
    ]);
  });

  test("names the XML at its XML line when the XML has no markdown line", async () => {
    const t = tree('<?xml version="1.0"?>\n\n<foo/>\n', "", "bad");
    const r = await extract(t.xml);
    expect(r.err).toEqual([
      `${t.xml}:3: not RFC XML: the root element is <foo>, not <rfc>`,
    ]);
  });

  test("names the XML at its XML line when there is no .md beside it", async () => {
    const t = tree('<?xml version="1.0"?>\n<?line 10?>\n<foo/>\n', undefined);
    const r = await extract(t.xml);
    expect(r.err).toEqual([
      `${t.xml}:3: not RFC XML: the root element is <foo>, not <rfc>`,
    ]);
  });
});

/**
 * The refusals of `xml` with its .md beside it and without, each as file and
 * line, the same refusals in the same order.
 */
async function both(xml: string, name = "extract-mini") {
  const withMd = tree(xml, MINI_MD, name);
  const withoutMd = tree(xml, undefined, name);
  const a = await extract(withMd.xml);
  const b = await extract(withoutMd.xml);
  expect(a.code).toBe(1);
  expect(b.code).toBe(1);
  const strip = (ls: string[]) => ls.map((l) => l.replace(/^.*?:\d+: /, ""));
  expect(strip(a.err)).toEqual(strip(b.err));
  return { md: at(a.err), xml: at(b.err), withMd, withoutMd };
}

// extract-mini.xml's `<?line N?>` instructions put its middle 9 lines above
// the XML's own count, and its tables further on (one XML line per cell).

describe("a profile refusal", () => {
  test("at a markdown line names the .md; with no .md, the XML at its line", async () => {
    const xml = MINI.replace(' anchor="R-ENC-DIGITS"', "");
    const r = await both(xml);
    expect(r.md.every((w) => w.file === r.withMd.md)).toBe(true);
    expect(r.xml.every((w) => w.file === r.withoutMd.xml)).toBe(true);
    expect(r.md.map((w) => w.line)).toEqual(r.xml.map((w) => w.line - 9));
    expect(lineAt(xml, r.xml[0].line)).toContain("Each byte <bcp14>MUST");
  });

  test("in a ts-interface block is at the line in the block, in either file", async () => {
    const bad = "export const hexDecode = (text: string): u8[] | null";
    const xml = MINI.replace(bad, `${bad} junk`);
    const r = await both(xml);
    expect(r.md[0]).toEqual({ file: r.withMd.md, line: 40 });
    expect(r.xml[0]).toEqual({ file: r.withoutMd.xml, line: 49 });
    expect(lineAt(xml, 49)).toBe(`${bad} junk`);
    // The functions the gates name are at their lines in the block too.
    expect(r.md.map((w) => w.line)).toEqual(r.xml.map((w) => w.line - 9));
  });

  test("at the root, which has no markdown line, names the XML", async () => {
    const t = tree(MINI, MINI_MD, "other");
    const r = await extract(t.xml);
    expect(r.err).toEqual([
      `${t.xml}:10: docName "draft-extract-mini-00" names contract "extract-mini", but the file is other.xml`,
    ]);
  });
});

describe("a gate refusal", () => {
  test("at a markdown line names the .md; with no .md, the XML at its line", async () => {
    const broken = MINI.replace(
      'hexDecode("666F6F")</tt>',
      'hexDecode("666F6E")</tt>',
    );
    const r = await both(broken);
    expect(r.md).toEqual([{ file: r.withMd.md, line: 180 }]);
    expect(r.xml).toEqual([{ file: r.withoutMd.xml, line: 189 }]);
    expect(lineAt(broken, 190)).toContain(">V3<");
  });

  test("of the sidecar still names the sidecar", async () => {
    const t = tree(MINI, MINI_MD);
    const side = join(t.d, "contracts/extract-mini.survivors.json");
    writeFileSync(side, JSON.stringify({ allowSurvivors: [{ line: 3 }] }));
    const r = await extract(t.xml);
    expect(r.code).toBe(1);
    expect(r.err).toEqual([
      `${side}: shape: allowSurvivors[0].file: a non-empty string`,
      `${side}: shape: allowSurvivors[0].reason: a non-empty string`,
    ]);
  });
});

describe("a locator's files", () => {
  const locator = {
    file: "s.xml",
    root: 1,
    at: { V1: 7, V2: 9 },
    files: { V2: "s.md" },
  };

  test("locate names a part's own file, else the locator's", () => {
    expect(locate(locator, "V2.expect")).toEqual({ file: "s.md", line: 9 });
    expect(locate(locator, "V1.expect")).toEqual({ file: "s.xml", line: 7 });
    expect(locate(locator, "")).toEqual({ file: "s.xml", line: 1 });
  });

  test("gateRefusals prints each at its own file", () => {
    const fidelity = (at: string) => ({
      gate: "fidelity" as const,
      at,
      message: "1-byte value is not printed in §6",
    });
    expect(
      gateRefusals(
        [fidelity("V2.expect"), fidelity("V1.call")],
        locator,
        "c.survivors.json",
      ),
    ).toEqual([
      "s.xml:7: fidelity: 1-byte value is not printed in §6",
      "s.md:9: fidelity: 1-byte value is not printed in §6",
    ]);
  });
});

describe("shapeRefusals", () => {
  test("names the markdown at a markdown line, else the XML at its line", () => {
    const broken = {
      contract: "x",
      requirements: [{ id: "" }],
    } as unknown as RfcContract;
    const locs = {
      requirements: [{ xmlLine: 5, mdLine: 50 }],
      exclusions: [],
      clauses: [],
      functions: [],
    };
    const root = { xmlLine: 1 };
    const md = shapeRefusals(broken, "f.xml", root, locs, "f.md");
    expect(md.find((r) => r.file === "f.md")?.line).toBe(50);
    expect(md.find((r) => r.file === "f.xml")?.line).toBe(1);
    // Without the markdown file, the same issue is at its XML line.
    const xml = shapeRefusals(broken, "f.xml", root, locs);
    expect(xml.every((r) => r.file === "f.xml")).toBe(true);
    expect(xml.map((r) => r.line)).toContain(5);
  });
});
