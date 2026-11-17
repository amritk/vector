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

/** A temp dir holding `files` ({ path: content }); `caps` is written as the caps file unless a string. */
const repo = (files, caps) => {
  const dir = mkdtempSync(path.join(tmpdir(), "doc-caps-"));
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
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd: dir,
    stdio: "ignore",
  });

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
  test(name, () => {
    const dir = repo(files, caps);
    try {
      const r = run(dir);
      assert.equal(r.status, status, r.stderr);
      for (const l of lines) assert.ok(r.stderr.includes(l), r.stderr);
      if (status === 0) assert.equal(r.stderr, "");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
  test(`--base: ${name}`, () => {
    const dir = repo(files, baseCaps);
    try {
      const sha = commit(dir);
      writeFileSync(
        path.join(dir, "scripts/doc-caps.json"),
        JSON.stringify(headCaps),
      );
      const r = run(dir, "--base", sha);
      assert.equal(r.status, status, r.stderr);
      for (const l of lines) assert.ok(r.stderr.includes(l), r.stderr);
      if (status === 0) assert.equal(r.stderr, "");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("--base: a base without the caps file has no previous caps", () => {
  const dir = repo(files, baseCaps);
  try {
    rmSync(path.join(dir, "scripts/doc-caps.json"));
    const sha = commit(dir);
    writeFileSync(
      path.join(dir, "scripts/doc-caps.json"),
      JSON.stringify(baseCaps),
    );
    const r = run(dir, "--base", sha);
    assert.equal(r.status, 0, r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--base: a base whose caps file is malformed exits 2", () => {
  const dir = repo(files, "{ not json");
  try {
    const sha = commit(dir);
    writeFileSync(
      path.join(dir, "scripts/doc-caps.json"),
      JSON.stringify(baseCaps),
    );
    const r = run(dir, "--base", sha);
    assert.equal(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes(`${sha}:scripts/doc-caps.json`), r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--base: a base that names no commit exits 2", () => {
  const dir = repo(files, baseCaps);
  try {
    commit(dir);
    const r = run(dir, "--base", "0000000000000000000000000000000000000000");
    assert.equal(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes("cannot read the base"), r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--base: outside a git repo the base is unreadable, exit 2", () => {
  const dir = repo(files, baseCaps);
  try {
    const r = run(dir, "--base", "HEAD");
    assert.equal(r.status, 2, r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// [name, arguments]
const USAGE_CASES = [
  ["--base without a ref", ["--base"]],
  ["an unknown flag", ["--frobnicate"]],
];

for (const [name, args] of USAGE_CASES) {
  test(`bad usage: ${name} exits 2`, () => {
    const dir = repo(files, baseCaps);
    try {
      const r = run(dir, ...args);
      assert.equal(r.status, 2, r.stderr);
      assert.ok(r.stderr.includes("usage:"), r.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("a missing caps file exits 2", () => {
  const dir = repo({}, {});
  try {
    rmSync(path.join(dir, "scripts/doc-caps.json"));
    const r = run(dir);
    assert.equal(r.status, 2, r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
