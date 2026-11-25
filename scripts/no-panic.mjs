// Holds vector, and every Nish test it emits for its own contracts and
// fixtures, to the compiler's default no-panic rule. Nothing is relaxed: no
// compile here passes a flag that lets a panic site through.
//
//   NISH_BIN=<nish>/bin/nish npm run no-panic   (default .nish/bin/nish)
//
// It needs dist/vector, built by `npm run build` with the pinned nish. Then:
//
//   1. builds src/main.ts with NISH_BIN and --emit-panics;
//   2. emits every contracts/*.json and tests/fixtures/**/contracts/*.json
//      (not *.survivors.json) with `vector spec emit ... --package vector=src`;
//   3. compiles each emitted test with NISH_BIN and --emit-panics.
//
// A panic site is read from the compiler's refusal (NL2457 for a site in the
// module, NL2458 for a call that reaches one), since a refused build writes no
// --emit-panics report, and from the report when it is written: there, any
// site that is not proven and is not out of memory. Each prints as
// `file:line:col kind`.
//
// Skipped, with the reason, never failed: a contract spec emit refuses (exit
// 1: fixtures built to be refused), and an emitted test whose import nothing
// provides (no such std module, or no such export). Failed: a panic site, a
// spec emit exit other than 0 or 1, any other compile error, or no test
// compiled at all. Exit 0 when nothing failed, 1 when something did, and 2
// when it cannot run (no dist/vector, no compiler).

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The compiler's codes for a refused panic site: in the module, and a call reaching one. */
const PANIC_SITE = "NL2457";
const PANIC_CALL = "NL2458";
/** The codes for an import nothing provides: no such std module, no such export. */
const NO_MODULE = "NL3011";
const NO_EXPORT = "NL2376";

/**
 * The diagnostics in `--json` output, one JSON object per line; a line that is
 * not one (a progress line) is left out.
 */
export const parseDiagnostics = (text) => {
  const out = [];
  for (const line of text.split("\n")) {
    try {
      const d = JSON.parse(line);
      if (d !== null && typeof d === "object" && typeof d.code === "string")
        out.push(d);
    } catch {
      // not a diagnostic
    }
  }
  return out;
};

/**
 * The panic site a refusal diagnostic names, `{ file, line, column, kind }`,
 * or null when `d` is not a panic refusal. NL2457 opens with the kind in
 * backticks (`index`, `overflow`, ...); NL2458 is a call, named after its
 * callee.
 */
export const refusalSite = (d) => {
  if (d.severity !== "error") return null;
  let kind;
  if (d.code === PANIC_SITE) {
    kind = /^`([^`]+)`/.exec(d.message)?.[1] ?? "panic";
  } else if (d.code === PANIC_CALL) {
    const callee = /^This call to `([^`]+)`/.exec(d.message)?.[1];
    kind = callee === undefined ? "call" : `call ${callee}`;
  } else {
    return null;
  }
  return { file: d.file, line: d.line, column: d.column, kind };
};

/**
 * The sites an --emit-panics report (its parsed JSON) leaves unproven, other
 * than out of memory, as `{ file, line, column, kind }`. A site counts as
 * proven only when the report says `proven: true`; `allowed` relaxes nothing.
 */
export const reportSites = (report) => {
  const out = [];
  for (const f of report?.functions ?? []) {
    for (const p of f.panics ?? []) {
      if (p.kind === "oom" || p.proven === true) continue;
      out.push({
        file: f.module,
        line: p.line,
        column: p.column,
        kind: p.kind,
      });
    }
  }
  return out;
};

/** `file:line:col kind`, with `file` shortened by `label`. */
export const formatSite = (s, label = (f) => f) =>
  `${label(s.file)}:${s.line}:${s.column} ${s.kind}`;

/**
 * What one compile came to: `{ outcome, sites, reason }`, where outcome is
 * "clean", "panics" (sites lists them), "skipped" (an import nothing
 * provides) or "failed" (reason says why). `status` is the compiler's exit,
 * `diags` its parsed --json diagnostics, and `report` the parsed
 * --emit-panics report, or null when it wrote none. `label` shortens a path
 * in a reason.
 */
export const classifyCompile = (
  { status, diags, report },
  label = (f) => f,
) => {
  if (status === 0) {
    if (report === null)
      return {
        outcome: "failed",
        sites: [],
        reason: "compiled but wrote no --emit-panics report",
      };
    const sites = reportSites(report);
    return {
      outcome: sites.length > 0 ? "panics" : "clean",
      sites,
      reason: "",
    };
  }
  const errors = diags.filter((d) => d.severity === "error");
  const sites = [];
  const missing = [];
  const other = [];
  for (const d of errors) {
    const s = refusalSite(d);
    if (s !== null) sites.push(s);
    else if (
      d.code === NO_MODULE ||
      (d.code === NO_EXPORT && /has no exported/.test(d.message))
    )
      missing.push(d);
    else other.push(d);
  }
  if (status !== 1 || other.length > 0 || errors.length === 0) {
    const first = other[0];
    return {
      outcome: "failed",
      sites,
      reason:
        first === undefined
          ? `the compiler exited ${status} with no error a panic refusal or a missing import explains`
          : `${label(first.file)}:${first.line}:${first.column}: ${first.code}: ${first.message}`,
    };
  }
  if (sites.length > 0) return { outcome: "panics", sites, reason: "" };
  const m = missing[0];
  return {
    outcome: "skipped",
    sites,
    // NL3011 goes on to list every std module; the module is all a reader needs.
    reason: `${m.code}: ${m.message.split(" (it has:")[0]}`,
  };
};

