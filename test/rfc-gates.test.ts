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
import hkdfContract from "../contracts/rfc5869-hkdf-sha256.json";
import { rfcMain } from "../src/rfc/cli.ts";
import type { RfcContract } from "../src/rfc/contract.ts";
import { validateContractShape } from "../src/rfc/contract.ts";
import { staleReason } from "../src/rfc/emit-nish.ts";
import {
  exportsCheck,
  renderExports,
  targetModulePath,
} from "../src/rfc/exports.ts";
import {
  VECTOR_ROOT,
  frozenCheck,
  pathKind,
  renderFrozen,
  sha256,
} from "../src/rfc/frozen.ts";
import { runGates } from "../src/rfc/gates.ts";
import { DiffParseError, exportedNames } from "../src/rfc/gitdiff.ts";
import type { MutantResult, MutationReport } from "../src/rfc/mutate.ts";
import {
  type ContractReport,
  SURVIVOR_MEANING,
  renderMarkdown,
  renderReport,
  reportJson,
  reportStatus,
} from "../src/rfc/report.ts";

// The PR gates: frozen (spec or implementation, never both; sources unchanged),
// stale (a generated test names the contract bytes it came from), exports (no
// untested surface), mutate (no survivor without a reason) and the markdown
// dashboard. Each passes on a good change and refuses a bad one.

