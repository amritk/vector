import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { foreignCommandsWarning } from "../src/rfc/cli.ts";
import type { RfcContract } from "../src/rfc/contract.ts";
import {
  type Containment,
  runSourceCommands,
  sourceContainment,
} from "../src/rfc/run.ts";

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
      "group",
    );
    expect(w).toContain(
      `warning: --run-sources runs 2 shell command(s) from ${contract}, which is not in a repository's contracts/.`,
    );
    expect(w).toContain("not a process it detached with setsid");
    expect(w).toContain("  [V-0] $ printf deadbeef");
    expect(w).toContain("  [V-1] $ setsid sh -c 'sleep 9' &");
    expect(w).not.toContain("V-CITE");
    // Where a PID namespace holds each command, it says that instead.
    const held = foreignCommandsWarning(
      contract,
      withCommands("true"),
      dir,
      "namespace",
    );
    expect(held).toContain(
      "Each runs in its own PID namespace: at its timeout or its exit, everything it started inside it is killed. A service it asks to start something (a tmux server already running, systemd-run, at, docker) is outside it, and setuid tools such as sudo do not work in it.",
    );
    expect(held).not.toContain("setsid");
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

// Each command runs in its own PID namespace where Linux allows it, so a
// process it detached with setsid dies with it.
const contract = (command: string) =>
  ({
    clauses: [
      {
        id: "V-CMD",
        kind: "vector",
        source: { command },
        expect: { str: "ok" },
      },
    ],
  }) as unknown as RfcContract;

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(process.platform !== "linux")("--run-sources on Linux", () => {
  test("holds each command in a PID namespace, or else marks it", () => {
    expect(["namespace", "marked"]).toContain(sourceContainment());
    // Without user namespaces, the warning says what the marking misses.
    expect(
      foreignCommandsWarning(
        join(tmpdir(), "c.json"),
        withCommands("true"),
        tmpdir(),
        "marked",
      ),
    ).toContain("one that clears its environment escapes");
  });

  const modes: Containment[] = [
    ...(sourceContainment() === "namespace" ? (["namespace"] as const) : []),
    "marked",
  ];
  for (const containment of modes) {
    test(`${containment}: a setsid'd child dies at the timeout`, async () => {
      const mark = join(mkdtempSync(join(tmpdir(), "run-sources-")), "leaked");
      const r = await runSourceCommands(
        contract(`setsid sh -c 'sleep 1; touch ${mark}' & sleep 5`),
        { timeoutMs: 200, containment },
      );
      expect(r.get("V-CMD")?.detail).toBe("timed out after 200 ms");
      await settle(1_500);
      expect(existsSync(mark)).toBe(false);
    });

    test(`${containment}: a setsid'd child holding stdout open dies at the timeout`, async () => {
      const mark = join(mkdtempSync(join(tmpdir(), "run-sources-")), "leaked");
      const started = Date.now();
      const r = await runSourceCommands(
        contract(`setsid sh -c 'sleep 1; touch ${mark}; sleep 9'; echo ok`),
        { timeoutMs: 200, containment },
      );
      expect(r.get("V-CMD")?.detail).toBe("timed out after 200 ms");
      expect(Date.now() - started).toBeLessThan(900);
      await settle(1_500);
      expect(existsSync(mark)).toBe(false);
    });

    test(`${containment}: a setsid'd child dies when the command exits`, async () => {
      const mark = join(mkdtempSync(join(tmpdir(), "run-sources-")), "leaked");
      const r = await runSourceCommands(
        contract(
          `(setsid sh -c 'sleep 1; touch ${mark}' >/dev/null 2>&1 &); echo ok`,
        ),
        { containment },
      );
      expect(r.get("V-CMD")?.outcome).toBe("pass");
      await settle(1_500);
      expect(existsSync(mark)).toBe(false);
    });

    test(`${containment}: the command still runs as you, from the contract's directory`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "run-sources-"));
      const id = await runSourceCommands(
        contract(
          `[ "$(id -u)" = "${process.getuid?.()}" ] && [ "$(pwd -P)" = "$(cd ${dir} && pwd -P)" ] && echo ok`,
        ),
        { cwd: dir, containment },
      );
      expect(id.get("V-CMD")?.outcome).toBe("pass");
    });
  }

  // What none of the modes reach: setsid with a cleared environment in
  // marked mode, or plain setsid in group mode. Holding stdout, it must not
  // hold up the run past its timeout either.
  for (const [containment, detach] of [
    ["marked", "env -i setsid"],
    ["group", "setsid"],
  ] as const) {
    test(`${containment}: an escapee holding stdout does not delay the timeout`, async () => {
      const pidFile = join(mkdtempSync(join(tmpdir(), "run-sources-")), "pid");
      const started = Date.now();
      const r = await runSourceCommands(
        contract(`${detach} sh -c 'echo $$ > ${pidFile}; exec sleep 30'`),
        { timeoutMs: 300, containment },
      );
      const took = Date.now() - started;
      try {
        process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL");
      } catch {
        // Already gone.
      }
      expect(r.get("V-CMD")?.detail).toBe("timed out after 300 ms");
      expect(took).toBeLessThan(2_000);
    });
  }

  test("vector interrupted: the command it was running dies with it", async () => {
    const mark = join(mkdtempSync(join(tmpdir(), "run-sources-")), "leaked");
    const run = join(repo, "src/rfc/run.ts");
    const child = spawn(
      process.execPath,
      [
        "-e",
        `const { runSourceCommands } = await import(${JSON.stringify(run)});
        await runSourceCommands(
          { clauses: [{ id: "V-CMD", kind: "vector", source: {
            command: "setsid sh -c 'sleep 1; touch ${mark}' & echo started; sleep 30",
          } }] },
          { timeoutMs: 60_000, containment: "marked" },
        );`,
      ],
      { stdio: "ignore" },
    );
    await settle(500);
    child.kill("SIGINT");
    const signal = await new Promise((r) => child.on("exit", (_c, s) => r(s)));
    expect(signal).toBe("SIGINT");
    await settle(1_500);
    expect(existsSync(mark)).toBe(false);
  });

  test("group: a setsid'd child outlives it, as the warning says", async () => {
    const mark = join(mkdtempSync(join(tmpdir(), "run-sources-")), "leaked");
    await runSourceCommands(
      contract(
        `(setsid sh -c 'sleep 1; touch ${mark}' >/dev/null 2>&1 &); echo ok`,
      ),
      { containment: "group" },
    );
    await settle(1_500);
    expect(existsSync(mark)).toBe(true);
  });
});
