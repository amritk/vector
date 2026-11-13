// Hand-built `vector diff` cases: each pins one way two programs can differ
// (or not), so a check that stopped seeing it would fail here.

import { Suite } from "nish/testing"
import { diffExitCode } from "../../src/cli/diff"
import { joinPath, makeTempDir } from "../../src/core/fs"
import { newJsonDocument, parseJson } from "../../src/core/json"
import { runProcess } from "../../src/core/process"
import { QueryAnswer } from "../../src/core/smt"
import { resolveZ3 } from "../../src/core/z3"
import { outJsonRender } from "../../src/verify/emit/outjson"
import {
  CHECK_UNKNOWN,
  CHECK_WITNESS,
  DIFF_DIFFERENT,
  DIFF_EQUIVALENT,
  DIFF_ERROR,
  DIFF_INVALID,
  DIFF_UNDECIDED,
  DiffCheck,
  DiffOutcome,
  assembleDiffs,
  diffPairStatus,
  diffPrograms,
  diffReportJson,
  emitDiffScript,
  pairFunctions,
  renderDiffSummary,
} from "../../src/verify/equiv/diff"
import { BCase, bBin, bNone, bNum, bProgram, bRemoveTree, bVar } from "./build"

const dcRun = (t: Suite, what: string, before: BCase, after: BCase): DiffOutcome => {
  t.eqStr(`${what}: old is well-formed`, bProgram(before.programText()).isErr() ? "bad" : "", "")
  t.eqStr(`${what}: new is well-formed`, bProgram(after.programText()).isErr() ? "bad" : "", "")
  const oldDoc = newJsonDocument()
  const oldRoot = parseJson(oldDoc, before.programText(), "old")
  const newDoc = newJsonDocument()
  const newRoot = parseJson(newDoc, after.programText(), "new")
  return diffPrograms(oldDoc, oldRoot.isOk() ? oldRoot.value : -1, newDoc, newRoot.isOk() ? newRoot.value : -1)
}

// One function `f(x: Real): Real` with result == result, given its requires and body.
const dcOne = (requires: string[], body: string): BCase => {
  const c = new BCase("diffcase")
  const result = bVar("result")
  c.fn("f", 1, ["x:Real"], "Real", requires, [bBin("==", result, result)], body)
  return c
}

const dcIdentity = (): BCase => dcOne(bNone(), bVar("x"))

