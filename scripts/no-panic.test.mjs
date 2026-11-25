// Tests for scripts/no-panic.mjs: how a compile, a report and a spec emit are
// classed. Run with `node --test scripts/no-panic.test.mjs`.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyCompile,
  classifyEmit,
  contractsOf,
  exitCode,
  formatSite,
  parseDiagnostics,
  refusalSite,
  reportSites,
} from "./no-panic.mjs";

const diag = (code, message, over = {}) => ({
  file: "src/a.ts",
  line: 3,
  column: 7,
  severity: "error",
  code,
  message,
  ...over,
});

test("parseDiagnostics keeps JSON lines with a code and drops the rest", () => {
  const text = [
    "Compiling src/main.ts",
    JSON.stringify(diag("NL2457", "`index` may panic here")),
    "  {not json",
    JSON.stringify({ message: "no code" }),
    "null",
    `  ${JSON.stringify(diag("NL2117", "expected u8"))}  `,
    "",
  ].join("\n");
  assert.deepEqual(
    parseDiagnostics(text).map((d) => d.code),
    ["NL2457", "NL2117"],
  );
});

test("refusalSite names the kind of each panic refusal", () => {
  const rows = [
    ["`index` may panic here: the index is not proven", "index"],
    ["`overflow` may panic here", "overflow"],
    ["`slice` may panic here", "slice"],
    ["`divide` may panic here", "divide"],
    ["`pop` may panic here", "pop"],
    ["`array-length` may panic here", "array-length"],
    ["`io-exit` may panic here", "io-exit"],
    ["may panic here, with no kind", "panic"],
  ];
  for (const [message, kind] of rows) {
    assert.deepEqual(refusalSite(diag("NL2457", message)), {
      file: "src/a.ts",
      line: 3,
      column: 7,
      kind,
    });
  }
});

test("refusalSite names the callee of a call that reaches a panic", () => {
  assert.equal(
    refusalSite(diag("NL2458", "This call to `hexDecode` may panic: index"))
      .kind,
    "call hexDecode",
  );
  assert.equal(refusalSite(diag("NL2458", "may panic: index")).kind, "call");
});

test("refusalSite is null for anything but a panic refusal error", () => {
  assert.equal(refusalSite(diag("NL2117", "`index` may panic here")), null);
  assert.equal(refusalSite(diag("NL3011", "no module")), null);
  assert.equal(
    refusalSite(diag("NL2457", "`index` may panic", { severity: "warning" })),
    null,
  );
  assert.equal(
    refusalSite(
      diag("NL2458", "This call to `f` may panic", { severity: "note" }),
    ),
    null,
  );
});

const report = (...panics) => ({
  functions: [{ name: "f", module: "src/b.ts", line: 1, panics }],
});

test("reportSites leaves out OOM and proven sites, and keeps every other", () => {
  const rows = [
    [{ kind: "oom", line: 2, column: 1, allowed: true }, false],
    [{ kind: "oom", line: 2, column: 1 }, false],
    [{ kind: "index", line: 4, column: 9, proven: true }, false],
    [{ kind: "index", line: 4, column: 9, proven: false }, true],
    [{ kind: "index", line: 4, column: 9 }, true],
    [{ kind: "overflow", line: 4, column: 9, allowed: true }, true],
    [{ kind: "divide", line: 4, column: 9, proven: "yes" }, true],
  ];
  for (const [p, kept] of rows) {
    const sites = reportSites(report(p));
    assert.equal(sites.length, kept ? 1 : 0, JSON.stringify(p));
    if (kept)
      assert.deepEqual(sites[0], {
        file: "src/b.ts",
        line: p.line,
        column: p.column,
        kind: p.kind,
      });
  }
  assert.deepEqual(reportSites({}), []);
  assert.deepEqual(reportSites({ functions: [{ module: "m" }] }), []);
});

test("formatSite prints file:line:col kind, with the file labelled", () => {
  const s = { file: "/tmp/x/a.ts", line: 1, column: 2, kind: "index" };
  assert.equal(formatSite(s), "/tmp/x/a.ts:1:2 index");
  assert.equal(
    formatSite(s, () => "<emitted>/a.ts"),
    "<emitted>/a.ts:1:2 index",
  );
});

test("classifyCompile: a clean build is clean only with a report and no unproven site", () => {
  assert.equal(
    classifyCompile({ status: 0, diags: [], report: report() }).outcome,
    "clean",
  );
  assert.equal(
    classifyCompile({
      status: 0,
      diags: [],
      report: report({ kind: "oom", line: 1, column: 1 }),
    }).outcome,
    "clean",
  );
  const unproven = classifyCompile({
    status: 0,
    diags: [],
    report: report({ kind: "index", line: 5, column: 2, proven: false }),
  });
  assert.equal(unproven.outcome, "panics");
  assert.deepEqual(
    unproven.sites.map((s) => formatSite(s)),
    ["src/b.ts:5:2 index"],
  );
  assert.equal(
    classifyCompile({ status: 0, diags: [], report: null }).outcome,
    "failed",
  );
});

