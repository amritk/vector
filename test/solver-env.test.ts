import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveDevZ3 } from "../src/solve/runner.ts";

// Locating and driving z3 fails with a solver error, never silently or with a
// crash (#21). The runner caches the z3 it finds, so the end-to-end cases run
// in a child process with their own environment.

const dirs: string[] = [];
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "solver-env-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const runner = resolve(import.meta.dir, "../src/solve/runner.ts");

/** runZ3Script on a script of `size` bytes, in a child with VECTOR_Z3 = z3. */
function runWith(z3: string, size: number) {
  const dir = scratch();
  const main = join(dir, "main.ts");
  writeFileSync(
    main,
    `import { runZ3Script } from ${JSON.stringify(runner)};
const r = await runZ3Script("(check-sat)\\n".repeat(${Math.ceil(size / 12)}), 1);
console.log(JSON.stringify(r));`,
  );
  const r = spawnSync(process.execPath, [main], {
    env: { ...process.env, VECTOR_Z3: z3 },
    encoding: "utf8",
    timeout: 60_000,
  });
  return {
    status: r.status,
    stderr: r.stderr,
    result: r.stdout.trim() ? JSON.parse(r.stdout.trim()) : undefined,
  };
}

describe("VECTOR_Z3", () => {
  test("naming a missing file is an error, not a fallback", () => {
    expect(() => resolveDevZ3({ VECTOR_Z3: "/no/such/z3" })).toThrow(
      "VECTOR_Z3 is /no/such/z3, which does not exist",
    );
    const r = runWith("/no/such/z3", 12);
    expect(r.status).toBe(0);
    expect(r.result).toEqual({
      kind: "error",
      message:
        "failed to prepare z3: VECTOR_Z3 is /no/such/z3, which does not exist",
    });
  });

  test("an existing file is used, with its directory for libz3", () => {
    const dir = scratch();
    const bin = join(dir, "z3");
    writeFileSync(bin, "");
    expect(resolveDevZ3({ VECTOR_Z3: bin })).toEqual({ bin, libDir: dir });
    expect(resolveDevZ3({ VECTOR_Z3: bin, VECTOR_Z3_LIB: "/l" })).toEqual({
      bin,
      libDir: "/l",
    });
  });
});

describe("a z3 that does not read its input", () => {
  test("is a solver error, not an uncaught EPIPE", () => {
    const bin = join(scratch(), "z3");
    writeFileSync(bin, "#!/bin/sh\nexit 0\n");
    chmodSync(bin, 0o755);
    // Far more than a pipe buffer, so the write is still going when it exits.
    const r = runWith(bin, 8 << 20);
    expect(r.stderr).not.toContain("EPIPE");
    expect(r.status).toBe(0);
    expect(r.result.kind).toBe("error");
    expect(r.result.message).toMatch(
      /stopped reading its input: EPIPE|z3 produced no verdicts/,
    );
  });
});
