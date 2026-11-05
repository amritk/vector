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
    write(d, "new dir/n.ts", "x\nexport const n = 0\n");
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
      {
        file: "gone.ts",
        ranges: [],
        exports: [{ name: "old", kind: "deleted" }],
      },
      {
        file: "new dir/n.ts",
        ranges: [[1, 2]],
        exports: [{ name: "n", kind: "added" }],
      },
    ]);
    expect(gitDiff(d, "HEAD", ["a.ts"]).map((f) => f.file)).toEqual(["a.ts"]);
    rmSync(d, { recursive: true, force: true });
  });

  test("reads a/ and b/ paths whatever the user's prefix config says", () => {
    const d = repo();
    write(d, "a/x.ts", "1\n");
    commit(d);
    write(d, "a/x.ts", "2\nexport async function k() {}\nexport class C {}\n");
    for (const [k, v] of [
      ["diff.noprefix", "true"],
      ["diff.mnemonicPrefix", "true"],
    ]) {
      git(d, "config", k, v);
      expect(gitDiff(d, "HEAD")).toEqual([
        {
          file: "a/x.ts",
          ranges: [[1, 3]],
          exports: [
            { name: "k", kind: "added" },
            { name: "C", kind: "added" },
          ],
        },
      ]);
      git(d, "config", "--unset", k);
    }
    rmSync(d, { recursive: true, force: true });
  });

  test("a git error is an error, not an empty diff", () => {
    const d = repo();
    expect(() => gitDiff(d, "no-such-rev")).toThrow(
      /git diff -U0 no-such-rev failed/,
    );
    rmSync(d, { recursive: true, force: true });
  });

  test("an untracked file is wholly added; ignored ones are not", () => {
    const d = repo();
    write(d, "a.ts", "1\n");
    write(d, ".gitignore", "*.log\n");
    commit(d);
    write(
      d,
      "std/new.ts",
      "// hi\nexport function n(): i32 {\n  return 1\n}\n",
    );
    write(d, "std/empty.ts", "");
    write(d, "x.log", "export const no = 1\n");
    // Neither added nor intent-to-add: still part of the change.
    expect(gitDiff(d, "HEAD")).toEqual([
      { file: "std/empty.ts", ranges: [], exports: [] },
      {
        file: "std/new.ts",
        ranges: [[1, 4]],
        exports: [{ name: "n", kind: "added" }],
      },
    ]);
    // Paths are the repository's, from wherever git is run.
    expect(gitDiff(join(d, "std"), "HEAD", ["new.ts"])).toEqual([
      {
        file: "std/new.ts",
        ranges: [[1, 4]],
        exports: [{ name: "n", kind: "added" }],
      },
    ]);
    // Intent-to-add: git diff shows it; it is not listed twice.
    git(d, "add", "-N", "std/new.ts");
    expect(gitDiff(d, "HEAD", ["std/new.ts"])).toEqual([
      {
        file: "std/new.ts",
        ranges: [[1, 4]],
        exports: [{ name: "n", kind: "added" }],
      },
    ]);
    write(d, "bin.dat", "a\0b");
    expect(() => gitDiff(d, "HEAD")).toThrow(/untracked binary file/);
    rmSync(d, { recursive: true, force: true });
  });

  test("a rename is a deletion and an addition, so every line of it is new", () => {
    const d = repo();
    write(d, "old.ts", "export function f(): i32 {\n  return 1\n}\n");
    commit(d);
    git(d, "mv", "old.ts", "new.ts");
    expect(gitDiff(d, "HEAD")).toEqual([
      {
        file: "new.ts",
        ranges: [[1, 3]],
        exports: [{ name: "f", kind: "added" }],
      },
      {
        file: "old.ts",
        ranges: [],
        exports: [{ name: "f", kind: "deleted" }],
      },
    ]);
    rmSync(d, { recursive: true, force: true });
  });

  test("a change inside an export's body changes that export", () => {
    const d = repo();
    const before = [
      "export function f(a: i32): i32 {", // 1
      "  const b = a + 1", // 2
      "  return b", // 3
      "}", // 4
      "", // 5
      "// g's doc", // 6
      "export const g: i32 =", // 7
      "  1 +", // 8
      "  2", // 9
      "function h(): void {}", // 10
      "export function k(): i32 {", // 11
      "  const x = 1", // 12
      "  const y = 2", // 13
      "  return x", // 14
      "}", // 15
      "export function gone(): void {}", // 16
      "",
    ].join("\n");
    write(d, "m.ts", before);
    commit(d);
    const after = before
      .replace("a + 1", "a + 2") // f's body
      .replace("  2\n", "  3\n") // g's continuation line
      .replace("function h(): void {}", "function h(): void { }") // not exported
      .replace("  const y = 2\n", "") // a pure deletion inside k
      .replace("export function gone(): void {}\n", "");
    write(d, "m.ts", after);
    expect(gitDiff(d, "HEAD")).toEqual([
      {
        file: "m.ts",
        ranges: [
          [2, 2],
          [9, 10],
        ],
        exports: [
          { name: "f", kind: "changed" },
          { name: "g", kind: "changed" },
          { name: "k", kind: "changed" },
          { name: "gone", kind: "deleted" },
        ],
      },
    ]);
    // A changed comment between items touches neither.
    write(d, "m.ts", before.replace("// g's doc", "// g's docs"));
    expect(gitDiff(d, "HEAD")).toEqual([
      { file: "m.ts", ranges: [[6, 6]], exports: [] },
    ]);
    rmSync(d, { recursive: true, force: true });
  });

  test("names every declaration form, and refuses an export it cannot name", () => {
    const d = repo();
    write(d, "a.ts", "\n");
    commit(d);
    write(
      d,
      "a.ts",
      [
        "export const enum E { A }",
        "export const enumerable = 1",
        "export abstract class A {}",
        "export namespace N {",
        "  export const inner = 1",
        "}",
        "export declare function d(): void",
        "export function* gen() {}",
        "export default function () {}",
        "",
      ].join("\n"),
    );
    expect(gitDiff(d, "HEAD")[0].exports.map((e) => e.name)).toEqual([
      "E",
      // Before: named `erable`, read as `const enum` + `erable`.
      "enumerable",
      "A",
      "N",
      "d",
      "gen",
      "default",
    ]);
    for (const form of [
      "export { x }",
      "export * from './b.ts'",
      "export { y as z } from './b.ts'",
      "export = q",
    ]) {
      write(d, "a.ts", `const x = 1\n${form}\n`);
      expect(() => gitDiff(d, "HEAD")).toThrow(/an export it cannot name/);
    }
    // Untouched, it is not this change's business.
    write(d, "a.ts", "\nexport { x }\n");
    commit(d);
    write(d, "a.ts", "const x = 1\nexport { x }\n");
    expect(gitDiff(d, "HEAD")).toEqual([
      { file: "a.ts", ranges: [[1, 1]], exports: [] },
    ]);
    // Removed, too, it is refused.
    write(d, "a.ts", "const x = 1\n");
    expect(() => gitDiff(d, "HEAD")).toThrow(/an export it cannot name/);
    rmSync(d, { recursive: true, force: true });
  });

  // An edit to `line` of `src` (committed first): the exports the diff names.
  const touched = (src: string, line: number) => {
    const d = repo();
    write(d, "m.ts", src);
    commit(d);
    const lines = src.split("\n");
    lines[line - 1] += " ";
    write(d, "m.ts", lines.join("\n"));
    try {
      return gitDiff(d, "HEAD").flatMap((f) =>
        f.exports.map((e) => `${e.name}:${e.kind}`),
      );
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  };

  // `line` of `src` (committed first) deleted: the exports the diff names.
  const cut = (src: string, line: number) => {
    const d = repo();
    write(d, "m.ts", src);
    commit(d);
    const lines = src.split("\n");
    lines.splice(line - 1, 1);
    write(d, "m.ts", lines.join("\n"));
    try {
      return gitDiff(d, "HEAD").flatMap((f) =>
        f.exports.map((e) => `${e.name}:${e.kind}`),
      );
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  };

  test("a deleted first, middle or last line changes its export; at a boundary, both", () => {
    // Before: a deletion just after an item's last line was nobody's.
    const v = "export const v = (k) =>\n  check(k)\n";
    expect(cut(v, 2)).toEqual(["v:changed"]);
    const three = "export const a =\n  1 +\n  2\nexport const b = 3\n";
    expect(cut(three, 2)).toEqual(["a:changed"]);
    // `  2` was a's last line, right before b: the diff cannot tell whose, so
    // both are changed.
    expect(cut(three, 3)).toEqual(["a:changed", "b:changed"]);
    const fn = "export function f(): i32 {\n  g()\n  return 1\n}\n";
    expect(cut(`${fn}\nexport const z = 1\n`, 3)).toEqual(["f:changed"]);
    // Deleting an item's first line deletes that export; it was right
    // before b, so b is changed too.
    expect(cut("export const a = 1\nexport const b =\n  2\n", 1)).toEqual([
      "b:changed",
      "a:deleted",
    ]);
    // A deleted line with a line kept on either side is neither item's.
    expect(
      cut("export const a = 1\n\n// x\n\nexport const b = 2\n", 3),
    ).toEqual([]);
  });

  test("an item after a line that ends in a string is its own (nish std/cli.ts, std/json-typed.ts)", () => {
    // Before: `class Style` was read as part of `SGR_STRIKETHROUGH = "9"`, and
    // `class JsonNumber` as part of the unexported string before it.
    const cli = readFileSync("test/fixtures/mutate/cli-style.ts.txt", "utf8");
    const at = (src: string, text: string) =>
      src.split("\n").findIndex((l) => l.includes(text)) + 1;
    expect(touched(cli, at(cli, "  metaThemed: string"))).toEqual([
      "Style:changed",
    ]);
    expect(touched(cli, at(cli, 'SGR_BLACK: string = "30"'))).toEqual([
      "SGR_BLACK:changed",
    ]);
    const json = readFileSync(
      "test/fixtures/mutate/json-number.ts.txt",
      "utf8",
    );
    expect(touched(json, at(json, "return String.fromBytes"))).toEqual([
      "JsonNumber:changed",
    ]);
    expect(touched(json, at(json, '"nish/json-typed: jsonDecode'))).toEqual([]);
  });

  test("an item starts at its declaration whatever the line before ends in", () => {
    const enders = [
      'export const s = "a"',
      "export const t = `x${y}`",
      "export const c = 'c'",
      "export const g: Map<string, number> = m",
      "export type T = Array<number>",
      "export const n = x!",
      "export let i = j++",
      "export let k = j--",
      "export const r = /a+/",
      'const s2: string =\n  "two lines"',
      "export const v = `\nmulti ${x}\n`",
    ];
    for (const end of enders) {
      for (const gap of ["", "\n"]) {
        const src = `${end}\n${gap}export function f(): void {\n  body()\n}\n`;
        const body = src.split("\n").indexOf("  body()") + 1;
        expect(touched(src, body), `${end} ${JSON.stringify(gap)}`).toEqual([
          "f:changed",
        ]);
      }
    }
    // Allman braces: the `{` at column 0 is the function's.
    expect(
      touched("export const a = 1\nexport function f()\n{\n  body()\n}\n", 4),
    ).toEqual(["f:changed"]);
    // A function as a value: `=` before it needs an operand, so it carries on.
    expect(
      touched("export const h =\nfunction () {\n  body()\n}\n", 3),
    ).toEqual(["h:changed"]);
    // A top-level statement that is no declaration belongs to the item before.
    expect(touched("export const a = 1\nmain()\n", 2)).toEqual(["a:changed"]);
  });

  test("refuses brackets it cannot balance, and an export it cannot place", () => {
    // A regex literal with a bracket in it: the depth is wrong from there on.
    expect(() =>
      touched("export const re = /[(]/\nexport const b = 1\n", 2),
    ).toThrow(/never closed/);
    expect(() =>
      touched("export const re = /[)]/\nexport const b = 1\n", 2),
    ).toThrow(/a closing bracket with none open/);
    // Two exports on one line, or one after other code: touched, refused.
    expect(() =>
      touched("export const a = 1; export const b = 2\n", 1),
    ).toThrow(/not its line's first code/);
    expect(() =>
      touched("export function f() {\n  x()\n} export const b = 2\n", 2),
    ).toThrow(/not its line's first code/);
    // Untouched, they are not this change's business.
    expect(
      touched(
        "export const a = 1; export const b = 2\nexport const c = 3\n",
        2,
      ),
    ).toEqual(["c:changed"]);
  });

  test("an indented or commented export, a BOM, and a namespace's own exports", () => {
    expect(touched("  export function x(): void {\n  body()\n}\n", 2)).toEqual([
      "x:changed",
    ]);
    expect(
      touched("/** d */ export function y(): void {\n  body()\n}\n", 2),
    ).toEqual(["y:changed"]);
    expect(
      touched("\uFEFFexport function z(): void {\n  body()\n}\n", 2),
    ).toEqual(["z:changed"]);
    expect(
      touched("export namespace N {\n  export const inner = 1\n}\n", 2),
    ).toEqual(["N:changed"]);
    // A BOM on an untracked file's first line: still named.
    const d = repo();
    write(d, "a.ts", "\n");
    commit(d);
    write(d, "b.ts", "\uFEFFexport const q = 1\n");
    expect(gitDiff(d, "HEAD")).toEqual([
      {
        file: "b.ts",
        ranges: [[1, 1]],
        exports: [{ name: "q", kind: "added" }],
      },
    ]);
    rmSync(d, { recursive: true, force: true });
  });

  test("exports are read only in script files; another file has lines, not exports", () => {
    const d = repo();
    write(d, "env.sh", "export FOO=bar\n");
    write(d, "m.ts", "export const a = 1\n");
    commit(d);
    write(d, "env.sh", "export FOO=baz\nexport BAR=1\n");
    write(d, "m.ts", "export const a = 2\n");
    write(d, "new.sh", "export NEW=1\n");
    expect(gitDiff(d, "HEAD")).toEqual([
      { file: "env.sh", ranges: [[1, 2]], exports: [] },
      {
        file: "m.ts",
        ranges: [[1, 1]],
        exports: [{ name: "a", kind: "changed" }],
      },
      { file: "new.sh", ranges: [[1, 1]], exports: [] },
    ]);
    rmSync(d, { recursive: true, force: true });
  });

  test("refuses a range base: the post-image read is the working tree's", () => {
    const d = repo();
    for (const base of ["HEAD~1..HEAD", "main...topic"])
      expect(() => gitDiff(d, base)).toThrow(/a range/);
    rmSync(d, { recursive: true, force: true });
  });

  test("refuses a base that looks like an option", () => {
    const d = repo();
    expect(() => gitDiff(d, "--output=/tmp/x")).toThrow(/looks like an option/);
    rmSync(d, { recursive: true, force: true });
  });

  const one = (hunks: string) =>
    `diff --git a/f.ts b/f.ts\nindex 1..2 100644\n--- a/f.ts\n+++ b/f.ts\n${hunks}`;
  const blank = () => "";

  test("a hunk header without counts means one line, and a 0 count adds no range", () => {
    expect(
      parseGitDiff(one("@@ -3 +3 @@ fn\n-a\n+b\n@@ -7,1 +6,0 @@\n-c\n"), blank),
    ).toEqual([{ file: "f.ts", ranges: [[3, 3]], exports: [] }]);
    expect(
      parseGitDiff(
        one("@@ -1,0 +2,2 @@\n+a\n+b\n\\ No newline at end of file\n"),
        blank,
      ),
    ).toEqual([{ file: "f.ts", ranges: [[2, 3]], exports: [] }]);
    expect(parseGitDiff("", blank)).toEqual([]);
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
      // CRLF text: the \r is never taken as part of a path.
      [
        "diff --git a/f b/f\r\n--- a/f\r\n+++ b/f\r\n@@ -1 +1 @@ x\r\n-a\r\n+b\r\n",
        /carriage return/,
      ],
      [one("@@ -1 +1 @@\n-a\n+export const v = 1\n"), /not a top-level item/],
    ];
    for (const [text, why] of bad) {
      expect(() => parseGitDiff(text, blank)).toThrow(DiffParseError);
      expect(() => parseGitDiff(text, blank)).toThrow(why);
    }
  });

  test("a mode change or a rename with no hunks is no entry", () => {
    const text =
      "diff --git a/m b/m\nold mode 100644\nnew mode 100755\ndiff --git a/r b/s\nsimilarity index 100%\nrename from r\nrename to s\n";
    expect(parseGitDiff(text, blank)).toEqual([]);
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
    expect(on(9)).toEqual(["9:10:return-null return null"]);
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
    // Only the expression is replaced: the `;` and a comment after it stay.
    expect(ret("    return a;", "u8[] | null")).toEqual(["    return null;"]);
    expect(ret("    return f(a) // why")).toEqual(["    return null // why"]);
    // A string is part of the expression: the whole of it is replaced.
    expect(ret('    return "abc";')).toEqual(["    return null;"]);
    expect(ret("    return `t${a}x`")).toEqual(["    return null"]);
    expect(ret('    return "x" + g(a); // why')).toEqual([
      "    return null; // why",
    ]);
    expect(ret('    return "a" /* c */;')).toEqual([
      "    return null /* c */;",
    ]);
    expect(ret('    return "a" +')).toEqual([]);
    expect(ret("    return a", "u8")).toEqual([]);
    expect(ret("    return a +")).toEqual([]);
    expect(ret("    return f(")).toEqual([]);
    expect(ret("    return a\n      .b")).toEqual([]);
    // A template that runs onto the next line: `return null` would leave its
    // rest as code. One that closes on this line is replaced whole (above).
    expect(ret("    return `abc\ndef`")).toEqual([]);
    expect(ret("    return `abc ${\n  a}`")).toEqual([]);
    expect(
      generateMutants("{\n  return a\n}\n", [[2, 2]]).filter(
        (m) => m.operator === "return-null",
      ),
    ).toEqual([]);
    // An unannotated callback inside a function that admits null: its own
    // return type is unknown, so it is not judged by the outer one.
    for (const head of ["xs.map((x) => {", "xs.map(function (x) {"])
      expect(
        generateMutants(
          `function f(xs): u8[] | null {\n  ${head}\n    return x + 1\n  })\n}\n`,
          [[3, 3]],
        ).filter((m) => m.operator === "return-null"),
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
    // Lines of a multi-line template, its closing line, or inside a `${…}`
    // that spans lines: part of a literal, not statements.
    const tpl =
      "function f(): string {\n  const s = `\nhello\n`;\n  g(`${\n  h()\n}`)\n  g(s);\n}\n";
    expect(
      generateMutants(tpl, [[1, 9]])
        .filter((m) => m.operator === "delete-statement")
        .map((m) => m.line),
    ).toEqual([8]);
    for (const line of [3, 4, 6]) expect(del(tpl, line)).toEqual([]);
    // Nor inside a block comment that spans lines, or right after one.
    expect(del("/* a\nf(x)\n*/ g(y)\nh(z)\n", 2)).toEqual([]);
    expect(del("/* a\nf(x)\n*/ g(y)\nh(z)\n", 3)).toEqual([]);
    expect(del("/* a\nf(x)\n*/ g(y)\nh(z)\n", 4)).toHaveLength(1);
    // A line of a multi-line `for (…)` header or call is no statement (nish
    // std/crypto/hmac.ts:468: deleting the condition broke the parse).
    const loop =
      "for (\n  let i = 0;\n  i < n && i < m;\n  i++\n) {\n  f(i)\n}\n";
    for (const line of [3, 4]) expect(del(loop, line)).toEqual([]);
    expect(del(loop, 6)).toHaveLength(1);
    expect(del("g(\n  a,\n  [\n    b\n  ],\n)\n", 4)).toEqual([]);
    // The body of a braceless head: deleting it would re-parent the next line.
    for (const head of [
      "if (bad)",
      "} else",
      "else if (x)",
      "for (;;)",
      "while (x)",
    ])
      expect(del(`${head}\n  throw err\nout.push(v)\n`, 2)).toEqual([]);
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

// A run of the hkdf test as nish would report it: nish names the mutated std
// module by its std path and the emitted test by its absolute one.
const TEST_FILE = "/tmp/vector-rfc-x/main.ts";
const SOURCES = ["std/crypto/hkdf.ts", TEST_FILE];
const ids = hkdf.clauses.map((k) => k.id);
const result = (
  stdout: string,
  stderr = "",
  exitCode: number | null = 0,
  timedOut = false,
  started = true,
): ExecResult => {
  const clauses = parseTestOutput(hkdf, stdout);
  return {
    started,
    timedOut,
    sources: SOURCES,
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
  // Never started: result(stdout, stderr, exit, timedOut, started = false).
  const unstarted = (stderr: string, exit: number | null) =>
    result("", stderr, exit, false, false);

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
    // A panic before the first clause, once the test has started, is a kill.
    expect(
      classify(result("", "index out of range: 1 >= 1\n", 1)).outcome,
    ).toBe("killed");
    // The test binary killed by a signal (137, 139): the watchdog reports
    // 128 + the signal, and the test did start.
    expect(classify(result(panic, "", 137))).toEqual({
      outcome: "killed",
      detail: "exit 137",
    });
    expect(classify(result(panic, "", 2))).toEqual({
      outcome: "killed",
      detail: "exit 2",
    });
    for (const d of [
      "std/crypto/hkdf.ts:113:1: syntax error: unexpected }",
      "std/crypto/hkdf.ts:164:17: error: Unknown identifier x",
    ])
      expect(classify(unstarted(`${d}\n`, 1))).toEqual({
        outcome: "stillborn",
        detail: d,
      });
    expect(classify(result("", "", 137, true)).outcome).toBe("timeout");
  });

  test("a run that never started is never a kill", () => {
    // Every way a run can end with no clause run and no compile diagnostic:
    // nish killed (OOM, 137), nish or the linker failing, the build hanging,
    // nish not starting, the watchdog itself killed.
    for (const [stderr, exit] of [
      ["", 137],
      ["Killed\n", 137],
      ["clang: error: linker command failed with exit code 1\n", 1],
      ["ld.lld: error: undefined symbol: nish_rt_alloc\n", 1],
      ["vector-watchdog: the build took longer than 100 ms\n", 125],
      ["failed to start /x/nish: ENOENT\n", 127],
      ["", null],
      ["", 0],
      ["", 1],
    ] as const)
      expect(
        () => classify(unstarted(stderr, exit)),
        `${exit} ${stderr}`,
      ).toThrow(/the test never started/);
    // A diagnostic with no failing exit, or a timeout before the start, is
    // not a verdict either.
    expect(() =>
      classify(unstarted("std/crypto/hkdf.ts:1:1: error: x\n", 0)),
    ).toThrow(/never started/);
    expect(() =>
      classify(unstarted("std/crypto/hkdf.ts:1:1: error: x\n", null)),
    ).toThrow(/never started/);
    expect(() => classify(result("", "", 137, true, false))).toThrow(
      /never started/,
    );
  });

  test("a diagnostic is the mutant's only in the mutated module or the test", () => {
    const real =
      "std/crypto/hkdf.ts:136:10: syntax error: expected `;`, found `)`";
    const inTest = `${TEST_FILE}:1:10: error: Module \`nish/crypto/hkdf\` has no exported function \`nope\``;
    const quoted = "  136 |     return error: x\n      |          ^";
    for (const d of [real, inTest])
      expect(
        classify(unstarted(`${d}\n${quoted}\n${d}\n2 errors\n`, 1)),
      ).toEqual({
        outcome: "stillborn",
        detail: d,
      });
    // The C toolchain, another std module, or a relative test path: not
    // the mutant's doing, so the run never started.
    const c =
      "runtime/x.c:1:10: fatal error: stdio.h: No such file or directory";
    for (const stderr of [
      c,
      `${real}\n${c}`,
      `${real}\nclang: error: linker command failed with exit code 1`,
      "std/other.ts:1:1: error: x",
      "main.ts:1:1: error: x",
    ])
      expect(() => classify(unstarted(`${stderr}\n`, 1)), stderr).toThrow(
        /the test never started/,
      );
  });

  test("a diagnostic after the test started is a kill, not a stillborn mutant", () => {
    const r = result(
      `PASS  [${ids[0]}] ok`,
      "std/crypto/hkdf.ts:1:1: error: x\n",
      1,
    );
    expect(classify(r).outcome).toBe("killed");
    expect(
      classify(result("", "std/crypto/hkdf.ts:1:1: error: x\n", 1)).outcome,
    ).toBe("killed");
  });

  test("a runner failure or a silent stop fails the run", () => {
    // Started, then the runner itself killed: no exit status to judge.
    expect(() => classify(result(`PASS  [${ids[0]}] ok`, "", null))).toThrow(
      /killed before it finished/,
    );
    expect(() => classify(result(failOne, "", null))).toThrow(
      /killed before it finished/,
    );
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
        return result(
          "",
          "std/crypto/hkdf.ts:3:9: error: bad\n",
          1,
          false,
          false,
        );
      if (contents.includes("0 && n")) return result("", "", 137, true);
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

  test("an allowance covers a survivor on its file and line; every unused one is reported", async () => {
    const allowSurvivors = [
      { file: "std/f.ts", line: 3, reason: "equivalent at the bound" },
      { file: "std/f.ts", line: 9, reason: "stale" },
      { file: "std/other.ts", line: 3, reason: "another file" },
    ];
    const r = await runMutants({ ...opts, exec: fake(), allowSurvivors });
    expect(r.survivors).toEqual([]);
    expect(r.results[4].allowed).toBe("equivalent at the bound");
    // One for a file this run did not mutate is unused too, not dropped.
    expect(r.unusedAllowances).toEqual([allowSurvivors[1], allowSurvivors[2]]);
    // Another file's allowance never covers this file's survivor.
    const other = await runMutants({
      ...opts,
      exec: fake(),
      allowSurvivors: [allowSurvivors[2]],
    });
    expect(other.survivors.map((x) => x.mutant.id)).toEqual([
      "3:18:relational",
    ]);
  });

  test("an allowance with no reason is refused", async () => {
    for (const reason of ["", "   "])
      await expect(
        runMutants({
          ...opts,
          exec: fake(),
          allowSurvivors: [{ file: "std/f.ts", line: 3, reason }],
        }),
      ).rejects.toThrow(/gives no reason/);
  });

  test("no mutant to run fails the run; so does a max, jobs or timeout that is not a positive integer", async () => {
    let calls = 0;
    const exec: Exec = async (c) => {
      calls++;
      return fake()(c);
    };
    // A change that touches only a comment (line 1) or nothing at all.
    for (const r of [[[1, 1]], []] as [number, number][][])
      await expect(runMutants({ ...opts, ranges: r, exec })).rejects.toThrow(
        /no mutants in the changed lines of std\/f.ts/,
      );
    await expect(runMutants({ ...opts, exec, mutants: [] })).rejects.toThrow(
      /no mutants/,
    );
    for (const k of ["max", "jobs", "timeoutMs"])
      for (const v of [0, -1, Number.NaN, 1.5, Number.POSITIVE_INFINITY])
        await expect(runMutants({ ...opts, exec, [k]: v })).rejects.toThrow(
          `${k} must be a positive integer`,
        );
    // Refused before anything ran.
    expect(calls).toBe(0);
  });

  test("max takes an even, deterministic spread; mutants picks which", async () => {
    expect(spread([1, 2, 3, 4, 5, 6], 3)).toEqual([1, 3, 5]);
    expect(spread([1, 2], 5)).toEqual([1, 2]);
    expect(spread([1, 2], undefined)).toEqual([1, 2]);
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
      result("", "", 137, true),
      result(pass, "", 1),
      result(pass, "", 0, false, false),
    ])
      await expect(runMutants({ ...opts, exec: fake(base) })).rejects.toThrow(
        /does not pass on the unmutated std\/f.ts/,
      );
  });

  test("a runner error on any mutant fails the run, and no more are run", async () => {
    let calls = 0;
    const exec: Exec = async (c) => {
      calls++;
      if (c === src) return result(pass);
      return calls === 2 ? result("", "", 0) : result(pass);
    };
    await expect(runMutants({ ...opts, exec, jobs: 2 })).rejects.toThrow(
      MutationRunError,
    );
    // The base, the failing mutant and the one already running beside it.
    expect(mutants.length).toBeGreaterThan(3);
    expect(calls).toBe(3);
  });

  test("the run fails only once the mutants already running have finished", async () => {
    let calls = 0;
    let finished = false;
    const exec: Exec = async (c) => {
      calls++;
      if (c === src) return result(pass);
      if (calls === 2) return result("", "", 0);
      await new Promise((r) => setTimeout(r, 50));
      finished = true;
      return result(pass);
    };
    await expect(runMutants({ ...opts, exec, jobs: 2 })).rejects.toThrow(
      /exited 0 without a verdict/,
    );
    // Its scratch install is gone before the caller hears of the failure.
    expect(finished).toBe(true);
  });

  test("the default exec builds, then runs, the test in a scratch install with the module replaced", async () => {
    // A stand-in compiler, called as `nish <file> --link <bin>`: it fails the
    // build as the module says, else links a stand-in test that passes every
    // clause unless the module says FAIL, crashes on CRASH, and never finishes
    // on HANG. Its sleep is a child holding the output pipes open, as a
    // mutant's own children would.
    const r = tmp("vector-mut-fake-");
    const out = ids.map((id) => `PASS  [${id}] ok`).join("\\n");
    write(
      r,
      "build/seed/libexec/nish",
      [
        "#!/bin/sh",
        'd="$(dirname "$0")"',
        'm="$d/../std/f.ts"',
        '[ "$2" = --link ] && [ -f "$1" ] || { echo "bad args: $*" >&2; exit 2; }',
        'grep -q BUILD_DIAG "$m" && { echo "std/f.ts:1:1: error: bad" >&2; exit 1; }',
        'grep -q BUILD_OOM "$m" && kill -9 $$',
        'grep -q LINK_FAIL "$m" && { echo "clang: error: linker command failed with exit code 1" >&2; exit 1; }',
        'grep -q BUILD_HANG "$m" && { sleep 30; exit 0; }',
        'grep -q TEST_DIAG "$m" && { echo "$1:1:10: error: no export" >&2; exit 1; }',
        'grep -q C_DIAG "$m" && { echo "std/f.ts:1:1: error: bad" >&2; echo "runtime/x.c:1:10: fatal error: stdio.h: No such file or directory" >&2; exit 1; }',
        // The build says it linked, but left no binary, or one that cannot run.
        'grep -q NO_BIN "$m" && exit 0',
        'grep -q NO_EXEC "$m" && { echo x > "$3"; chmod 644 "$3"; exit 0; }',
        'echo "linked $3"',
        'cp "$d/test.sh" "$3"',
        "",
      ].join("\n"),
    );
    write(
      r,
      "build/seed/libexec/test.sh",
      [
        "#!/bin/sh",
        'm="$(dirname "$0")/std/f.ts"',
        'grep -q HANG "$m" && { sleep 30; exit 0; }',
        'grep -q CRASH "$m" && kill -9 $$',
        `grep -q FAIL "$m" && { printf 'FAIL  [${ids[0]}] x\\n'; exit 1; }`,
        `printf '${out}\\n'`,
        "",
      ].join("\n"),
    );
    chmodSync(join(r, "build/seed/libexec/nish"), 0o755);
    chmodSync(join(r, "build/seed/libexec/test.sh"), 0o755);
    write(r, "std/f.ts", "base");
    const exec = scratchExec({
      contract: hkdf,
      test: "",
      nishRoot: r,
      modulePath: "std/f.ts",
      timeoutMs: 1500,
    });
    const ok = await exec("ok");
    expect(ok.started).toBe(true);
    expect(classify(ok).outcome).toBe("survived");
    expect(classify(await exec("FAIL")).outcome).toBe("killed");
    const crash = await exec("CRASH");
    expect(crash.run.exitCode).toBe(137);
    expect(classify(crash).outcome).toBe("killed");
    const hung = await exec("HANG");
    expect([hung.started, hung.timedOut]).toEqual([true, true]);
    expect(classify(hung).outcome).toBe("timeout");
    const diag = await exec("BUILD_DIAG");
    expect(diag.started).toBe(false);
    expect(classify(diag)).toEqual({
      outcome: "stillborn",
      detail: "std/f.ts:1:1: error: bad",
    });
    // A diagnostic in the test, named by the path run.ts gave it: stillborn.
    const inTest = await exec("TEST_DIAG");
    expect(classify(inTest).outcome).toBe("stillborn");
    expect(classify(inTest).detail).toMatch(
      /^\/.*main\.ts:1:10: error: no export$/,
    );
    // The build dying, the linker failing, the build hanging, a C toolchain
    // error beside a diagnostic, or a binary that is missing or cannot run:
    // the test never ran, so the mutant is neither killed nor stillborn.
    for (const [m, why] of [
      ["C_DIAG", /never started \(exit 1\).*runtime\/x\.c/s],
      ["NO_BIN", /never started \(exit 127\).*failed to start/s],
      ["NO_EXEC", /never started \(exit 127\).*failed to start/s],
      ["BUILD_OOM", /never started \(exit 137\)/],
      ["LINK_FAIL", /never started \(exit 1\): clang: error: linker/],
      ["BUILD_HANG", /never started \(exit 125\).*took longer than 1500 ms/s],
    ] as const) {
      const x = await exec(m);
      expect([m, x.started, x.timedOut]).toEqual([m, false, false]);
      expect(() => classify(x)).toThrow(why);
    }
    rmSync(r, { recursive: true, force: true });
  }, 30_000);
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

  test("ChaCha20-Poly1305: tag byte 15, tail > 0 and the tail loop bound are generated and killed", async () => {
    await live(
      aead,
      modules.aead,
      [
        [
          "int-literal",
          "toU32(tag[15] ^ sealed[p + 15])",
          "toU32(tag[15] ^ sealed[p + 14])",
        ],
        // `tail > 0` → `tail >= 0`: the mutant pads a part with no partial
        // block, so a contract that never tags such a part lets it survive.
        ["relational", "if (tail > 0) {", "if (tail >= 0) {"],
        // Dies of the module's own panic (index out of range), not a clause:
        // a kill, but proof only that the loop bound is load-bearing.
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
