#!/usr/bin/env node
// Fails when an exported function under src/ is never called by name in
// tests/. A function counts as exported when it is declared at the top level
// as `export const name = (…) =>` (or `= async (…)`, or with type parameters)
// or `export function name`. It counts as called when `name(` appears in a
// tests/**/*.ts file, outside a line comment.
//
// src/main.ts's `main` is the binary's entry point: no test can call it by
// name (every Nish test has its own `main`), so it counts as called when
// tests/cli/ holds at least one golden case, which runs dist/vector.

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
  /^export\s+(?:const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:<[^>]*>\s*)?\(|(?:async\s+)?function\s+([A-Za-z_$][\w$]*))/;

const exported = [];
for (const file of walk(join(root, "src")).filter((p) => p.endsWith(".ts"))) {
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      const m = exportRe.exec(line);
      if (m)
        exported.push({
          name: m[1] ?? m[2],
          where: `${relative(root, file)}:${i + 1}`,
        });
    });
}

const testText = walk(join(root, "tests"))
  .filter(
    (p) => p.endsWith(".ts") && !p.startsWith(join(root, "tests/fixtures")),
  )
  .map((p) =>
    readFileSync(p, "utf8")
      .split("\n")
      .map((line) => line.replace(/^\s*\/\/.*$/, ""))
      .join("\n"),
  )
  .join("\n");

const cliDir = join(root, "tests/cli");
const goldenCases = existsSync(cliDir)
  ? readdirSync(cliDir).filter((name) => existsSync(join(cliDir, name, "cmd")))
      .length
  : 0;

const escapeDollar = (s) => s.replace(/[$]/g, "\\$");
const untested = exported.filter(({ name, where }) => {
  if (name === "main" && where.startsWith("src/main.ts:"))
    return goldenCases === 0;
  return !new RegExp(
    `(?<![\\w$.])${escapeDollar(name)}\\s*(?:<[^>]*>)?\\(`,
  ).test(testText);
});

if (untested.length > 0) {
  console.error("exported functions no test calls by name:");
  for (const { name, where } of untested) console.error(`  ${where}  ${name}`);
  process.exit(1);
}
console.log(
  `tested-exports: all ${exported.length} exported functions are called in tests/`,
);
