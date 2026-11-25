#!/usr/bin/env node
// The panic ratchet: counts the sites under src/ that the next Nish compiler
// (`.nish-next-version`, fetched into .nish-next/) cannot prove panic-free,
// per module, and refuses any module over its count in
// scripts/panic-baseline/*.json, or with a site and no count there.
//
// A site counts when its module is under src/, it is not an out-of-memory
// site, it is neither proven nor allowed, and it is not a call into a src/
// function (that function's own sites already count). Lowering a count once
// a module improves is the ratchet: a module under its count warns.
//
// Usage: node scripts/panics.mjs [--report <json>] [--nish <bin>]
//        [--entry <file>] [--baseline-dir <dir>] [--root <dir>]
// --report reads an existing --emit-panics report instead of compiling.
// Exit: 0 at or under every baseline, 1 a module over its baseline or
// missing from every baseline, 2 a tool failure or an unreadable input,
// a report the counting rule cannot read or naming no src/ module included.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const panicsOptions = (argv) =>
  parseArgs({
    args: argv,
    options: {
      report: { type: "string" },
      nish: { type: "string" },
      entry: { type: "string", default: "src/main.ts" },
      "baseline-dir": { type: "string", default: "scripts/panic-baseline" },
      root: { type: "string", default: process.cwd() },
    },
    strict: true,
    allowPositionals: false,
  }).values;

const panicsReadJson = (file, what) => {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    throw new Error(`cannot read ${what} ${file}: ${e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${what} ${file} is not JSON: ${e.message}`);
  }
};

