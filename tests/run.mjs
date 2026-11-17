#!/usr/bin/env node
// Runs vector's tests: every tests/**/*_test.ts with `nish run`, then every
// CLI golden case in tests/cli/<case>/ against dist/vector.
//
//   node tests/run.mjs            every test
//   node tests/run.mjs smt        only tests whose path contains "smt"
//
// A golden case is a directory holding `cmd` (one line: `vector <args>`,
// split on whitespace, with '…' or "…" quoting), `stdout`, an optional
// `stderr` (no file means stderr must be empty), and `exit` (the expected
// status). Each case runs from the repository root. `{{version}}` in
// `stdout` or `stderr` stands for package.json's version, so a release, which
// bumps that version, never has to touch a golden.
//
// A case may also hold `repo`: one line naming a fixture directory, from the
// repository root, that holds `base/` and `head/` trees. The runner copies
// `base/` into a fresh temp directory, commits it on `main`, then commits
// `head/` in its place (a file absent from `head/` is deleted) on `work`, and
// runs the case from there: `{{repo}}` in `cmd` stands for that directory,
// and `<repo>` stands for it in `stdout` and `stderr`. git's GIT_DIR,
// GIT_WORK_TREE and GIT_INDEX_FILE are unset for the run. A `repo` naming a
// missing fixture fails the case.
//
// A unit test passes only when it exits 0 and its last line is nish/testing's
// `N passed, M failed, K skipped` with N > 0 and M = 0, so a test that asserts
// nothing fails. A test that vector emitted from a contract (tests/dogfood/) ends
// with `vector-done <nonce> <bits>` after its summary: every test is passed a
// fresh nonce, and such a line must carry it with every bit 1, or the test
// fails. Every run is killed after TIMEOUT_MS. The runner exits 1 if
// anything failed, 2 if it could not run (no compiler, no dist/vector when a
// case needs it).
//
// A unit test runs from nish's build cache, so vector's lookup of `.z3/` beside
// the binary cannot find the repository's z3. Unit tests therefore get
// VECTOR_Z3 set to the repository's .z3/z3 when it exists and VECTOR_Z3 is not
// already set. Golden cases run dist/vector without it, so they exercise
// the lookup beside the binary.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const testsDir = join(root, "tests");
const filter = process.argv[2] ?? "";
const nish = process.env.NISH ?? join(root, ".nish/bin/nish");
const vector = join(root, "dist/vector");
const TIMEOUT_MS = 120_000;
const VERSION = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
).version;
const repoZ3 = join(root, ".z3/z3");
const unitEnv =
  process.env.VECTOR_Z3 || !existsSync(repoZ3)
    ? process.env
    : { ...process.env, VECTOR_Z3: repoZ3 };

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? [path, ...walk(path)] : [path];
  });

const all = walk(testsDir).filter(
  (p) => !p.startsWith(join(testsDir, "fixtures")),
);
const matches = (p) => relative(root, p).includes(filter);
const units = all.filter((p) => p.endsWith("_test.ts") && matches(p)).sort();
const cases = all
  .filter((p) => existsSync(join(p, "cmd")) && matches(p))
  .sort();

if (units.length + cases.length === 0) {
  console.error(`no tests match ${JSON.stringify(filter)}`);
  process.exit(2);
}
if (units.length > 0 && !existsSync(nish)) {
  console.error(`no compiler at ${nish}: run bash scripts/fetch-nish.sh`);
  process.exit(2);
}
if (cases.length > 0 && !existsSync(vector)) {
  console.error(`no ${relative(root, vector)}: run npm run build`);
  process.exit(2);
}

const failed = [];

for (const file of units) {
  const name = relative(root, file);
  const nonce = randomBytes(8).toString("hex");
  const r = spawnSync(nish, ["run", name, nonce], {
    cwd: root,
    env: unitEnv,
    encoding: "utf8",
    maxBuffer: 64 << 20,
    timeout: TIMEOUT_MS,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const lines = (r.stdout ?? "").trimEnd().split("\n");
  const done = /^vector-done (\S+) ([01]*)$/.exec(lines.at(-1) ?? "");
  if (done !== null) lines.pop();
  // vector emits tests/dogfood/, so each must end with this run's nonce and a
  // 1 for every clause; a hand-written test has no vector-done line.
  const emitted = name.startsWith(`tests${sep}dogfood${sep}`);
  const ended =
    done === null
      ? !emitted
      : done[1] === nonce && done[2] !== "" && !done[2].includes("0");
  const summary = lines.at(-1) ?? "";
  const counts = /(\d+) passed, (\d+) failed, \d+ skipped$/.exec(summary);
  const asserted =
    ended &&
    counts !== null &&
    Number(counts[1]) > 0 &&
    Number(counts[2]) === 0;
  if (r.status === 0 && asserted) {
    console.log(`ok    ${name}  ${summary}`);
  } else {
    failed.push(name);
    const why =
      r.status !== 0
        ? `exit ${r.status ?? r.signal}`
        : ended
          ? "no passing `N passed, 0 failed` summary"
          : done === null
            ? "vector emits it, but it printed no vector-done line"
            : "its vector-done line lacks this run's nonce or has a clause that failed";
    console.log(`FAIL  ${name} (${why})`);
    console.log(
      out
        .split("\n")
        .filter((line) => !line.startsWith("PASS"))
        .join("\n"),
    );
  }
}

/** Splits a `cmd` line into words: whitespace separates, quotes group. */
const words = (line) => {
  const out = [];
  const re = /'([^']*)'|"([^"]*)"|(\S+)/g;
  for (let m = re.exec(line); m !== null; m = re.exec(line))
    out.push(m[1] ?? m[2] ?? m[3]);
  return out;
};

