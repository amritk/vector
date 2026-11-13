import { Cli, PARSE_ERROR, PARSE_OK, ROOT } from "nish/cli-args"
import { Suite } from "nish/testing"
import { notImplemented } from "../../src/cli/common"
import { DIFF_ID, registerDiff } from "../../src/cli/diff"
import { SPEC_CHECK_ID, registerSpecCheck } from "../../src/cli/spec-check"
import { SPEC_EMIT_ID, registerSpecEmit } from "../../src/cli/spec-emit"
import { SPEC_EXPORTS_ID, registerSpecExports } from "../../src/cli/spec-exports"
import { SPEC_EXTRACT_ID, registerSpecExtract } from "../../src/cli/spec-extract"
import { SPEC_FROZEN_ID, registerSpecFrozen } from "../../src/cli/spec-frozen"
import { SPEC_MUTATE_ID, registerSpecMutate } from "../../src/cli/spec-mutate"
import { SPEC_RUN_ID, registerSpecRun } from "../../src/cli/spec-run"
import { SPEC_STALE_ID, registerSpecStale } from "../../src/cli/spec-stale"
import { VERIFY_ID, registerVerify } from "../../src/cli/verify"

export const main = (): i32 => {
  const t = new Suite("cli/register")
  const cli = new Cli("vector", "0.0.0", "test")
  const verify = registerVerify(cli, ROOT)
  const diff = registerDiff(cli, ROOT)
  const spec = cli.group(ROOT, "spec", "spec")
  const extract = registerSpecExtract(cli, spec)
  const check = registerSpecCheck(cli, spec)
  const emit = registerSpecEmit(cli, spec)
  const run = registerSpecRun(cli, spec)
  const frozen = registerSpecFrozen(cli, spec)
  const stale = registerSpecStale(cli, spec)
  const exportsGate = registerSpecExports(cli, spec)
  const mutate = registerSpecMutate(cli, spec)

  const v = cli.parse(["vector", "verify", "s.json", "p.json", "--json", "--emit", "out.ts"], 1)
  t.eqI32("verify parses", v.kind, PARSE_OK)
  t.eqI32("verify id", v.id, VERIFY_ID)
  t.eqStr("verify spec", v.positional(verify.specJsonArg) ?? "", "s.json")
  t.eqStr("verify program", v.positional(verify.programJsonArg) ?? "", "p.json")
  t.ok("verify --json", v.flag(verify.jsonFlag))
  t.eqStr("verify --emit", v.value(verify.emitFlag) ?? "", "out.ts")
  t.eqI32("verify needs both files", cli.parse(["vector", "verify", "s.json"], 1).kind, PARSE_ERROR)

  const d = cli.parse(["vector", "diff", "a.json", "b.json"], 1)
  t.eqI32("diff id", d.id, DIFF_ID)
  t.eqStr("diff new", d.positional(diff.newJsonArg) ?? "", "b.json")

  const x = cli.parse(["vector", "spec", "extract", "s.xml", "-o", "c.json", "--check"], 1)
  t.eqI32("extract id", x.id, SPEC_EXTRACT_ID)
  t.eqStr("extract -o", x.value(extract.outFlag) ?? "", "c.json")
  t.ok("extract --check", x.flag(extract.checkFlag))

  const c = cli.parse(["vector", "spec", "check", "c.json", "--format", "json", "--run-sources"], 1)
  t.eqI32("check id", c.id, SPEC_CHECK_ID)
  t.eqStr("check --format", c.value(check.formatFlag) ?? "", "json")
  t.ok("check --run-sources", c.flag(check.runSourcesFlag))

  const em = cli.parse(["vector", "spec", "emit", "c.json", "-o", "m.ts"], 1)
  t.eqI32("emit id", em.id, SPEC_EMIT_ID)
  t.eqStr("emit -o", em.value(emit.outFlag) ?? "", "m.ts")
  const ru = cli.parse(["vector", "spec", "run", "c.json"], 1)
  t.eqI32("run id", ru.id, SPEC_RUN_ID)
  t.ok("run has no -o by default", ru.value(run.outFlag) === null)

  const f = cli.parse(["vector", "spec", "frozen", "a.json", "b.json", "--base", "main"], 1)
  t.eqI32("frozen id", f.id, SPEC_FROZEN_ID)
  t.eqI32("frozen takes many contracts", toI32(f.positionals(frozen.contractsArg).length), 2)
  t.eqI32("frozen takes none", cli.parse(["vector", "spec", "frozen", "--base", "main"], 1).kind, PARSE_OK)

  const s = cli.parse(["vector", "spec", "stale", "t.ts", "c.json"], 1)
  t.eqI32("stale id", s.id, SPEC_STALE_ID)
  t.eqStr("stale test", s.positional(stale.testTsArg) ?? "", "t.ts")

  const e = cli.parse(["vector", "spec", "exports", "c.json", "--base", "main", "--nish-root", "../nish"], 1)
  t.eqI32("exports id", e.id, SPEC_EXPORTS_ID)
  t.eqStr("exports --nish-root", e.value(exportsGate.nishRootFlag) ?? "", "../nish")

  const m = cli.parse(["vector", "spec", "mutate", "c.json", "--jobs", "4", "--max", "20"], 1)
  t.eqI32("mutate id", m.id, SPEC_MUTATE_ID)
  t.eqStr("mutate --jobs", m.value(mutate.jobsFlag) ?? "", "4")

  t.eqI32(
    "an unknown flag is an error",
    cli.parse(["vector", "spec", "stale", "t.ts", "c.json", "--nope"], 1).kind,
    PARSE_ERROR,
  )
  t.eqI32("stub handlers exit 2", mutate.run(m), 2)
  t.eqI32("notImplemented exits 2", notImplemented("test"), 2)
  return t.done()
}
