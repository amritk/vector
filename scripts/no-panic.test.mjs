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
  summarize,
} from "./no-panic.mjs";

/** An NL3011 as the compiler prints it, for a std module it lacks. */
const NO_STD = "Module `nish/hex` is not part of the standard library";

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
  assert.equal(refusalSite(diag("NL3011", NO_STD)), null);
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

test("classifyCompile: a report with no functions list, or one unreadable, fails", () => {
  for (const r of [{}, { function: [] }, { functions: {} }]) {
    const c = classifyCompile({ status: 0, diags: [], report: r });
    assert.equal(c.outcome, "failed", JSON.stringify(r));
    assert.equal(c.reason, "the --emit-panics report has no functions list");
  }
  for (const status of [0, 1]) {
    const c = classifyCompile({
      status,
      diags: [diag("NL2457", "`index` may panic")],
      report: null,
      reportError: "Unexpected end of JSON input",
    });
    assert.equal(c.outcome, "failed");
    assert.equal(
      c.reason,
      "unreadable --emit-panics report: Unexpected end of JSON input",
    );
  }
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
    diags: [diag("NL3011", `${NO_STD} (it has: array, base64)`)],
    report: null,
  });
  assert.equal(noModule.outcome, "skipped");
  assert.equal(noModule.reason, `NL3011: ${NO_STD}`);
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
  // Only a nish/<module> the std lacks is skipped: a vector-package module
  // or export, emitted as a relative import, that is missing fails, as does
  // either code with another message.
  for (const [code, message] of [
    ["NL2376", "something else"],
    ["NL2376", "Module `../../src/core/hex` has no exported function `toHex`"],
    ["NL2376", "Module `vector/core/hex` has no exported function `toHex`"],
    ["NL2376", "Module `xnish/hex` has no exported function `toHex`"],
    ["NL3011", "Module `../src/core/hex` is not part of the standard library"],
    ["NL3011", "no module"],
    ["NL3011", `see: ${NO_STD}`],
  ]) {
    assert.equal(
      classifyCompile({ status: 1, diags: [diag(code, message)], report: null })
        .outcome,
      "failed",
      message,
    );
  }
  // The std's own module with no such export is skipped.
  assert.equal(
    classifyCompile({
      status: 1,
      diags: [
        diag(
          "NL2376",
          "Module `nish/crypto/sha256` has no exported function `x`",
        ),
      ],
      report: null,
    }).outcome,
    "skipped",
  );
});

test("classifyCompile: a panic beside a missing import is still a panic", () => {
  assert.equal(
    classifyCompile({
      status: 1,
      diags: [diag("NL3011", NO_STD), diag("NL2457", "`pop` may panic")],
      report: null,
    }).outcome,
    "panics",
  );
});

test("classifyCompile: any other error fails, beside panics or a missing import", () => {
  const rows = [
    [diag("NL2117", "expected Secret<u8[]>, got u8[]")],
    [diag("NL2117", "expected u8"), diag("NL2457", "`index` may panic")],
    [diag("NL2117", "expected u8"), diag("NL3011", NO_STD)],
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
      diags: [warn, diag("NL3011", NO_STD)],
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
      [diag("NL3011", NO_STD)],
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

const clean = { outcome: "clean", sites: [], reason: "" };
const emitted = { outcome: "emitted", reason: "" };
const site = { file: "/out/t.ts", line: 4, column: 2, kind: "index" };

test("summarize: vector's own build fails the run unless it is clean", () => {
  const ok = {
    what: "contracts/a.json",
    test: "<e>/a",
    emit: emitted,
    compile: clean,
  };
  const rows = [
    [clean, 0, 0],
    [{ outcome: "skipped", sites: [], reason: `NL3011: ${NO_STD}` }, 1, 1],
    [{ outcome: "panics", sites: [site], reason: "" }, 1, 1],
    [{ outcome: "failed", sites: [], reason: "boom" }, 1, 1],
  ];
  for (const [build, failed, exit] of rows) {
    const r = summarize(build, [ok]);
    assert.equal(r.failures.length, failed, build.outcome);
    assert.equal(r.exit, exit, build.outcome);
    assert.equal(r.built, build.outcome === "clean" ? 1 : 0);
    assert.equal(r.skipped.length, 0);
    if (failed) assert.match(r.failures[0], /^src\/main\.ts: /);
  }
  assert.equal(
    summarize({ outcome: "skipped", sites: [], reason: "NL3011: x" }, [ok])
      .failures[0],
    "src/main.ts: did not build: NL3011: x",
  );
});

test("summarize: a test's panics fail, a std skip skips, and each is counted", () => {
  const t = (what, emit, compile) => ({
    what,
    test: `<e>/${what}`,
    emit,
    compile,
  });
  const r = summarize(
    clean,
    [
      t("p.json", emitted, { outcome: "panics", sites: [site], reason: "" }),
      t("c.json", emitted, clean),
      t("s.json", emitted, {
        outcome: "skipped",
        sites: [],
        reason: "NL3011: m",
      }),
      t("f.json", emitted, {
        outcome: "failed",
        sites: [],
        reason: "NL2117: x",
      }),
      t("r.json", { outcome: "skipped", reason: "refused" }, undefined),
      t(
        "e.json",
        { outcome: "failed", reason: "spec emit exited 2: M" },
        undefined,
      ),
    ],
    (f) => f.replace("/out/", "<e>/"),
  );
  assert.deepEqual(r.failures, [
    "p.json -> <e>/p.json: 1 panic site(s)\n  <e>/t.ts:4:2 index",
    "f.json -> <e>/f.json: NL2117: x",
    "e.json: spec emit exited 2: M",
  ]);
  assert.deepEqual(r.skipped, [
    "s.json -> <e>/s.json: NL3011: m",
    "r.json: spec emit refused it: refused",
  ]);
  assert.deepEqual([r.built, r.emitted, r.compiled, r.exit], [1, 4, 2, 1]);
  // Clean tests alone pass; skips alone, with nothing compiled, do not.
  assert.equal(summarize(clean, [t("c.json", emitted, clean)]).exit, 0);
  assert.equal(
    summarize(clean, [
      t("s.json", emitted, { outcome: "skipped", sites: [], reason: "m" }),
    ]).exit,
    1,
  );
});
