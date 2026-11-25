// node --test scripts/panics.test.mjs: drives scripts/panics.mjs as a child
// process, over fixture Nish programs compiled by the next nish and over
// fixture --emit-panics reports, and checks its exit status and messages.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(here);
const script = path.join(here, "panics.mjs");
const nish = path.join(repoRoot, ".nish-next/bin/nish");

before(() => {
  const fetch = spawnSync("bash", [path.join(here, "fetch-nish-next.sh")], {
    encoding: "utf8",
  });
  assert.equal(fetch.status, 0, fetch.stdout + fetch.stderr);
});

/** A temp dir holding `files` ({ path: content }), removed when `t` ends. */
const fixture = (t, files) => {
  const dir = mkdtempSync(path.join(tmpdir(), "panics-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [f, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(
      path.join(dir, f),
      typeof content === "string" ? content : JSON.stringify(content),
    );
  }
  return dir;
};

/** Runs the ratchet in `dir` with `args`, baselines in `dir/b`. */
const ratchet = (dir, ...args) => {
  mkdirSync(path.join(dir, "b"), { recursive: true });
  const run = spawnSync(
    process.execPath,
    [script, "--root", dir, "--baseline-dir", "b", ...args],
    { encoding: "utf8" },
  );
  return { status: run.status, out: run.stdout, err: run.stderr };
};

/** One function of a report: `module`, `name`, and its `panics`. */
const fn = (module, name, ...panics) => ({
  name,
  symbol: name,
  module,
  line: 1,
  panics: panics.map((p, i) => ({ line: i + 2, column: 3, ...p })),
});

/** src/lib.ts: `libAt`, which reads `xs[i]` with `guard` around it or bare. */
const lib = (guard) =>
  guard
    ? `export const libAt = (xs: i32[], i: i32): i32 => {
  if (i >= 0 && i < xs.length) {
    return xs[i]
  }
  return 0
}
`
    : `export const libAt = (xs: i32[], i: i32): i32 => {
  return xs[i]
}
`;
/** src/main.ts, calling `libAt` on an index the compiler cannot know. */
const main = `import { libAt } from './lib.ts'
const xs: i32[] = [1, 2, 3]
const n: i32 = toI32(process.argv.length)
console.log(libAt(xs, n))
`;

const compiled = [
  {
    name: "a guarded index passes with no baseline",
    guard: true,
    baseline: {},
    status: 0,
    out: /panics: 0 unproven sites/,
  },
  {
    name: "an unguarded index with no baseline is refused, naming the site",
    guard: false,
    baseline: {},
    status: 1,
    err: /src\/lib\.ts: 1 unproven sites, and no baseline names it\n {2}src\/lib\.ts:2:10 index\n/,
  },
  {
    name: "an unguarded index at its baseline passes, its caller uncounted",
    guard: false,
    baseline: { "s.json": { modules: { "src/lib.ts": 1 } } },
    status: 0,
    out: /panics: 1 unproven sites/,
  },
];

for (const row of compiled) {
  test(`compiled: ${row.name}`, (t) => {
    const files = { "src/lib.ts": lib(row.guard), "src/main.ts": main };
    for (const [f, json] of Object.entries(row.baseline))
      files[`b/${f}`] = json;
    const dir = fixture(t, files);
    const r = ratchet(dir, "--nish", nish);
    assert.equal(r.status, row.status, r.out + r.err);
    if (row.out) assert.match(r.out, row.out);
    if (row.err) assert.match(r.err, row.err);
  });
}

const L = "src/l.ts";
const own = fn("src/o.ts", "ownFn", { kind: "oom", allowed: true });
const counted = [
  ["an oom site", [{ kind: "oom" }], 0],
  ["an index site", [{ kind: "index" }], 1],
  ["a proven site", [{ kind: "index", proven: true }], 0],
  ["a site proven false", [{ kind: "index", proven: false }], 1],
  ["an allowed site", [{ kind: "divide", allowed: true }], 0],
  ["a site allowed false", [{ kind: "divide", allowed: false }], 1],
  ["a call into a src function", [{ kind: "call", callee: "ownFn" }], 0],
  ["a call into std", [{ kind: "call", callee: "stdFn" }], 1],
  [
    "a non-call site naming a src callee",
    [{ kind: "index", callee: "ownFn" }],
    1,
  ],
];

