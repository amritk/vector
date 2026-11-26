import { Suite } from "nish/testing"
import { QueryAnswer } from "../../src/core/smt"
import { Float64Delta } from "../../src/verify/emit/float64"
import { outJsonRender } from "../../src/verify/emit/outjson"
import {
  CHECK_NONE,
  CHECK_UNKNOWN,
  CHECK_WITNESS,
  DIFF_DIFFERENT,
  DIFF_EQUIVALENT,
  DIFF_MISMATCH,
  DIFF_UNDECIDED,
  DiffCheck,
  DiffQuery,
  Float64Diff,
  FunctionPair,
  MatchedFunctionDiff,
  ProgramDiffReport,
  assembleDiffs,
  diffDecide,
  diffPairStatus,
  diffReplayWitnesses,
  diffReportJson,
  emitDiffScript,
  pairFunctions,
  renderDiffSummary,
} from "../../src/verify/equiv/diff"
import { Program } from "../../src/verify/lang/ast"
import { BCase, bBin, bNum, bProgram, bVar } from "./build"

// A program of one function `f` with these parameters, `x >= low` and
// returning `x + add` plus its other Int parameters.
const eqgProgram = (t: Suite, params: string[], low: string, add: string): Program => {
  const c = new BCase("versions")
  let body = bBin("+", bVar("x"), bNum(add))
  for (let i = 1; i < toI32(params.length); i++) {
    const at = params[i].indexOf(":")
    if (at > 0 && params[i].substring(at + 1) === "Int") {
      body = bBin("+", body, bVar(params[i].substring(0, at)))
    }
  }
  c.fn("f", 1, params, "Int", [bBin(">=", bVar("x"), bNum(low))], [bBin("==", bVar("result"), bVar("result"))], body)
  const program = bProgram(c.programText())
  t.eqStr(`f(${params.join(", ")}) builds`, program.isOk() ? "" : program.error, "")
  return program.isOk() ? program.value : new Program("versions")
}

// `n` queries over no constants, each answered unsat.
const eqgQueries = (n: i32): DiffQuery[] => {
  const out: DiffQuery[] = []
  for (let i = 0; i < n; i++) {
    out.push(new DiffQuery(0, [], [], "o", "n"))
  }
  return out
}

const eqgAnswers = (n: i32): QueryAnswer[] => {
  const out: QueryAnswer[] = []
  for (let i = 0; i < n; i++) {
    out.push(new QueryAnswer("unsat"))
  }
  return out
}

const eqgPairs = (pair: FunctionPair, n: i32): FunctionPair[] => {
  const out: FunctionPair[] = []
  for (let i = 0; i < n; i++) {
    out.push(pair)
  }
  return out
}

const eqgWitness = (names: string[], values: string[]): DiffCheck => {
  const c = new DiffCheck(CHECK_WITNESS)
  for (const n of names) {
    c.inputs.names.push(n)
  }
  for (const v of values) {
    c.inputs.values.push(v)
  }
  return c
}

const eqgEquivalent = (name: string): MatchedFunctionDiff =>
  new MatchedFunctionDiff(
    name,
    `${name}(x: Int) -> Int`,
    new DiffCheck(CHECK_NONE),
    new DiffCheck(CHECK_NONE),
    new DiffCheck(CHECK_NONE),
  )

/** One call of assembleDiffs on counts at the edges of four per pair. */
class EqgCountCase {
  pairs: i32
  queries: i32
  answers: i32
  ok: boolean

  constructor(pairs: i32, queries: i32, answers: i32, ok: boolean) {
    this.pairs = pairs
    this.queries = queries
    this.answers = answers
    this.ok = ok
  }
}