test("classifyCompile: refusals are panic sites, one per diagnostic", () => {
  const c = classifyCompile({
    status: 1,
    diags: [
      diag("NL2457", "`index` may panic here"),
      diag("NL2458", "This call to `g` may panic: slice", { line: 9 }),
    ],
    report: null,
  });
  assert.equal(c.outcome, "panics");
  assert.deepEqual(
    c.sites.map((s) => formatSite(s)),
    ["src/a.ts:3:7 index", "src/a.ts:9:7 call g"],
  );
});

test("classifyCompile: a missing import is skipped, with its reason", () => {
  const noModule = classifyCompile({
    status: 1,
    diags: [
      diag(
        "NL3011",
        "Module `nish/hex` is not in the standard library (it has: nish/a, nish/b)",
      ),
    ],
    report: null,
  });
  assert.equal(noModule.outcome, "skipped");
  assert.equal(
    noModule.reason,
    "NL3011: Module `nish/hex` is not in the standard library",
  );
  const noExport = classifyCompile({
    status: 1,
    diags: [
      diag(
        "NL2376",
        "Module `nish/sha256` has no exported function `sha256Pair`",
      ),
    ],
    report: null,
  });
  assert.equal(noExport.outcome, "skipped");
  // NL2376 with another message is not a missing import.
  assert.equal(
    classifyCompile({
      status: 1,
      diags: [diag("NL2376", "something else")],
      report: null,
    }).outcome,
    "failed",
  );
});

test("classifyCompile: a panic beside a missing import is still a panic", () => {
  assert.equal(
    classifyCompile({
      status: 1,
      diags: [diag("NL3011", "no module"), diag("NL2457", "`pop` may panic")],
      report: null,
    }).outcome,
    "panics",
  );
});

test("classifyCompile: any other error fails, beside panics or a missing import", () => {
  const rows = [
    [diag("NL2117", "expected Secret<u8[]>, got u8[]")],
    [diag("NL2117", "expected u8"), diag("NL2457", "`index` may panic")],
    [diag("NL2117", "expected u8"), diag("NL3011", "no module")],
  ];
  for (const diags of rows) {
    const c = classifyCompile({ status: 1, diags, report: null }, () => "L");
    assert.equal(c.outcome, "failed", JSON.stringify(diags));
    assert.equal(c.reason, `L:3:7: NL2117: ${diags[0].message}`);
  }
});

test("classifyCompile: warnings neither fail nor excuse a refusal", () => {
  const warn = diag("NL9999", "unused", { severity: "warning" });
  assert.equal(
    classifyCompile({ status: 0, diags: [warn], report: report() }).outcome,
    "clean",
  );
  // A warning beside a missing import is not another error.
  assert.equal(
    classifyCompile({
      status: 1,
      diags: [warn, diag("NL3011", "no module")],
      report: null,
    }).outcome,
    "skipped",
  );
  // Exit 1 with only a warning: no error explains it.
  assert.equal(
    classifyCompile({ status: 1, diags: [warn], report: null }).outcome,
    "failed",
  );
});

test("classifyCompile: an exit other than 0 or 1 fails, whatever it printed", () => {
  for (const status of [2, 3, 70, null]) {
    for (const diags of [
      [],
      [diag("NL2457", "`index` may panic")],
      [diag("NL3011", "no module")],
    ]) {
      assert.equal(
        classifyCompile({ status, diags, report: null }).outcome,
        "failed",
        `${status} ${JSON.stringify(diags)}`,
      );
    }
  }
  assert.equal(
    classifyCompile({ status: 1, diags: [], report: null }).outcome,
    "failed",
  );
});

test("classifyEmit: exit 0 emitted, 1 skipped, anything else failed", () => {
  assert.deepEqual(classifyEmit(0, ""), { outcome: "emitted", reason: "" });
  assert.deepEqual(classifyEmit(1, "vector: refused: no vectors\nmore\n"), {
    outcome: "skipped",
    reason: "vector: refused: no vectors",
  });
  for (const status of [2, 3, null]) {
    const e = classifyEmit(status, "MISMATCH\n");
    assert.equal(e.outcome, "failed");
    assert.equal(e.reason, `spec emit exited ${status}: MISMATCH`);
  }
});

test("exitCode: 1 on a failure or nothing compiled, else 0", () => {
  assert.equal(exitCode({ failures: 0, compiled: 1 }), 0);
  assert.equal(exitCode({ failures: 0, compiled: 12 }), 0);
  assert.equal(exitCode({ failures: 1, compiled: 12 }), 1);
  assert.equal(exitCode({ failures: 0, compiled: 0 }), 1);
});

test("contractsOf keeps tracked contracts and fixture contracts, sorted, no survivors", () => {
  const files = [
    "contracts/sha256.json",
    "contracts/sha256.survivors.json",
    "contracts/nested/x.json",
    "contracts/readme.md",
    "tests/fixtures/a/head/contracts/hex.json",
    "tests/fixtures/a/head/contracts/hex.survivors.json",
    "tests/fixtures/contracts/top.json",
    "tests/fixtures/a/specs/x.json",
    "xcontracts/y.json",
    "src/contracts/z.json",
    "contracts/b.json",
    "",
  ];
  assert.deepEqual(contractsOf(files), [
    "contracts/b.json",
    "contracts/sha256.json",
    "tests/fixtures/a/head/contracts/hex.json",
  ]);
});
