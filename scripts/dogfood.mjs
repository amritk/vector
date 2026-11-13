#!/usr/bin/env node
// Checks that vector's tests of itself are what vector generates now. Each
// tests/dogfood/*_test.ts was emitted from one of vector's own contracts, and
// its header names the command that regenerates it:
//
//   //   vector spec emit contracts/<name>.json --package vector=src -o tests/dogfood/<name>_test.ts.
//
// For each test, this:
//
//   1. extracts specs/<name>.xml again and refuses a contract that differs
//      from contracts/<name>.json;
//   2. checks the contract, running every vector's source and comparing its
//      signatures with the module the contract names under src/;
//   3. runs `vector spec stale`, which refuses a test whose contract changed;
//   4. runs the regenerate command and refuses a test that changed, so a change
//      to the emitter shows up in the test it emits. The regenerated test is
//      left in place, ready to commit.
//
// npm test runs the tests themselves. This exits 1 when anything is out of
// date, and 2 when it cannot run (no dist/vector, no dogfood test).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vector = join(root, "dist/vector");
const dir = join(root, "tests/dogfood");
const REGEN =
  /^\/\/ {3}vector spec emit (\S+)((?: --package \S+)*) -o (\S+)\.$/m;

if (!existsSync(vector)) {
  console.error("no dist/vector: run npm run build");
  process.exit(2);
}
const tests = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith("_test.ts"))
      .sort()
  : [];
if (tests.length === 0) {
  console.error("no tests/dogfood/*_test.ts to check");
  process.exit(2);
}

const run = (args) => spawnSync(vector, args, { cwd: root, encoding: "utf8" });
const problems = [];

for (const name of tests) {
  const test = `tests/dogfood/${name}`;
  const before = readFileSync(join(root, test), "utf8");
  const m = REGEN.exec(before);
  if (m === null || m[3] !== test) {
    problems.push(`${test}: no regenerate line that writes ${test}`);
    continue;
  }
  const [, contract, packages] = m;
  const stem = contract.replace(/^contracts\//, "").replace(/\.json$/, "");
  // The contract's paths are relative to it, so extract beside it.
  const fresh = join(root, `contracts/.dogfood-${stem}.json`);
  const ex = run(["spec", "extract", `specs/${stem}.xml`, "-o", fresh]);
  if (ex.status !== 0) {
    problems.push(
      `${test}: spec extract specs/${stem}.xml failed\n${ex.stderr}`,
    );
  } else if (
    readFileSync(fresh, "utf8") !== readFileSync(join(root, contract), "utf8")
  ) {
    problems.push(
      `${contract}: not what specs/${stem}.xml extracts to now: run vector spec extract specs/${stem}.xml -o ${contract}`,
    );
  }
  rmSync(fresh, { force: true });
  const module = JSON.parse(readFileSync(join(root, contract), "utf8")).target
    ?.module;
  const pkg = /^vector\/(.+)$/.exec(module ?? "");
  const check = ["spec", "check", contract, "--run-sources"];
  if (pkg !== null) check.push("--module", `src/${pkg[1]}.ts`);
  const ck = run(check);
  if (ck.status !== 0) {
    problems.push(`${contract}: spec check failed\n${ck.stdout}${ck.stderr}`);
  }
  const st = run(["spec", "stale", test, contract]);
  if (st.status !== 0) {
    problems.push(`${test}: ${st.stdout.trim()}${st.stderr.trim()}`);
  }
  const emit = ["spec", "emit", contract];
  for (const p of packages
    .trim()
    .split(/\s+/)
    .filter((w) => w !== "--package"))
    if (p.length > 0) emit.push("--package", p);
  emit.push("-o", test);
  const em = run(emit);
  if (em.status !== 0) {
    problems.push(`${test}: spec emit failed\n${em.stderr}`);
  } else if (readFileSync(join(root, test), "utf8") !== before) {
    problems.push(
      `${test}: not what its contract emits now; it has been regenerated, so review and commit it`,
    );
  }
  console.log(`checked ${test}`);
}

for (const p of problems) console.log(`FAIL  ${p}`);
console.log(`\n${tests.length} dogfood test(s), ${problems.length} problem(s)`);
process.exit(problems.length === 0 ? 0 : 1);