for (const [name, panics, n] of counted) {
  test(`counting: ${name} counts ${n}`, (t) => {
    const report = {
      functions: [
        own,
        fn("std/s.ts", "stdFn", { kind: "index" }),
        fn(L, "lFn", ...panics),
      ],
    };
    const dir = fixture(t, {
      "r.json": report,
      "b/s.json": { modules: { [L]: 0 } },
    });
    const r = ratchet(dir, "--report", "r.json");
    assert.equal(r.status, n, r.out + r.err);
    if (n === 1) {
      const p = panics[0];
      const site = `  ${L}:2:3 ${p.kind}${p.kind === "call" ? ` ${p.callee}` : ""}`;
      assert.equal(
        r.err,
        `${L}: 1 unproven sites, over its baseline of 0 (s.json)\n${site}\npanics: 1 module(s) refused\n`,
      );
    }
  });
}

test("counting: a std function named like a src one does not hide a call", (t) => {
  const report = {
    functions: [
      fn("std/s.ts", "ownFn", { kind: "index" }),
      fn(L, "lFn", { kind: "call", callee: "ownFn" }),
    ],
  };
  const dir = fixture(t, {
    "r.json": report,
    "b/s.json": { modules: { [L]: 0 } },
  });
  const r = ratchet(dir, "--report", "r.json");
  assert.equal(r.status, 1, r.out + r.err);
  assert.match(r.err, / {2}src\/l\.ts:2:3 call ownFn\n/);
});

const two = { functions: [fn(L, "lFn", { kind: "index" }, { kind: "slice" })] };
const compare = [
  [
    "over by one",
    { [L]: 1 },
    1,
    /src\/l\.ts: 2 unproven sites, over its baseline of 1 \(s\.json\)\n {2}src\/l\.ts:2:3 index\n {2}src\/l\.ts:3:3 slice\n/,
  ],
  ["at its baseline", { [L]: 2 }, 0, null],
  [
    "under by one",
    { [L]: 3 },
    0,
    /warning: src\/l\.ts: 2 unproven sites, under its baseline of 3; lower it in s\.json/,
  ],
  [
    "a baselined module with no sites",
    { [L]: 2, "src/gone.ts": 1 },
    0,
    /warning: src\/gone\.ts: 0 unproven sites, under its baseline of 1/,
  ],
  ["a module at 0 with no sites", { [L]: 2, "src/zero.ts": 0 }, 0, null],
];

for (const [name, modules, status, err] of compare) {
  test(`baseline: ${name} exits ${status}`, (t) => {
    const dir = fixture(t, {
      "r.json": two,
      "b/s.json": { modules, waiting: ["ignored"] },
      "b/README.md": "not a baseline",
    });
    const r = ratchet(dir, "--report", "r.json");
    assert.equal(r.status, status, r.out + r.err);
    if (err) assert.match(r.err, err);
    else assert.doesNotMatch(r.err, /warning/);
    if (status === 0) assert.match(r.out, /panics: 2 unproven sites/);
    else assert.match(r.err, /panics: 1 module\(s\) refused/);
  });
}

test("baseline: counts in two files are merged", (t) => {
  const report = {
    functions: [
      fn("src/m.ts", "mFn", { kind: "pop" }),
      fn("src/n.ts", "nFn", { kind: "pop" }),
      fn(L, "lFn", { kind: "index" }),
    ],
  };
  const dir = fixture(t, {
    "r.json": report,
    "b/a.json": { modules: { [L]: 1, "src/n.ts": 0 } },
    "b/c.json": { modules: { "src/m.ts": 0 } },
  });
  const r = ratchet(dir, "--report", "r.json");
  assert.equal(r.status, 1, r.out + r.err);
  assert.equal(
    r.err,
    [
      "src/m.ts: 1 unproven sites, over its baseline of 0 (c.json)",
      "  src/m.ts:2:3 pop",
      "src/n.ts: 1 unproven sites, over its baseline of 0 (a.json)",
      "  src/n.ts:2:3 pop",
      "panics: 2 module(s) refused",
      "",
    ].join("\n"),
  );
});

/**
 * A stub nish, run in the root: it writes its arguments to args.txt there and
 * `report` to its --emit-panics path, then exits 0.
 */
const stubNish = (report) => `#!/bin/bash
printf '%s\\n' "$@" > args.txt
while [ "$1" != --emit-panics ]; do shift; done
printf '%s' '${JSON.stringify(report)}' > "$2"
`;
const defaultNish = [
  ["a fetch that fails exits 2", "exit 3\n", 2, /fetch-nish-next\.sh failed/],
  [
    "a fetch that succeeds runs .nish-next/bin/nish",
    "echo fetched\n",
    1,
    /src\/l\.ts: 1 unproven sites, and no baseline names it/,
  ],
];