/** Runs nish with --emit-panics and returns the parsed report. */
const panicsCompile = (root, nish, entry) => {
  const dir = mkdtempSync(join(tmpdir(), "vector-panics-"));
  try {
    const report = join(dir, "panics.json");
    const args = [
      entry,
      "--allow-panics",
      "--emit-panics",
      report,
      "--link",
      join(dir, "v"),
      "--profile",
      "debug",
    ];
    const run = spawnSync(nish, args, { cwd: root, encoding: "utf8" });
    if (run.error) throw new Error(`cannot run ${nish}: ${run.error.message}`);
    if (run.status !== 0) {
      throw new Error(
        `${nish} ${args.join(" ")} exited ${run.status}\n${run.stdout}${run.stderr}`,
      );
    }
    return panicsReadJson(report, "panic report");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const panicsSrc = (module) => module.startsWith("src/");
const panicsStd = (module) => module.startsWith("std/");
const panicsFlag = (v) => v === undefined || typeof v === "boolean";

/**
 * Refuses a report whose shape the counting rule cannot read, so that no
 * report counts nothing by accident: each function needs a string name, a
 * module under src/ or std/ (no other path form), and a panics array; each
 * site a string kind, an integer line and column, boolean proven and allowed
 * when present, and a string callee when it is a call. A report must name a
 * src/ module.
 */
const panicsShape = (report) => {
  if (!report || !Array.isArray(report.functions))
    throw new Error("panic report has no functions array");
  report.functions.forEach((f, i) => {
    const at = `panic report: function ${i}`;
    if (!f || typeof f !== "object") throw new Error(`${at} is not an object`);
    if (typeof f.name !== "string") throw new Error(`${at} has no name`);
    if (typeof f.module !== "string") throw new Error(`${at} has no module`);
    if (!panicsSrc(f.module) && !panicsStd(f.module))
      throw new Error(
        `${at}: module ${f.module} is under neither src/ nor std/`,
      );
    if (!Array.isArray(f.panics)) throw new Error(`${at} has no panics array`);
    f.panics.forEach((p, j) => {
      const site = `${at} (${f.module}) site ${j}`;
      if (!p || typeof p !== "object")
        throw new Error(`${site} is not an object`);
      if (typeof p.kind !== "string") throw new Error(`${site} has no kind`);
      if (!Number.isInteger(p.line) || !Number.isInteger(p.column))
        throw new Error(`${site} has no line and column`);
      if (!panicsFlag(p.proven) || !panicsFlag(p.allowed))
        throw new Error(`${site}: proven and allowed must be booleans`);
      if (p.kind === "call" && typeof p.callee !== "string")
        throw new Error(`${site} is a call with no callee`);
    });
  });
  if (!report.functions.some((f) => panicsSrc(f.module)))
    throw new Error("panic report names no src/ module");
};

/** The counted sites of a report, as {module, line, column, kind, callee}. */
const panicsCounted = (report) => {
  panicsShape(report);
  const own = new Set(
    report.functions.filter((f) => panicsSrc(f.module)).map((f) => f.name),
  );
  const sites = [];
  for (const f of report.functions) {
    if (!panicsSrc(f.module)) continue;
    for (const p of f.panics) {
      if (p.kind === "oom" || p.proven === true || p.allowed === true) continue;
      if (p.kind === "call" && own.has(p.callee)) continue;
      sites.push({
        module: f.module,
        line: p.line,
        column: p.column,
        kind: p.kind,
        callee: p.callee,
      });
    }
  }
  return sites;
};

/** Every baseline file's modules merged, refusing a module named twice. */
const panicsBaseline = (dir) => {
  let files;
  try {
    files = readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .sort();
  } catch (e) {
    throw new Error(`cannot read baseline directory ${dir}: ${e.message}`);
  }
  const counts = new Map();
  const owner = new Map();
  for (const name of files) {
    const file = join(dir, name);
    const json = panicsReadJson(file, "baseline");
    if (
      !json ||
      typeof json.modules !== "object" ||
      json.modules === null ||
      Array.isArray(json.modules)
    ) {
      throw new Error(`baseline ${file} has no modules object`);
    }
    for (const [module, n] of Object.entries(json.modules)) {
      if (!panicsSrc(module))
        throw new Error(`baseline ${file}: ${module} is not a src/ module`);
      if (!Number.isInteger(n) || n < 0)
        throw new Error(`baseline ${file}: ${module} is not a count: ${n}`);
      if (owner.has(module))
        throw new Error(
          `${module} is in both ${owner.get(module)} and ${name}`,
        );
      owner.set(module, name);
      counts.set(module, n);
    }
  }
  return { counts, owner };
};

const panicsSiteText = (s) =>
  `  ${s.module}:${s.line}:${s.column} ${s.kind}${s.kind === "call" ? ` ${s.callee}` : ""}`;

const panicsMain = (argv) => {
  const o = panicsOptions(argv);
  const root = resolve(o.root);
  let report;
  if (o.report !== undefined) {
    report = panicsReadJson(resolve(root, o.report), "panic report");
  } else {
    let nish = o.nish;
    if (nish === undefined) {
      const fetch = spawnSync(
        "bash",
        [join(root, "scripts/fetch-nish-next.sh")],
        { cwd: root, stdio: "inherit" },
      );
      if (fetch.status !== 0)
        throw new Error("scripts/fetch-nish-next.sh failed");
      nish = join(root, ".nish-next/bin/nish");
    }
    report = panicsCompile(root, nish, o.entry);
  }
  const sites = panicsCounted(report);
  const { counts, owner } = panicsBaseline(resolve(root, o["baseline-dir"]));
  const byModule = new Map();
  for (const s of sites) {
    if (!byModule.has(s.module)) byModule.set(s.module, []);
    byModule.get(s.module).push(s);
  }
  let refused = 0;
  for (const [module, list] of byModule) {
    const limit = counts.get(module);
    if (limit === undefined) {
      console.error(
        `${module}: ${list.length} unproven sites, and no baseline names it`,
      );
    } else if (list.length > limit) {
      console.error(
        `${module}: ${list.length} unproven sites, over its baseline of ${limit} (${owner.get(module)})`,
      );
    } else continue;
    for (const s of list) console.error(panicsSiteText(s));
    refused++;
  }
  for (const [module, limit] of counts) {
    const n = byModule.get(module)?.length ?? 0;
    if (n < limit) {
      console.error(
        `warning: ${module}: ${n} unproven sites, under its baseline of ${limit}; lower it in ${owner.get(module)}`,
      );
    }
  }
  if (refused > 0) {
    console.error(`panics: ${refused} module(s) refused`);
    return 1;
  }
  console.log(
    `panics: ${sites.length} unproven sites, every module at or under its baseline`,
  );
  return 0;
};

try {
  process.exitCode = panicsMain(process.argv.slice(2));
} catch (e) {
  // Any error, a malformed report's included, is a failure to check: 2.
  console.error(`panics: ${e.message}`);
  process.exitCode = 2;
}
