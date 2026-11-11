import { afterAll, describe, expect, spyOn, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { rfcMain } from "../src/rfc/cli.ts";
import {
  CONTRACT_KEYS,
  canonicalJson,
  defaultContractPath,
  survivorsPath,
  unifiedDiff,
} from "../src/rfc/extract.ts";
import { VECTOR_ROOT } from "../src/rfc/frozen.ts";

// `vector spec extract`: a kramdown-rfc spec's XML → its canonical contract.
// The fixture test/fixtures/extract/extract-mini.md is specs/example-hex.md
// without V5, its one byte-list vector, built with scripts/build-spec.sh.

const MINI_XML = join(VECTOR_ROOT, "test/fixtures/extract/extract-mini.xml");
const MINI = readFileSync(MINI_XML, "utf8");

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const write = (d: string, rel: string, s: string) => {
  mkdirSync(dirname(join(d, rel)), { recursive: true });
  writeFileSync(join(d, rel), s);
};
/** A tree shaped like vector's: specs/<name>.xml, contracts/, and rfcs/. */
const tree = (xml = MINI, name = "extract-mini", rfcs = true) => {
  const d = mkdtempSync(join(tmpdir(), "vector-extract-"));
  dirs.push(d);
  write(d, `specs/${name}.xml`, xml);
  mkdirSync(join(d, "contracts"));
  if (rfcs)
    cpSync(join(VECTOR_ROOT, "rfcs/rfc4648.txt"), join(d, "rfcs/rfc4648.txt"));
  return {
    d,
    xml: join(d, `specs/${name}.xml`),
    out: join(d, `contracts/${name}.json`),
  };
};

/** Runs `vector spec …`, capturing stdout and stderr. */
async function cli(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const stdout = spyOn(process.stdout, "write").mockImplementation((s) => {
    out.push(String(s));
    return true;
  });
  const log = spyOn(console, "log").mockImplementation((...a) => {
    out.push(`${a.join(" ")}\n`);
  });
  const error = spyOn(console, "error").mockImplementation((...a) => {
    err.push(a.join(" "));
  });
  try {
    const code = await rfcMain(argv);
    return { code, out: out.join(""), err: err.join("\n") };
  } finally {
    stdout.mockRestore();
    log.mockRestore();
    error.mockRestore();
  }
}

describe("canonicalJson", () => {
  test("2-space indent, \\n, a trailing newline; empties stay inline", () => {
    expect(canonicalJson({})).toBe("{}\n");
    expect(canonicalJson([])).toBe("[]\n");
    expect(canonicalJson("x")).toBe('"x"\n');
    expect(canonicalJson({ a: { b: [], c: {} }, d: null })).toBe(
      '{\n  "a": {\n    "b": [],\n    "c": {}\n  },\n  "d": null\n}\n',
    );
  });

  test("an array of primitives is inline while its line, comma included, fits in 80", () => {
    // `  "k": [` is 8 wide and `]` 1: 71 characters of elements fit.
    const fits = ["x".repeat(69)]; // "…" adds 2: 8 + 71 + 1 = 80
    expect(canonicalJson({ k: fits })).toBe(
      `{\n  "k": ${JSON.stringify(fits)}\n}\n`,
    );
    // The same array followed by a key needs a comma: 81 is too wide.
    expect(canonicalJson({ k: fits, z: 1 })).toBe(
      `{\n  "k": [\n    ${JSON.stringify(fits[0])}\n  ],\n  "z": 1\n}\n`,
    );
    const over = ["x".repeat(70)];
    expect(canonicalJson({ k: over })).toContain('"k": [\n');
  });

  test("width is counted in characters, not UTF-16 units or bytes", () => {
    // 69 astral characters are 138 UTF-16 units, but 69 characters wide.
    const astral = ["𝔵".repeat(69)];
    expect(canonicalJson({ k: astral })).toBe(
      `{\n  "k": ${JSON.stringify(astral)}\n}\n`,
    );
  });

  test("an array of objects, or of arrays, is one element per line", () => {
    expect(canonicalJson([{ a: 1 }, [1, 2]])).toBe(
      '[\n  {\n    "a": 1\n  },\n  [1, 2]\n]\n',
    );
    // An element's width counts its own comma.
    const inner = ["y".repeat(71)]; // 2 + 75 + 1 (comma) = 78: fits
    expect(canonicalJson([inner, 1])).toBe(
      `[\n  ${JSON.stringify(inner)},\n  1\n]\n`,
    );
  });

  test("every committed contract is in canonical form", () => {
    const dir = join(VECTOR_ROOT, "contracts");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(2);
    for (const f of files) {
      const text = readFileSync(join(dir, f), "utf8");
      expect(canonicalJson(JSON.parse(text)), f).toBe(text);
    }
  });

  test("the key order starts with $schema and ends with allowSurvivors", () => {
    expect(CONTRACT_KEYS[0]).toBe("$schema");
    expect(CONTRACT_KEYS.at(-1)).toBe("allowSurvivors");
  });
});

describe("unifiedDiff", () => {
  const lines = (n: number) =>
    `${Array.from({ length: n }, (_, i) => `l${i + 1}`).join("\n")}\n`;

  test("equal texts have no diff", () => {
    expect(unifiedDiff("a\n", "a\n", "x", "y")).toBe("");
  });

  test("a missing file is all added lines", () => {
    expect(unifiedDiff("", "a\nb\n", "x", "y")).toBe(
      "--- x\n+++ y\n@@ -0,0 +1,2 @@\n+a\n+b\n",
    );
    expect(unifiedDiff("a\n", "", "x", "y")).toBe(
      "--- x\n+++ y\n@@ -1,1 +0,0 @@\n-a\n",
    );
  });

  test("one change, with three lines of context either side", () => {
    const b = lines(10).replace("l5\n", "five\n");
    expect(unifiedDiff(lines(10), b, "x", "y")).toBe(
      [
        "--- x",
        "+++ y",
        "@@ -2,7 +2,7 @@",
        " l2",
        " l3",
        " l4",
        "-l5",
        "+five",
        " l6",
        " l7",
        " l8",
        "",
      ].join("\n"),
    );
  });

  test("changes up to six lines apart share a hunk; seven apart do not", () => {
    const near = lines(20).replace("l3\n", "c\n").replace("l10\n", "d\n");
    expect(unifiedDiff(lines(20), near, "x", "y").match(/^@@/gm)).toHaveLength(
      1,
    );
    const far = lines(20).replace("l3\n", "c\n").replace("l11\n", "d\n");
    const diff = unifiedDiff(lines(20), far, "x", "y");
    expect(diff.match(/^@@.*$/gm)).toEqual([
      "@@ -1,6 +1,6 @@",
      "@@ -8,7 +8,7 @@",
    ]);
  });

  test("an insertion and a deletion count their sides", () => {
    const b = lines(4).replace("l2\n", "l2\nnew\n").replace("l4\n", "");
    expect(unifiedDiff(lines(4), b, "x", "y")).toBe(
      "--- x\n+++ y\n@@ -1,4 +1,4 @@\n l1\n l2\n+new\n l3\n-l4\n",
    );
  });
});

describe("paths", () => {
  test("the default contract is contracts/<name>.json beside specs/", () => {
    expect(defaultContractPath(join("a", "specs", "x.xml"))).toBe(
      join("a", "contracts", "x.json"),
    );
  });

  test("the allowSurvivors sidecar is specs/<name>.survivors.json", () => {
    expect(survivorsPath(join("a", "specs", "x.xml"))).toBe(
      join("a", "specs", "x.survivors.json"),
    );
  });
});

describe("vector spec extract", () => {
  test("a .md spec: build it first, and nothing is run", async () => {
    const r = await cli(["extract", "specs/example-hex.md"]);
    expect(r.code).toBe(2);
    expect(r.err).toBe(
      "build it first: scripts/build-spec.sh specs/example-hex.md",
    );
    expect(r.out).toBe("");
  });

  test("usage errors exit 2", async () => {
    let r = await cli(["extract", "spec.txt"]);
    expect(r.code).toBe(2);
    expect(r.err).toBe(
      "error: extract reads an RFC XML v3 spec (.xml), not spec.txt",
    );
    r = await cli(["extract", MINI_XML, "--check"]);
    expect(r.code).toBe(2);
    expect(r.err).toBe("error: --check needs -o <contract.json>");
    r = await cli(["extract", join(tmpdir(), "vector-no-such-spec.xml")]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("error: cannot read ");
  });

  test("no -o writes the contract to stdout, byte-identical across runs", async () => {
    const a = await cli(["extract", MINI_XML]);
    const b = await cli(["extract", MINI_XML]);
    expect(a.code).toBe(0);
    expect(a.err).toBe("");
    expect(b.out).toBe(a.out);
    expect(canonicalJson(JSON.parse(a.out))).toBe(a.out);
    const c = JSON.parse(a.out);
    expect(Object.keys(c)).toEqual([
      "$schema",
      "contract",
      "source",
      "sources",
      "target",
      "requirements",
      "exclusions",
      "functions",
      "clauses",
    ]);
    expect(c.$schema).toBe("../schemas/rfc-contract.json");
    const digest = new Bun.CryptoHasher("sha256").update(MINI).digest("hex");
    expect(c.source).toEqual({
      title: "Extract fixture: nish/hex without a byte-list vector",
      main: "extract-mini",
      sha256: digest,
    });
    // vector's own rfcs/ is no place of the contract's: no path.
    expect(c.sources[1]).toEqual({
      id: "rfc4648",
      rfc: 4648,
      file: "rfcs/rfc4648.txt",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  test("-o writes the file; an RFC in the rfcs/ beside contracts/ gets a path", async () => {
    const t = tree();
    const r = await cli(["extract", t.xml, "-o", t.out]);
    expect(r.code).toBe(0);
    const c = JSON.parse(readFileSync(t.out, "utf8"));
    expect(Object.keys(c.sources[1])).toEqual([
      "id",
      "rfc",
      "path",
      "file",
      "sha256",
    ]);
    expect(c.sources[1].path).toBe("../rfcs/rfc4648.txt");
    expect(c.sources[0].path).toBe("../specs/extract-mini.xml");
    // The written contract checks against its spec.
    const check = await cli(["check", t.out]);
    expect(check.code, check.out).toBe(0);
  });

  test("--check: 0 when up to date, else 1 with a unified diff", async () => {
    const t = tree();
    let r = await cli(["extract", t.xml, "-o", t.out, "--check"]);
    expect(r.code).toBe(1);
    expect(r.out).toStartWith(
      `--- ${t.out}\n+++ ${t.out} (extracted from ${t.xml})\n@@ -0,0 +1,`,
    );
    expect(r.err).toBe(
      `${t.out} is not what ${t.xml} states; run: vector spec extract ${t.xml} -o ${t.out}`,
    );
    expect(() => readFileSync(t.out)).toThrow();

    expect((await cli(["extract", t.xml, "-o", t.out])).code).toBe(0);
    const written = readFileSync(t.out, "utf8");
    r = await cli(["extract", t.xml, "-o", t.out, "--check"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe("");

    writeFileSync(t.out, written.replace('"nish/hex"', '"nish/hex2"'));
    r = await cli(["extract", t.xml, "-o", t.out, "--check"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      '-    "module": "nish/hex2"\n+    "module": "nish/hex"',
    );
    // --check writes nothing.
    expect(readFileSync(t.out, "utf8")).toContain("nish/hex2");
  });

  test("the sidecar's allowSurvivors are merged verbatim, last", async () => {
    const t = tree();
    const { allowSurvivors } = JSON.parse(
      readFileSync(
        join(VECTOR_ROOT, "specs/example-hex.survivors.json"),
        "utf8",
      ),
    );
    const survivors = allowSurvivors.slice(0, 2);
    write(
      t.d,
      "specs/extract-mini.survivors.json",
      JSON.stringify({ allowSurvivors: survivors }),
    );
    const r = await cli(["extract", t.xml]);
    expect(r.code).toBe(0);
    const c = JSON.parse(r.out);
    expect(Object.keys(c).at(-1)).toBe("allowSurvivors");
    expect(c.allowSurvivors).toEqual(survivors);
  });

  test("a sidecar entry the schema refuses is a refusal at the docName", async () => {
    const t = tree();
    write(
      t.d,
      "specs/extract-mini.survivors.json",
      JSON.stringify({ allowSurvivors: [{ line: 3 }] }),
    );
    const r = await cli(["extract", t.xml]);
    expect(r.code).toBe(1);
    expect(r.err).toContain(`${t.xml}:10: shape: allowSurvivors[0]`);
  });

  test("a sidecar that is not JSON, or holds no list, is an error", async () => {
    const t = tree();
    const side = join(t.d, "specs/extract-mini.survivors.json");
    writeFileSync(side, "{");
    let r = await cli(["extract", t.xml]);
    expect(r.code).toBe(2);
    expect(r.err).toStartWith(`error: cannot read ${side}: `);
    writeFileSync(side, "null");
    r = await cli(["extract", t.xml]);
    expect(r.code).toBe(2);
    expect(r.err).toBe(`error: ${side}: expected {"allowSurvivors": [...]}`);
  });

  test("an RFC found nowhere: exit 2, with the command that fetches it", async () => {
    const t = tree(MINI.replaceAll("4648", "9871"), "extract-mini", false);
    const r = await cli(["extract", t.xml]);
    expect(r.code).toBe(2);
    expect(r.err).toContain(
      "rfc9871 not found; fetch it: curl -sSfL -o rfcs/rfc9871.xml https://www.rfc-editor.org/rfc/rfc9871.xml",
    );
    expect(r.out).toBe("");
  });

  test("an RFC that cannot be read is an error, not a missing RFC", async () => {
    const t = tree(MINI, "extract-mini", false);
    mkdirSync(join(t.d, "rfcs/rfc4648.txt"), { recursive: true });
    const r = await cli(["extract", t.xml, "-o", t.out]);
    expect(r.code).toBe(2);
    expect(r.err).toBe(
      `error: ${join(t.d, "rfcs/rfc4648.txt")} is not a regular file`,
    );
  });

  test("the profile's refusals: exit 1, each file:line", async () => {
    const t = tree(MINI, "other");
    const r = await cli(["extract", t.xml]);
    expect(r.code).toBe(1);
    expect(r.err).toBe(
      `${t.xml}:10: docName "draft-extract-mini-00" names contract "extract-mini", but the file is other.xml`,
    );
    expect(r.out).toBe("");
  });

  test("the XML reader's refusal, at the markdown line when the XML has one", async () => {
    let t = tree('<?xml version="1.0"?>\n<?line 10?>\n<foo/>\n', "bad");
    let r = await cli(["extract", t.xml]);
    expect(r.code).toBe(1);
    expect(r.err).toBe(
      `${t.xml}:11: not RFC XML: the root element is <foo>, not <rfc>`,
    );
    t = tree('<?xml version="1.0"?>\n\n<foo/>\n', "bad");
    r = await cli(["extract", t.xml]);
    expect(r.code).toBe(1);
    expect(r.err).toBe(
      `${t.xml}:3: not RFC XML: the root element is <foo>, not <rfc>`,
    );
  });

  test("the gates' refusals: exit 1, all of them, each at its line, once", async () => {
    // V3's argument and V4's, as the RFC never prints them.
    const broken = MINI.replace(
      'hexDecode("666F6F")</tt>',
      'hexDecode("666F6E")</tt>',
    ).replace(
      'hexDecode("666F6F626172")</tt>',
      'hexDecode("666F6F626171")</tt>',
    );
    const t = tree(broken);
    const r = await cli(["extract", t.xml, "-o", t.out]);
    expect(r.code).toBe(1);
    const lines = r.err.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      new RegExp(`^${t.xml}:[0-9]+: fidelity: .*"666F6E"`),
    );
    expect(lines[1]).toMatch(
      new RegExp(`^${t.xml}:[0-9]+: fidelity: .*"666F6F626171"`),
    );
    expect(() => readFileSync(t.out)).toThrow();
  });
});

describe("contracts/example-hex.json", () => {
  test("is what specs/example-hex.xml states", async () => {
    const r = await cli([
      "extract",
      "specs/example-hex.xml",
      "-o",
      "contracts/example-hex.json",
      "--check",
    ]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
  });
});
