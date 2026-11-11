import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import hexContract from "../contracts/example-hex.json";
import hkdfContract from "../contracts/rfc5869-hkdf-sha256.json";
import { rfcMain } from "../src/rfc/cli.ts";
import type {
  PropertyClause,
  RfcContract,
  VectorClause,
} from "../src/rfc/contract.ts";
import { VECTOR_ROOT } from "../src/rfc/frozen.ts";
import { runGates } from "../src/rfc/gates.ts";
import { parseRfc } from "../src/rfc/rfctext.ts";
import { makeScratch } from "../src/rfc/scratch.ts";
import { parseV3 } from "../src/rfc/xmlv3.ts";

// The acceptance contract: `contracts/example-hex.json`, extracted from
// `specs/example-hex.xml` (built from `specs/example-hex.md`), against the Nish reference implementation in
// `test/fixtures/nish-hex/hex.ts`. Every gate passes on the contract as
// committed, and each one refuses a copy of it with one thing broken.

const hex = hexContract as unknown as RfcContract;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const FIXTURE = join(VECTOR_ROOT, "test/fixtures/nish-hex/hex.ts");
const CONTRACT = join(VECTOR_ROOT, "contracts/example-hex.json");
const MOD = "std/hex.ts";
const fixture = readFileSync(FIXTURE, "utf8");

const dirs: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const write = (d: string, rel: string, s: string) => {
  mkdirSync(dirname(join(d, rel)), { recursive: true });
  writeFileSync(join(d, rel), s);
};
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const repo = (p: string) => {
  const d = tmp(p);
  git(d, "init", "-q");
  git(d, "config", "user.email", "t@example.com");
  git(d, "config", "user.name", "t");
  git(d, "config", "commit.gpgsign", "false");
  return d;
};
const commit = (d: string, msg = "c") => {
  git(d, "add", "-A");
  git(d, "commit", "-qm", msg, "--allow-empty");
};