/**
 * What one `spec emit` came to: "emitted" on exit 0, "skipped" on exit 1 (the
 * contract is refused), and "failed" on anything else; `reason` is the first
 * line of its stderr.
 */
export const classifyEmit = (status, stderr) => {
  const reason = stderr.trim().split("\n")[0] ?? "";
  if (status === 0) return { outcome: "emitted", reason: "" };
  if (status === 1) return { outcome: "skipped", reason };
  return { outcome: "failed", reason: `spec emit exited ${status}: ${reason}` };
};

/** The job's exit: 1 when anything failed or panicked, or no test compiled. */
export const exitCode = ({ failures, compiled }) =>
  failures > 0 || compiled === 0 ? 1 : 0;

/** The contracts to emit: tracked, under contracts/ or a fixture's contracts/, no survivors. */
export const contractsOf = (files) =>
  files
    .filter(
      (f) =>
        /^(contracts|tests\/fixtures\/.+\/contracts)\/[^/]+\.json$/.test(f) &&
        !f.endsWith(".survivors.json"),
    )
    .sort();

const main = () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const nish = path.resolve(
    root,
    process.env.NISH_BIN ?? path.join(root, ".nish/bin/nish"),
  );
  const vector = path.join(root, "dist/vector");
  if (!existsSync(vector)) {
    console.error("no-panic: no dist/vector: run npm run build");
    process.exit(2);
  }
  const ver = spawnSync(nish, ["--version"], { encoding: "utf8" });
  if (ver.status !== 0) {
    console.error(`no-panic: cannot run the compiler ${nish}`);
    process.exit(2);
  }
  console.log(`no-panic: ${ver.stdout.trim()} at ${nish}`);

  const out = mkdtempSync(path.join(tmpdir(), "no-panic-"));
  const label = (f) => {
    const abs = path.resolve(root, f);
    return abs.startsWith(out + path.sep)
      ? `<emitted>/${path.relative(out, abs)}`
      : path.relative(root, abs);
  };
  const failures = [];
  const skipped = [];

  /** Compiles `file` with no relax flag; returns what it came to. */
  const compile = (file, name) => {
    const panics = path.join(out, `${name}.panics.json`);
    rmSync(panics, { force: true });
    const r = spawnSync(
      nish,
      [
        file,
        "--link",
        path.join(out, `${name}.bin`),
        "--emit-panics",
        panics,
        "--json",
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 },
    );
    let report = null;
    if (existsSync(panics)) {
      try {
        report = JSON.parse(readFileSync(panics, "utf8"));
      } catch (e) {
        return {
          outcome: "failed",
          sites: [],
          reason: `unreadable --emit-panics report: ${e.message}`,
        };
      }
    }
    return classifyCompile(
      {
        status: r.status,
        diags: parseDiagnostics(`${r.stdout}\n${r.stderr}`),
        report,
      },
      label,
    );
  };

  const record = (what, c) => {
    if (c.outcome === "panics") {
      failures.push(
        `${what}: ${c.sites.length} panic site(s)\n${c.sites.map((s) => `  ${formatSite(s, label)}`).join("\n")}`,
      );
    } else if (c.outcome === "failed") {
      failures.push(`${what}: ${c.reason}`);
    } else if (c.outcome === "skipped") {
      skipped.push(`${what}: ${c.reason}`);
    }
  };

  // 1. vector itself.
  const build = compile("src/main.ts", "vector");
  record("src/main.ts", build);
  const built = build.outcome === "clean" ? 1 : 0;

  // 2. and 3. every contract's emitted test.
  const ls = spawnSync("git", ["ls-files", "contracts", "tests/fixtures"], {
    cwd: root,
    encoding: "utf8",
  });
  if (ls.status !== 0) {
    console.error("no-panic: git ls-files failed");
    process.exit(2);
  }
  let emitted = 0;
  let compiled = 0;
  for (const contract of contractsOf(ls.stdout.split("\n"))) {
    const stem = contract.replace(/\.json$/, "");
    const test = path.join(out, `${stem}_test.ts`);
    mkdirSync(path.dirname(test), { recursive: true });
    const em = spawnSync(
      vector,
      ["spec", "emit", contract, "--package", "vector=src", "-o", test],
      { cwd: root, encoding: "utf8" },
    );
    const e = classifyEmit(em.status, em.stderr ?? "");
    if (e.outcome === "skipped") {
      skipped.push(`${contract}: spec emit refused it: ${e.reason}`);
      continue;
    }
    if (e.outcome === "failed") {
      failures.push(`${contract}: ${e.reason}`);
      continue;
    }
    emitted++;
    const c = compile(test, stem.replaceAll("/", "_"));
    if (c.outcome === "clean" || c.outcome === "panics") compiled++;
    record(`${contract} -> ${label(test)}`, c);
  }
  rmSync(out, { recursive: true, force: true });

  for (const s of skipped) console.log(`SKIP  ${s}`);
  for (const f of failures) console.log(`FAIL  ${f}`);
  if (compiled === 0) console.log("FAIL  no emitted test compiled");
  console.log(
    `\nbuilt ${built}/1, emitted ${emitted}, compiled ${compiled}, skipped ${skipped.length}, failed ${failures.length}`,
  );
  process.exit(exitCode({ failures: failures.length, compiled }));
};

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  main();
