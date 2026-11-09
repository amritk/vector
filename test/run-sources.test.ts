import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { foreignCommandsWarning } from "../src/rfc/cli.ts";
import type { RfcContract } from "../src/rfc/contract.ts";

// --run-sources runs shell commands a contract names. Run from a contract the
// repository did not check in, it says so and lists them first (#28).

const withCommands = (...commands: string[]) =>
  ({
    clauses: [
      { id: "R-1", kind: "requirement" },
      ...commands.map((command, i) => ({
        id: `V-${i}`,
        kind: "vector",
        source: { command },
      })),
      { id: "V-CITE", kind: "vector", source: { cite: { section: "1" } } },
    ],
  }) as unknown as RfcContract;

const repo = resolve(import.meta.dir, "..");

describe("--run-sources on a contract from elsewhere", () => {
  test("names the contract and lists every command it will run", () => {
    const dir = mkdtempSync(join(tmpdir(), "run-sources-"));
    const contract = join(dir, "c.json");
    const w = foreignCommandsWarning(
      contract,
      withCommands("printf deadbeef", "setsid sh -c 'sleep 9' &"),
      dir,
    );
    expect(w).toContain(
      `warning: --run-sources runs 2 shell command(s) from ${contract}, which is not in a repository's contracts/.`,
    );
    expect(w).toContain("not a process it detached with setsid");
    expect(w).toContain("  [V-0] $ printf deadbeef");
    expect(w).toContain("  [V-1] $ setsid sh -c 'sleep 9' &");
    expect(w).not.toContain("V-CITE");
  });

  test("outside this repository's contracts/, it names that directory", () => {
    const w = foreignCommandsWarning(
      join(repo, "test/fixtures/c.json"),
      withCommands("true"),
      repo,
    );
    expect(w).toContain(`which is not in ${join(repo, "contracts")}/.`);
  });

  test("is quiet for a checked-in contract, or one with no commands", () => {
    expect(
      foreignCommandsWarning(
        join(repo, "contracts/example-hex.json"),
        withCommands("true"),
        repo,
      ),
    ).toBeUndefined();
    expect(
      foreignCommandsWarning(join(tmpdir(), "c.json"), withCommands(), repo),
    ).toBeUndefined();
  });
});