for (const [name, fetch, status, err] of defaultNish) {
  test(`default nish: ${name}`, (t) => {
    const dir = fixture(t, {
      "scripts/fetch-nish-next.sh": fetch,
      ".nish-next/bin/nish": stubNish({
        functions: [fn(L, "lFn", { kind: "index" })],
      }),
    });
    chmodSync(path.join(dir, ".nish-next/bin/nish"), 0o755);
    const r = ratchet(dir);
    assert.equal(r.status, status, r.out + r.err);
    assert.match(r.err, err);
    if (status === 1) assert.match(r.out, /^fetched\n/);
  });
}

test("compile: nish gets --entry, a debug profile and a link in a temp dir it then removes", (t) => {
  const dir = fixture(t, {
    "n.sh": stubNish({ functions: [fn(L, "lFn", { kind: "index" })] }),
  });
  chmodSync(path.join(dir, "n.sh"), 0o755);
  const r = ratchet(dir, "--nish", path.join(dir, "n.sh"), "--entry", "e.ts");
  assert.equal(r.status, 1, r.out + r.err);
  const args = readFileSync(path.join(dir, "args.txt"), "utf8").split("\n");
  const tmp = path.dirname(args[3]);
  assert.match(path.basename(tmp), /^vector-panics-/);
  assert.deepEqual(args, [
    "e.ts",
    "--allow-panics",
    "--emit-panics",
    path.join(tmp, "panics.json"),
    "--link",
    path.join(tmp, "v"),
    "--profile",
    "debug",
    "",
  ]);
  assert.equal(existsSync(tmp), false);
});

test("root and baseline dir: default to the working directory and its scripts/panic-baseline", (t) => {
  const dir = fixture(t, {
    "r.json": two,
    "scripts/panic-baseline/s.json": { modules: { [L]: 2 } },
  });
  const run = spawnSync(process.execPath, [script, "--report", "r.json"], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /panics: 2 unproven sites/);
});

const failures = [
  ["a missing report", {}, ["--report", "r.json"], /cannot read panic report/],
  [
    "a report that is not JSON",
    { "r.json": "{" },
    ["--report", "r.json"],
    /panic report .* is not JSON/,
  ],
  [
    "a report with no functions",
    { "r.json": { fns: [] } },
    ["--report", "r.json"],
    /no functions array/,
  ],
  [
    "a report that is null",
    { "r.json": "null" },
    ["--report", "r.json"],
    /no functions array/,
  ],
  [
    "a baseline module not under src/",
    { "r.json": two, "b/s.json": { modules: { "srcx/l.ts": 0 } } },
    ["--report", "r.json"],
    /baseline .*s\.json: srcx\/l\.ts is not a src\/ module/,
  ],
  [
    "a nish that exits 0 and writes no report",
    { "src/main.ts": "" },
    ["--nish", "true"],
    /cannot read panic report .*panics\.json/,
  ],
  [
    "a baseline that is not JSON",
    { "r.json": two, "b/s.json": "[" },
    ["--report", "r.json"],
    /baseline .* is not JSON/,
  ],
  [
    "a baseline with no modules",
    { "r.json": two, "b/s.json": { counts: {} } },
    ["--report", "r.json"],
    /has no modules object/,
  ],
  [
    "a baseline that is null",
    { "r.json": two, "b/s.json": "null" },
    ["--report", "r.json"],
    /baseline .*s\.json has no modules object/,
  ],
  [
    "a baseline whose modules is null",
    { "r.json": two, "b/s.json": { modules: null } },
    ["--report", "r.json"],
    /has no modules object/,
  ],
  [
    "a baseline whose modules is an array",
    { "r.json": two, "b/s.json": { modules: [] } },
    ["--report", "r.json"],
    /has no modules object/,
  ],
  [
    "a negative count",
    { "r.json": two, "b/s.json": { modules: { [L]: -1 } } },
    ["--report", "r.json"],
    /src\/l\.ts is not a count: -1/,
  ],
  [
    "a fractional count",
    { "r.json": two, "b/s.json": { modules: { [L]: 1.5 } } },
    ["--report", "r.json"],
    /is not a count: 1\.5/,
  ],
  [
    "a string count",
    { "r.json": two, "b/s.json": { modules: { [L]: "2" } } },
    ["--report", "r.json"],
    /is not a count: 2/,
  ],
  [
    "a module in two baselines",
    {
      "r.json": two,
      "b/a.json": { modules: { [L]: 1 } },
      "b/c.json": { modules: { [L]: 1 } },
    },
    ["--report", "r.json"],
    /src\/l\.ts is in both a\.json and c\.json/,
  ],
  [
    "a missing baseline directory",
    { "r.json": two },
    ["--report", "r.json", "--baseline-dir", "nowhere"],
    /cannot read baseline directory/,
  ],
  ["an unknown option", {}, ["--bogus"], /Unknown option '--bogus'/],
  [
    "a nish that cannot run",
    { "src/main.ts": "" },
    ["--nish", "/nonexistent/nish"],
    /cannot run \/nonexistent\/nish/,
  ],
  [
    "a nish that fails",
    { "src/main.ts": "" },
    ["--nish", "false"],
    /false src\/main\.ts --allow-panics .* exited 1/,
  ],
  [
    "a nish that refuses the program",
    { "src/main.ts": "const x: i32 = 'no'\n" },
    ["--nish", nish],
    /exited 1/,
  ],
];

