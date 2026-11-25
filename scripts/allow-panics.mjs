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
//   - in a shell script, a workflow or YAML, a whole-line `#` comment;
//   - in JavaScript or TypeScript, a line where every copy of the flag sits in
//     comment text (a `//` comment or a `/* */` block, open from an earlier
//     line or not) and that comment text says refused. Strings, template
//     literals and regular expressions are code, so a `//` or ` * ` inside one
//     is not a comment. Every other kind of file has no line that passes.
//
// A run: line, a command, a string or a fenced example never passes, even one
// that says refused. A closing fence is the opening's character, at least as
// many, and nothing after it. Exit 0 when no line names the flag outside those, 1
// naming each `file:line` when one does, and 2 when git cannot list the files.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The flag, built so that this file never holds it. */
export const FLAG = ["--allow", "panics"].join("-");

/** The directories whose tracked files are read. */
export const DIRS = ["scripts", ".github", "docs", "src"];

/** How `file` writes a comment, by its extension: "hash", "slash", or "none". */
export const commentKind = (file) => {
  const ext = path.extname(file);
  if ([".sh", ".bash", ".yml", ".yaml", ".toml", ".py"].includes(ext))
    return "hash";
  if ([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"].includes(ext))
    return "slash";
  return "none";
};

/** The characters after which a `/` in code opens a regular expression. */
const REGEX_AFTER = "(,=:[!&|?{};+-*%<>~^";

/**
 * For each line of JavaScript or TypeScript `lines`, which of its characters
 * are comment text: a `boolean[]` per line. State runs across lines for a
 * block comment and a template literal; a quoted string, a `//` comment and a
 * regular expression end with their line.
 */
export const slashCommentMasks = (lines) => {
  let state = "code"; // "code" | "block" | "template"
  const masks = [];
  for (const line of lines) {
    const mask = new Array(line.length).fill(false);
    let i = 0;
    let prev = ""; // the last non-space code character on this line
    while (i < line.length) {
      const c = line[i];
      const d = line[i + 1];
      if (state === "block") {
        if (c === "*" && d === "/") {
          mask[i] = mask[i + 1] = true;
          state = "code";
          i += 2;
          prev = "";
        } else mask[i++] = true;
      } else if (state === "template") {
        if (c === "\\") i += 2;
        else {
          if (c === "`") state = "code";
          i++;
          prev = "`";
        }
      } else if (c === "/" && d === "/") {
        mask.fill(true, i);
        break;
      } else if (c === "/" && d === "*") {
        mask[i] = mask[i + 1] = true;
        state = "block";
        i += 2;
      } else if (c === '"' || c === "'") {
        i++;
        while (i < line.length && line[i] !== c) i += line[i] === "\\" ? 2 : 1;
        i++;
        prev = c;
      } else if (c === "`") {
        state = "template";
        i++;
      } else if (c === "/" && (prev === "" || REGEX_AFTER.includes(prev))) {
        i++;
        let cls = false;
        while (i < line.length && (cls || line[i] !== "/")) {
          if (line[i] === "\\") i++;
          else if (line[i] === "[") cls = true;
          else if (line[i] === "]") cls = false;
          i++;
        }
        i++;
        prev = "/";
      } else {
        if (c !== " " && c !== "\t") prev = c;
        i++;
      }
    }
    masks.push(mask);
  }
  return masks;
};

/** Whether every copy of the flag in `line` lies in comment text that says refused, by its `mask`. */
const slashExempt = (line, mask) => {
  let text = "";
  for (let i = 0; i < line.length; i++) if (mask[i]) text += line[i];
  for (let at = line.indexOf(FLAG); at !== -1; at = line.indexOf(FLAG, at + 1))
    for (let k = at; k < at + FLAG.length; k++) if (!mask[k]) return false;
  return /refuse/i.test(text);
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
  const kind = commentKind(file);
  const masks = kind === "slash" ? slashCommentMasks(lines) : [];
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
          line.slice(open[0].length).trim() === "" &&
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
    const exempt = markdown
      ? !code && says
      : kind === "hash"
        ? says && line.trimStart().startsWith("#")
        : kind === "slash" && slashExempt(line, masks[i]);
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
    } catch (e) {
      if (e?.code === "ENOENT") continue; // tracked but deleted in the work tree
      console.error(`allow-panics: cannot read ${file}: ${e?.message ?? e}`);
      process.exit(2);
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