// diffCompatible pairs only same-typed, same-arity versions; each
// parameter's type is compared, not only the first.
const eqgPairing = (t: Suite): void => {
  const one = eqgProgram(t, ["x:Int"], "0", "1")
  const oneLater = eqgProgram(t, ["x:Int"], "1", "2")
  const two = eqgProgram(t, ["x:Int", "y:Int"], "0", "1")
  const twoReal = eqgProgram(t, ["x:Int", "y:Real"], "0", "1")
  const same = pairFunctions(one, oneLater)
  t.eqI32("same arity and types: comparable", toI32(same.comparable.length), 1)
  t.eqI32("same arity and types: no signature change", toI32(same.signatureChanged.length), 0)
  const fewer = pairFunctions(two, one)
  t.eqI32("a parameter dropped: not comparable", toI32(fewer.comparable.length), 0)
  t.eqI32("a parameter dropped: a signature change", toI32(fewer.signatureChanged.length), 1)
  const more = pairFunctions(one, two)
  t.eqI32("a parameter added: a signature change", toI32(more.signatureChanged.length), 1)
  const retyped = pairFunctions(two, twoReal)
  t.eqI32("the second parameter retyped: not comparable", toI32(retyped.comparable.length), 0)
  t.eqI32("the second parameter retyped: a signature change", toI32(retyped.signatureChanged.length), 1)
  const empty = new Program("versions")
  const added = pairFunctions(empty, one)
  t.eqI32("only in the new version: added", toI32(added.added.length), 1)
  t.eqI32("only in the new version: not removed", toI32(added.removed.length), 0)
  const removed = pairFunctions(one, empty)
  t.eqI32("only in the old version: removed", toI32(removed.removed.length), 1)
  t.eqI32("only in the old version: not added", toI32(removed.added.length), 0)
  // Two new functions named f: the old f pairs with the first, here the
  // two-parameter one, so the pairing is a signature change.
  if (one.functions.length > 0 && two.functions.length > 0) {
    const twice = new Program("versions")
    twice.functions.push(two.functions[0])
    twice.functions.push(one.functions[0])
    const first = pairFunctions(one, twice)
    t.eqI32("a name twice: the first is paired, not comparable", toI32(first.comparable.length), 0)
    t.eqI32("a name twice: the first is paired, a signature change", toI32(first.signatureChanged.length), 1)
  }
}

// emitDiffScript gives a pair whose old version has fewer parameters no
// queries, and assembleDiffs then refuses the script; the old code read past
// the old version's parameters.
const eqgShortPair = (t: Suite): void => {
  const one = eqgProgram(t, ["x:Int"], "0", "1")
  const two = eqgProgram(t, ["x:Int", "y:Int"], "0", "1")
  if (one.functions.length === 0 || two.functions.length === 0) {
    return
  }
  const short = new FunctionPair(one.functions[0], two.functions[0])
  const equal = new FunctionPair(one.functions[0], one.functions[0])
  const long = new FunctionPair(two.functions[0], one.functions[0])
  t.eqI32(
    "an old version with fewer parameters: no queries",
    toI32(emitDiffScript([short], one, two).queries.length),
    0,
  )
  t.eqI32("the same parameters: four queries", toI32(emitDiffScript([equal], one, one).queries.length), 4)
  t.eqI32(
    "an old version with more parameters: four queries",
    toI32(emitDiffScript([long], two, one).queries.length),
    4,
  )
  const mixed = emitDiffScript([equal, short], one, two)
  t.eqI32("a short pair after a good one: four queries", toI32(mixed.queries.length), 4)
  const refused = assembleDiffs([equal, short], mixed.queries, eqgAnswers(toI32(mixed.queries.length)))
  t.ok("a short pair: assembleDiffs refuses", refused.isErr())
  if (refused.isErr()) {
    t.eqStr("a short pair: the count message", refused.error, "diff: 4 answers for 4 queries over 2 pairs")
  }
  // A caller whose counts are consistent with a short pair: refused on the
  // parameters, where the old code read past the old version's.
  const consistent = assembleDiffs([short], eqgQueries(4), eqgAnswers(4))
  t.ok("a short pair, consistent counts: refused", consistent.isErr())
  if (consistent.isErr()) {
    t.eqStr(
      "a short pair, consistent counts: the parameter message",
      consistent.error,
      "diff: f has 2 parameters but its old version has 1",
    )
  }
  const same = assembleDiffs([equal], eqgQueries(4), eqgAnswers(4))
  t.ok("the same parameters, consistent counts: accepted", same.isOk())
  const longer = assembleDiffs([long], eqgQueries(4), eqgAnswers(4))
  t.ok("an old version with more parameters, consistent counts: accepted", longer.isOk())
  if (longer.isOk()) {
    t.eqI32("an old version with more parameters: no rename", toI32(longer.value[0].paramRenames.length), 0)
  }
}