// Report shapes the counting rule cannot read, each refused rather than
// counted as nothing. `good` is a src/ function, so only the row's flaw fails.
const good = fn(L, "lFn", { kind: "index" });
const site = (p) => fn(L, "lFn", { kind: "index", ...p });
const shapes = [
  ["no functions", [], /names no src\/ module/],
  ["only std functions", [fn("std/s.ts", "s")], /names no src\/ module/],
  [
    "a ./src/ module",
    [fn("./src/x.ts", "x", { kind: "index" })],
    /module \.\/src\/x\.ts is under neither/,
  ],
  [
    "a srcx/ module",
    [good, fn("srcx/a.ts", "a")],
    /function 1: module srcx\/a\.ts is under neither/,
  ],
  [
    "a stdx/ module",
    [good, fn("stdx/a.ts", "a")],
    /function 1: module stdx\/a\.ts is under neither/,
  ],
  ["a function that is null", [good, null], /function 1 is not an object/],
  ["a function that is a number", [good, 5], /function 1 is not an object/],
  [
    "a function with no name",
    [good, { module: L, panics: [] }],
    /function 1 has no name/,
  ],
  [
    "a function with no module",
    [good, { name: "f", panics: [] }],
    /function 1 has no module/,
  ],
  [
    "a function with no panics",
    [good, { name: "f", module: L }],
    /function 1 has no panics array/,
  ],
  [
    "a function whose panics is an object",
    [good, { name: "f", module: L, panics: {} }],
    /function 1 has no panics array/,
  ],
  [
    "a site that is null",
    [good, { name: "f", module: L, panics: [null] }],
    /function 1 \(src\/l\.ts\) site 0 is not an object/,
  ],
  [
    "a site that is a string",
    [good, { name: "f", module: L, panics: ["index"] }],
    /site 0 is not an object/,
  ],
  [
    "a site with no kind",
    [good, site({ kind: undefined })],
    /site 0 has no kind/,
  ],
  [
    "a site with no line",
    [good, site({ line: undefined })],
    /site 0 has no line and column/,
  ],
  [
    "a site with a string column",
    [good, site({ column: "3" })],
    /site 0 has no line and column/,
  ],
  [
    'a site proven "true"',
    [good, site({ proven: "true" })],
    /proven and allowed must be booleans/,
  ],
  [
    "a site allowed 1",
    [good, site({ allowed: 1 })],
    /proven and allowed must be booleans/,
  ],
  [
    "a call with no callee",
    [good, site({ kind: "call" })],
    /site 0 is a call with no callee/,
  ],
];

for (const [name, functions, err] of shapes) {
  test(`report shape: ${name} exits 2`, (t) => {
    const dir = fixture(t, {
      "r.json": { functions },
      "b/s.json": { modules: { [L]: 5 } },
    });
    const r = ratchet(dir, "--report", "r.json");
    assert.equal(r.status, 2, r.out + r.err);
    assert.match(r.err, err);
    assert.doesNotMatch(r.err, /TypeError|is not a function|Cannot read/);
  });
}

for (const [name, files, args, err] of failures) {
  test(`failure: ${name} exits 2`, (t) => {
    const dir = fixture(t, files);
    const r = ratchet(dir, ...args);
    assert.equal(r.status, 2, r.out + r.err);
    assert.match(r.err, err);
  });
}
