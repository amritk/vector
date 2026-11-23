// node --test scripts/doc-caps.test.mjs: drives scripts/doc-caps.mjs as a
// child process over temporary repos and checks its exit status and message.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "doc-caps.mjs",
);
const advice =
  "shorten it in place: simplify, never move text into another file to fit";

/**
 * A temp dir holding `files` ({ path: content }), removed when test `t` ends;
 * `caps` is written as the caps file, verbatim when a string.
 */
const repo = (t, files, caps) => {
  const dir = mkdtempSync(path.join(tmpdir(), "doc-caps-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const all = {
    ...files,
    "scripts/doc-caps.json":
      typeof caps === "string" ? caps : JSON.stringify(caps),
  };
  for (const [f, content] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), content);
  }
  return dir;
};

const git = (dir, ...args) =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    {
      cwd: dir,
      stdio: "ignore",
    },
  );

/** Commit the dir as it stands and return the commit's SHA. */
const commit = (dir) => {
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: dir,
    encoding: "utf8",
  }).trim();
};

const run = (dir, ...args) =>
  spawnSync(process.execPath, [script, ...args], {
    cwd: dir,
    encoding: "utf8",
  });

const x = (n) => "x".repeat(n);

// [name, files, caps, exit status, the lines stderr must contain]
const CASES = [
  ["under its cap", { "a.md": x(9) }, { "a.md": 10 }, 0, []],
  ["exactly at its cap", { "a.md": x(10) }, { "a.md": 10 }, 0, []],
  [
    "bytes, not characters",
    { "a.md": "é".repeat(6) },
    { "a.md": 10 },
    1,
    ["a.md: 12 bytes, over its cap of 10"],
  ],
  [
    "over its cap",
    { "a.md": x(11), "b.md": x(1) },
    { "a.md": 10, "b.md": 10 },
    1,
    [`a.md: 11 bytes, over its cap of 10; ${advice}`],
  ],
  [
    "a nested file over its cap",
    { "d/e/SKILL.md": x(300) },
    { "d/e/SKILL.md": 256 },
    1,
    ["d/e/SKILL.md: 300 bytes, over its cap of 256"],
  ],
  [
    "a missing file",
    {},
    { "gone.md": 10 },
    1,
    [
      `gone.md: missing, but scripts/doc-caps.json caps it at 10 bytes; ${advice}`,
    ],
  ],
  [
    "a directory, not a file",
    { "d/a.md": "" },
    { d: 10 },
    1,
    ["d: missing, but scripts/doc-caps.json caps it at 10 bytes"],
  ],
  ["malformed JSON", {}, "{ not json", 2, ["is not valid JSON"]],
  ["an array, not an object", {}, "[]", 2, ["must be an object"]],
  [
    "a cap that is not a positive integer",
    { "a.md": "" },
    { "a.md": "10" },
    2,
    ["the cap of a.md must be a positive integer"],
  ],
  ["a zero cap", { "a.md": "" }, { "a.md": 0 }, 2, ["positive integer"]],
];

for (const [name, files, caps, status, lines] of CASES) {
  test(name, (t) => {
    const dir = repo(t, files, caps);
    const r = run(dir);
    assert.equal(r.status, status, r.stderr);
    for (const l of lines) assert.ok(r.stderr.includes(l), r.stderr);
    if (status === 0) assert.equal(r.stderr, "");
  });
}

const files = { "a.md": x(5), "b.md": x(5), "c.md": x(5) };
const baseCaps = { "a.md": 10, "b.md": 10 };