/** Runs the CLI, capturing what it prints. */
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
    const code = await rfcMain(argv);
    return { code, out: out.join("\n"), err: err.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

/**
 * A tree shaped like vector's — specs/, rfcs/, contracts/ — holding the
 * contract (or a broken copy), so its relative source paths resolve.
 */
function tree(c: RfcContract = hex, p = "vector-hex-"): string {
  const d = tmp(p);
  for (const f of ["specs/example-hex.xml", "rfcs/rfc4648.txt"])
    write(d, f, readFileSync(join(VECTOR_ROOT, f), "utf8"));
  write(d, "contracts/example-hex.json", `${JSON.stringify(c, null, 2)}\n`);
  return d;
}

interface Issue {
  gate: string;
  at: string;
  message: string;
}
interface CheckJson {
  status: string;
  issues: Issue[];
  warnings: { at: string; message: string }[];
  sources?: Record<string, { outcome: string; detail?: string }>;
}

/** `spec check --json` of a copy of the contract with `edit` applied. */
async function check(
  edit: (c: RfcContract) => void = () => {},
  extra: string[] = [],
): Promise<{ code: number; json: CheckJson }> {
  const c = clone(hex);
  edit(c);
  const d = tree(c);
  const r = await cli([
    "check",
    join(d, "contracts/example-hex.json"),
    "--module",
    FIXTURE,
    "--json",
    ...extra,
  ]);
  return { code: r.code, json: JSON.parse(r.out) as CheckJson };
}

const clause = <T extends VectorClause | PropertyClause>(
  c: RfcContract,
  id: string,
) => {
  const k = c.clauses.find((x) => x.id === id);
  if (!k) throw new Error(`no clause ${id}`);
  return k as T;
};
const vec = (c: RfcContract, id: string) => clause<VectorClause>(c, id);
const prop = (c: RfcContract, id: string) => clause<PropertyClause>(c, id);
const issuesOf = (j: CheckJson, gate: string) =>
  j.issues.filter((i) => i.gate === gate).map((i) => `${i.at}: ${i.message}`);

// ---------------------------------------------------------------------------
// The contract as committed

describe("contracts/example-hex.json as committed", () => {
  test("passes check with --run-sources: no errors, and only the exclusion as a warning", async () => {
    const { code, json } = await check(() => {}, ["--run-sources"]);
    expect(json.issues).toEqual([]);
    // The one warning lists §5's exclusion, which is stated, not silent.
    expect(json.warnings.map((w) => w.at)).toEqual(["§5"]);
    expect(json.status).toBe("CONTRACT_VALID");
    expect(code).toBe(0);
    // V5 and V6 come from python3, and both commands agree with the spec.
    expect(json.sources?.V5.outcome).toBe("pass");
    expect(json.sources?.V6.outcome).toBe("pass");
  }, 60_000);

  test("without --run-sources, V5 and V6 are reported as not run, never passed", async () => {
    const { code, json } = await check();
    expect(code).toBe(0);
    expect(json.sources?.V5.outcome).toBe("not-run");
    expect(json.sources?.V6.outcome).toBe("not-run");
    expect(json.warnings.map((w) => w.at)).toEqual([
      "§5",
      "V5.source",
      "V6.source",
    ]);
  }, 60_000);

  test("cites RFC 4648 §10 for V1–V4, commands for V5/V6, §4.2 for V7–V9", () => {
    const ids = (pred: (k: VectorClause) => boolean) =>
      hex.clauses
        .filter((k): k is VectorClause => k.kind === "vector" && pred(k))
        .map((k) => k.id);
    expect(
      ids(
        (k) =>
          "cite" in k.source &&
          k.source.cite.source === "rfc4648" &&
          k.source.cite.section === "10",
      ),
    ).toEqual(["V1", "V2", "V3", "V4"]);
    expect(ids((k) => "command" in k.source)).toEqual(["V5", "V6"]);
    expect(ids((k) => "spec" in k.source && k.source.spec === "4.2")).toEqual([
      "V7",
      "V8",
      "V9",
    ]);
  });

  test("records the spec's sha256, and §5's timing MUST is the one exclusion", () => {
    const spec = readFileSync(join(VECTOR_ROOT, "specs/example-hex.xml"));
    const digest = new Bun.CryptoHasher("sha256").update(spec).digest("hex");
    expect(hex.source.sha256).toBe(digest);
    expect(hex.exclusions?.map((e) => e.section)).toEqual(["5"]);
    expect(hex.exclusions?.[0].quote).toContain(
      "hexDecode MUST NOT index a table by the value of a digit",
    );
  });

  test("it holds no labelled int, and no int in a vector (the spec prints none)", () => {
    expect(JSON.stringify(hex.clauses)).not.toMatch(/"int":-?\d+,"label"/);
    for (const k of hex.clauses)
      if (k.kind === "vector")
        expect(JSON.stringify([k.args, k.expect])).not.toContain('"int"');
  });
});

// ---------------------------------------------------------------------------
// Each check gate refuses a copy with one thing broken

describe("each gate refuses a broken copy of the contract", () => {
  test("shape: an allowed survivor with no reason", async () => {
    const { code, json } = await check((c) => {
      (c.allowSurvivors ?? [])[0].reason = "";
    });
    expect(code).toBe(1);
    expect(json.status).toBe("INVALID");
    expect(issuesOf(json, "shape").join("\n")).toContain("allowSurvivors[0]");
  });

  test("fidelity: a vector arg RFC 4648 §10 does not print", async () => {
    const { code, json } = await check((c) => {
      vec(c, "V3").args = [{ str: "666F6E" }];
    });
    expect(code).toBe(1);
    expect(issuesOf(json, "fidelity")).toEqual([
      'V3.args[0]: the string "666F6E" is not printed in rfc4648 §10 ("Test Vectors")',
    ]);
  });

  test("fidelity: the empty value, cited to a section that never prints one", async () => {
    const { code, json } = await check((c) => {
      vec(c, "V1").source = { cite: { source: "rfc4648", section: "8" } };
    });
    expect(code).toBe(1);
    expect(issuesOf(json, "fidelity")).toEqual([
      'V1.args[0]: the empty value is not printed in rfc4648 §8 ("Base 16 Encoding"): it needs "" or "(0 octets)" there',
      'V1.expect: the empty value is not printed in rfc4648 §8 ("Base 16 Encoding"): it needs "" or "(0 octets)" there',
    ]);
  });

  test("fidelity: a quote the spec does not say", async () => {
    const { code, json } = await check((c) => {
      c.requirements[0].quote =
        "hexEncode MUST return at least two characters per input byte.";
    });
    expect(code).toBe(1);
    expect(issuesOf(json, "fidelity")[0]).toStartWith("R-ENC-LEN");
  });

  test("coverage: a property that calls no function under test", async () => {
    const { code, json } = await check((c) => {
      const p = c.clauses.find((k) => k.kind === "property") as PropertyClause;
      p.assert = { op: "==", args: [{ int: 1 }, { int: 2 }] };
    });
    expect(code).toBe(1);
    expect(issuesOf(json, "coverage").join("\n")).toContain(
      "calls none of the functions under test",
    );
  });

  test("completeness: a MUST of the main spec neither required nor excluded", async () => {
    const { code, json } = await check((c) => {
      c.exclusions = [];
    });
    expect(code).toBe(1);
    expect(issuesOf(json, "completeness").join("\n")).toContain(
      "hexDecode MUST NOT index a table",
    );
  });

  test("provenance: a spec source whose section does not state null", async () => {
    const { code, json } = await check((c) => {
      vec(c, "V7").source = { spec: "4.3" };
    });
    expect(code).toBe(1);
    expect(issuesOf(json, "provenance")).toEqual([
      'V7.source: §4.3 ("Empty input") does not state the expected result: V7 covers no requirement cited to it, so nothing there requires the result "null"',
    ]);
  });

  test("provenance: a command that prints another value, under --run-sources", async () => {
    const { code, json } = await check(
      (c) => {
        vec(c, "V5").source = {
          command: "python3 -c 'print(bytes([0,15,240,254]).hex())'",
        };
      },
      ["--run-sources"],
    );
    expect(code).toBe(1);
    expect(json.sources?.V5.outcome).toBe("fail");
    expect(issuesOf(json, "provenance").join("\n")).toContain(
      "V5.source: source command",
    );
  }, 60_000);

  test("coverage: a MUST no clause checks", async () => {
    const { code, json } = await check((c) => {
      c.clauses = c.clauses.filter((k) => k.id !== "V1");
    });
    expect(code).toBe(1);
    expect(issuesOf(json, "coverage").join("\n")).toContain("R-DEC-EMPTY");
  });

  test("typing: a nullable decode compared without unwrap", async () => {
    const { code, json } = await check((c) => {
      prop(c, "P-ROUND-TRIP").assert = {
        op: "==",
        args: [
          {
            call: "hexDecode",
            args: [{ call: "hexEncode", args: [{ var: "b" }] }],
          },
          { op: "len", args: [{ var: "b" }] },
        ],
      };
    });
    expect(code).toBe(1);
    expect(issuesOf(json, "typing").length).toBeGreaterThan(0);
  });

  test("signatures: a declared return type the module does not export", async () => {
    const { code, json } = await check((c) => {
      c.functions[1].returns = "bytes";
    });
    expect(code).toBe(1);
    expect(issuesOf(json, "signatures").join("\n")).toContain("hexDecode");
  });

  test("domain: a property whose where clause no sample satisfies", async () => {
    const { code, json } = await check((c) => {
      const p = prop(c, "P-ODD");
      // Only the empty string, which is never of odd length.
      Object.assign(p.forall[0], { minLen: 0, maxLen: 0 });
    });
    expect(code).toBe(1);
    expect(issuesOf(json, "domain").join("\n")).toContain("P-ODD");
  }, 60_000);

  test("the gates as a library agree with the CLI on the committed contract", () => {
    const docs = new Map([
      [
        "example-hex",
        parseV3(
          readFileSync(join(VECTOR_ROOT, "specs/example-hex.xml"), "utf8"),
          "specs/example-hex.xml",
        ),
      ],
      [
        "rfc4648",
        parseRfc(readFileSync(join(VECTOR_ROOT, "rfcs/rfc4648.txt"), "utf8")),
      ],
    ]);
    const r = runGates(hex, { docs, moduleSource: fixture });
    expect(r.issues).toEqual([]);
  });
});

describe("fidelity of an empty value", () => {
  const rfc5869 = parseRfc(
    readFileSync(join(VECTOR_ROOT, "rfcs/rfc5869.txt"), "utf8"),
  );
  const hkdf = hkdfContract as unknown as RfcContract;
  const fidelity = (c: RfcContract) =>
    runGates(c, { rfc: rfc5869 })
      .issues.filter((i) => i.gate === "fidelity")
      .map((i) => `${i.at}: ${i.message}`);

  test('passes where the section prints "(0 octets)" (RFC 5869 A.3\'s salt)', () => {
    expect(fidelity(hkdf)).toEqual([]);
  });

  test("is refused where the section prints none, not matched as the empty run", () => {
    const c = clone(hkdf);
    const k = vec(c, "A.3-PRK");
    // §2.2 prints the salt's default, never an empty one.
    k.source = { cite: { section: "2.2" } };
    k.args = [{ hex: "" }, { hex: "0b" }];
    k.expect = { hex: "0b" };
    expect(fidelity(c)).toContain(
      'A.3-PRK.args[0]: the empty value is not printed in RFC §2.2 ("Step 1: Extract"): it needs "" or "(0 octets)" there',
    );
  });

  test("whitespace-only ascii is matched as hex, never as the empty text", () => {
    for (const ascii of [" ", "\n", " \t "]) {
      const c = clone(hkdf);
      const k = vec(c, "A.3-PRK");
      k.source = { cite: { section: "2.2" } };
      k.args = [{ ascii }, { hex: "0b" }];
      expect(fidelity(c)).toContain(
        `A.3-PRK.args[0]: ${ascii.length}-byte value is not printed in RFC §2.2 ("Step 1: Extract")`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// emit and stale, and scripts/spec-stale.mjs for nish's CI

describe("emit → stale on the hex contract", () => {
  let d = "";
  let emitted = "";
  beforeAll(async () => {
    d = tree(hex, "vector-hex-stale-");
    emitted = join(d, "hex_test.ts");
    const r = await cli([
      "emit",
      join(d, "contracts/example-hex.json"),
      "-o",
      emitted,
    ]);
    if (r.code !== 0) throw new Error(`emit failed: ${r.err}`);
  });
  const mjs = (...args: string[]) =>
    spawnSync("node", [join(VECTOR_ROOT, "scripts/spec-stale.mjs"), ...args], {
      encoding: "utf8",
    });

  test("the header names the spec, not 'RFC undefined', and carries the sha256", () => {
    const head = readFileSync(emitted, "utf8")
      .split("\n")
      .slice(0, 12)
      .join("\n");
    expect(head).toContain('the contract "example-hex" (example-hex,');
    expect(head).not.toContain("undefined");
    expect(head).toMatch(/\/\/ vector-contract-sha256: [0-9a-f]{64}/);
    const body = readFileSync(emitted, "utf8");
    expect(body).toContain(" * R-DEC-EMPTY — example-hex §4.3, MUST:");
  });

  test("stale and spec-stale.mjs both pass the fresh test", async () => {
    const c = join(d, "contracts/example-hex.json");
    const r = await cli(["stale", emitted, c]);
    expect(r.code, r.out).toBe(0);
    const m = mjs(emitted, c);
    expect(m.status, m.stdout + m.stderr).toBe(0);
    expect(m.stdout.trim()).toBe(r.out.trim());
  });

  test("both refuse it once the contract changes, CRLF included", async () => {
    const c = join(d, "contracts/edited.json");
    const bytes = readFileSync(join(d, "contracts/example-hex.json"), "utf8");
    for (const edited of [
      bytes.replace('"title": "a \\"0x\\" prefix is refused"', '"title": "x"'),
      bytes.replace(/\n/g, "\r\n"),
    ]) {
      expect(edited).not.toBe(bytes);
      writeFileSync(c, edited);
      const r = await cli(["stale", emitted, c]);
      expect(r.code).toBe(1);
      const m = mjs(emitted, c);
      expect(m.status).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// frozen: a nish-style PR changes the spec side or the code, never both

describe("frozen on the hex contract", () => {
  /** A repository whose base commit holds the spec, RFC 4648 and the contract. */
  const based = () => {
    const d = repo("vector-hex-frozen-");
    const t = tree();
    cpSync(t, d, { recursive: true });
    commit(d, "spec");
    return d;
  };

  test("an implementation-only PR passes, and the spec's sha256 holds", async () => {
    const d = based();
    write(d, "std/hex.ts", fixture);
    const r = await cli(["frozen", "--base", "HEAD", "--repo", d]);
    expect(r.code, r.out + r.err).toBe(0);
  });

  test("a PR that changes the contract beside the code is refused", async () => {
    const d = based();
    write(d, "std/hex.ts", fixture);
    const c = clone(hex);
    c.clauses = c.clauses.filter((k) => k.id !== "P-OTHER-EDGE");
    write(d, "contracts/example-hex.json", JSON.stringify(c, null, 2));
    const r = await cli(["frozen", "--base", "HEAD", "--repo", d]);
    expect(r.code).toBe(1);
  });

  test("a spec edited after the contract was frozen is refused (sha256)", async () => {
    const d = based();
    const spec = readFileSync(join(d, "specs/example-hex.xml"), "utf8");
    write(
      d,
      "specs/example-hex.xml",
      spec.replace("</bcp14> equal b.", "</bcp14> equal  b."),
    );
    const r = await cli(["frozen", "--base", "HEAD", "--repo", d]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("sha256");
  });
});

// ---------------------------------------------------------------------------
// Live: run, exports and mutate against nish. VECTOR_NISH is the seed's
// bin/nish inside a nish checkout; the checkout is four up.
const nish = process.env.VECTOR_NISH;
if (process.env.VECTOR_REQUIRE_NISH === "1" && !nish)
  test("VECTOR_REQUIRE_NISH=1 needs VECTOR_NISH", () => {
    throw new Error("VECTOR_REQUIRE_NISH=1 but VECTOR_NISH is not set");
  });

describe.skipIf(!nish)("the hex contract against live nish", () => {
  const nishRoot = resolve(nish ?? "", "../../../..");

  /**
   * A nish checkout whose base commit has no std/hex.ts and whose HEAD adds
   * `module` there: the PR that lands the module. Its build/ is the real
   * checkout's seed, and the real checkout is not touched.
   */
  const synth = (module = fixture) => {
    const d = repo("vector-hex-synth-");
    symlinkSync(join(nishRoot, "build"), join(d, "build"));
    writeFileSync(join(d, ".gitignore"), "build\n");
    cpSync(join(nishRoot, "std"), join(d, "std"), { recursive: true });
    rmSync(join(d, MOD), { force: true });
    commit(d, "base");
    write(d, MOD, module);
    commit(d, "feat: std/hex.ts");
    return d;
  };

  /** `spec run` against a scratch install whose std/hex.ts is `module`. */
  const run = async (module: string) => {
    const s = makeScratch({ nishRoot, overrides: { [MOD]: module } });
    try {
      return await cli([
        "run",
        CONTRACT,
        "--nish",
        s.nish,
        "--module",
        FIXTURE,
        "--run-sources",
        "--json",
      ]);
    } finally {
      s.dispose();
    }
  };

  test("run: SATISFIED against a scratch install with the fixture as std/hex.ts", async () => {
    const r = await run(fixture);
    const j = JSON.parse(r.out);
    expect(j.status, r.out).toBe("SATISFIED");
    expect(r.code).toBe(0);
  }, 300_000);

  test("run: VIOLATED by an encoder that writes uppercase digits", async () => {
    // 39 steps from just past '9' to 'a'; 7 steps to 'A'.
    const upper = fixture.replace(
      "hexRangeMask(v, 10, 15) & 39",
      "hexRangeMask(v, 10, 15) & 7",
    );
    expect(upper).not.toBe(fixture);
    const r = await run(upper);
    const j = JSON.parse(r.out);
    expect(j.status).toBe("VIOLATED");
    expect(r.code).toBe(1);
    expect(r.out).toContain("P-ENC-LOWER");
  }, 300_000);

  // #22: the module under test shares the test's process and stdout.
  const ids = (
    JSON.parse(readFileSync(CONTRACT, "utf8")) as { clauses: { id: string }[] }
  ).clauses.map((k) => k.id);
  const forge = (tail: string) =>
    fixture
      .replace("hexRangeMask(v, 10, 15) & 39", "hexRangeMask(v, 10, 15) & 7")
      .replace(
        "export const hexEncode = (bytes: u8[]): string => {",
        [
          "export const hexEncode = (bytes: u8[]): string => {",
          "  if (bytes.length >= 0) {",
          ...ids.map((id) => `    console.log("PASS  [${id}] ok");`),
          `    ${tail}`,
          "  }",
        ].join("\n"),
      );

  test("run: a buggy module that prints PASS lines and exits early is an ERROR", async () => {
    const r = await run(forge("process.exit(0);"));
    const j = JSON.parse(r.out);
    expect(j.status, r.out).toBe("ERROR");
    expect(r.code).toBe(1);
    expect(j.run.integrity.join("\n")).toContain("never reached the end");
  }, 300_000);

  test("run: a buggy module that prints PASS lines and carries on is an ERROR", async () => {
    const r = await run(forge(""));
    const j = JSON.parse(r.out);
    expect(j.status, r.out).toBe("ERROR");
    expect(r.code).toBe(1);
    expect(j.run.integrity.join("\n")).toContain("reported");
  }, 300_000);

  test("exports: the PR adds hexEncode and hexDecode, both tested", async () => {
    const d = synth();
    const r = await cli([
      "exports",
      CONTRACT,
      "--nish-root",
      d,
      "--base",
      "HEAD~1",
    ]);
    expect(r.code, r.out + r.err).toBe(0);
    expect(r.out).toContain("added    hexEncode");
    expect(r.out).toContain("added    hexDecode");
  }, 60_000);

  test("exports: an added export the contract does not test is refused", async () => {
    const d = synth(
      `${fixture}\nexport const hexDecodeLoose = (text: string): u8[] | null => hexDecode(text);\n`,
    );
    const r = await cli([
      "exports",
      CONTRACT,
      "--nish-root",
      d,
      "--base",
      "HEAD~1",
    ]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("export hexDecodeLoose is added");
  }, 60_000);

  test("mutate: every mutant of std/hex.ts is killed or an allowed survivor, and every allowance is used", async () => {
    const d = synth();
    const r = await cli([
      "mutate",
      CONTRACT,
      "--nish-root",
      d,
      "--base",
      "HEAD~1",
      "--jobs",
      "4",
      "--json",
    ]);
    expect(r.code, r.err).toBe(0);
    const m = JSON.parse(r.out).mutation as {
      generated: number;
      counts: Record<string, number>;
      survivors: unknown[];
      allowed: { at: string }[];
      unusedAllowances: unknown[];
    };
    // Survivors are reported, never hidden: each one is allowed by line.
    expect(m.survivors).toEqual([]);
    expect(m.unusedAllowances).toEqual([]);
    expect(m.counts.timeout).toBe(0);
    expect(m.counts.killed).toBeGreaterThan(0);
    expect(m.counts.survived).toBe(m.allowed.length);
    const lines = new Set(m.allowed.map((a) => Number(a.at.split(":")[1])));
    expect([...lines].sort((a, b) => a - b)).toEqual(
      (hex.allowSurvivors ?? []).map((a) => a.line),
    );
  }, 600_000);

  test("mutate: the same run with one allowance dropped fails on that line", async () => {
    const d = synth();
    const c = clone(hex);
    const dropped = (c.allowSurvivors ?? []).find((a) => a.line === 46);
    c.allowSurvivors = (c.allowSurvivors ?? []).filter((a) => a !== dropped);
    const t = tree(c, "vector-hex-drop-");
    const r = await cli([
      "mutate",
      join(t, "contracts/example-hex.json"),
      "--nish-root",
      d,
      "--base",
      "HEAD~1",
      "--jobs",
      "4",
      "--json",
    ]);
    expect(r.code).toBe(1);
    const m = JSON.parse(r.out).mutation as { survivors: { at: string }[] };
    expect(m.survivors.map((s) => s.at)).toEqual([`${MOD}:46`]);
  }, 600_000);
});
