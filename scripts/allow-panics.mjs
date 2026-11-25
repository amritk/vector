// Refuses the compiler's relax-panics flag anywhere it could be run: in any
// tracked file under scripts/, .github/, docs/ or src/.
//
//   npm run allow-panics      (from anywhere in the repository)
//
// A line that names the flag passes only when it says the flag is refused
// (it matches /refuse/i) and nothing can run it:
//
//   - in a docs/ Markdown file, a prose line: outside every ``` or ~~~ fence,
//     not a fence line itself, and not indented as a code block;
//   - in any other file, a comment line: `#` in a shell script, a workflow or
//     YAML, `//`, `/*` or `*` in JavaScript or TypeScript. Every other kind of
//     file has no line that passes.
//
// A run: line, a command, a string or a fenced example never passes, even one
// that says refused. Exit 0 when no line names the flag outside those, 1
// naming each `file:line` when one does, and 2 when git cannot list the files.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The flag, built so that this file never holds it. */
export const FLAG = ["--allow", "panics"].join("-");

/** The directories whose tracked files are read. */
export const DIRS = ["scripts", ".github", "docs", "src"];

const HASH = ["#"];
const SLASH = ["//", "/*", "*"];

/** The markers that open a comment line in `file`, by its extension; none for a kind with no comment. */
export const commentMarkers = (file) => {
  const ext = path.extname(file);
  if ([".sh", ".bash", ".yml", ".yaml", ".toml", ".py"].includes(ext))
    return HASH;
  if ([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"].includes(ext))
    return SLASH;
  return [];
};

/** Whether `file` is read as Markdown prose: a .md file under docs/. */
export const isDocsMarkdown = (file) =>
  file.startsWith("docs/") && file.endsWith(".md");

/**
 * The 1-based numbers of the lines in `text` that name the flag and do not
 * pass, read as `file` (its path decides how).
 */
export const refusedLines = (file, text) => {
  const lines = text.split("\n");
  const markdown = isDocsMarkdown(file);
  const markers = commentMarkers(file);
  const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let code = false;
    if (markdown) {
      const open = /^\s*(`{3,}|~{3,})/.exec(line);
      if (fence !== null) {
        code = true;
        if (
          open !== null &&
          open[1][0] === fence[0] &&
          open[1].length >= fence.length
        )
          fence = null;
      } else if (open !== null) {
        code = true;
        fence = open[1];
      } else {
        code = /^( {4}|\t)/.test(line);
      }
    }
    if (!line.includes(FLAG)) continue;
    const says = /refuse/i.test(line);
    const t = line.trimStart();
    const exempt = markdown
      ? !code && says
      : says && markers.some((m) => t.startsWith(m));
    if (!exempt) out.push(i + 1);
  }
  return out;
};

const main = () => {
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  if (top.status !== 0) {
    console.error("allow-panics: not in a git repository");
    process.exit(2);
  }
  const root = top.stdout.trim();
  const ls = spawnSync("git", ["ls-files", "-z", "--", ...DIRS], {
    cwd: root,
    encoding: "utf8",
  });
  if (ls.status !== 0) {
    console.error("allow-panics: git ls-files failed");
    process.exit(2);
  }
  const files = ls.stdout.split("\0").filter((f) => f !== "");
  const hits = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(path.join(root, file), "utf8");
    } catch {
      continue; // tracked but deleted in the work tree
    }
    for (const n of refusedLines(file, text)) hits.push(`${file}:${n}`);
  }
  for (const h of hits)
    console.error(
      `allow-panics: ${h}: names ${FLAG}; nothing may relax the no-panic rule (a comment or docs prose line saying it is refused passes)`,
    );
  if (hits.length > 0) process.exit(1);
  console.log(`allow-panics: no ${FLAG} in ${files.length} tracked files`);
};

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  main();