const eqgCounts = (t: Suite): void => {
  const one = eqgProgram(t, ["x:Int"], "0", "1")
  if (one.functions.length === 0) {
    return
  }
  const pair = new FunctionPair(one.functions[0], one.functions[0])
  const cases: EqgCountCase[] = [
    new EqgCountCase(0, 0, 0, true),
    new EqgCountCase(0, 4, 4, false),
    new EqgCountCase(1, 0, 0, false),
    new EqgCountCase(1, 3, 3, false),
    new EqgCountCase(1, 4, 4, true),
    new EqgCountCase(1, 5, 5, false),
    new EqgCountCase(1, 7, 7, false),
    new EqgCountCase(1, 8, 8, false),
    new EqgCountCase(1, 4, 3, false),
    new EqgCountCase(1, 4, 5, false),
    new EqgCountCase(2, 4, 4, false),
    new EqgCountCase(2, 7, 7, false),
    new EqgCountCase(2, 8, 8, true),
    new EqgCountCase(2, 9, 9, false),
    new EqgCountCase(2, 12, 12, false),
  ]
  for (const c of cases) {
    const label = `${c.pairs} pairs, ${c.queries} queries, ${c.answers} answers`
    const got = assembleDiffs(eqgPairs(pair, c.pairs), eqgQueries(c.queries), eqgAnswers(c.answers))
    t.eqStr(`${label}: accepted`, got.isOk() ? "yes" : "no", c.ok ? "yes" : "no")
    if (got.isOk()) {
      t.eqI32(`${label}: a verdict per pair`, toI32(got.value.length), c.pairs)
    } else {
      t.eqStr(
        `${label}: the count message`,
        got.error,
        `diff: ${c.answers} answers for ${c.queries} queries over ${c.pairs} pairs`,
      )
    }
  }
}

/** One shared-domain query and z3's answer to it. */
class EqgNamesCase {
  constants: string[]
  names: string[]
  result: string
  valued: string[]
  refusal: string
  witness: string

  constructor(
    constants: string[],
    names: string[],
    result: string,
    valued: string[],
    refusal: string,
    witness: string,
  ) {
    this.constants = constants
    this.names = names
    this.result = result
    this.valued = valued
    this.refusal = refusal
    this.witness = witness
  }
}

// A model value for a constant past the query's names is refused, as the old
// code panicked on it; a short query z3 gave no such value is read as before.
const eqgNames = (t: Suite): void => {
  const one = eqgProgram(t, ["x:Int"], "0", "1")
  if (one.functions.length === 0) {
    return
  }
  const pair = new FunctionPair(one.functions[0], one.functions[0])
  const cases: EqgNamesCase[] = [
    new EqgNamesCase(["a"], [], "sat", ["a"], "diff: a query has 0 names for 1 constants", ""),
    new EqgNamesCase(["a", "b"], ["x"], "sat", ["a", "b"], "diff: a query has 1 names for 2 constants", ""),
    new EqgNamesCase(["a", "b"], ["x"], "sat", ["b"], "diff: a query has 1 names for 2 constants", ""),
    new EqgNamesCase(["a", "b"], ["x"], "sat", ["a"], "", "x=3"),
    new EqgNamesCase(["a"], [], "sat", [], "", ""),
    new EqgNamesCase(["a"], [], "unsat", ["a"], "", ""),
    new EqgNamesCase(["a"], [], "unknown", ["a"], "", ""),
    new EqgNamesCase(["a"], ["x"], "sat", ["a"], "", "x=3"),
    new EqgNamesCase(["a"], ["x", "y"], "sat", ["a"], "", "x=3"),
    new EqgNamesCase([], [], "sat", [], "", ""),
  ]
  for (const c of cases) {
    const queries = eqgQueries(3)
    queries.push(new DiffQuery(0, c.constants, c.names, "o", "n"))
    const answers = eqgAnswers(3)
    const last = new QueryAnswer(c.result)
    for (const v of c.valued) {
      last.names.push(v)
      last.values.push("3")
    }
    answers.push(last)
    const got = assembleDiffs([pair], queries, answers)
    const label = `${c.result}, constants [${c.constants.join(",")}], names [${c.names.join(",")}], values for [${c.valued.join(",")}]`
    t.eqStr(`${label}: refusal`, got.isOk() ? "" : got.error, c.refusal)
    if (got.isOk() && got.value.length === 1) {
      const inputs = got.value[0].sharedDomain.inputs
      const pairs: string[] = []
      for (let i = 0; i < toI32(inputs.names.length) && i < toI32(inputs.values.length); i++) {
        pairs.push(`${inputs.names[i]}=${inputs.values[i]}`)
      }
      t.eqStr(`${label}: the witness`, pairs.join(","), c.witness)
    }
  }
}

