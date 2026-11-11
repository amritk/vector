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
import hexContract from "../contracts/example-hex.json";
import hkdfContract from "../contracts/rfc5869-hkdf-sha256.json";
import { rfcMain } from "../src/rfc/cli.ts";
import {
  type RfcContract,
  declaredSources,
  validateContractShape,
} from "../src/rfc/contract.ts";
import {
  VECTOR_ROOT,
  frozenCheck,
  recordedProblem,
  sourceLabel,
} from "../src/rfc/frozen.ts";

// A contract records the file each source was read from and the sha256 of its
// bytes; `spec check` fails when it reads other ones, and `spec frozen` when an
// RFC file changes, not only the main spec.

const hex = hexContract as unknown as RfcContract;
const hkdf = hkdfContract as unknown as RfcContract;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const HKDF_SHA = hkdf.source.sha256 as string;
const ZERO = "0".repeat(64);
const RFC4648 = readFileSync(join(VECTOR_ROOT, "rfcs/rfc4648.txt"), "utf8");

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "vector-sources-")));
  dirs.push(d);
  return d;
};
const write = (d: string, rel: string, s: string) => {
  mkdirSync(dirname(join(d, rel)), { recursive: true });
  writeFileSync(join(d, rel), s);
};
/** A repo laid out like vector's: contracts/, specs/ and rfcs/. */
const project = (c: RfcContract, name = "c.json") => {
  const d = tmp();
  for (const f of [
    "specs/example-hex.xml",
    "rfcs/rfc4648.txt",
    "rfcs/rfc5869.txt",
  ])
    cpSync(join(VECTOR_ROOT, f), join(d, f));
  write(d, `contracts/${name}`, JSON.stringify(c));
  return { d, contract: join(d, "contracts", name) };
};