const hkdf = hkdfContract as unknown as RfcContract;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const dirs: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const repo = (p = "vector-gates-") => {
  const d = tmp(p);
  git(d, "init", "-q");
  git(d, "config", "user.email", "t@example.com");
  git(d, "config", "user.name", "t");
  git(d, "config", "commit.gpgsign", "false");
  return d;
};
const write = (d: string, rel: string, s: string) => {
  mkdirSync(dirname(join(d, rel)), { recursive: true });
  writeFileSync(join(d, rel), s);
};
const commit = (d: string) => {
  git(d, "add", "-A");
  git(d, "commit", "-qm", "c", "--allow-empty");
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

// ---------------------------------------------------------------------------
// frozen

describe("spec frozen: which side a path is on", () => {
  test("specs/, contracts/ and rfcs/ are the spec side", () => {
    for (const p of [
      "specs/x.md",
      "specs/a/b.md",
      "contracts/c.json",
      "rfcs/rfc1.txt",
    ])
      expect(pathKind(p)).toBe("spec");
  });
  test("docs/ and top-level *.md are neutral", () => {
    for (const p of ["docs/a.md", "docs/x/y.png", "README.md", "CHANGES.md"])
      expect(pathKind(p)).toBe("neutral");
  });
  test("everything else is implementation, look-alikes included", () => {
    for (const p of [
      "src/rfc/cli.ts",
      "test/rfc-gates.test.ts",
      "package.json",
      "a/b.md",
      "src/specs/x.ts",
      "specs",
      "specsx/y",
      "contract/x.json",
      "xdocs/a.md",
      "README.md.bak",
    ])
      expect(pathKind(p)).toBe("implementation");
  });
});

describe("spec frozen", () => {
  const rfc = readFileSync(join(VECTOR_ROOT, "rfcs/rfc5869.txt"));
  /** A repo with one contract whose rfcs/ source matches, committed. */
  const frozenRepo = () => {
    const d = repo();
    write(d, "contracts/h.json", JSON.stringify(hkdf));
    mkdirSync(join(d, "rfcs"));
    writeFileSync(join(d, "rfcs/rfc5869.txt"), rfc);
    write(d, "src/a.ts", "export const a = 1\n");
    write(d, "README.md", "# r\n");
    commit(d);
    return d;
  };

  test("no change at all: OK, and the contract's source sha256 matches", () => {
    const d = frozenRepo();
    const r = frozenCheck({ repo: d, base: "HEAD" });
    expect(r.problems).toEqual([]);
    expect(r.contracts).toEqual([{ path: join(d, "contracts/h.json") }]);
    expect(renderFrozen(r)).toContain("spec frozen against HEAD: OK");
  });

  test("implementation only (plus neutral docs) passes", () => {
    const d = frozenRepo();
    write(d, "src/a.ts", "export const a = 2\n");
    write(d, "README.md", "# r2\n");
    write(d, "docs/new.md", "x\n");
    const r = frozenCheck({ repo: d, base: "HEAD" });
    expect(r.problems).toEqual([]);
    expect(r.changed).toEqual([
      { path: "README.md", kind: "neutral" },
      { path: "docs/new.md", kind: "neutral" },
      { path: "src/a.ts", kind: "implementation" },
    ]);
  });

  test("spec side only passes", () => {
    const d = frozenRepo();
    write(d, "specs/new.md", "# s\n");
    const c = clone(hkdf);
    c.requirements[0].note = "edited";
    write(d, "contracts/h.json", JSON.stringify(c));
    expect(frozenCheck({ repo: d, base: "HEAD" }).problems).toEqual([]);
  });

  test("spec and implementation together are refused, untracked files included", () => {
    const d = frozenRepo();
    write(d, "specs/new.md", "# s\n");
    write(d, "src/untracked.ts", "x\n");
    const r = frozenCheck({ repo: d, base: "HEAD" });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain("specs/new.md");
    expect(r.problems[0]).toContain("src/untracked.ts");
    expect(renderFrozen(r)).toContain("FAILED");
  });

  test("a nested .md outside docs/ is implementation: refused beside a spec change", () => {
    const d = frozenRepo();
    write(d, "contracts/notes.md", "x\n");
    write(d, "src/notes.md", "x\n");
    expect(frozenCheck({ repo: d, base: "HEAD" }).problems).toHaveLength(1);
  });

  test("a committed mixed change against an older base is refused", () => {
    const d = frozenRepo();
    write(d, "rfcs/other.txt", "x\n");
    write(d, "test/t.ts", "x\n");
    commit(d);
    expect(frozenCheck({ repo: d, base: "HEAD~1" }).problems).toHaveLength(1);
    expect(frozenCheck({ repo: d, base: "HEAD" }).problems).toEqual([]);
  });

  test("measured from the fork point: commits that landed on the base since do not count", () => {
    const d = frozenRepo();
    git(d, "branch", "-M", "main");
    git(d, "checkout", "-qb", "pr");
    write(d, "contracts/notes.md", "x\n");
    commit(d);
    git(d, "checkout", "-q", "main");
    write(d, "src/a.ts", "export const a = 3\n");
    commit(d);
    git(d, "checkout", "-q", "pr");
    const r = frozenCheck({ repo: d, base: "main" });
    expect(r.changed).toEqual([{ path: "contracts/notes.md", kind: "spec" }]);
    expect(r.problems).toEqual([]);
    expect(r.at).toBe(git(d, "rev-parse", "HEAD~1").trim());
    // The same PR with its own implementation change is still refused.
    write(d, "src/a.ts", "export const a = 4\n");
    expect(frozenCheck({ repo: d, base: "main" }).problems).toHaveLength(1);
  });

  test("a generated test is spec side: with its contract it passes, beside the code it is refused", () => {
    const d = frozenRepo();
    const c = clone(hkdf);
    c.requirements[0].note = "edited";
    write(d, "contracts/h.json", JSON.stringify(c));
    write(
      d,
      "test/h.ts",
      `// vector-contract-sha256: ${"0".repeat(64)}\nexport {}\n`,
    );
    const r = frozenCheck({ repo: d, base: "HEAD" });
    expect(r.changed).toContainEqual({ path: "test/h.ts", kind: "generated" });
    expect(r.problems).toEqual([]);
    write(d, "src/a.ts", "export const a = 2\n");
    const mixed = frozenCheck({ repo: d, base: "HEAD" });
    expect(mixed.problems).toHaveLength(1);
    expect(mixed.problems[0]).toContain("test/h.ts");
  });

  test("a generated test beside the code alone is refused too", () => {
    const d = frozenRepo();
    write(
      d,
      "test/h.ts",
      `// vector-contract-sha256: ${"0".repeat(64)}\nexport {}\n`,
    );
    write(d, "src/a.ts", "export const a = 2\n");
    expect(frozenCheck({ repo: d, base: "HEAD" }).problems).toHaveLength(1);
  });

  test("every source a contract declares is spec side, wherever it lives", () => {
    const d = repo();
    const c = clone(hkdf) as RfcContract;
    const { rfc: _rfc, ...rest } = c.source;
    c.source = { ...rest, main: "rfc5869" } as RfcContract["source"];
    c.sources = [
      { id: "rfc5869", rfc: 5869 },
      { id: "errata", path: "../docs/errata.md" },
    ];
    write(d, "contracts/h.json", JSON.stringify(c));
    mkdirSync(join(d, "rfcs"));
    writeFileSync(join(d, "rfcs/rfc5869.txt"), rfc);
    write(d, "docs/errata.md", "# 1. Errata\n");
    write(d, "src/a.ts", "export const a = 1\n");
    commit(d);
    write(d, "docs/errata.md", "# 1. Errata\n\nchanged\n");
    write(d, "src/a.ts", "export const a = 2\n");
    const r = frozenCheck({ repo: d, base: "HEAD" });
    expect(r.changed).toContainEqual({ path: "docs/errata.md", kind: "spec" });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain("docs/errata.md");
  });

  test("a main source that no longer matches source.sha256 is refused", () => {
    const d = frozenRepo();
    writeFileSync(join(d, "rfcs/rfc5869.txt"), `${rfc}\nchanged\n`);
    const r = frozenCheck({ repo: d, base: "HEAD" });
    expect(r.problems.join("\n")).toContain(
      "the spec changed under the contract",
    );
    expect(r.contracts[0].problem).toBeDefined();
  });

  test("a contract with no source.sha256, no source on disk, or bad JSON is refused", () => {
    const d = frozenRepo();
    const noSha = clone(hkdf);
    noSha.source.sha256 = undefined;
    write(d, "contracts/nosha.json", JSON.stringify(noSha));
    const other = clone(hkdf);
    other.source.rfc = 1;
    write(d, "contracts/nosrc.json", JSON.stringify(other));
    const at = clone(hkdf);
    at.source.rfc = undefined;
    at.source.main = "s";
    at.sources = [{ id: "s", path: "missing.md" }];
    write(d, "contracts/path.json", JSON.stringify(at));
    write(d, "contracts/bad.json", "{");
    write(d, "contracts/shape.json", "{}");
    const r = frozenCheck({ repo: d, base: "HEAD" });
    const why = Object.fromEntries(
      r.contracts.map((c) => [c.path.split("/").pop(), c.problem]),
    );
    expect(why["h.json"]).toBeUndefined();
    expect(why["nosha.json"]).toContain("no source.sha256");
    expect(why["nosrc.json"]).toContain("is not on disk");
    expect(why["path.json"]).toContain("missing.md");
    expect(why["bad.json"]).toContain("cannot read it");
    expect(why["shape.json"]).toContain("not a contract");
  });

  test("no contracts to check is a failure", () => {
    const d = repo();
    write(d, "a.ts", "x\n");
    commit(d);
    expect(frozenCheck({ repo: d, base: "HEAD" }).problems).toEqual([
      "no contracts to check",
    ]);
    expect(
      frozenCheck({ repo: d, base: "HEAD", contracts: [] }).problems,
    ).toEqual(["no contracts to check"]);
  });

  test("a git error is a failure: an unknown base, an option-like base, not a repo", () => {
    const d = frozenRepo();
    expect(() => frozenCheck({ repo: d, base: "nope" })).toThrow(/nope/);
    expect(() => frozenCheck({ repo: d, base: "--output=x" })).toThrow();
    expect(() =>
      frozenCheck({ repo: tmp("vector-norepo-"), base: "HEAD" }),
    ).toThrow(/git rev-parse/);
  });

  test("the CLI: exit 0 on OK, 1 on a mixed change, 2 on a git error, JSON on request", async () => {
    const d = frozenRepo();
    let r = await cli(["frozen", "--repo", d, "--base", "HEAD"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("OK");
    write(d, "specs/s.md", "x\n");
    write(d, "src/b.ts", "x\n");
    r = await cli(["frozen", "--repo", d, "--base", "HEAD", "--json"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out).problems).toHaveLength(1);
    r = await cli([
      "frozen",
      "--repo",
      d,
      "--base",
      "HEAD",
      join(d, "contracts/h.json"),
    ]);
    expect(r.code).toBe(1);
    r = await cli(["frozen", "--repo", d, "--base", "nope"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("error:");
    r = await cli(["frozen", "--repo", d]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--base");
  });

  test("vector's own contracts record the sha256 of their sources", () => {
    const r = frozenCheck({ repo: VECTOR_ROOT, base: "HEAD" });
    expect(r.contracts.length).toBeGreaterThan(0);
    expect(r.contracts.filter((c) => c.problem)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// stale

describe("spec stale", () => {
  const d = tmp("vector-stale-");
  const contract = join(d, "c.json");
  writeFileSync(contract, JSON.stringify(hkdf));
  const bytes = readFileSync(contract);
  const line = (h: string) => `// vector-contract-sha256: ${h}\n`;
  const fresh = join(d, "fresh.ts");
  writeFileSync(fresh, `// header\n${line(sha256(bytes))}x\n`);
  const old = join(d, "old.ts");
  writeFileSync(old, line(sha256(new TextEncoder().encode("{}"))));
  const none = join(d, "none.ts");
  writeFileSync(none, "x\n");
  const two = join(d, "two.ts");
  writeFileSync(two, line(sha256(bytes)).repeat(2));

  test("staleReason: fresh passes; stale, missing and doubled lines are refused", () => {
    expect(staleReason(readFileSync(fresh, "utf8"), bytes)).toBeNull();
    expect(staleReason(readFileSync(old, "utf8"), bytes)).toMatch(/^stale:/);
    expect(staleReason("x", bytes)).toMatch(/no `\/\/ vector-contract-sha256/);
    expect(staleReason(readFileSync(two, "utf8"), bytes)).toMatch(/2 vector/);
    // Indented or upper-case, it is not the line.
    expect(staleReason(` ${line(sha256(bytes))}`, bytes)).not.toBeNull();
    expect(
      staleReason(line(sha256(bytes).toUpperCase()), bytes),
    ).not.toBeNull();
  });

  test("the CLI: 0 fresh, 1 stale or missing, 2 unreadable or bad usage", async () => {
    let r = await cli(["stale", fresh, contract]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("as it is now");
    r = await cli(["stale", old, contract]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("stale:");
    r = await cli(["stale", none, contract, "--json"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out).problems).toHaveLength(1);
    r = await cli(["stale", two, contract]);
    expect(r.code).toBe(1);
    r = await cli(["stale", join(d, "missing.ts"), contract]);
    expect(r.code).toBe(2);
    r = await cli(["stale", fresh, join(d, "missing.json")]);
    expect(r.code).toBe(2);
    r = await cli(["stale", fresh]);
    expect(r.code).toBe(2);
    r = await cli(["stale", fresh, contract, "extra"]);
    expect(r.code).toBe(2);
  });

  test("emit writes the line stale checks; changing the contract makes it stale", async () => {
    const c = join(d, "emit.json");
    writeFileSync(c, JSON.stringify(hkdf, null, 2));
    const out = join(d, "emitted.ts");
    expect((await cli(["emit", c, "-o", out])).code).toBe(0);
    expect((await cli(["stale", out, c])).code).toBe(0);
    writeFileSync(c, `${JSON.stringify(hkdf, null, 2)}\n`);
    expect((await cli(["stale", out, c])).code).toBe(1);
  }, 60_000);

  const script = join(VECTOR_ROOT, "scripts/spec-stale.mjs");
  const node = (...args: string[]) =>
    spawnSync("node", [script, ...args], { encoding: "utf8" });

  test("scripts/spec-stale.mjs, with node only: fresh passes, stale and missing are refused", () => {
    let r = node(fresh, contract);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("fresh");
    r = node(old, contract);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("stale:");
    r = node(none, contract);
    expect(r.status).toBe(1);
    r = node(two, contract);
    expect(r.status).toBe(1);
    r = node(fresh);
    expect(r.status).toBe(2);
  });

  test("scripts/spec-stale.mjs --self-test shows a pass and the refusals", () => {
    const r = node("--self-test");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("fresh: pass");
    expect(r.stdout).toContain("stale: refused");
    expect(r.stdout).toContain("no line: refused");
  });

  test("the script and the Bun command agree on the emitted line", () => {
    const src = readFileSync(script, "utf8");
    expect(src).toContain("vector-contract-sha256: ([0-9a-f]{64})$");
    expect(src).not.toMatch(/from "(?!node:)/);
  });
});

// ---------------------------------------------------------------------------
// exports

describe("spec exports", () => {
  const MOD = "std/crypto/hkdf.ts";
  const baseSrc = [
    "export const hkdfExtractSha256 = (s: u8[], k: u8[]): u8[] => k",
    "export const hkdfExpandSha256 = (p: u8[], i: u8[], n: i32): u8[] | null => null",
    "export const helper = (x: i32): i32 => x",
    "const internal = 1",
    "",
  ].join("\n");
  /** A nish-like checkout whose base commit holds `baseSrc`; `nested` puts it below the git top. */
  const exportsRepo = (nested = false) => {
    const top = repo("vector-exports-");
    const root = nested ? join(top, "nish") : top;
    write(root, MOD, baseSrc);
    commit(top);
    return root;
  };
  const check = (root: string, c: RfcContract = hkdf, base = "HEAD") =>
    exportsCheck({ contract: c, nishRoot: root, base });

  test("target.module maps to its std/ file; anything else is refused", () => {
    expect(targetModulePath(hkdf)).toBe(MOD);
    for (const m of ["crypto/hkdf", "nish/../x", "nish/a//b", "nish/./a"]) {
      const c = clone(hkdf);
      c.target.module = m;
      expect(() => targetModulePath(c)).toThrow(/not a nish/);
    }
  });

  test("no change passes", () => {
    const r = check(exportsRepo());
    expect(r.problems).toEqual([]);
    expect(renderExports(r)).toContain("no exports added, changed or deleted");
  });

  test("changing a tested export passes; an untested one is refused", () => {
    const root = exportsRepo();
    write(
      root,
      MOD,
      baseSrc
        .replace("=> k", "=> s")
        .replace("(x: i32): i32 => x", "(x: i32): i32 => x + 1"),
    );
    const r = check(root);
    expect(r.changes).toEqual([
      { name: "hkdfExtractSha256", kind: "changed" },
      { name: "helper", kind: "changed" },
    ]);
    expect(r.problems).toEqual([
      "export helper is changed, but the contract neither tests it nor lists it in outOfScope with a reason",
    ]);
    expect(renderExports(r)).toContain("FAILED");
  });

  test("an added untested export is refused; outOfScope with a reason lets it through", () => {
    const root = exportsRepo(true);
    write(
      root,
      MOD,
      `${baseSrc}export function extra(): i32 {\n  return 1\n}\n`,
    );
    expect(check(root).problems).toEqual([
      "export extra is added, but the contract neither tests it nor lists it in outOfScope with a reason",
    ]);
    const c = clone(hkdf);
    c.outOfScope = [{ name: "extra", reason: "a convenience wrapper" }];
    const r = check(root, c);
    expect(r.problems).toEqual([]);
    expect(r.notes).toEqual([
      "export extra is added, out of scope: a convenience wrapper",
    ]);
    expect(renderExports(r)).toContain("notes:");
  });

  test("deleting a tested export is refused; an untested one is a note", () => {
    const root = exportsRepo();
    write(root, MOD, baseSrc.replace(/^export const helper.*\n/m, ""));
    let r = check(root);
    expect(r.problems).toEqual([]);
    expect(r.notes).toEqual([
      "export helper is deleted; the contract does not test it",
    ]);
    const c = clone(hkdf);
    c.outOfScope = [{ name: "helper", reason: "r" }];
    expect(check(root, c).notes[0]).toContain("its outOfScope entry can go");
    write(
      root,
      MOD,
      baseSrc.replace(/^export const hkdfExpandSha256.*\n/m, ""),
    );
    r = check(root);
    expect(r.changes).toContainEqual({
      name: "hkdfExpandSha256",
      kind: "deleted",
    });
    // The deleted line sits against helper, so helper counts as changed too:
    // over-reporting, never under.
    expect(r.problems).toContain(
      "export hkdfExpandSha256 is deleted, but the contract tests it: its test can no longer build",
    );
  });

  test("an export commented out is deleted, not missed; indented at the top it is still an export", () => {
    const root = exportsRepo();
    write(
      root,
      MOD,
      baseSrc.replace(
        /^(export const hkdfExpandSha256.*)$/m,
        (l) => `/*\n${l}\n*/`,
      ),
    );
    expect(check(root).problems[0]).toContain(
      "export hkdfExpandSha256 is deleted",
    );
    write(
      root,
      MOD,
      baseSrc.replace(
        /^export const hkdfExpandSha256/m,
        "  export const hkdfExpandSha256",
      ),
    );
    const r = check(root);
    expect(r.problems).toEqual([]);
    expect(r.changes).toEqual([{ name: "hkdfExpandSha256", kind: "changed" }]);
  });

  test("the module removed entirely deletes every export", () => {
    const root = exportsRepo();
    rmSync(join(root, MOD));
    const r = check(root);
    expect(r.changes.map((e) => e.kind)).toEqual([
      "deleted",
      "deleted",
      "deleted",
    ]);
    expect(r.problems).toHaveLength(2);
  });

  test("a module new since the base: every export is added", () => {
    const top = repo();
    write(top, "README.md", "x\n");
    commit(top);
    write(top, MOD, baseSrc);
    const r = check(top);
    expect(r.changes.map((e) => `${e.kind} ${e.name}`)).toEqual([
      "added hkdfExtractSha256",
      "added hkdfExpandSha256",
      "added helper",
    ]);
    expect(r.problems).toEqual([
      "export helper is added, but the contract neither tests it nor lists it in outOfScope with a reason",
    ]);
  });

  test("an export it cannot name, or several declarators, is refused (fails closed)", () => {
    const root = exportsRepo();
    write(root, MOD, `${baseSrc}export const a = 1, b = 2\n`);
    expect(() => check(root)).toThrow(/declares more than one name/);
    write(root, MOD, `${baseSrc}export { internal }\n`);
    expect(() => check(root)).toThrow(/cannot name/);
    expect(() => exportedNames("export const a = 1, b = 2\n", "f")).toThrow(
      DiffParseError,
    );
    expect([...exportedNames(baseSrc, "f")]).toEqual([
      "hkdfExtractSha256",
      "hkdfExpandSha256",
      "helper",
    ]);
  });

  test("outOfScope needs a reason and must not name a tested function", () => {
    const c = clone(hkdf) as unknown as Record<string, unknown>;
    c.outOfScope = [{ name: "x", reason: " " }];
    expect(validateContractShape(c)).toEqual([
      "outOfScope[0].reason: a non-empty string",
    ]);
    c.outOfScope = [{ name: "hkdfExpandSha256", reason: "r" }];
    expect(validateContractShape(c)[0]).toContain(
      "is a function the contract tests",
    );
    c.outOfScope = [
      { name: "x", reason: "r" },
      { name: "x", reason: "r" },
    ];
    expect(validateContractShape(c)[0]).toContain("duplicate");
    c.outOfScope = [{ name: "not an ident", reason: "r" }];
    expect(validateContractShape(c)[0]).toContain("an identifier");
    // hmacSha256 is tested, but in another module: it may be out of scope here.
    c.outOfScope = [{ name: "hmacSha256", reason: "r" }];
    expect(validateContractShape(c)).toEqual([]);
    expect(() =>
      exportsCheck({ contract: { x: 1 }, nishRoot: "/", base: "HEAD" }),
    ).toThrow(/not a contract/);
  });

  test("a git error is a failure", () => {
    const root = exportsRepo();
    expect(() => check(root, hkdf, "nope")).toThrow();
    expect(() => check(root, hkdf, "-x")).toThrow();
    expect(() => check(tmp("vector-norepo-"))).toThrow(
      /git merge-base HEAD HEAD failed.*not a git repository/,
    );
  });

  test("the CLI: 0 on OK, 1 on a problem, 2 on a git error or missing option", async () => {
    const root = exportsRepo();
    const contract = join(VECTOR_ROOT, "contracts/rfc5869-hkdf-sha256.json");
    let r = await cli([
      "exports",
      contract,
      "--nish-root",
      root,
      "--base",
      "HEAD",
    ]);
    expect(r.code).toBe(0);
    write(root, MOD, `${baseSrc}export const more = 1\n`);
    r = await cli([
      "exports",
      contract,
      "--nish-root",
      root,
      "--base",
      "HEAD",
      "--json",
    ]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out).changes).toEqual([
      { name: "more", kind: "added" },
    ]);
    r = await cli(["exports", contract, "--nish-root", root, "--base", "nope"]);
    expect(r.code).toBe(2);
    r = await cli(["exports", contract, "--base", "HEAD"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--nish-root");
    r = await cli(["exports", contract, "--nish-root", root]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--base");
  });
});

// ---------------------------------------------------------------------------
// allowSurvivors and source.sha256 shapes

describe("contract shape: allowSurvivors and source.sha256", () => {
  const shape = (patch: (c: Record<string, unknown>) => void) => {
    const c = clone(hkdf) as unknown as Record<string, unknown>;
    patch(c);
    return validateContractShape(c);
  };
  test("a well-formed allowance passes; an empty reason or a bad line is refused", () => {
    expect(
      shape((c) => {
        c.allowSurvivors = [{ file: "std/a.ts", line: 3, reason: "r" }];
      }),
    ).toEqual([]);
    expect(
      shape((c) => {
        c.allowSurvivors = [{ file: "std/a.ts", line: 3, reason: "" }];
      }),
    ).toEqual(["allowSurvivors[0].reason: a non-empty string"]);
    expect(
      shape((c) => {
        c.allowSurvivors = [{ file: "std/a.ts", line: 0, reason: "r" }];
      }),
    ).toEqual(["allowSurvivors[0].line: a line number >= 1"]);
    expect(
      shape((c) => {
        c.allowSurvivors = { file: "std/a.ts", line: 3, reason: "r" };
      }),
    ).toEqual(["contract.allowSurvivors: an array"]);
  });
  test("source.sha256 is 64 lowercase hex digits", () => {
    expect(
      shape((c) => {
        (c.source as Record<string, unknown>).sha256 = "AB";
      }),
    ).toEqual(["contract.source.sha256: 64 lowercase hex digits"]);
  });
});

// ---------------------------------------------------------------------------
// reports: markdown, and the mutation section in every format

describe("reports", () => {
  let checked: ContractReport;
  beforeAll(async () => {
    const r = await cli([
      "check",
      join(VECTOR_ROOT, "contracts/rfc5869-hkdf-sha256.json"),
      "--format",
      "markdown",
    ]);
    expect(r.code).toBe(0);
    markdown = r.out;
    checked = { contract: hkdf, gates: runGates(hkdf) };
  }, 60_000);
  let markdown = "";

  test("check --format markdown: a dashboard per requirement", () => {
    expect(markdown).toContain("## ✅ rfc5869-hkdf-sha256: CONTRACT_VALID");
    expect(markdown).toContain("#### R-EXTRACT");
    expect(markdown).toContain("> PRK = HMAC-Hash(salt, IKM)");
    expect(markdown).toContain(
      "| Clause | Title | Outcome | Evidence | Detail |",
    );
  });

  test("an invalid contract renders as a failed markdown report", async () => {
    const d = tmp("vector-md-");
    const c = clone(hkdf);
    c.requirements[0].quote = "not in the RFC at all";
    writeFileSync(join(d, "c.json"), JSON.stringify(c));
    const r = await cli(["check", join(d, "c.json"), "--format", "markdown"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("## ❌");
    expect(r.out).toContain("Gate failures");
  }, 60_000);

  const result = (
    line: number,
    outcome: MutantResult["outcome"],
    mutated: string,
    allowed?: string,
  ): MutantResult => ({
    mutant: {
      id: `${line}:1:int-literal`,
      operator: "int-literal",
      line,
      column: 1,
      original: "const x = 1 | 2",
      mutated,
    },
    outcome,
    allowed,
  });
  const mutation = (): MutationReport => {
    const results = [
      result(3, "killed", "const x = 2"),
      result(4, "survived", "const y = a | b"),
      result(5, "survived", "", "dead code"),
      result(6, "stillborn", "const z ="),
    ];
    return {
      file: "std/m.ts",
      generated: 9,
      results,
      counts: { killed: 1, survived: 2, stillborn: 1, timeout: 0 },
      survivors: [results[1]],
      unusedAllowances: [{ file: "std/m.ts", line: 40, reason: "old" }],
    };
  };

  test("the mutation section: survivors, allowed ones, unused allowances", () => {
    const r = { ...checked, mutation: mutation() } as ContractReport;
    expect(reportStatus(r)).toBe("SURVIVORS");
    const text = renderReport(r);
    expect(text).toContain(
      "4 of 9 mutants run: 1 killed, 0 timed out, 2 survived (1 not allowed); 1 stillborn, not counted",
    );
    expect(text).toContain(
      `✘ std/m.ts:4  const y = a | b  — ${SURVIVOR_MEANING}`,
    );
    expect(text).toContain(
      "– std/m.ts:5  (deleted) const x = 1 | 2  — allowed: dead code",
    );
    expect(text).toContain("! allowSurvivors std/m.ts:40 matched no survivor");
    const md = renderMarkdown(r);
    expect(md).toContain("### Mutation of `std/m.ts`");
    expect(md).toContain("| `std/m.ts:4` | `const y = a \\| b` |");
    expect(md).toContain("➖ allowed: dead code");
    expect(md).toContain("⚠️ allowSurvivors `std/m.ts:40` matched no survivor");
    const json = reportJson(r) as { mutation: Record<string, unknown> };
    expect(json.mutation.survivors).toEqual([
      {
        at: "std/m.ts:4",
        id: "4:1:int-literal",
        original: "const x = 1 | 2",
        mutated: "const y = a | b",
      },
    ]);
    expect(json.mutation.allowed).toEqual([
      { at: "std/m.ts:5", id: "5:1:int-literal", reason: "dead code" },
    ]);
  });

  test("every survivor allowed: MUTANTS_KILLED", () => {
    const m = mutation();
    m.survivors = [];
    expect(reportStatus({ ...checked, mutation: m } as ContractReport)).toBe(
      "MUTANTS_KILLED",
    );
  });

  test("markdown: exclusions, every vector source, uncovered requirements, a run that did not finish", () => {
    const chacha = JSON.parse(
      readFileSync(
        join(VECTOR_ROOT, "contracts/rfc8439-chacha20-poly1305.json"),
        "utf8",
      ),
    ) as RfcContract;
    const md = renderMarkdown({ contract: chacha, gates: runGates(chacha) });
    expect(md).toContain("### Not tested, by decision");
    expect(md).toContain("which MUST not be repeated for the same key");

    const c = clone(hkdf);
    const vectors = c.clauses.filter((k) => k.kind === "vector");
    vectors[0].source = { command: "openssl kdf" };
    vectors[1].source = { spec: "A.1" };
    c.requirements.push({
      ...c.requirements[0],
      id: "R-NOBODY",
      quote: "nothing covers this",
    });
    // The gates of the unchanged contract: the renderer draws what it is given.
    const md2 = renderMarkdown({
      contract: c,
      gates: runGates(hkdf),
      run: {
        status: "ERROR",
        exitCode: 2,
        clauses: new Map(),
        requirements: new Map(),
        stdout: "",
        stderr: "error: ```boom```",
        nish: "nish",
      },
    });
    expect(md2).toContain("vector, expected from openssl kdf");
    expect(md2).toContain("vector, spec A.1");
    expect(md2).toContain("⭕ checked, not run");
    expect(md2).toMatch(/#### R-NOBODY .*❌ uncovered/);
    expect(md2).toContain("### The test did not complete");
    expect(md2).toContain("error: ˋˋˋboomˋˋˋ");
  });

  test("--format is checked, and markdown is only for reports", async () => {
    const contract = join(VECTOR_ROOT, "contracts/rfc5869-hkdf-sha256.json");
    for (const argv of [
      ["check", contract, "--format", "html"],
      ["frozen", "--base", "HEAD", "--format", "markdown"],
      ["exports", contract, "--format", "markdown"],
      ["stale", "a", "b", "--format", "markdown"],
      ["check", contract, "extra"],
      ["mutate", contract, "--jobs", "0"],
      ["mutate", contract, "--max", "1.5"],
      ["mutate", contract, "--jobs"],
    ]) {
      const r = await cli(argv);
      expect(r.code, argv.join(" ")).toBe(2);
      expect(r.err).toContain("error:");
    }
  });

  test("mutate refuses an invalid contract before running anything", async () => {
    const d = tmp("vector-mut-invalid-");
    const c = clone(hkdf);
    c.requirements[0].quote = "not in the RFC at all";
    writeFileSync(join(d, "c.json"), JSON.stringify(c));
    const r = await cli([
      "mutate",
      join(d, "c.json"),
      "--base",
      "HEAD",
      "--nish-root",
      d,
    ]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("INVALID");
  }, 60_000);

  test("mutate needs --base and --nish-root", async () => {
    const contract = join(VECTOR_ROOT, "contracts/rfc5869-hkdf-sha256.json");
    let r = await cli(["mutate", contract, "--nish-root", "/x"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--base");
    r = await cli(["mutate", contract, "--base", "HEAD"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--nish-root");
  });
});

// ---------------------------------------------------------------------------
// Live: mutate and exports against a synthetic nish checkout. VECTOR_NISH is
// the seed's bin/nish inside a nish checkout; the checkout is four up.
const nish = process.env.VECTOR_NISH;
if (process.env.VECTOR_REQUIRE_NISH === "1" && !nish)
  test("VECTOR_REQUIRE_NISH=1 needs VECTOR_NISH", () => {
    throw new Error("VECTOR_REQUIRE_NISH=1 but VECTOR_NISH is not set");
  });

describe.skipIf(!nish)("spec mutate against a synthetic nish checkout", () => {
  const nishRoot = resolve(nish ?? "", "../../../..");
  const MOD = "std/crypto/hkdf.ts";
  const contract = join(VECTOR_ROOT, "contracts/rfc5869-hkdf-sha256.json");
  const real = () => readFileSync(join(nishRoot, MOD), "utf8");
  const lineOf = (src: string, text: string) =>
    src.split("\n").findIndex((l) => l.includes(text)) + 1;
  /**
   * A checkout whose base commit has `MOD` with `edit` applied and whose
   * working tree has the real one, so the diff is just the edited lines. Its
   * build/ is the real checkout's seed.
   */
  const synth = (edit: (src: string) => string) => {
    const d = repo("vector-synth-");
    symlinkSync(join(nishRoot, "build"), join(d, "build"));
    writeFileSync(join(d, ".gitignore"), "build\n");
    cpSync(join(nishRoot, "std"), join(d, "std"), { recursive: true });
    write(d, MOD, edit(real()));
    commit(d);
    write(d, MOD, real());
    return d;
  };
  const LABEL = "out[2] = toU8(fullLength)";
  const BOUND = "const HKDF_MAX_BLOCKS: i32 = 255";
  let label = "";
  beforeAll(() => {
    label = synth((s) => s.replace(LABEL, "out[2] = toU8(fullLength + 1)"));
  });

  test("a change no requirement covers: survivors as file:line, exit 1", async () => {
    const r = await cli([
      "mutate",
      contract,
      "--nish-root",
      label,
      "--base",
      "HEAD",
      "--max",
      "2",
      "--jobs",
      "2",
    ]);
    expect(r.code, r.err).toBe(1);
    expect(r.out).toContain("Status: SURVIVORS");
    const at = `${MOD}:${lineOf(real(), LABEL)}`;
    expect(r.out).toContain(`✘ ${at}`);
    expect(r.out).toContain(SURVIVOR_MEANING);
  }, 300_000);

  test("the same survivors allowed with a reason: exit 0, markdown dashboard", async () => {
    const d = tmp("vector-allow-");
    const c = clone(hkdf);
    c.allowSurvivors = [
      {
        file: MOD,
        line: lineOf(real(), LABEL),
        reason: "the TLS label helper is outside RFC 5869",
      },
    ];
    writeFileSync(join(d, "c.json"), JSON.stringify(c));
    const r = await cli([
      "mutate",
      join(d, "c.json"),
      "--nish-root",
      label,
      "--base",
      "HEAD",
      "--max",
      "2",
      "--jobs",
      "2",
      "--format",
      "markdown",
    ]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain("MUTANTS_KILLED");
    expect(r.out).toContain(
      "➖ allowed: the TLS label helper is outside RFC 5869",
    );
  }, 300_000);

  test("a change the contract pins down: the mutant is killed, exit 0", async () => {
    const d = synth((s) =>
      s.replace(BOUND, "const HKDF_MAX_BLOCKS: i32 = 256"),
    );
    const r = await cli([
      "mutate",
      contract,
      "--nish-root",
      d,
      "--base",
      "HEAD",
      "--max",
      "1",
      "--json",
    ]);
    expect(r.code, r.err).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.mutation.counts.killed).toBe(1);
    expect(j.mutation.survivors).toEqual([]);
  }, 300_000);

  test("no change, so no mutants: a failure, not a pass", async () => {
    const d = synth((s) => s);
    const r = await cli([
      "mutate",
      contract,
      "--nish-root",
      d,
      "--base",
      "HEAD",
    ]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("no mutants in the changed lines");
  }, 60_000);

  test("a test that fails on the unmutated module: a failure", async () => {
    // The working tree breaks the bound, so the contract fails before any mutant.
    const d = synth((s) => s.replace(LABEL, "out[2] = toU8(fullLength + 1)"));
    write(d, MOD, real().replace(BOUND, "const HKDF_MAX_BLOCKS: i32 = 2"));
    const r = await cli([
      "mutate",
      contract,
      "--nish-root",
      d,
      "--base",
      "HEAD",
      "--max",
      "1",
    ]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("does not pass on the unmutated");
  }, 300_000);

  test("exports against the real module: an added untested export is refused", async () => {
    const d = synth((s) => s);
    let r = await cli([
      "exports",
      contract,
      "--nish-root",
      d,
      "--base",
      "HEAD",
    ]);
    expect(r.code, r.out).toBe(0);
    write(d, MOD, `${real()}\nexport const hkdfExtra = (): i32 => 1\n`);
    r = await cli(["exports", contract, "--nish-root", d, "--base", "HEAD"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("export hkdfExtra is added");
  }, 60_000);
});
