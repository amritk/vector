import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { VECTOR_ROOT, frozenCheck } from "../src/rfc/frozen.ts";

// `vector spec frozen --base … contracts/*.json` expands to the
// *.survivors.json sidecars too. They are not contracts, so frozen skips one
// passed by name, as it does when it finds the contracts itself.

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
};

/** A committed repo holding example-hex's contract, its sidecar and sources. */
const repo = () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "vector-sidecars-")));
  dirs.push(d);
  for (const f of [
    "contracts/example-hex.json",
    "contracts/example-hex.survivors.json",
    "specs/example-hex.xml",
    "rfcs/rfc4648.txt",
  ]) {
    mkdirSync(dirname(join(d, f)), { recursive: true });
    cpSync(join(VECTOR_ROOT, f), join(d, f));
  }
  git(d, "init", "-q");
  git(d, "config", "user.email", "t@example.com");
  git(d, "config", "user.name", "t");
  git(d, "config", "commit.gpgsign", "false");
  git(d, "add", "-A");
  git(d, "commit", "-qm", "c");
  return d;
};

describe("spec frozen skips a sidecar passed by name", () => {
  const d = repo();
  const contract = join(d, "contracts/example-hex.json");
  const sidecar = join(d, "contracts/example-hex.survivors.json");

  test("a contract and its sidecar: the contract alone is checked", () => {
    const r = frozenCheck({
      repo: d,
      base: "HEAD",
      contracts: [contract, sidecar],
    });
    expect(r.problems).toEqual([]);
    expect(r.contracts.map((c) => c.path)).toEqual([contract]);
  });

  test("only the sidecar: no contract to check", () => {
    const r = frozenCheck({ repo: d, base: "HEAD", contracts: [sidecar] });
    expect(r.contracts).toEqual([]);
    expect(r.problems).toEqual(["no contracts to check"]);
  });
});
