import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import hkdfContract from "../contracts/rfc5869-hkdf-sha256.json";
import aeadContract from "../contracts/rfc8439-chacha20-poly1305.json";
import type { RfcContract } from "../src/rfc/contract.ts";
import { emitNishTest } from "../src/rfc/emit-nish.ts";
import { DiffParseError, gitDiff, parseGitDiff } from "../src/rfc/gitdiff.ts";
import {
  type Exec,
  type ExecResult,
  type Mutant,
  MutationRunError,
  applyMutant,
  classify,
  codeMask,
  generateMutants,
  runMutants,
  scratchExec,
  spread,
} from "../src/rfc/mutate.ts";
import { judge, parseTestOutput } from "../src/rfc/run.ts";
import { sampleContract } from "../src/rfc/sample.ts";
import { makeScratch } from "../src/rfc/scratch.ts";

// The diff-scoped mutation engine: git diff → changed lines → mutants of those
// lines → each run against the contract's emitted test in a scratch install.

const hkdf = hkdfContract as unknown as RfcContract;
const aead = aeadContract as unknown as RfcContract;
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const repo = () => {
  const d = tmp("vector-mut-git-");
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

describe("reading git diff -U0", () => {
  test("ranges and exports from a real diff, against a base commit", () => {
    const d = repo();
    write(d, "a.ts", "export const x = 1\nconst y = 2\nfunction f() {}\n");
    write(d, "gone.ts", "export function old() {}\n");
    write(d, "mode.sh", "echo\n");
    commit(d);
    write(
      d,
      "a.ts",
      "export const x = 2\nconst y = 2\nfunction f() {}\nexport function g() {}\nconst z = 3\n",
    );
    rmSync(join(d, "gone.ts"));
    chmodSync(join(d, "mode.sh"), 0o755);
    write(d, "new dir/n.ts", "x\n\texport const n = 0\n");
    git(d, "add", "-A");
    const diffs = gitDiff(d, "HEAD");
    expect(diffs).toEqual([
      {
        file: "a.ts",
        ranges: [
          [1, 1],
          [4, 5],
        ],
        exports: [
          { name: "x", kind: "changed" },
          { name: "g", kind: "added" },
        ],
      },
      { file: "gone.ts", ranges: [], exports: [] },
      {
        file: "new dir/n.ts",
        ranges: [[1, 2]],
        exports: [{ name: "n", kind: "added" }],
      },
    ]);
    expect(gitDiff(d, "HEAD", ["a.ts"]).map((f) => f.file)).toEqual(["a.ts"]);
    rmSync(d, { recursive: true, force: true });
  });

  test("a git error is an error, not an empty diff", () => {
    const d = repo();
    expect(() => gitDiff(d, "no-such-rev")).toThrow(
      /git diff -U0 no-such-rev failed/,
    );
    rmSync(d, { recursive: true, force: true });
  });

  const one = (hunks: string) =>
    `diff --git a/f.ts b/f.ts\nindex 1..2 100644\n--- a/f.ts\n+++ b/f.ts\n${hunks}`;

  test("a hunk header without counts means one line, and a 0 count adds no range", () => {
    expect(
      parseGitDiff(one("@@ -3 +3 @@ fn\n-a\n+b\n@@ -7,1 +6,0 @@\n-c\n")),
    ).toEqual([{ file: "f.ts", ranges: [[3, 3]], exports: [] }]);
    expect(
      parseGitDiff(
        one("@@ -1,0 +2,2 @@\n+a\n+b\n\\ No newline at end of file\n"),
      ),
    ).toEqual([{ file: "f.ts", ranges: [[2, 3]], exports: [] }]);
    expect(parseGitDiff("")).toEqual([]);
  });

  test("refuses what it cannot read: never an empty or partial result", () => {
    const bad: [string, RegExp][] = [
      [one("@@ -1,1 +1,1 @\n-a\n+b\n"), /cannot parse the hunk header/],
      [one("@@ -a +1 @@\n+b\n"), /cannot parse the hunk header/],
      [one("@@ -1,2 +1,1 @@\n-a\n+b\n"), /ends early/],
      [one("@@ -1,1 +1,1 @@\n-a\n b\n+c\n"), /does not count/],
      [one("@@ -1,1 +1,1 @@\n-a\n+b\n+c\n"), /unexpected line after the hunks/],
      [one(""), /expected a hunk/],
      ["index 1..2\n", /expected "diff --git"/],
      [
        "diff --git a/f b/f\nBinary files a/f and b/f differ\n",
        /binary change/,
      ],
      ["diff --git a/f b/f\n+++ b/f\n", /expected "--- "/],
      ["diff --git a/f b/f\n--- a/f\n@@ -1 +1 @@\n", /expected "\+\+\+ "/],
      ['diff --git a/f b/f\n--- "a/\\303"\n+++ b/f\n', /quoted path/],
      ["diff --git a/f b/f\n--- f\n+++ b/f\n", /cannot read the path/],
      ["diff --git a/f b/f\n--- /dev/null\n+++ /dev/null\n", /both sides/],
    ];
    for (const [text, why] of bad) {
      expect(() => parseGitDiff(text)).toThrow(DiffParseError);
      expect(() => parseGitDiff(text)).toThrow(why);
    }
  });

  test("a mode change or a rename with no hunks is no entry", () => {
    const text =
      "diff --git a/m b/m\nold mode 100644\nnew mode 100755\ndiff --git a/r b/s\nsimilarity index 100%\nrename from r\nrename to s\n";
    expect(parseGitDiff(text)).toEqual([]);
  });
});

describe("the operators", () => {
  const src = readFileSync("test/fixtures/mutate/operators.ts.txt", "utf8");
  const all = generateMutants(src, [[1, 1000]]);
  const on = (line: number) =>
    all
      .filter((m) => m.line === line)
      .map((m) => `${m.id} ${m.mutated.trim()}`.trim());

  test("relational flips, ±1, &&↔||, inside the changed lines only", () => {
    expect(on(3)).toEqual([
      "3:9:relational if (n <= 0 || n >= xs.length) {",
      "3:11:int-literal:plus if (n < 1 || n >= xs.length) {",
      "3:11:int-literal:minus if (n < -1 || n >= xs.length) {",
      "3:13:logical if (n < 0 && n >= xs.length) {",
      "3:18:relational if (n < 0 || n > xs.length) {",
    ]);
    const only6 = generateMutants(src, [[6, 6]]);
    expect(only6.map((m) => m.line)).toEqual([6, 6, 6, 6, 6]);
    expect(only6.map((m) => m.operator)).toEqual([
      "drop-not",
      "logical",
      "relational",
      "int-literal",
      "int-literal",
    ]);
    expect(only6[0].mutated).toBe("  const ok: boolean = done(xs) && n == 3");
    expect(only6[2].mutated).toBe("  const ok: boolean = !done(xs) && n != 3");
    expect(generateMutants(src, [])).toEqual([]);
  });

  test("never inside a string, a comment or a template's text", () => {
    expect(on(1)).toEqual([]);
    expect(on(7)).toEqual(["7:3:delete-statement"]);
    expect(on(8)).toEqual([]);
    expect(on(14)).toEqual([
      "14:26:int-literal:plus const t = `n < ${count + 2} && 5`",
      "14:26:int-literal:minus const t = `n < ${count + 0} && 5`",
    ]);
  });

  test("generics, arrows, shifts and identifiers with digits are not operators", () => {
    expect(on(2)).toEqual([]);
    expect(on(11)).toEqual([]);
    const m = generateMutants(
      "f(a>>b, a => b, x1, 1.5, 0x10, 1e3, 10n, 1_000, x!, !!y, a<b)\n",
      [[1, 1]],
    );
    expect(m.map((x) => x.operator)).toEqual(["delete-statement"]);
  });

  test("return x → return null only where the declared type admits null", () => {
    expect(on(9)).toEqual(["9:3:return-null return null"]);
    expect(on(4)).toEqual([]);
    expect(on(12)).toEqual([
      "12:14:int-literal:plus return x * 3",
      "12:14:int-literal:minus return x * 1",
    ]);
    const ret = (body: string, type = "null | u8") =>
      generateMutants(
        `function f(): ${type} {\n  if (a) {\n${body}\n  }\n}\n`,
        [[3, 3]],
      )
        .filter((m) => m.operator === "return-null")
        .map((m) => m.mutated);
    expect(ret("    return a")).toEqual(["    return null"]);
    expect(ret("    return a;", "u8[] | null")).toEqual(["    return null"]);
    expect(ret("    return a", "u8")).toEqual([]);
    expect(ret("    return a +")).toEqual([]);
    expect(ret("    return f(")).toEqual([]);
    expect(ret("    return a\n      .b")).toEqual([]);
    expect(
      generateMutants("{\n  return a\n}\n", [[2, 2]]).filter(
        (m) => m.operator === "return-null",
      ),
    ).toEqual([]);
  });

  test("deletes whole statements, never a piece of a longer one", () => {
    const del = (s: string, line: number) =>
      generateMutants(s, [[line, line]]).filter(
        (m) => m.operator === "delete-statement",
      );
    expect(del("if (a) {\n  f(x)\n}\n", 2)).toHaveLength(1);
    expect(del("f(a,\n  b)\n", 1)).toEqual([]);
    expect(del("x = a\n  .b()\n", 1)).toEqual([]);
    expect(del("x =\n  b()\n", 2)).toEqual([]);
    expect(del("a\n  .b()\n", 2)).toEqual([]);
    expect(del("f(a))\n", 1)).toEqual([]);
    expect(del("let x = 1\n", 1)).toEqual([]);
    expect(del("}\n", 1)).toEqual([]);
    expect(del("\n", 1)).toEqual([]);
  });

  test("applying a mutant changes its one line, and refuses another source", () => {
    const m = all.find((x) => x.id === "3:13:logical") as Mutant;
    const out = applyMutant(src, m);
    expect(out.split("\n")[2]).toBe(m.mutated);
    expect(
      out.split("\n").filter((l, i) => l !== src.split("\n")[i]),
    ).toHaveLength(1);
    expect(() => applyMutant(out, m)).toThrow(/not the line it was made from/);
  });

  test("the code mask: escapes, nested templates, unterminated comments", () => {
    const code = (s: string) =>
      [...s].map((c, i) => (codeMask(s)[i] ? c : "_")).join("");
    expect(code('a "b\\"c" d')).toBe("a ______ d");
    expect(code("a 'b' c")).toBe("a ___ c");
    expect(code("`x\\`${a + `y${b}`}` c")).toBe("______a + ____b____ c");
    expect(code("a { b } /* c")).toBe("a { b } ____");
    expect(code("a // b\nc")).toBe("a ____\nc");
  });
});

describe("scratch installs", () => {
  const fakeRoot = () => {
    const r = tmp("vector-mut-root-");
    write(r, "build/seed/libexec/nish", "#!/bin/sh\n");
    write(r, "build/seed/runtime/r.c", "r");
    write(r, "build/seed/std/stale.ts", "stale");
    write(r, "std/crypto/hkdf.ts", "original");
    write(r, "std/io.ts", "io");
    return r;
  };

  test("the checkout's std plus overrides, beside the seed's binary", () => {
    const r = fakeRoot();
    const s = makeScratch({
      nishRoot: r,
      overrides: { "std/crypto/hkdf.ts": "mutated", "./std/new/x.ts": "x" },
    });
    expect(s.nish).toBe(join(s.dir, "libexec/nish"));
    expect(readFileSync(join(s.dir, "std/crypto/hkdf.ts"), "utf8")).toBe(
      "mutated",
    );
    expect(readFileSync(join(s.dir, "std/new/x.ts"), "utf8")).toBe("x");
    expect(readFileSync(join(s.dir, "std/io.ts"), "utf8")).toBe("io");
    expect(existsSync(join(s.dir, "std/stale.ts"))).toBe(false);
    expect(existsSync(join(s.dir, "runtime/r.c"))).toBe(true);
    expect(readFileSync(join(r, "std/crypto/hkdf.ts"), "utf8")).toBe(
      "original",
    );
    s.dispose();
    expect(existsSync(s.dir)).toBe(false);
    rmSync(r, { recursive: true, force: true });
  });

  test("refuses an override outside std/ and a checkout without a seed", () => {
    const r = fakeRoot();
    for (const p of ["src/x.ts", "std/../x.ts", "../std/x.ts", "stdx/a.ts"])
      expect(() =>
        makeScratch({ nishRoot: r, overrides: { [p]: "" } }),
      ).toThrow(/is not a path under std\//);
    rmSync(join(r, "build"), { recursive: true });
    expect(() => makeScratch({ nishRoot: r })).toThrow(/does not exist/);
    rmSync(r, { recursive: true, force: true });
  });

  test("a failed copy removes the half-made install", () => {
    const r = fakeRoot();
    const made = () =>
      readdirSync(tmpdir()).filter((n) => n.startsWith("vector-scratch-"));
    const before = made();
    // std/io.ts is a file, so the override's directory cannot be made.
    expect(() =>
      makeScratch({ nishRoot: r, overrides: { "std/io.ts/x.ts": "x" } }),
    ).toThrow(/ENOTDIR|EEXIST/);
    expect(made()).toEqual(before);
    rmSync(r, { recursive: true, force: true });
  });
});

// A run of the hkdf test as nish would report it.
const ids = hkdf.clauses.map((k) => k.id);
const result = (
  stdout: string,
  stderr = "",
  exitCode: number | null = 0,
  timedOut = false,
): ExecResult => {
  const clauses = parseTestOutput(hkdf, stdout);
  return {
    timedOut,
    run: {
      ...judge(hkdf, clauses, exitCode),
      clauses,
      exitCode,
      stdout,
      stderr,
      nish: "/x/nish",
    },
  };
};
const pass = ids.map((id) => `PASS  [${id}] ok`).join("\n");
const failOne = pass.replace(`PASS  [${ids[1]}]`, `FAIL  [${ids[1]}]`);

describe("classifying a run", () => {
  test("killed, survived, stillborn and timeout", () => {
    expect(classify(result(pass)).outcome).toBe("survived");
    expect(classify(result(failOne, "", 1))).toEqual({
      outcome: "killed",
      detail: `FAIL  [${ids[1]}] ok`,
    });
    const panic = `PASS  [${ids[0]}] ok`;
    expect(
      classify(result(panic, "index out of range: 34 >= 34\n", 1)),
    ).toEqual({
      outcome: "killed",
      detail: "index out of range: 34 >= 34",
    });
    expect(
      classify(result("", "index out of range: 1 >= 1\n", 1)).outcome,
    ).toBe("killed");
    expect(classify(result(panic, "", null))).toEqual({
      outcome: "killed",
      detail: "exit on a signal",
    });
    expect(classify(result(panic, "", 2))).toEqual({
      outcome: "killed",
      detail: "exit 2",
    });
    for (const d of [
      "std/crypto/hkdf.ts:113:1: syntax error: unexpected }",
      "std/crypto/hkdf.ts:164:17: error: Unknown identifier x",
    ])
      expect(classify(result("", `${d}\n`, 1))).toEqual({
        outcome: "stillborn",
        detail: d,
      });
    expect(classify(result("", "", null, true)).outcome).toBe("timeout");
  });

  test("a diagnostic after clauses ran is a kill, not a stillborn mutant", () => {
    const r = result(`PASS  [${ids[0]}] ok`, "std/a.ts:1:1: error: x\n", 1);
    expect(classify(r).outcome).toBe("killed");
  });

  test("a runner failure or a silent stop fails the run", () => {
    expect(() =>
      classify(result("", "failed to start /x/nish: ENOENT", null)),
    ).toThrow(MutationRunError);
    expect(() => classify(result(`PASS  [${ids[0]}] ok`, "", 0))).toThrow(
      /exited 0 without a verdict/,
    );
    expect(() => classify(result("", "", 0))).toThrow(
      /exited 0 without a verdict/,
    );
  });
});

describe("running mutants with a fake runner", () => {
  const src = readFileSync("test/fixtures/mutate/operators.ts.txt", "utf8");
  const ranges: [number, number][] = [[3, 3]];
  const mutants = generateMutants(src, ranges);
  // Survives the `>=` flip, cannot compile `< -1`, hangs on `&&`, kills the rest.
  const fake =
    (base = result(pass)): Exec =>
    async (contents) => {
      if (contents === src) return base;
      if (contents.includes("n > xs")) return result(pass);
      if (contents.includes("< -1"))
        return result("", "f.ts:3:9: error: bad\n", 1);
      if (contents.includes("0 && n")) return result("", "", null, true);
      return result(failOne, "", 1);
    };
  const opts = {
    contract: hkdf,
    test: "",
    nishRoot: "/nowhere",
    modulePath: "std/f.ts",
    source: src,
    ranges,
  };

  test("counts each outcome and lists the survivors", async () => {
    const r = await runMutants({ ...opts, exec: fake(), jobs: 3 });
    expect(r.generated).toBe(5);
    expect(r.results.map((x) => [x.mutant.id, x.outcome])).toEqual([
      ["3:9:relational", "killed"],
      ["3:11:int-literal:plus", "killed"],
      ["3:11:int-literal:minus", "stillborn"],
      ["3:13:logical", "timeout"],
      ["3:18:relational", "survived"],
    ]);
    expect(r.counts).toEqual({
      killed: 2,
      survived: 1,
      stillborn: 1,
      timeout: 1,
    });
    expect(r.survivors.map((x) => x.mutant.id)).toEqual(["3:18:relational"]);
    expect(r.unusedAllowances).toEqual([]);
  });

  test("an allowance covers a survivor on its file and line; an unused one is reported", async () => {
    const allowSurvivors = [
      { file: "std/f.ts", line: 3, reason: "equivalent at the bound" },
      { file: "std/f.ts", line: 9, reason: "stale" },
      { file: "std/other.ts", line: 3, reason: "another file" },
    ];
    const r = await runMutants({ ...opts, exec: fake(), allowSurvivors });
    expect(r.survivors).toEqual([]);
    expect(r.results[4].allowed).toBe("equivalent at the bound");
    expect(r.unusedAllowances).toEqual([allowSurvivors[1]]);
  });

  test("max takes an even, deterministic spread; mutants picks which", async () => {
    expect(spread([1, 2, 3, 4, 5, 6], 3)).toEqual([1, 3, 5]);
    expect(spread([1, 2], 5)).toEqual([1, 2]);
    expect(spread([1, 2], undefined)).toEqual([1, 2]);
    expect(spread([1, 2], 0)).toEqual([]);
    const r = await runMutants({ ...opts, exec: fake(), max: 2 });
    expect(r.generated).toBe(5);
    expect(r.results.map((x) => x.mutant.id)).toEqual([
      "3:9:relational",
      "3:11:int-literal:minus",
    ]);
    const picked = await runMutants({
      ...opts,
      exec: fake(),
      mutants: [mutants[4]],
    });
    expect(picked.results.map((x) => x.outcome)).toEqual(["survived"]);
  });

  test("refuses a mutant this source and these ranges do not make", async () => {
    const other = generateMutants(src, [[6, 6]])[0];
    await expect(
      runMutants({ ...opts, exec: fake(), mutants: [other] }),
    ).rejects.toThrow(/is not one this source and these ranges make/);
    const forged = { ...mutants[0], mutated: "  if (true) {" };
    await expect(
      runMutants({ ...opts, exec: fake(), mutants: [forged] }),
    ).rejects.toThrow(/is not one this source and these ranges make/);
  });

  test("fails unless the test passes on the unmutated module", async () => {
    for (const base of [
      result(failOne, "", 1),
      result("", "", null, true),
      result(pass, "", 1),
    ])
      await expect(runMutants({ ...opts, exec: fake(base) })).rejects.toThrow(
        /does not pass on the unmutated std\/f.ts/,
      );
  });

  test("a runner error on any mutant fails the run", async () => {
    const exec: Exec = async (c) =>
      c === src ? result(pass) : result("", "", 0);
    await expect(runMutants({ ...opts, exec })).rejects.toThrow(
      MutationRunError,
    );
  });

  test("the default exec runs the test in a scratch install with the module replaced", async () => {
    // A stand-in compiler: passes every clause unless the module says FAIL,
    // never finishes if it says HANG.
    const r = tmp("vector-mut-fake-");
    const out = ids.map((id) => `PASS  [${id}] ok`).join("\\n");
    write(
      r,
      "build/seed/libexec/nish",
      `#!/bin/sh\nm="$(dirname "$0")/../std/f.ts"\ngrep -q HANG "$m" && exec sleep 30\ngrep -q FAIL "$m" && { printf 'FAIL  [${ids[0]}] x\\n'; exit 1; }\nprintf '${out}\\n'\n`,
    );
    chmodSync(join(r, "build/seed/libexec/nish"), 0o755);
    write(r, "std/f.ts", "base");
    const exec = scratchExec({
      contract: hkdf,
      test: "",
      nishRoot: r,
      modulePath: "std/f.ts",
      timeoutMs: 1500,
    });
    expect(classify(await exec("ok")).outcome).toBe("survived");
    expect(classify(await exec("FAIL")).outcome).toBe("killed");
    const hung = await exec("HANG");
    expect(hung.timedOut).toBe(true);
    expect(classify(hung).outcome).toBe("timeout");
    rmSync(r, { recursive: true, force: true });
  });
});

// Live: the planted mutants against nish's real std. VECTOR_NISH is the seed's
// bin/nish inside a nish checkout; the checkout is four directories up.
const nish = process.env.VECTOR_NISH;
if (process.env.VECTOR_REQUIRE_NISH === "1" && !nish)
  test("VECTOR_REQUIRE_NISH=1 needs VECTOR_NISH", () => {
    throw new Error("VECTOR_REQUIRE_NISH=1 but VECTOR_NISH is not set");
  });

describe.skipIf(!nish)("planted mutants against nish", () => {
  const nishRoot = resolve(nish ?? "", "../../../..");
  const modules = {
    hkdf: "std/crypto/hkdf.ts",
    aead: "std/crypto/chacha20poly1305.ts",
  };
  // A synthetic base: the first commit holds each module emptied, the working
  // tree the real one, so every line of it is in the diff.
  let base = "";
  let diffs: ReturnType<typeof gitDiff> = [];
  beforeAll(() => {
    base = repo();
    for (const p of Object.values(modules)) write(base, p, "");
    commit(base);
    for (const p of Object.values(modules))
      write(base, p, readFileSync(join(nishRoot, p), "utf8"));
    diffs = gitDiff(base, "HEAD");
  });
  afterAll(() => {
    if (base) rmSync(base, { recursive: true, force: true });
  });
  const live = async (
    c: RfcContract,
    path: string,
    planted: [op: string, original: string, mutated: string][],
    sample: number,
  ) => {
    const diff = diffs.find((d) => d.file === path);
    expect(diff?.ranges.length).toBeGreaterThan(0);
    const source = readFileSync(join(base, path), "utf8");
    const ranges = diff?.ranges ?? [];
    const all = generateMutants(source, ranges);
    // Matched on the whole line before and after, so a look-alike on a
    // neighbouring line (tag[14] → tag[15]) cannot stand in for the planted one.
    const found = planted.map(([op, original, mutated]) => {
      const m = all.find(
        (x) =>
          x.operator === op &&
          x.original.trim() === original &&
          x.mutated.trim() === mutated,
      );
      expect(m, `${op}: ${original} → ${mutated}`).toBeDefined();
      return m as Mutant;
    });
    const others = spread(
      all.filter((m) => !found.includes(m)),
      sample,
    );
    const s = await sampleContract(c);
    const r = await runMutants({
      contract: c,
      test: emitNishTest(c, s.properties),
      nishRoot,
      modulePath: path,
      source,
      ranges,
      mutants: [...found, ...others],
      jobs: 4,
      timeoutMs: 120_000,
    });
    for (const x of r.results)
      console.log(
        `${path} ${x.mutant.id} ${x.outcome}: ${x.mutant.mutated.trim()} ${x.detail ?? ""}`,
      );
    for (const m of found)
      expect(
        r.results.find((x) => x.mutant === m)?.outcome,
        m.mutated.trim(),
      ).toBe("killed");
    return r;
  };

  test("HKDF: the L bound +1 is generated and killed", async () => {
    await live(
      hkdf,
      modules.hkdf,
      [
        [
          "int-literal",
          "const HKDF_MAX_BLOCKS: i32 = 255",
          "const HKDF_MAX_BLOCKS: i32 = 256",
        ],
      ],
      3,
    );
  }, 600_000);

  test("ChaCha20-Poly1305: tag byte 15 and the tail bound are generated and killed", async () => {
    await live(
      aead,
      modules.aead,
      [
        [
          "int-literal",
          "toU32(tag[15] ^ sealed[p + 15])",
          "toU32(tag[15] ^ sealed[p + 14])",
        ],
        [
          "logical",
          "for (let i: i32 = 0; i < tail && i < toI32(last.length); i++) {",
          "for (let i: i32 = 0; i < tail || i < toI32(last.length); i++) {",
        ],
      ],
      3,
    );
  }, 600_000);
});
