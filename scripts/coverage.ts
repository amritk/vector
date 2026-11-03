// The coverage gate: fails when aggregate line or function coverage drops below
// the floor. bunfig's coverageThreshold is applied per file, so one untested
// file (src/rfc/report.ts sits near 6%) would make any useful floor fail; this
// totals bun's lcov report instead.
//
// Raise the floors as coverage rises. Never lower them to get a branch green.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FLOOR = { lines: 74, functions: 85 };

const dir = join(import.meta.dir, "..", "coverage");
rmSync(dir, { recursive: true, force: true });
const run = spawnSync(
  "bun",
  ["test", "--coverage", "--coverage-reporter=lcov", `--coverage-dir=${dir}`],
  { stdio: "inherit" },
);
if (run.status !== 0) process.exit(run.status ?? 1);

let lcov: string;
try {
  lcov = readFileSync(join(dir, "lcov.info"), "utf8");
} catch {
  console.error("coverage: bun wrote no lcov.info; failing closed");
  process.exit(1);
}
const total = (key: string): number =>
  [...lcov.matchAll(new RegExp(`^${key}:(\\d+)$`, "gm"))].reduce(
    (sum, m) => sum + Number(m[1]),
    0,
  );
const pct = (hit: number, found: number): number =>
  found === 0 ? 0 : (100 * hit) / found;
const lines = pct(total("LH"), total("LF"));
const functions = pct(total("FNH"), total("FNF"));

console.log(
  `coverage: lines ${lines.toFixed(2)}% (floor ${FLOOR.lines}%), functions ${functions.toFixed(2)}% (floor ${FLOOR.functions}%)`,
);
if (lines < FLOOR.lines || functions < FLOOR.functions) {
  console.error("coverage: below the floor");
  process.exit(1);
}
