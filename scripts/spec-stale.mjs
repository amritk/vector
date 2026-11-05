#!/usr/bin/env node
// `vector spec stale` without vector: spec-stale.mjs <test.ts> <contract.json> exits 0
// when the test's one `// vector-contract-sha256:` line is the contract's sha256, 1 when
// it is stale or missing, 2 on bad usage. --self-test shows a pass and two refusals.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const hash = (b) => createHash("sha256").update(b).digest("hex");
const LINE = /^\/\/ vector-contract-sha256: ([0-9a-f]{64})$/gm;
function stale(test, contract) {
  const got = [...readFileSync(test, "utf8").matchAll(LINE)].map((m) => m[1]);
  const want = hash(readFileSync(contract));
  if (got.length !== 1)
    return `${got.length} vector-contract-sha256 lines, want 1`;
  return got[0] === want
    ? null
    : `stale: emitted from ${got[0]}, the contract is ${want}`;
}
const [arg, contract] = process.argv.slice(2);
if (arg === "--self-test") {
  const d = mkdtempSync(`${process.env.TMPDIR ?? "/tmp"}/spec-stale-`);
  const at = (f, s) => {
    writeFileSync(`${d}/${f}`, s);
    return `${d}/${f}`;
  };
  const c = at("c.json", "{}\n");
  const cases = [
    [
      "fresh",
      at("ok.ts", `// vector-contract-sha256: ${hash("{}\n")}\n`),
      null,
    ],
    [
      "stale",
      at("old.ts", `// vector-contract-sha256: ${hash("{ }\n")}\n`),
      "stale:",
    ],
    ["no line", at("none.ts", "x\n"), "0 vector-contract-sha256"],
  ];
  let ok = true;
  for (const [name, test, want] of cases) {
    const why = stale(test, c);
    console.log(`${name}: ${why === null ? "pass" : `refused: ${why}`}`);
    ok &&= want === null ? why === null : why?.startsWith(want) === true;
  }
  rmSync(d, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
}
if (process.argv.length !== 4) {
  console.error(
    "usage: spec-stale.mjs <test.ts> <contract.json> | --self-test",
  );
  process.exit(2);
}
const why = stale(arg, contract);
console.log(`${arg}: ${why ?? "fresh"}`);
process.exit(why ? 1 : 0);