export const main = (): i32 => {
  const t = new Suite("verify/diffcases")
  const x = bVar("x")
  const result = bVar("result")

  // Equal over the reals, different in float64: a body change.
  const bodyOld = dcOne(bNone(), bBin("+", bBin("+", x, bNum("0.1")), bNum("0.2")))
  const bodyNew = dcOne(bNone(), bBin("+", x, bNum("0.3")))
  const body = dcRun(t, "float64 body", bodyOld, bodyNew)
  t.eqStr("float64 body: DIFFERENT", body.status, DIFF_DIFFERENT)
  t.ok("float64 body: equal over the reals", body.report.matched.length === 1 && body.report.matched[0].equivalent)
  t.eqI32("float64 body: a float64 delta", toI32(body.report.float64Deltas.length), 1)
  t.contains("float64 body: says so", body.summary, "equal over the reals, but the emitted float64 code DIFFERS")

  // ... and a requires change: (x + 0.1) + 0.2 > 0.3 accepts x = 0 in float64.
  const reqOld = dcOne([bBin(">", bBin("+", bBin("+", x, bNum("0.1")), bNum("0.2")), bNum("0.3"))], x)
  const reqNew = dcOne([bBin(">", x, bNum("0"))], x)
  const req = dcRun(t, "float64 requires", reqOld, reqNew)
  t.eqStr("float64 requires: DIFFERENT", req.status, DIFF_DIFFERENT)
  t.eqI32("float64 requires: a float64 delta", toI32(req.report.float64Deltas.length), 1)

  // A removed function breaks its callers; an added one breaks nothing.
  const pair = new BCase("diffcase")
  pair.fn("f", 1, ["x:Real"], "Real", bNone(), [bBin("==", result, result)], x)
  pair.fn("g", 1, ["x:Real"], "Real", bNone(), [bBin("==", result, result)], x)
  const removed = dcRun(t, "removed", pair, dcIdentity())
  t.eqStr("removed: DIFFERENT", removed.status, DIFF_DIFFERENT)
  t.eqI32("removed: names g", toI32(removed.report.removed.length), 1)
  t.eqStr("removed: exits 1", `${diffExitCode(removed.status)}`, "1")
  const added = dcRun(t, "added", dcIdentity(), pair)
  t.eqStr("added: EQUIVALENT", added.status, DIFF_EQUIVALENT)
  t.eqI32("added: names g", toI32(added.report.added.length), 1)
  t.eqStr("added: exits 0", `${diffExitCode(added.status)}`, "0")

  // A changed signature is not comparable, so it differs.
  const intParam = new BCase("diffcase")
  intParam.fn("f", 1, ["x:Int"], "Int", bNone(), [bBin("==", result, result)], x)
  const sig = dcRun(t, "signature", dcIdentity(), intParam)
  t.eqStr("signature: DIFFERENT", sig.status, DIFF_DIFFERENT)
  t.eqI32("signature: one change", toI32(sig.report.signatureChanged.length), 1)

  // A wider requires accepts an input the old one refused.
  const widened = dcRun(t, "widened", dcOne([bBin(">=", x, bNum("1"))], x), dcOne([bBin(">=", x, bNum("0"))], x))
  t.eqStr("widened: DIFFERENT", widened.status, DIFF_DIFFERENT)
  t.eqStr("widened: a witness", widened.report.matched[0].domainWidened.status, CHECK_WITNESS)
  t.contains("widened: says so", widened.summary, "was rejected, now ACCEPTED")
  const narrowed = dcRun(t, "narrowed", dcOne([bBin(">=", x, bNum("0"))], x), dcOne([bBin(">=", x, bNum("1"))], x))
  t.eqStr("narrowed: a witness", narrowed.report.matched[0].domainNarrowed.status, CHECK_WITNESS)

  // A changed ensures changes no behavior.
  const ensOld = new BCase("diffcase")
  ensOld.fn("f", 1, ["x:Real"], "Real", bNone(), [bBin(">=", result, bNum("0"))], bBin("max", x, bNum("0")))
  const ensNew = new BCase("diffcase")
  ensNew.fn("f", 1, ["x:Real"], "Real", bNone(), [bBin(">=", result, bNum("-1"))], bBin("max", x, bNum("0")))
  const ens = dcRun(t, "ensures only", ensOld, ensNew)
  t.eqStr("ensures only: EQUIVALENT", ens.status, DIFF_EQUIVALENT)
  t.eqI32("ensures only: one added", toI32(ens.report.matched[0].ensuresAdded.length), 1)
  t.eqI32("ensures only: one removed", toI32(ens.report.matched[0].ensuresRemoved.length), 1)

  // Commuted operands are the same function, in float64 too.
  const mulOld = new BCase("diffcase")
  mulOld.fn(
    "fx",
    1,
    ["amount:Real", "rate:Real"],
    "Real",
    bNone(),
    [bBin("==", result, result)],
    bBin("*", bVar("amount"), bVar("rate")),
  )
  const mulNew = new BCase("diffcase")
  mulNew.fn(
    "fx",
    1,
    ["amount:Real", "rate:Real"],
    "Real",
    bNone(),
    [bBin("==", result, result)],
    bBin("*", bVar("rate"), bVar("amount")),
  )
  const mul = dcRun(t, "commuted", mulOld, mulNew)
  t.eqStr("amount*rate vs rate*amount: EQUIVALENT", mul.status, DIFF_EQUIVALENT)
  t.eqI32("amount*rate vs rate*amount: no float64 delta", toI32(mul.report.float64Deltas.length), 0)

  // A requires window no random sample reaches: the solver's model of both
  // requires seeds the sweep, which finds the float64 delta inside it.
  const window = [bBin(">", x, bNum("3.1")), bBin("<", x, bNum("3.2"))]
  const winOld = dcOne(window, bBin("+", bBin("+", x, bNum("0.1")), bNum("0.2")))
  const winNew = dcOne(window, bBin("+", x, bNum("0.3")))
  const win = dcRun(t, "narrow window", winOld, winNew)
  t.eqStr("3.1 < x < 3.2, (x+0.1)+0.2 vs x+0.3: DIFFERENT", win.status, DIFF_DIFFERENT)
  t.eqI32("narrow window: a float64 delta", toI32(win.report.float64Deltas.length), 1)
  t.eqI32("narrow window: sampled", toI32(win.report.float64Unsampled.length), 0)
  // The pair's own JSON verdict carries the float64 delta, not just the reals.
  t.eqStr("narrow window: pair DIFFERENT", diffPairStatus(win.report, win.report.matched[0]), DIFF_DIFFERENT)
  const winJson = outJsonRender(diffReportJson(win.report))
  t.contains("narrow window: pair JSON status", winJson, '"status": "DIFFERENT"')
  t.contains("narrow window: pair JSON not equivalent", winJson, '"equivalent": false')
  t.contains("narrow window: pair JSON equal over the reals", winJson, '"equivalentOverReals": true')
  // The same window with one body is EQUIVALENT: the seed is compared too.
  const winSame = dcRun(t, "narrow window, same body", winNew, winNew)
  t.eqStr("narrow window, same body: EQUIVALENT", winSame.status, DIFF_EQUIVALENT)

  // A domain non-empty over the reals but empty in float64 (the two bounds
  // are adjacent doubles, so no double lies strictly between): nothing can be
  // compared, so it fails closed as UNDECIDED rather than EQUIVALENT.
  const sliver = [bBin(">", x, bNum("0.1")), bBin("<", x, bNum("0.10000000000000002"))]
  const sliverOld = dcOne(sliver, bBin("+", bBin("+", x, bNum("0.1")), bNum("0.2")))
  const sliverNew = dcOne(sliver, bBin("+", x, bNum("0.3")))
  const unsampled = dcRun(t, "float64-empty domain", sliverOld, sliverNew)
  t.eqStr("float64-empty domain: UNDECIDED", unsampled.status, DIFF_UNDECIDED)
  t.ok("float64-empty domain: equal over the reals", unsampled.report.matched[0].equivalent)
  t.eqI32("float64-empty domain: unsampled", toI32(unsampled.report.float64Unsampled.length), 1)
  t.contains("float64-empty domain: says so", unsampled.summary, "UNDECIDED in float64")
  t.eqStr(
    "float64-empty domain: pair UNDECIDED",
    diffPairStatus(unsampled.report, unsampled.report.matched[0]),
    DIFF_UNDECIDED,
  )
  t.contains("float64-empty domain: pair JSON", outJsonRender(diffReportJson(unsampled.report)), '"equivalent": false')
  t.contains("float64-empty domain: unsampled hint", unsampled.summary, "No float64 sample reached")
  t.ok("float64-empty domain: no solver hint", unsampled.summary.indexOf("nonlinear") < 0)
  // One pair unsampled and one the solver could not decide: both hints stay.
  const mixed = unsampled.report
  mixed.matched.push(mixed.matched[0])
  mixed.matched[1].valueDiff = new DiffCheck(CHECK_UNKNOWN)
  const mixedText = renderDiffSummary(DIFF_UNDECIDED, mixed)
  t.contains("unsampled and unknown: the float64 hint", mixedText, "No float64 sample reached")
  t.contains("unsampled and unknown: the solver hint", mixedText, "restate nonlinear bodies")
  // An empty shared domain makes zero comparisons vacuous: still EQUIVALENT.
  const empty = [bBin(">", x, bNum("1")), bBin("<", x, bNum("0"))]
  const vacuous = dcRun(t, "empty domain", dcOne(empty, bVar("x")), dcOne(empty, bBin("+", x, bNum("0"))))
  t.eqStr("empty shared domain: EQUIVALENT", vacuous.status, DIFF_EQUIVALENT)
  t.contains("empty shared domain: rests on verify", vacuous.summary, "rests on both passing vector verify")
  t.contains("empty shared domain: JSON vacuous", outJsonRender(diffReportJson(vacuous.report)), '"vacuous": true')

  // z3 answering unknown decides nothing.
  const oldP = bProgram(dcIdentity().programText())
  const newP = bProgram(dcOne(bNone(), bBin("+", x, bNum("0"))).programText())
  if (oldP.isErr() || newP.isErr()) {
    t.fail("read the unknown case", oldP.isErr() ? oldP.error : newP.isErr() ? newP.error : "")
  } else {
    const pairing = pairFunctions(oldP.value, newP.value)
    const script = emitDiffScript(pairing.comparable, oldP.value, newP.value)
    const unknowns: QueryAnswer[] = []
    for (let i = 0; i < toI32(script.queries.length); i++) {
      unknowns.push(new QueryAnswer("unknown"))
    }
    const diffs = assembleDiffs(pairing.comparable, script.queries, unknowns)
    if (diffs.isErr()) {
      t.fail("assembleDiffs", diffs.error)
    } else {
      t.ok("unknown is not equivalent", !diffs.value[0].equivalent)
      t.ok("unknown is CHECK_UNKNOWN", diffs.value[0].any(CHECK_UNKNOWN))
    }
  }
  t.eqStr("UNDECIDED exits 1", `${diffExitCode(DIFF_UNDECIDED)}`, "1")
  t.eqStr("DIFFERENT exits 1", `${diffExitCode(DIFF_DIFFERENT)}`, "1")
  t.eqStr("INVALID exits 2", `${diffExitCode(DIFF_INVALID)}`, "2")
  t.eqStr("ERROR exits 2", `${diffExitCode(DIFF_ERROR)}`, "2")

  // A z3 that rejects the script is ERROR, which exits 2.
  const z3 = resolveZ3()
  const dir = makeTempDir("vector-diffcases-")
  if (z3.isErr() || dir.isErr()) {
    t.fail("z3 and a temp dir", z3.isErr() ? z3.error : dir.isErr() ? dir.error : "")
    return t.done()
  }
  const fake = joinPath(dir.value, "z3")
  const fakeText = `#!/bin/sh\n"${z3.value}" "$@"\necho '(error "line 1 column 1: rejected on purpose")'\n`
  t.ok("write the fake z3", writeFileSyncMode(fake, fakeText, 0o755) >= 0)
  const oldPath = joinPath(dir.value, "old.json")
  t.ok("write old.json", writeFileSyncMode(oldPath, bodyOld.programText(), 0o644) >= 0)
  const run = runProcess(["env", `VECTOR_Z3=${fake}`, "dist/vector", "diff", "--json", oldPath, oldPath], "", 60000)
  // A z3 that answers unknown to every query, end to end: UNDECIDED, exit 1.
  // The golden runner cannot set VECTOR_Z3, so this spawn is the CLI case.
  const unsure = joinPath(dir.value, "z3-unknown")
  const unsureText = `#!/bin/sh
"${z3.value}" "$@" | sed -e 's/^sat$/unknown/' -e 's/^unsat$/unknown/'
`
  t.ok("write the unknown z3", writeFileSyncMode(unsure, unsureText, 0o755) >= 0)
  const undecided = runProcess(
    ["env", `VECTOR_Z3=${unsure}`, "dist/vector", "diff", "--json", oldPath, oldPath],
    "",
    60000,
  )
  const undecidedText = runProcess(["env", `VECTOR_Z3=${unsure}`, "dist/vector", "diff", oldPath, oldPath], "", 60000)
  t.ok("remove the temp dir", bRemoveTree(dir.value))
  if (run.isErr() || undecided.isErr() || undecidedText.isErr()) {
    t.fail("dist/vector runs (build it first)", run.isErr() ? run.error : "")
    return t.done()
  }
  t.eqI32("a z3 error exits 2", run.value.status, 2)
  t.contains("a z3 error is ERROR", run.value.stdout, `"status": "${DIFF_ERROR}"`)
  t.eqI32("z3 unknown exits 1", undecided.value.status, 1)
  t.contains("z3 unknown is UNDECIDED", undecided.value.stdout, `"status": "${DIFF_UNDECIDED}"`)
  t.contains("z3 unknown is not equivalent", undecided.value.stdout, `"equivalent": false`)
  t.eqI32("z3 unknown exits 1 without --json", undecidedText.value.status, 1)
  t.contains("z3 unknown says UNDECIDED", undecidedText.value.stdout, "Status: UNDECIDED")
  t.contains("z3 unknown marks the pair", undecidedText.value.stdout, "UNDECIDED (not proven equivalent)")
  return t.done()
}
