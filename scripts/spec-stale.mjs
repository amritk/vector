#!/usr/bin/env node
// `vector spec stale` without vector: spec-stale.mjs <test.ts> <contract.json> exits 0
// when the test's one `// vector-contract-sha256:` line is the contract's sha256, 1 when
// it is stale, missing or repeated, 2 on bad usage or a file it cannot read. Its reasons
// and output are `vector spec stale`'s, word for word. --self-test shows a pass and refusals.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const hash = (b) => createHash("sha256").update(b).digest("hex");
const LINE = /^\/\/ vector-contract-sha256: ([0-9a-f]{64})$/gm;
function read(path, enc) {
  try {
    return readFileSync(path, enc);
  } catch (err) {
    console.error(`error: cannot read ${path}: ${err.message}`);
    process.exit(2);
  }
}
function stale(test, contract) {
  const got = [...read(test, "utf8").matchAll(LINE)].map((m) => m[1]);
  const want = hash(read(contract));
  if (got.length === 0)
    return "no `// vector-contract-sha256: <hex>` line: regenerate it with vector spec emit";
  if (got.length > 1)
    return `${got.length} vector-contract-sha256 lines: a test names one contract`;
  return got[0] === want
    ? null
    : `stale: emitted from a contract with sha256 ${got[0]}, but the contract's is ${want}: regenerate it with vector spec emit`;
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
    ["no line", at("none.ts", "x\n"), "no `// vector-contract-sha256"],
    [
      "two lines",
      at("two.ts", `// vector-contract-sha256: ${hash("{}\n")}\n`.repeat(2)),
      "2 vector-contract-sha256 lines",
    ],
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
console.log(`${arg}: ${why ?? `emitted from ${contract} as it is now`}`);
process.exit(why ? 1 : 0);