const read = (dir, name) => {
  const path = join(dir, name);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};

/** The environment a `repo` case runs in: no git variables that redirect it. */
const repoEnv = () => {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
};

/** Runs git in `dir` with a fixed identity and no user config; throws on failure. */
const repoGit = (dir, args) => {
  const r = spawnSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    env: {
      ...repoEnv(),
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.invalid",
    },
  });
  if (r.status !== 0)
    throw new Error(`git ${args.join(" ")}: ${r.stderr ?? r.error}`);
};

/**
 * A temp repository holding `fixture`'s base/ committed on main and its
 * head/ committed on work, checked out; throws when it cannot be made.
 */
const repoMake = (fixture) => {
  const from = join(root, fixture);
  for (const tree of ["base", "head"])
    if (!statSync(join(from, tree), { throwIfNoEntry: false })?.isDirectory())
      throw new Error(`repo ${fixture}: no ${tree}/ directory`);
  // git names the real directory, so a linked temp dir (macOS) is resolved.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "vector-golden-")));
  try {
    cpSync(join(from, "base"), dir, { recursive: true });
    repoGit(dir, ["init", "-q", "-b", "main"]);
    repoGit(dir, ["add", "-A"]);
    repoGit(dir, ["commit", "-q", "--no-gpg-sign", "-m", "base"]);
    repoGit(dir, ["checkout", "-q", "-b", "work"]);
    for (const name of readdirSync(dir))
      if (name !== ".git") rmSync(join(dir, name), { recursive: true });
    cpSync(join(from, "head"), dir, { recursive: true });
    repoGit(dir, ["add", "-A"]);
    repoGit(dir, ["commit", "-q", "--no-gpg-sign", "-m", "head"]);
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return dir;
};

for (const dir of cases) {
  const name = relative(root, dir);
  const fixture = read(dir, "repo")?.trim() ?? null;
  let repo = null;
  if (fixture !== null) {
    try {
      repo = repoMake(fixture);
    } catch (e) {
      failed.push(name);
      console.log(`FAIL  ${name}: ${e.message}`);
      continue;
    }
  }
  const argv = words(read(dir, "cmd").trim()).map((w) =>
    repo === null ? w : w.replaceAll("{{repo}}", repo),
  );
  if (argv[0] !== "vector") {
    if (repo !== null) rmSync(repo, { recursive: true, force: true });
    failed.push(name);
    console.log(
      `FAIL  ${name}: cmd must start with "vector", not ${JSON.stringify(argv[0])}`,
    );
    continue;
  }
  const r = spawnSync(vector, argv.slice(1), {
    cwd: root,
    env: repo === null ? process.env : repoEnv(),
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  });
  if (repo !== null) {
    rmSync(repo, { recursive: true, force: true });
    r.stdout = (r.stdout ?? "").replaceAll(repo, "<repo>");
    r.stderr = (r.stderr ?? "").replaceAll(repo, "<repo>");
  }
  const problems = [];
  const wantExit = Number.parseInt(read(dir, "exit") ?? "", 10);
  if (Number.isNaN(wantExit))
    problems.push("exit file is missing or not a number");
  else if (r.status !== wantExit)
    problems.push(`exit ${r.status ?? r.signal}, want ${wantExit}`);
  const wantOut =
    read(dir, "stdout")?.replaceAll("{{version}}", VERSION) ?? null;
  if (wantOut === null) problems.push("stdout file is missing");
  else if (r.stdout !== wantOut)
    problems.push(`stdout differs:\n--- want\n${wantOut}--- got\n${r.stdout}`);
  const wantErr = (read(dir, "stderr") ?? "").replaceAll(
    "{{version}}",
    VERSION,
  );
  if (r.stderr !== wantErr)
    problems.push(`stderr differs:\n--- want\n${wantErr}--- got\n${r.stderr}`);
  if (problems.length === 0) {
    console.log(`ok    ${name}`);
  } else {
    failed.push(name);
    console.log(`FAIL  ${name}\n${problems.join("\n")}`);
  }
}

const total = units.length + cases.length;
console.log(`\n${total - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length === 0 ? 0 : 1);
