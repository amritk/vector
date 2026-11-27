// Pins only what holds for the life of the project: every command is
// registered, each path reaches its own id, and no two commands share one.
// A command's flags, arguments and handler belong to the stage that owns
// src/cli/<command>.ts, and are tested there.

import { Cli, PARSE_HELP, ROOT } from "nish/cli-args"
import { Suite } from "nish/testing"
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

const registerRoutes = (t: Suite, cli: Cli, path: string[], id: i32): void => {
  const argv: string[] = ["vector"]
  for (const word of path) argv.push(word)
  argv.push("--help")
  const r = cli.parse(argv, 1)
  const name = path.join(" ")
  t.eqI32(`${name} is registered`, r.kind, PARSE_HELP)
  t.eqI32(`${name} reaches its id`, r.id, id)
}

export const main = (): i32 => {
  const t = new Suite("cli/register")
  const cli = new Cli("vector", "0.0.0", "test")
  t.ok("registerVerify declares", registerVerify(cli, ROOT).isOk())
  t.ok("registerDiff declares", registerDiff(cli, ROOT).isOk())
  const spec = cli.tryGroup(ROOT, "spec", "spec").expect("spec")
  t.ok("registerSpecExtract declares", registerSpecExtract(cli, spec).isOk())
  t.ok("registerSpecCheck declares", registerSpecCheck(cli, spec).isOk())
  t.ok("registerSpecEmit declares", registerSpecEmit(cli, spec).isOk())
  t.ok("registerSpecRun declares", registerSpecRun(cli, spec).isOk())
  t.ok("registerSpecFrozen declares", registerSpecFrozen(cli, spec).isOk())
  t.ok("registerSpecStale declares", registerSpecStale(cli, spec).isOk())
  t.ok("registerSpecExports declares", registerSpecExports(cli, spec).isOk())
  t.ok("registerSpecMutate declares", registerSpecMutate(cli, spec).isOk())
  t.ok("a command declared twice is an Err, not a panic", registerVerify(cli, ROOT).isErr())
  t.ok("a spec command declared twice is an Err, not a panic", registerSpecStale(cli, spec).isErr())

  registerRoutes(t, cli, ["verify"], VERIFY_ID)
  registerRoutes(t, cli, ["diff"], DIFF_ID)
  registerRoutes(t, cli, ["spec", "extract"], SPEC_EXTRACT_ID)
  registerRoutes(t, cli, ["spec", "check"], SPEC_CHECK_ID)
  registerRoutes(t, cli, ["spec", "emit"], SPEC_EMIT_ID)
  registerRoutes(t, cli, ["spec", "run"], SPEC_RUN_ID)
  registerRoutes(t, cli, ["spec", "frozen"], SPEC_FROZEN_ID)
  registerRoutes(t, cli, ["spec", "stale"], SPEC_STALE_ID)
  registerRoutes(t, cli, ["spec", "exports"], SPEC_EXPORTS_ID)
  registerRoutes(t, cli, ["spec", "mutate"], SPEC_MUTATE_ID)

  const ids: i32[] = [
    VERIFY_ID,
    DIFF_ID,
    SPEC_EXTRACT_ID,
    SPEC_CHECK_ID,
    SPEC_EMIT_ID,
    SPEC_RUN_ID,
    SPEC_FROZEN_ID,
    SPEC_STALE_ID,
    SPEC_EXPORTS_ID,
    SPEC_MUTATE_ID,
  ]
  let distinct = true
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (ids[i] === ids[j]) distinct = false
    }
  }
  t.ok("no two commands share an id", distinct)
  t.eqI32("the spec group has no id", cli.parse(["vector", "spec", "--help"], 1).id, -1)
  return t.done()
}
