import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
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
  gateRefusals,
  survivorsPath,
  unifiedDiff,
} from "../src/rfc/extract.ts";
import { SIDECAR_SUFFIX, VECTOR_ROOT, frozenCheck } from "../src/rfc/frozen.ts";

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

  test("an array that holds an object is one element per line", () => {
    expect(canonicalJson([{ a: 1 }, [1, 2]])).toBe(
      '[\n  {\n    "a": 1\n  },\n  [1, 2]\n]\n',
    );
    // An element's width counts its own comma.
    const inner = ["y".repeat(71)]; // 2 + 75 + 1 (comma) = 78: fits
    expect(canonicalJson([inner, {}])).toBe(
      `[\n  ${JSON.stringify(inner)},\n  {}\n]\n`,
    );
  });

  test("every committed contract is in canonical form", () => {
    const dir = join(VECTOR_ROOT, "contracts");
    const files = readdirSync(dir).filter(
      (f) => f.endsWith(".json") && !f.endsWith(SIDECAR_SUFFIX),
    );
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

describe("canonicalJson, as biome lays out what does not fit", () => {
  test("an array of arrays with no object is inline when it fits", () => {
    expect(canonicalJson({ k: [[1, "a"], [], [null]] })).toBe(
      '{\n  "k": [[1, "a"], [], [null]]\n}\n',
    );
  });

  test("an array of numbers is filled, as many to a line as fit in 80", () => {
    const n = Array.from({ length: 40 }, (_, i) => i);
    // What `biome format` writes for {"a": [0, …, 39]}.
    expect(canonicalJson({ a: n })).toBe(
      [
        "{",
        '  "a": [',
        "    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,",
        "    21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39",
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
    // The last element has no comma, so it fits where a comma would not.
    // As biome writes it: 1234 ends a line at 80, 12345 would not fit.
    const six = Array(6).fill(10 ** 9);
    expect(canonicalJson({ k: [...six, 1234], j: [...six, 12345] })).toBe(
      [
        "{",
        '  "k": [',
        `    ${six.join(", ")}, 1234`,
        "  ],",
        '  "j": [',
        `    ${six.join(", ")},`,
        "    12345",
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
  });

  test("an array of strings or booleans that does not fit is one per line", () => {
    const b = Array.from({ length: 20 }, () => true);
    expect(canonicalJson(b)).toBe(
      `[\n${b.map(() => "  true").join(",\n")}\n]\n`,
    );
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

  test("a missing newline at the end is a change, marked as diff -u marks it", () => {
    expect(unifiedDiff("a\nb", "a\nb\n", "x", "y")).toBe(
      "--- x\n+++ y\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+b\n",
    );
    expect(unifiedDiff("a\n", "a\nb", "x", "y")).toBe(
      "--- x\n+++ y\n@@ -1,1 +1,2 @@\n a\n+b\n\\ No newline at end of file\n",
    );
  });

  test("a long shared start and end are context, not part of the match", () => {
    const a = `${lines(2000)}`;
    const b = a.replace("l1000\n", "mid\n");
    expect(unifiedDiff(a, b, "x", "y")).toBe(
      [
        "--- x",
        "+++ y",
        "@@ -997,7 +997,7 @@",
        " l997",
        " l998",
        " l999",
        "-l1000",
        "+mid",
        " l1001",
        " l1002",
        " l1003",
        "",
      ].join("\n"),
    );
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

  test("the allowSurvivors sidecar is contracts/<name>.survivors.json", () => {
    expect(survivorsPath(join("a", "contracts", "x.json"))).toBe(
      join("a", "contracts", "x.survivors.json"),
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
    r = await cli(["check", "c.json", "--check"]);
    expect(r.code).toBe(2);
    expect(r.err).toBe("error: --check is for extract");
    // -o is overwritten, so it is never the spec or a sidecar.
    r = await cli(["extract", MINI_XML, "-o", MINI_XML]);
    expect(r.code).toBe(2);
    expect(r.err).toBe(`error: -o ${MINI_XML} is the spec extract reads`);
    r = await cli(["extract", MINI_XML, "-o", "contracts/x.survivors.json"]);
    expect(r.code).toBe(2);
    expect(r.err).toBe(
      "error: -o contracts/x.survivors.json is an allowSurvivors sidecar, not a contract",
    );
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
    // Named from where the contract would be written: test/fixtures/contracts.
    expect(c.$schema).toBe("../../../schemas/rfc-contract.json");
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

  test("the spec's path is from where -o writes the contract", async () => {
    const t = tree();
    const out = join(t.d, "deep/dir/c.json");
    mkdirSync(dirname(out), { recursive: true });
    const r = await cli(["extract", t.xml, "-o", out]);
    expect(r.code, r.err).toBe(0);
    const c = JSON.parse(readFileSync(out, "utf8"));
    expect(c.sources[0].path).toBe("../../specs/extract-mini.xml");
    const check = await cli(["check", out]);
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
        join(VECTOR_ROOT, "contracts/example-hex.survivors.json"),
        "utf8",
      ),
    );
    const survivors = allowSurvivors.slice(0, 2);
    write(
      t.d,
      "contracts/extract-mini.survivors.json",
      JSON.stringify({ allowSurvivors: survivors }),
    );
    const r = await cli(["extract", t.xml]);
    expect(r.code).toBe(0);
    const c = JSON.parse(r.out);
    expect(Object.keys(c).at(-1)).toBe("allowSurvivors");
    expect(c.allowSurvivors).toEqual(survivors);
  });

  test("a sidecar entry the schema refuses is a refusal that names the sidecar", async () => {
    const t = tree();
    write(
      t.d,
      "contracts/extract-mini.survivors.json",
      JSON.stringify({ allowSurvivors: [{ line: 3 }] }),
    );
    const r = await cli(["extract", t.xml]);
    expect(r.code).toBe(1);
    const side = join(t.d, "contracts/extract-mini.survivors.json");
    expect(r.err.split("\n")).toEqual([
      `${side}: shape: allowSurvivors[0].file: a non-empty string`,
      `${side}: shape: allowSurvivors[0].reason: a non-empty string`,
    ]);
  });

  test("a sidecar that is not JSON, or holds no list, is an error", async () => {
    const t = tree();
    const side = join(t.d, "contracts/extract-mini.survivors.json");
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

  test("a cited RFC's malformed XML is an error naming its file, not a refusal", async () => {
    const t = tree(MINI.replaceAll("4648", "9871"), "extract-mini", false);
    write(t.d, "rfcs/rfc9871.xml", '<?xml version="1.0"?>\n<foo/>\n');
    const r = await cli(["extract", t.xml]);
    expect(r.code).toBe(2);
    expect(r.err).toBe(
      `error: ${join(t.d, "rfcs/rfc9871.xml")}:2: not RFC XML: the root element is <foo>, not <rfc>`,
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

describe("gateRefusals", () => {
  const locator = { file: "s.xml", root: 1, at: { V1: 7, V2: 9 } };
  test("each refusal once, sorted by line; the sidecar's last, by its file", () => {
    const fidelity = (at: string) => ({
      gate: "fidelity" as const,
      at,
      message: "1-byte value is not printed in §6",
    });
    expect(
      gateRefusals(
        [
          {
            gate: "shape",
            at: "",
            message: 'allowSurvivors[0]: missing "file"',
          },
          fidelity("V2.expect"),
          // Two fields of V1 break one rule on its one line: printed once.
          fidelity("V1.call"),
          fidelity("V1.expect"),
          { gate: "shape", at: "", message: "the root" },
        ],
        locator,
        "c.survivors.json",
      ),
    ).toEqual([
      "s.xml:1: shape: the root",
      "s.xml:7: fidelity: 1-byte value is not printed in §6",
      "s.xml:9: fidelity: 1-byte value is not printed in §6",
      'c.survivors.json: shape: allowSurvivors[0]: missing "file"',
    ]);
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

  test("two extracts of specs/example-hex.xml are byte-identical, and the committed file", async () => {
    const a = await cli(["extract", "specs/example-hex.xml"]);
    const b = await cli(["extract", "specs/example-hex.xml"]);
    expect(a.err).toBe("");
    expect(a.code).toBe(0);
    expect(b.out).toBe(a.out);
    expect(a.out).toBe(
      readFileSync(join(VECTOR_ROOT, "contracts/example-hex.json"), "utf8"),
    );
  });
});

describe("spec frozen and the sidecar", () => {
  test("contracts/*.survivors.json is not globbed as a contract", async () => {
    const t = tree();
    write(
      t.d,
      "contracts/extract-mini.survivors.json",
      readFileSync(
        join(VECTOR_ROOT, "contracts/example-hex.survivors.json"),
        "utf8",
      ),
    );
    expect((await cli(["extract", t.xml, "-o", t.out])).code).toBe(0);
    for (const args of [
      ["init", "-q"],
      ["add", "-A"],
      [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.com",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        "c",
      ],
    ])
      expect(spawnSync("git", args, { cwd: t.d }).status).toBe(0);
    const r = frozenCheck({ repo: t.d, base: "HEAD" });
    expect(r.contracts.map((c) => c.path)).toEqual([
      join(t.d, "contracts/extract-mini.json"),
    ]);
    expect(r.problems).toEqual([]);
  });
});
