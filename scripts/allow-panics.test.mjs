// Tests for scripts/allow-panics.mjs. Run with
// `node --test scripts/allow-panics.test.mjs`.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FLAG, refusedLines } from "./allow-panics.mjs";

const SCRIPT = fileURLToPath(new URL("allow-panics.mjs", import.meta.url));

test("the flag is built, not written", () => {
  assert.equal(FLAG, `--allow${"-"}panics`);
});

// [name, file, text, the lines refused]
const rows = [
  // A workflow: run: lines never pass, a comment saying refused does.
  [
    "workflow run: line",
    ".github/workflows/ci.yml",
    `steps:\n  - run: nish src/main.ts ${FLAG}\n`,
    [2],
  ],
  [
    "workflow run: line saying refused",
    ".github/workflows/ci.yml",
    `  - run: nish x ${FLAG} # refused\n`,
    [1],
  ],
  [
    "workflow run: block command",
    ".github/workflows/ci.yml",
    `  - run: |\n      nish x ${FLAG}\n`,
    [2],
  ],
  [
    "workflow comment saying refused",
    ".github/workflows/ci.yml",
    `  # ${FLAG} is refused here\n  - run: nish x\n`,
    [],
  ],
  [
    "workflow comment not saying refused",
    ".github/workflows/ci.yml",
    `  # pass ${FLAG} when it panics\n`,
    [1],
  ],
  // A shell script.
  [
    "shell command",
    "scripts/build.sh",
    `#!/bin/sh\nnish src/main.ts ${FLAG} -o dist/vector\n`,
    [2],
  ],
  [
    "shell command saying refused",
    "scripts/build.sh",
    `nish x ${FLAG} # refused\n`,
    [1],
  ],
  [
    "shell comment saying refused",
    "scripts/build.sh",
    `# never ${FLAG}: CI refuses it\n`,
    [],
  ],
  [
    "shell comment not saying refused",
    "scripts/build.sh",
    `# ${FLAG} for now\n`,
    [1],
  ],
  // A Node script and Nish source: no line passes, a comment saying refused
  // included.
  [
    "src string",
    "src/core/nish.ts",
    `const args = ["build", "${FLAG}"]\n`,
    [1],
  ],
  [
    "src string saying refused",
    "src/core/nish.ts",
    `const why = "${FLAG} is refused" // refused\n`,
    [1],
  ],
  [
    "src line comment saying refused",
    "src/core/nish.ts",
    `// ${FLAG} is refused by CI\n`,
    [1],
  ],
  [
    "src block comment saying refused",
    "scripts/x.mjs",
    `/**\n * ${FLAG} is refused\n */\n`,
    [2],
  ],
  ["src comment not saying refused", "scripts/x.mjs", `// add ${FLAG}\n`, [1]],
  [
    "a # line in JavaScript is not a comment",
    "scripts/x.mjs",
    `# ${FLAG} refused\n`,
    [1],
  ],
  [
    "a // line in a shell script is not a comment",
    "scripts/x.sh",
    `// ${FLAG} refused\n`,
    [1],
  ],
  [
    "a file kind with no comments",
    "scripts/doc-caps.json",
    `{"x": "${FLAG} refused"}\n`,
    [1],
  ],
  // Docs: prose passes when it says refused; any fence or code block never.
  [
    "docs prose saying refused",
    "docs/guide/guides/testing.md",
    `The compiler refuses a panic; \`${FLAG}\` is refused in CI.\n`,
    [],
  ],
  [
    "docs prose not saying refused",
    "docs/guide/guides/testing.md",
    `Pass \`${FLAG}\` to build.\n`,
    [1],
  ],
  [
    "docs sh fence",
    "docs/AI.md",
    `Build it:\n\n\`\`\`sh\nnish src/main.ts ${FLAG}\n\`\`\`\n`,
    [4],
  ],
  [
    "docs sh fence saying refused",
    "docs/AI.md",
    `\`\`\`sh\nnish x ${FLAG}   # refused\n\`\`\`\n`,
    [2],
  ],
  [
    "docs tilde fence saying refused",
    "docs/AI.md",
    `~~~\n${FLAG} refused\n~~~\n`,
    [2],
  ],
  [
    "docs fence line itself",
    "docs/AI.md",
    `\`\`\`sh ${FLAG} refused\n\`\`\`\n`,
    [1],
  ],
  [
    "docs prose after a closed fence",
    "docs/AI.md",
    `\`\`\`sh\nnish x\n\`\`\`\n${FLAG} is refused.\n`,
    [],
  ],
  [
    "docs ~~~ does not close a ``` fence",
    "docs/AI.md",
    `\`\`\`\n~~~\n${FLAG} refused\n\`\`\`\n`,
    [3],
  ],
  [
    "docs indented code block saying refused",
    "docs/AI.md",
    `Run:\n\n    nish x ${FLAG}  refused\n`,
    [3],
  ],
  [
    "docs Markdown outside docs/ is read by comments",
    "scripts/README.md",
    `${FLAG} is refused.\n`,
    [1],
  ],
  [
    "a # line in a file kind with no comments",
    "scripts/notes.txt",
    `# ${FLAG} refused\n`,
    [1],
  ],
  [
    "a file under docs/ that is not Markdown is read by comments",
    "docs/guide/config.yml",
    `${FLAG} is refused.\n# ${FLAG} is refused\n`,
    [1],
  ],
  [
    "a line without the flag passes",
    "scripts/x.sh",
    "nish src/main.ts --allow-other\nnpm run allow-panics\n",
    [],
  ],
  // Every extension of each comment kind.
  ...[".sh", ".bash", ".yml", ".yaml", ".toml", ".py"].flatMap((ext) => [
    [`${ext} comment`, `scripts/x${ext}`, `# ${FLAG} refused\n`, []],
    [`${ext} code`, `scripts/x${ext}`, `x ${FLAG} refused\n`, [1]],
    [`${ext} // line`, `scripts/x${ext}`, `// ${FLAG} refused\n`, [1]],
  ]),
  ...[".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"].flatMap((ext) => [
    [`${ext} // comment`, `scripts/x${ext}`, `// ${FLAG} refused\n`, [1]],
    [`${ext} /* */ comment`, `scripts/x${ext}`, `/* ${FLAG} refused */\n`, [1]],
    [
      `${ext} block comment line`,
      `scripts/x${ext}`,
      `/*\n * ${FLAG} refused\n */\n`,
      [2],
    ],
    [
      `${ext} trailing comment`,
      `scripts/x${ext}`,
      `x(); // ${FLAG} refused\n`,
      [1],
    ],
    [`${ext} code`, `scripts/x${ext}`, `x("${FLAG}") \n`, [1]],
    [`${ext} # line`, `scripts/x${ext}`, `# ${FLAG} refused\n`, [1]],
  ]),
  // Docs fences.
  [
    "docs a fence with an info string does not close a fence",
    "docs/AI.md",
    `\`\`\`\n\`\`\`sh\n${FLAG} refused\n\`\`\`\n${FLAG} is refused.\n`,
    [3],
  ],
  [
    "docs a shorter fence does not close a longer one",
    "docs/AI.md",
    `\`\`\`\`\n\`\`\`\n${FLAG} refused\n\`\`\`\`\n${FLAG} is refused.\n`,
    [3],
  ],
  [
    "docs a longer fence with trailing spaces closes",
    "docs/AI.md",
    `\`\`\`\nx\n\`\`\`\`  \n${FLAG} is refused.\n`,
    [],
  ],
  [
    "docs tab-indented code block saying refused",
    "docs/AI.md",
    `Run:\n\n\tnish x ${FLAG} refused\n`,
    [3],
  ],
  [
    "case does not matter in refused",
    "scripts/x.sh",
    `# ${FLAG}: REFUSED\n`,
    [],
  ],
];