/** One shared-domain witness and the verdict diffDecide gives it. */
class EqgDomainCase {
  names: string[]
  values: string[]
  want: string
  label: string

  constructor(names: string[], values: string[], want: string, label: string) {
    this.names = names
    this.values = values
    this.want = want
    this.label = label
  }
}

// A verdict with no comparable pair, or a shared-domain witness that names a
// parameter with no value, is a MISMATCH; the old code panicked on both.
const eqgDecide = (t: Suite): void => {
  const was = eqgProgram(t, ["x:Int"], "0", "1")
  const now = eqgProgram(t, ["x:Int"], "0", "1")
  const pairing = pairFunctions(was, now)
  t.eqI32("one comparable pair", toI32(pairing.comparable.length), 1)

  const paired = new ProgramDiffReport("versions", "versions")
  paired.matched.push(eqgEquivalent("f"))
  t.eqStr(
    "an equivalent verdict with its pair: EQUIVALENT",
    diffDecide(was, now, pairing, paired).status,
    DIFF_EQUIVALENT,
  )

  const extra = new ProgramDiffReport("versions", "versions")
  extra.matched.push(eqgEquivalent("f"))
  extra.matched.push(eqgEquivalent("g"))
  t.eqStr("an equivalent verdict with no pair: MISMATCH", diffDecide(was, now, pairing, extra).status, DIFF_MISMATCH)

  const none = new ProgramDiffReport("versions", "versions")
  none.matched.push(eqgEquivalent("f"))
  t.eqStr(
    "an equivalent verdict and no pairs at all: MISMATCH",
    diffDecide(was, now, pairFunctions(new Program("versions"), new Program("versions")), none).status,
    DIFF_MISMATCH,
  )

  // Not equivalent, so never run in float64: what it was before, UNDECIDED.
  const extraUnknown = new ProgramDiffReport("versions", "versions")
  extraUnknown.matched.push(eqgEquivalent("f"))
  extraUnknown.matched.push(
    new MatchedFunctionDiff(
      "g",
      "g(x: Int) -> Int",
      new DiffCheck(CHECK_NONE),
      new DiffCheck(CHECK_NONE),
      new DiffCheck(CHECK_UNKNOWN),
    ),
  )
  t.eqStr(
    "an undecided verdict with no pair: UNDECIDED",
    diffDecide(was, now, pairing, extraUnknown).status,
    DIFF_UNDECIDED,
  )

  const cases: EqgDomainCase[] = [
    new EqgDomainCase(["x"], [], DIFF_MISMATCH, "a shared-domain name with no value"),
    new EqgDomainCase(["x"], ["3"], DIFF_EQUIVALENT, "a shared-domain name with its value"),
    new EqgDomainCase(["y"], [], DIFF_EQUIVALENT, "a shared-domain name that is no parameter"),
    new EqgDomainCase([], [], DIFF_EQUIVALENT, "a shared domain z3 left empty"),
  ]
  for (const c of cases) {
    const report = new ProgramDiffReport("versions", "versions")
    const m = eqgEquivalent("f")
    m.sharedDomain = eqgWitness(c.names, c.values)
    report.matched.push(m)
    t.eqStr(`${c.label}: ${c.want}`, diffDecide(was, now, pairing, report).status, c.want)
  }
}