async function cli(argv: string[]) {
  const out: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...a) => {
    out.push(a.join(" "));
  });
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    return { code: await rfcMain(argv), out: out.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

describe("a source entry's file and sha256: shape", () => {
  const withEntry = (entry: Record<string, unknown>) => {
    const c = clone(hkdf) as unknown as { sources: unknown[] };
    c.sources = [entry];
    return validateContractShape(c);
  };

  test("vector's contracts record them and are valid", () => {
    for (const c of [hex, hkdf]) expect(validateContractShape(c)).toEqual([]);
  });

  test("file is a path inside the repo with / separators", () => {
    const msg =
      "sources[0].file: a path inside the repo, with / separators, like rfcs/rfc4648.txt";
    for (const file of [
      1,
      "",
      "/rfcs/rfc5869.txt",
      "../rfcs/rfc5869.txt",
      "rfcs/./rfc5869.txt",
      "rfcs//rfc5869.txt",
      "rfcs\\rfc5869.txt",
    ])
      expect(withEntry({ id: "rfc5869", rfc: 5869, file })).toContain(msg);
    expect(
      withEntry({ id: "rfc5869", rfc: 5869, file: "rfcs/rfc5869.txt" }),
    ).toEqual([]);
  });

  test("sha256 is 64 lowercase hex digits", () => {
    for (const sha256 of [7, "ABC", HKDF_SHA.toUpperCase()])
      expect(withEntry({ id: "rfc5869", rfc: 5869, sha256 })).toContain(
        "sources[0].sha256: 64 lowercase hex digits",
      );
  });

  test("an entry for source.rfc's own id must name the same RFC", () => {
    expect(withEntry({ id: "rfc5869", rfc: 5870 })).toContain(
      "sources[0].rfc: 5869, as contract.source.rfc says",
    );
  });

  test("source.rfc with sources may not also give main, nor a bad number", () => {
    const both = clone(hkdf);
    both.source.main = "rfc5869";
    expect(validateContractShape(both)).toEqual([
      "contract.source.main: only with contract.sources",
      "contract.source.rfc: with contract.source.main, give the RFC number on its entry there",
    ]);
    const bad = clone(hkdf);
    bad.source.rfc = 0;
    expect(validateContractShape(bad)).toEqual([
      "contract.source.rfc: the RFC number",
    ]);
  });
});

describe("declared sources with source.rfc and sources", () => {
  test("an entry with the RFC's id is the main source's own", () => {
    expect(declaredSources(hkdf)).toEqual({
      main: "rfc5869",
      list: hkdf.sources as NonNullable<RfcContract["sources"]>,
    });
  });

  test("without one, the RFC is the implicit main source, listed first", () => {
    const c = clone(hkdf);
    c.sources = [{ id: "extra", path: "../specs/extra.md" }];
    expect(validateContractShape(c)).toEqual([]);
    expect(declaredSources(c).list).toEqual([
      { id: "rfc5869", rfc: 5869 },
      { id: "extra", path: "../specs/extra.md" },
    ]);
  });
});

describe("how a source's file is named", () => {
  test("relative to the directory holding the contract's directory", () => {
    const { d, contract } = project(hex);
    expect(sourceLabel(join(d, "rfcs/rfc4648.txt"), contract)).toBe(
      "rfcs/rfc4648.txt",
    );
  });

  test("else relative to vector's root, where an rfc<N>.txt may come from", () => {
    const contract = join(tmp(), "a/b/c.json");
    expect(sourceLabel(join(VECTOR_ROOT, "rfcs/rfc5869.txt"), contract)).toBe(
      "rfcs/rfc5869.txt",
    );
  });

  test("relative to the innermost root, wherever vector sits", () => {
    // vector nested under the contract's repo: the file is vector's own rfcs/.
    const contract = join(dirname(VECTOR_ROOT), "contracts/c.json");
    expect(sourceLabel(join(VECTOR_ROOT, "rfcs/rfc5869.txt"), contract)).toBe(
      "rfcs/rfc5869.txt",
    );
    // a repo nested under vector: the file is the repo's own rfcs/.
    const inner = join(VECTOR_ROOT, "contracts/c.json");
    expect(sourceLabel(join(VECTOR_ROOT, "rfcs/rfc5869.txt"), inner)).toBe(
      "rfcs/rfc5869.txt",
    );
  });

  test("from the contract's nearest ancestor holding it under rfcs/ or specs/", () => {
    const d = tmp();
    write(d, "rfcs/x.txt", "s");
    for (const c of ["c.json", "contracts/c.json", "contracts/sub/c.json"])
      expect(sourceLabel(join(d, "rfcs/x.txt"), join(d, c))).toBe("rfcs/x.txt");
  });

  test("a file beside the contract is named from the directory holding it", () => {
    const d = tmp();
    write(d, "contracts/x.txt", "s");
    expect(
      sourceLabel(join(d, "contracts/x.txt"), join(d, "contracts/c.json")),
    ).toBe("contracts/x.txt");
  });

  test("any other file has no name, and recording one is refused", () => {
    const d = tmp();
    write(d, "x/spec.md", "s");
    const contract = join(d, "a/b/c.json");
    expect(sourceLabel(join(d, "x/spec.md"), contract)).toBeUndefined();
    expect(
      sourceLabel(join(d, "x/spec.md"), join(VECTOR_ROOT, "contracts/c.json")),
    ).toBeUndefined();
    expect(
      recordedProblem(
        { id: "s", file: "x/spec.md" },
        contract,
        join(d, "x/spec.md"),
        ZERO,
      ),
    ).toBe(
      `source s was read from ${join(d, "x/spec.md")}, which its file cannot name: it is under no specs/ or rfcs/ of the contract's repo or of vector, nor beside the contract`,
    );
    expect(
      recordedProblem(
        { id: "s", sha256: HKDF_SHA },
        contract,
        join(d, "x/spec.md"),
        ZERO,
      ),
    ).toContain(`source s (${join(d, "x/spec.md")}) has sha256 ${ZERO}`);
  });

  test("what was read is checked against what the entry records", () => {
    const { d, contract } = project(hkdf);
    const file = join(d, "rfcs/rfc5869.txt");
    const decl = { id: "rfc5869", file: "rfcs/rfc5869.txt", sha256: HKDF_SHA };
    expect(recordedProblem(decl, contract, file, HKDF_SHA)).toBeUndefined();
    expect(
      recordedProblem({ id: "rfc5869" }, contract, file, ZERO),
    ).toBeUndefined();
    expect(recordedProblem(decl, contract, file, ZERO)).toBe(
      `source rfc5869 (rfcs/rfc5869.txt) has sha256 ${ZERO}, but its sha256 is ${HKDF_SHA}: the source changed under the contract`,
    );
    expect(
      recordedProblem(
        { ...decl, file: "rfcs/other.txt" },
        contract,
        file,
        HKDF_SHA,
      ),
    ).toBe(
      "source rfc5869 was read from rfcs/rfc5869.txt, but its file is rfcs/other.txt",
    );
  });
});

describe("spec check verifies the file and bytes each source was read from", () => {
  test("vector's contracts check against the files they record", async () => {
    for (const c of [hex, hkdf]) {
      const { contract } = project(c);
      expect((await cli(["check", contract])).code).toBe(0);
    }
  });

  test("an RFC found in vector's rfcs/ is named from vector's root", async () => {
    const d = tmp();
    write(d, "a/b/h.json", JSON.stringify(hkdf));
    expect((await cli(["check", join(d, "a/b/h.json")])).code).toBe(0);
  });

  test("other bytes fail the check, naming the source and both hashes", async () => {
    const { d, contract } = project(hex);
    write(d, "rfcs/rfc4648.txt", `${RFC4648}\n`);
    const r = await cli(["check", contract]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("source rfc4648 (rfcs/rfc4648.txt) has sha256 ");
    expect(r.out).toContain(
      `but its sha256 is ${hex.sources?.[1].sha256}: the source changed under the contract`,
    );
  });

  test("another file fails the check, naming both files", async () => {
    const c = clone(hex);
    (c.sources as NonNullable<RfcContract["sources"]>)[1].file =
      "rfcs/rfc4648-old.txt";
    const { contract } = project(c);
    const r = await cli(["check", contract]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      "source rfc4648 was read from rfcs/rfc4648.txt, but its file is rfcs/rfc4648-old.txt",
    );
  });

  test("--spec naming the recorded file passes", async () => {
    const { d, contract } = project(hkdf);
    const r = await cli([
      "check",
      contract,
      "--spec",
      join(d, "rfcs/rfc5869.txt"),
    ]);
    expect(r.code).toBe(0);
  });

  test("--spec is judged by the file it names", async () => {
    const { contract } = project(hkdf);
    const elsewhere = join(tmp(), "rfc5869.txt");
    cpSync(join(VECTOR_ROOT, "rfcs/rfc5869.txt"), elsewhere);
    const r = await cli(["check", contract, "--spec", elsewhere]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      `source rfc5869 was read from ${elsewhere}, which its file cannot name`,
    );
  });
});

describe("spec frozen flags a changed RFC file, not only the main spec", () => {
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  /** `c` in a fresh repo, after `edit` changes its files, committed. */
  const repo = (c: RfcContract, edit: (d: string) => void = () => {}) => {
    const p = project(c);
    edit(p.d);
    git(p.d, "init", "-q");
    git(p.d, "config", "user.email", "t@example.com");
    git(p.d, "config", "user.name", "t");
    git(p.d, "config", "commit.gpgsign", "false");
    git(p.d, "add", "-A");
    git(p.d, "commit", "-qm", "c");
    return p;
  };
  const problem = (d: string) =>
    frozenCheck({ repo: d, base: "HEAD" }).contracts[0].problem;

  test("unchanged: no problem", () => {
    expect(problem(repo(hex).d)).toBeUndefined();
  });

  test("a changed RFC file beside the XML main spec", () => {
    const { d } = repo(hex);
    write(d, "rfcs/rfc4648.txt", `${RFC4648}\n`);
    expect(problem(d)).toStartWith(
      "source rfc4648 (rfcs/rfc4648.txt) has sha256 ",
    );
  });

  test("a recorded file that is not the one found", () => {
    const c = clone(hex);
    (c.sources as NonNullable<RfcContract["sources"]>)[1].file = "rfcs/old.txt";
    expect(problem(repo(c).d)).toBe(
      "source rfc4648 was read from rfcs/rfc4648.txt, but its file is rfcs/old.txt",
    );
  });

  test("a recorded source is read as spec text, never through a device", () => {
    const c = clone(hex);
    const entry = (c.sources as NonNullable<RfcContract["sources"]>)[1];
    entry.path = undefined;
    const { d } = repo(c, (d) => {
      rmSync(join(d, "rfcs/rfc4648.txt"));
      symlinkSync("/dev/zero", join(d, "rfcs/rfc4648.txt"));
    });
    expect(problem(d)).toContain("source rfc4648 is ");
    expect(problem(d)).toContain("which is not spec text");
  });

  test("a recorded source that is not on disk", () => {
    const c = clone(hkdf);
    c.sources?.push({ id: "gone", path: "../specs/gone.md", sha256: ZERO });
    expect(problem(repo(c).d)).toBe("source gone is not on disk");
  });
});
