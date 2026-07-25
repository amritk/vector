import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// CLI-level contract: argument handling and exit codes, exercised through a
// real subprocess (the same way CI and the vector-gate template consume it).

const repoRoot = join(import.meta.dir, "..");
const cli = join(repoRoot, "src/cli.ts");

function runCli(
  args: string[],
  env: Record<string, string | undefined> = {},
): { exitCode: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["bun", cli, ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

describe("cli", () => {
  test("no arguments prints usage and exits 2", () => {
    const res = runCli([]);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain("Usage: vector");
    expect(res.stderr).toContain("--review");
  });

  test("unknown flags exit 2", () => {
    const res = runCli(["--frobnicate"]);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain("Unknown flag");
  });

  test("--verify on the proven fixture pair exits 0 with PROVEN JSON", () => {
    const res = runCli([
      "--verify",
      "test/fixtures/currency-spec.json",
      "test/fixtures/currency.json",
      "--json",
    ]);
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout).status).toBe("PROVEN");
  }, 60_000);

  test("--review without credentials exits 2, not 1", () => {
    // Force the API backend so the test never invokes a live claude CLI.
    const res = runCli(
      ["--review", "test/fixtures/currency-spec.json", "--intent", "x"],
      { VECTOR_LLM: "api", ANTHROPIC_API_KEY: undefined },
    );
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain("Review failed");
    expect(res.stderr).toContain("ANTHROPIC_API_KEY");
  }, 60_000);
});