for (const [name, file, text, want] of rows) {
  test(`refusedLines: ${name}`, () => {
    assert.deepEqual(refusedLines(file, text), want);
  });
}

const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
};

/** A git repository holding `files` (path to text), tracked or not. */
const repo = (tracked, untracked = {}) => {
  const dir = mkdtempSync(path.join(tmpdir(), "allow-panics-"));
  git(dir, "init", "-q");
  for (const [f, t] of Object.entries({ ...tracked, ...untracked })) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), t);
  }
  for (const f of Object.keys(tracked)) git(dir, "add", f);
  return dir;
};

const run = (cwd) =>
  spawnSync(process.execPath, [SCRIPT], { cwd, encoding: "utf8" });

test("the check fails naming file:line for each tracked hit, under each directory", () => {
  const dir = repo(
    {
      ".github/workflows/ci.yml": `- run: nish x ${FLAG}\n`,
      "scripts/b.sh": `ok\nnish x ${FLAG}\n`,
      "docs/a.md": `\`\`\`sh\nnish x ${FLAG}\n\`\`\`\n`,
      "src/c.ts": `const a = "${FLAG}"\n`,
      "docs/ok.md": `${FLAG} is refused.\n`,
      "tests/t.sh": `nish x ${FLAG}\n`,
    },
    { "scripts/untracked.sh": `nish x ${FLAG}\n` },
  );
  try {
    const r = run(path.join(dir, "docs"));
    assert.equal(r.status, 1, r.stderr);
    const named = r.stderr
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => l.split(": ")[1]);
    assert.deepEqual(named.sort(), [
      ".github/workflows/ci.yml:1",
      "docs/a.md:2",
      "scripts/b.sh:2",
      "src/c.ts:1",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the check passes when every line naming the flag is exempt", () => {
  const dir = repo({
    "docs/ok.md": `${FLAG} is refused.\n`,
    "scripts/ok.sh": `# ${FLAG} is refused\n`,
  });
  try {
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /in 2 tracked files/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the check exits 2 when git cannot list the files", () => {
  const dir = repo({ "scripts/ok.sh": "ok\n" });
  try {
    writeFileSync(path.join(dir, ".git", "index"), "not an index");
    const r = run(dir);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /git ls-files failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a tracked file deleted from the work tree is passed over; one unreadable exits 2", () => {
  const dir = repo({ "scripts/gone.sh": "ok\n", "scripts/dir.sh": "ok\n" });
  try {
    rmSync(path.join(dir, "scripts/gone.sh"));
    rmSync(path.join(dir, "scripts/dir.sh"));
    let r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    mkdirSync(path.join(dir, "scripts/dir.sh"));
    r = run(dir);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /cannot read scripts\/dir\.sh/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the check exits 2 outside a git repository", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "allow-panics-"));
  try {
    const r = spawnSync(process.execPath, [SCRIPT], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) },
    });
    assert.equal(r.status, 2, r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