// [name, the head's caps, exit status, the lines stderr must contain]
const BASE_CASES = [
  ["the same caps", baseCaps, 0, []],
  ["a lowered cap", { "a.md": 8, "b.md": 10 }, 0, []],
  ["an added entry", { ...baseCaps, "c.md": 10 }, 0, []],
  [
    "a raised cap",
    { "a.md": 11, "b.md": 10 },
    1,
    ["a.md: its cap was raised from 10 to 11 bytes since", advice],
  ],
  [
    "a removed entry",
    { "a.md": 10 },
    1,
    ["b.md: its cap of 10 bytes at", "was removed", advice],
  ],
  [
    "an entry removed and another added",
    { "a.md": 10, "c.md": 10 },
    1,
    ["b.md: its cap of 10 bytes at"],
  ],
];

for (const [name, headCaps, status, lines] of BASE_CASES) {
  test(`--base: ${name}`, (t) => {
    const dir = repo(t, files, baseCaps);
    const sha = commit(dir);
    writeFileSync(
      path.join(dir, "scripts/doc-caps.json"),
      JSON.stringify(headCaps),
    );
    const r = run(dir, "--base", sha);
    assert.equal(r.status, status, r.stderr);
    for (const l of lines) assert.ok(r.stderr.includes(l), r.stderr);
    if (status === 0) assert.equal(r.stderr, "");
  });
}

const renameFiles = { "a.md": x(5), "b.md": "y\ny\ny\ny\n" };
const mv = (from, to) => (dir) => git(dir, "mv", from, to);

// [name, base caps, the change committed on top, the head's caps, exit status,
// the lines stderr must contain]
const RENAME_CASES = [
  [
    "a rename that keeps its cap",
    baseCaps,
    mv("b.md", "c.md"),
    { "a.md": 10, "c.md": 10 },
    0,
    [],
  ],
  [
    "a rename that lowers its cap",
    baseCaps,
    mv("b.md", "c.md"),
    { "a.md": 10, "c.md": 9 },
    0,
    [],
  ],
  [
    "a rename into a new directory",
    baseCaps,
    (dir) => {
      mkdirSync(path.join(dir, "d"));
      git(dir, "mv", "b.md", "d/b.md");
    },
    { "a.md": 10, "d/b.md": 10 },
    0,
    [],
  ],
  [
    "two renames",
    baseCaps,
    (dir) => {
      mv("a.md", "e.md")(dir);
      mv("b.md", "f.md")(dir);
    },
    { "e.md": 10, "f.md": 10 },
    0,
    [],
  ],
  [
    "a rename after a modified file",
    baseCaps,
    (dir) => {
      writeFileSync(path.join(dir, "a.md"), x(6));
      mv("b.md", "c.md")(dir);
    },
    { "a.md": 10, "c.md": 10 },
    0,
    [],
  ],
  [
    "a rename whose content also changed",
    baseCaps,
    (dir) => {
      mv("b.md", "c.md")(dir);
      writeFileSync(path.join(dir, "c.md"), "y\ny\ny\nz\n");
      git(dir, "add", "c.md");
    },
    { "a.md": 10, "c.md": 10 },
    0,
    [],
  ],
  [
    "a rename that raises its cap",
    baseCaps,
    mv("b.md", "c.md"),
    { "a.md": 10, "c.md": 11 },
    1,
    ["b.md: renamed to c.md, whose cap of 11 bytes is higher than its 10 at"],
  ],
  [
    "a rename whose new path has no cap",
    baseCaps,
    mv("b.md", "c.md"),
    { "a.md": 10 },
    1,
    ["b.md: renamed to c.md, which has no cap", "was removed", advice],
  ],
  [
    "a rename to a path the base already capped",
    { ...baseCaps, "c.md": 10 },
    mv("b.md", "c.md"),
    { "a.md": 10, "c.md": 10 },
    1,
    ["b.md: renamed to c.md, which was already capped at", "was removed"],
  ],
  [
    "a file deleted outright",
    baseCaps,
    (dir) => git(dir, "rm", "-q", "b.md"),
    { "a.md": 10 },
    1,
    ["b.md: its cap of 10 bytes at", "was removed", advice],
  ],
  [
    "an entry removed while its file stays",
    baseCaps,
    () => {},
    { "a.md": 10 },
    1,
    ["b.md: its cap of 10 bytes at", "was removed"],
  ],
  [
    "a rename beside an entry removed without one",
    baseCaps,
    mv("b.md", "c.md"),
    { "c.md": 10 },
    1,
    ["a.md: its cap of 10 bytes at"],
  ],
];