const eqgForged = (): DiffCheck => eqgWitness(["x"], ["5"])

const eqgNone = (): DiffCheck => new DiffCheck(CHECK_NONE)

// diffReplayWitnesses counts every check that does not replay, exactly.
const eqgReplayCount = (t: Suite): void => {
  const was = eqgProgram(t, ["x:Int"], "0", "1")
  const now = eqgProgram(t, ["x:Int"], "1", "2")
  const pairing = pairFunctions(was, now)
  // x = 0 is narrowed (only the old accepts it); x = 5 is in both domains.
  const real = eqgWitness(["x"], ["0"])
  const rows: MatchedFunctionDiff[] = [
    new MatchedFunctionDiff("f", "f(x: Int) -> Int", real, eqgNone(), eqgNone()),
    new MatchedFunctionDiff("f", "f(x: Int) -> Int", eqgForged(), eqgNone(), eqgNone()),
    new MatchedFunctionDiff("f", "f(x: Int) -> Int", eqgForged(), eqgForged(), eqgNone()),
  ]
  for (let i = 0; i < toI32(rows.length); i++) {
    t.eqI32(`${i} forged witnesses: ${i} mismatches`, diffReplayWitnesses(was, now, pairing.comparable, [rows[i]]), i)
  }
  // Only the first verdict has a pair: the second is not replayed.
  const unpaired = new MatchedFunctionDiff("g", "g(x: Int) -> Int", eqgForged(), eqgForged(), eqgNone())
  t.eqI32(
    "a verdict past the pairs is not replayed",
    diffReplayWitnesses(was, now, pairing.comparable, [
      new MatchedFunctionDiff("f", "f(x: Int) -> Int", eqgForged(), eqgNone(), eqgNone()),
      unpaired,
    ]),
    1,
  )
}

// A float64 delta is found by name and rendered with every input.
const eqgRender = (t: Suite): void => {
  const report = new ProgramDiffReport("versions", "versions")
  report.matched.push(eqgEquivalent("f"))
  report.matched.push(eqgEquivalent("h"))
  const other = new Float64Delta()
  other.found = true
  other.inputs.names.push("z")
  other.inputs.values.push("9")
  other.oldResult = "8"
  other.newResult = "7"
  const delta = new Float64Delta()
  delta.found = true
  delta.inputs.names.push("x")
  delta.inputs.values.push("1")
  delta.inputs.names.push("y")
  delta.inputs.values.push("2")
  delta.oldResult = "3"
  delta.newResult = "4"
  report.float64Deltas.push(new Float64Diff("g", other))
  report.float64Deltas.push(new Float64Diff("f", delta))
  // A second delta under the same name: the first one is rendered.
  const later = new Float64Delta()
  later.found = true
  later.inputs.names.push("w")
  later.inputs.values.push("6")
  later.oldResult = "5"
  later.newResult = "4"
  report.float64Deltas.push(new Float64Diff("f", later))
  const text = renderDiffSummary(DIFF_DIFFERENT, report)
  t.contains("f's own delta, every input", text, "float64: at x = 1, y = 2 → old = 3, new = 4")
  t.ok("not another function's delta", text.indexOf("z = 9") < 0)
  t.ok("a name twice: not the later delta", text.indexOf("w = 6") < 0)
  t.eqStr("a delta by name: DIFFERENT", diffPairStatus(report, report.matched[0]), DIFF_DIFFERENT)
  t.eqStr("no delta by that name: EQUIVALENT", diffPairStatus(report, report.matched[1]), DIFF_EQUIVALENT)
  const json = outJsonRender(diffReportJson(report))
  t.contains("the JSON has the first input", json, `"x": "1"`)
  t.contains("the JSON has the second input", json, `"y": "2"`)
}

export const main = (): i32 => {
  const t = new Suite("verify/equiv_guard")
  eqgPairing(t)
  eqgShortPair(t)
  eqgCounts(t)
  eqgNames(t)
  eqgDecide(t)
  eqgReplayCount(t)
  eqgRender(t)
  return t.done()
}
