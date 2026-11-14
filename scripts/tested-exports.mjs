#!/usr/bin/env node
// Fails when an exported function under src/ is never called by name in a
// test. A function counts as exported when it is declared at the top level as
// `export const name = (…) =>` (or `= x =>`, `= async (…)`, with type
// parameters, or with the arrow's parameters on the next line) or
// `export function name`. It counts as called when `name(` appears in a
// tests/**/*_test.ts file (the files tests/run.mjs runs) outside a comment or a
// string literal; a template literal's `${…}` still counts. A run that finds no
// exports at all fails, since it has checked nothing.
//
// src/main.ts's `main` is the binary's entry point: no test can call it by
// name (every Nish test has its own `main`), so it counts as called when
// tests/cli/ holds at least one golden case, which runs dist/vector.
//
// It also fails when two .ts files under src/ declare the same top-level name
// (class, interface, enum, function, `const name = (…) =>` arrow or type
// alias, exported or not), since Nish names are program-wide. Each clash is
// printed with both file paths.
//
// It also fails when src/index.ts's VECTOR_VERSION differs from package.json's
// version, which `vector --version` is meant to print.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const exportRe =
  /^export\s+(?:const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:<[^>]*>\s*)?(?:\(|[A-Za-z_$][\w$]*\s*=>)|(?:async\s+)?function\s+([A-Za-z_$][\w$]*))/gm;

/**
 * Blanks out comments and string literals, keeping each `${…}` of a template
 * literal (code) and every newline (line numbers).
 */
const codeOnly = (text) => {
  let out = "";
  let i = 0;
  const braces = []; // per open `${`: brace depth inside it
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const close = text.indexOf("*/", i + 2);
      const stop = close < 0 ? text.length : close + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c && text[i] !== "\n") {
        i += text[i] === "\\" ? 2 : 1;
      }
      i++;
      out += " ";
    } else if (c === "`" || (c === "}" && braces.at(-1) === 0)) {
      if (c === "}") braces.pop();
      i++;
      while (i < text.length && text[i] !== "`") {
        if (text[i] === "\\") i += 2;
        else if (text[i] === "$" && text[i + 1] === "{") break;
        else {
          if (text[i] === "\n") out += "\n";
          i++;
        }
      }
      if (text[i] === "$") {
        braces.push(0);
        i += 2;
      } else i++;
      out += " ";
    } else {
      if (braces.length > 0 && c === "{") braces[braces.length - 1]++;
      if (braces.length > 0 && c === "}") braces[braces.length - 1]--;
      out += c;
      i++;
    }
  }
  return out;
};

const exported = [];
for (const file of walk(join(root, "src")).filter((p) => p.endsWith(".ts"))) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(exportRe)) {
    const line = text.slice(0, m.index).split("\n").length;
    exported.push({
      name: m[1] ?? m[2],
      where: `${relative(root, file)}:${line}`,
    });
  }
}

const declRe =
  /^(?:export\s+)?(?:declare\s+)?(?:(?:abstract\s+)?class|interface|enum|type|(?:async\s+)?function\*?)\s+([A-Za-z_$][\w$]*)|^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:<[^>]*>\s*)?(?:\(|[A-Za-z_$][\w$]*\s*=>)/gm;

// name -> every file under src/ that declares it at the top level
const declaredIn = new Map();
for (const file of walk(join(root, "src")).filter((p) => p.endsWith(".ts"))) {
  const rel = relative(root, file);
  for (const m of codeOnly(readFileSync(file, "utf8")).matchAll(declRe)) {
    const name = m[1] ?? m[2];
    const files = declaredIn.get(name) ?? [];
    if (!files.includes(rel)) files.push(rel);
    declaredIn.set(name, files);
  }
}
const clashes = [...declaredIn].filter(([, files]) => files.length > 1);

const testText = walk(join(root, "tests"))
  .filter((p) => p.endsWith("_test.ts"))
  .map((p) => codeOnly(readFileSync(p, "utf8")))
  .join("\n");

const cliDir = join(root, "tests/cli");
const goldenCases = existsSync(cliDir)
  ? readdirSync(cliDir).filter((name) => existsSync(join(cliDir, name, "cmd")))
      .length
  : 0;

const called = new Set(
  Array.from(
    testText.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(/g),
    (m) => m[1],
  ),
);
const untested = exported.filter(({ name, where }) => {
  if (name === "main" && where.startsWith("src/main.ts:"))
    return goldenCases === 0;
  return !called.has(name);
});

let failed = false;
if (exported.length === 0) {
  console.error("tested-exports: found no exported functions under src/");
  failed = true;
}
if (untested.length > 0) {
  console.error("exported functions no test calls by name:");
  for (const { name, where } of untested) console.error(`  ${where}  ${name}`);
  failed = true;
}

if (clashes.length > 0) {
  console.error("top-level names declared in more than one file under src/:");
  for (const [name, files] of clashes)
    console.error(`  ${name}  ${files.join("  ")}`);
  failed = true;
}

const indexText = readFileSync(join(root, "src/index.ts"), "utf8");
const binVersion = /VECTOR_VERSION\s*:\s*string\s*=\s*"([^"]*)"/.exec(
  indexText,
)?.[1];
const pkgVersion = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
).version;
if (binVersion !== pkgVersion) {
  console.error(
    `src/index.ts VECTOR_VERSION is ${binVersion}, package.json's version is ${pkgVersion}`,
  );
  failed = true;
}
if (failed) process.exit(1);
console.log(
  `tested-exports: all ${exported.length} exported functions are called in tests/`,
);