for (const [name, before, change, headCaps, status, lines] of RENAME_CASES) {
  test(`--base: ${name}`, (t) => {
    const dir = repo(t, renameFiles, before);
    const sha = commit(dir);
    change(dir);
    writeFileSync(
      path.join(dir, "scripts/doc-caps.json"),
      JSON.stringify(headCaps),
    );
    commit(dir);
    const r = run(dir, "--base", sha);
    assert.equal(r.status, status, r.stderr);
    for (const l of lines) assert.ok(r.stderr.includes(l), r.stderr);
    if (status === 0) assert.equal(r.stderr, "");
    else assert.ok(!r.stderr.includes("c.md:"), r.stderr);
  });
}

test("--base: a git failure while reading renames exits 2", (t) => {
  const dir = repo(t, renameFiles, baseCaps);
  const sha = commit(dir);
  mv("b.md", "c.md")(dir);
  writeFileSync(
    path.join(dir, "scripts/doc-caps.json"),
    JSON.stringify({ "a.md": 10, "c.md": 10 }),
  );
  commit(dir);
  // Delete HEAD's tree, so the base still names a commit but no diff can be read.
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    cwd: dir,
    encoding: "utf8",
  }).trim();
  rmSync(path.join(dir, ".git/objects", tree.slice(0, 2), tree.slice(2)));
  const r = run(dir, "--base", sha);
  assert.equal(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes("cannot read the renames"), r.stderr);
});

test("--base: a base without the caps file has no previous caps", (t) => {
  const dir = repo(t, files, baseCaps);
  rmSync(path.join(dir, "scripts/doc-caps.json"));
  const sha = commit(dir);
  writeFileSync(
    path.join(dir, "scripts/doc-caps.json"),
    JSON.stringify(baseCaps),
  );
  const r = run(dir, "--base", sha);
  assert.equal(r.status, 0, r.stderr);
});

test("--base: a base whose caps file is malformed exits 2", (t) => {
  const dir = repo(t, files, "{ not json");
  const sha = commit(dir);
  writeFileSync(
    path.join(dir, "scripts/doc-caps.json"),
    JSON.stringify(baseCaps),
  );
  const r = run(dir, "--base", sha);
  assert.equal(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes(`${sha}:scripts/doc-caps.json`), r.stderr);
});

test("--base: a base that names no commit exits 2", (t) => {
  const dir = repo(t, files, baseCaps);
  commit(dir);
  const r = run(dir, "--base", "0000000000000000000000000000000000000000");
  assert.equal(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes("cannot read the base"), r.stderr);
});

test("--base: outside a git repo the base is unreadable, exit 2", (t) => {
  const dir = repo(t, files, baseCaps);
  const r = run(dir, "--base", "HEAD");
  assert.equal(r.status, 2, r.stderr);
});

// [name, arguments]
const USAGE_CASES = [
  ["--base without a ref", ["--base"]],
  ["an unknown flag", ["--frobnicate"]],
  ["a ref that starts with -", ["--base", "--output=x"]],
];

for (const [name, args] of USAGE_CASES) {
  test(`bad usage: ${name} exits 2`, (t) => {
    const dir = repo(t, files, baseCaps);
    const r = run(dir, ...args);
    assert.equal(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes("usage:"), r.stderr);
  });
}

test("a missing caps file exits 2", (t) => {
  const dir = repo(t, {}, {});
  rmSync(path.join(dir, "scripts/doc-caps.json"));
  const r = run(dir);
  assert.equal(r.status, 2, r.stderr);
});
