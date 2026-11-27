import { JSON_VALUE_ARRAY, JSON_VALUE_BOOLEAN, JSON_VALUE_STRING } from "nish/json-value"
import { Suite } from "nish/testing"
import { splitLines } from "nish/text"
import { makeTempDir } from "../../../src/core/fs"
import { jsonIntMember, jsonMember, jsonStringMember, newJsonDocument, parseJson } from "../../../src/core/json"
import { runProcess } from "../../../src/core/process"
import { vectorRun } from "../../../src/index"
import { contractParse } from "../../../src/spec/contract/read"
import { Expr, ExprKind } from "../../../src/spec/contract/types"
import { runRemove } from "../../../src/spec/run/run"
import { SampleValue, sampleEval, sampleInt } from "../../../src/spec/sample/eval"
import { sampleParseInt } from "../../../src/spec/sample/ints"

/** The no-panic compiler, which `.nish-next-version` pins and `scripts/fetch-nish-next.sh` installs. */
const PROVER: string = ".nish-next/bin/nish"
/** The pinned compiler (`.nish-version`), which `spec run` builds with. */
const NISH: string = ".nish/bin/nish"
/** A contract with a clause of every kind over every type the emitter writes. */
const CONTRACT: string = "tests/fixtures/emit-panics/contracts/emit-panics.json"
/** The module that contract tests, which is not the emitter's to prove. */
const UNDER_TEST: string = "tests/fixtures/emit-panics/stub.ts"

/**
 * Builds every program `vector spec emit` writes for the fixture, quick and
 * `--slow`, with the no-panic compiler and its default rule, and refuses any
 * site in the emitted test that is neither out of memory, proven, nor a call
 * into the module under test.
 */
export const main = (): i32 => {
  const t = new Suite("spec/emit panics")
  panicsClassifierRows(t)
  const dir = makeTempDir("vector-panics-").expect("a scratch directory")
  panicsWrapRows(t, dir)
  if (readFileSyncOrNull(PROVER) === null) {
    if (panicsProverRequired(getenv("CI") ?? "", getenv("VECTOR_PROVER_REQUIRED") ?? "")) {
      t.ok(`${PROVER} is installed (CI or VECTOR_PROVER_REQUIRED=1 needs it)`, false)
    } else {
      t.skip("the emitted tests build under the no-panic rule", `${PROVER} is not installed`)
    }
    runRemove(dir).expect("remove the scratch directory")
    return t.done()
  }
  for (const slow of [false, true]) {
    panicsBuild(t, dir, slow)
  }
  runRemove(dir).expect("remove the scratch directory")
  return t.done()
}

/**
 * Emits the fixture through `vectorRun`, builds it with the prover bare and
 * with `--emit-panics`, and checks both builds and every site they report.
 */
const panicsBuild = (t: Suite, dir: string, slow: boolean): void => {
  const tag = slow ? "--slow" : "quick"
  const file = `${dir}/${slow ? "slow" : "quick"}.ts`
  const args = ["spec", "emit", CONTRACT, "--package", "panics=tests/fixtures/emit-panics", "-o", file]
  if (slow) {
    args.push("--slow")
  }
  const emitted = vectorRun(args) === 0
  t.ok(`${tag}: the fixture emits`, emitted)
  if (!emitted) {
    return
  }
  const bare = runProcess([PROVER, file, "-o", `${dir}/out/`], "", 600000).expect("run the prover")
  t.ok(`${tag}: a bare prover build exits 0`, bare.status === 0)
  if (bare.status !== 0) {
    t.eqStr(`${tag}: what it refused`, panicsErrors(bare.stderr), "")
  }
  const report = `${dir}/${slow ? "slow" : "quick"}.json`
  const listed = runProcess([PROVER, file, "--emit-panics", report, "-o", `${dir}/out/`], "", 600000).expect(
    "run the prover",
  )
  t.ok(`${tag}: the build with --emit-panics exits 0`, listed.status === 0)
  const text = readFileSyncOrNull(report)
  t.ok(`${tag}: it writes the panic report`, text !== null)
  if (text === null) {
    return
  }
  // The report must cover the emitted test, or "nothing refused" proves nothing.
  const fns = panicsFunctions(text, file)
  t.ok(`${tag}: the report reads its functions`, fns.isOk())
  if (fns.isOk()) {
    for (const want of ["main", "clause_P_WRAP", "clause_V_OUT", "hexOf"]) {
      t.ok(`${tag}: the report lists the emitted ${want}`, fns.value.indexOf(want) >= 0)
    }
  }
  const refused = panicsRefused(text, file, UNDER_TEST)
  t.ok(`${tag}: the report reads`, refused.isOk())
  const none: string[] = []
  if (refused.isOk()) {
    t.eqLines(`${tag}: no site the emitter adds is unproven`, refused.value, none)
  }
}

/**
 * Whether a missing prover fails the run rather than skipping it: on CI, and
 * wherever `VECTOR_PROVER_REQUIRED=1` asks for it.
 */
const panicsProverRequired = (ci: string, required: string): boolean => ci === "true" || required === "1"

/** The names of the functions a `--emit-panics` report lists in `module`. */
const panicsFunctions = (text: string, module: string): Result<string[], string> => {
  const doc = newJsonDocument()
  const root = parseJson(doc, text, "the panic report").orReturn()
  const fns = jsonMember(doc, root, "functions", JSON_VALUE_ARRAY).orReturn()
  const out: string[] = []
  for (let i = 0; i < doc.length(fns); i++) {
    const f = doc.at(fns, i)
    if (jsonStringMember(doc, f, "module").orReturn() === module) {
      out.push(jsonStringMember(doc, f, "name").orReturn())
    }
  }
  return Ok(out)
}

/**
 * `P-WRAP`'s conjuncts are `stub(v) op k == w`, with `v op k` past its type's
 * range. The sampler evaluates `v op k` (the stub returns its argument) at
 * the clause's one sample, and the row holds when that equals `w`: so `w` is
 * the sampler's wrapped value. The emitted program then runs under the pinned
 * compiler and passes `P-WRAP`: so the emitted arithmetic computes it too.
 */
const panicsWrapRows = (t: Suite, dir: string): void => {
  const text = readFileSyncOrNull(CONTRACT)
  if (text === null) {
    t.ok("the fixture contract reads", false)
    return
  }
  const c = contractParse(text, CONTRACT)
  t.ok("the fixture contract parses", c.isOk())
  if (!c.isOk()) {
    return
  }
  let k = -1
  for (let i = 0; i < c.value.clauses.length; i++) {
    if (c.value.clauses[i].id === "P-WRAP") {
      k = i
    }
  }
  t.ok("the fixture has P-WRAP", k >= 0)
  if (k < 0) {
    return
  }
  const clause = c.value.clauses[k]
  const env = new Map<string, SampleValue>()
  for (const v of clause.forall) {
    const n = sampleParseInt(v.min)
    t.ok(`P-WRAP's ${v.name} is one value`, n.isOk() && v.min === v.max)
    env.set(v.name, sampleInt(n.isOk() ? n.value : toI64(0), v.type))
  }
  const all = clause.assert
  const none: Expr[] = []
  const conj = all !== null ? all.args : none
  t.eqStr("P-WRAP wraps + - * in i32 and i64", `${conj.length}`, "6")
  for (const eq of conj) {
    const lhs = eq.args[0]
    const at = lhs.args[0]
    const bare = new Expr(ExprKind.Op, lhs.name)
    bare.args = [at.args[0], lhs.args[1]]
    const got = sampleEval(bare, env)
    const want = sampleEval(eq.args[1], env)
    const what = `P-WRAP ${at.name}(${at.args[0].name}) ${lhs.name}`
    t.ok(`${what}: the sampler evaluates both sides`, got.isOk() && want.isOk())
    if (got.isOk() && want.isOk()) {
      t.eqStr(`${what}: the sampler's wrapped value is the clause's`, `${got.value.n}`, `${want.value.n}`)
    }
  }
  const file = `${dir}/wrap.ts`
  const emitted =
    vectorRun(["spec", "emit", CONTRACT, "--package", "panics=tests/fixtures/emit-panics", "-o", file]) === 0
  t.ok("wrap: the fixture emits", emitted)
  if (!emitted) {
    return
  }
  const run = runProcess([NISH, "run", file], "", 600000).expect("run the pinned compiler")
  t.eqStr("wrap: the emitted test exits 0 under the pinned compiler", `${run.status}`, "0")
  t.ok("wrap: the emitted value is the sampler's (P-WRAP passes)", run.stdout.indexOf("PASS  [P-WRAP]") >= 0)
}

/** The `file:line:col: error:` lines of a refused build, each cut to its kind. */
const panicsErrors = (stderr: string): string => {
  const out: string[] = []
  for (const line of splitLines(stderr)) {
    const at = line.indexOf(": error: ")
    if (at > 0) {
      const tail = line.substring(at + 9, line.length)
      const cut = tail.indexOf(" here")
      out.push(`${line.substring(0, at)} ${cut > 0 ? tail.substring(0, cut) : tail}`)
    }
  }
  return out.join("\n")
}

/**
 * The sites of a `--emit-panics` report that the emitted test may not keep,
 * each as `module:line:col kind function` (and `-> callee` for a call).
 *
 * Only sites in `testModule` count: the module under test and std are not
 * the emitter's. There a site passes when it is out of memory, proven, or a
 * call whose callee is defined in a module ending in `underTest`.
 */
const panicsRefused = (text: string, testModule: string, underTest: string): Result<string[], string> => {
  const doc = newJsonDocument()
  const root = parseJson(doc, text, "the panic report").orReturn()
  const fns = jsonMember(doc, root, "functions", JSON_VALUE_ARRAY).orReturn()
  // Where each function is defined, to place a call's callee.
  const names: string[] = []
  const modules: string[] = []
  for (let i = 0; i < doc.length(fns); i++) {
    const f = doc.at(fns, i)
    names.push(jsonStringMember(doc, f, "name").orReturn())
    modules.push(jsonStringMember(doc, f, "module").orReturn())
  }
  const out: string[] = []
  for (let i = 0; i < doc.length(fns); i++) {
    const f = doc.at(fns, i)
    const module = jsonStringMember(doc, f, "module").orReturn()
    if (module !== testModule) {
      continue
    }
    const name = jsonStringMember(doc, f, "name").orReturn()
    const sites = jsonMember(doc, f, "panics", JSON_VALUE_ARRAY).orReturn()
    for (let j = 0; j < doc.length(sites); j++) {
      const p = doc.at(sites, j)
      const kind = jsonStringMember(doc, p, "kind").orReturn()
      const proven = jsonMember(doc, p, "proven", JSON_VALUE_BOOLEAN)
      if (kind === "oom" || (proven.isOk() && doc.boolean(proven.value))) {
        continue
      }
      const at = `${module}:${jsonIntMember(doc, p, "line").orReturn()}:${jsonIntMember(doc, p, "column").orReturn()}`
      if (kind === "call") {
        const callee = jsonMember(doc, p, "callee", JSON_VALUE_STRING)
        const who = callee.isOk() ? doc.string(callee.value) : "?"
        const k = names.indexOf(who)
        const home = k >= 0 && k < modules.length ? modules[k] : ""
        if (home === underTest || home.endsWith(`/${underTest}`)) {
          continue
        }
        out.push(`${at} call ${name} -> ${who}`)
      } else {
        out.push(`${at} ${kind} ${name}`)
      }
    }
  }
  return Ok(out)
}

/** A one-function report: `fn` in `module`, with `sites` as its panics, beside the module under test's `stubBytes` and a helper. */
const panicsReport = (module: string, sites: string): string => {
  const f = `{"name":"f","symbol":"f","module":"${module}","line":1,"panics":[${sites}]}`
  const helper =
    '{"name":"hexOf","symbol":"hexOf","module":"/s/t.ts","line":9,"panics":[{"kind":"oom","line":9,"column":2,"allowed":true}]}'
  const stub = `{"name":"stubBytes","symbol":"stubBytes","module":"/r/${UNDER_TEST}","line":3,"panics":[{"kind":"index","line":4,"column":5,"proven":false}]}`
  const lookalike = `{"name":"lookalike","symbol":"lookalike","module":"/r/x${UNDER_TEST}","line":3,"panics":[]}`
  return `{"functions":[${f},${helper},${stub},${lookalike}]}`
}

/** Checks the classifier on hand-written reports, one row a kind of site. */
const panicsClassifierRows = (t: Suite): void => {
  // [what, the function's module, its sites, the sites refused]
  const rows: string[][] = [
    ["out of memory passes", "/s/t.ts", `{"kind":"oom","line":2,"column":3,"allowed":true}`, ""],
    ["a proven index passes", "/s/t.ts", `{"kind":"index","line":2,"column":3,"proven":true}`, ""],
    [
      "an unproven index is refused",
      "/s/t.ts",
      `{"kind":"index","line":2,"column":3,"proven":false}`,
      "/s/t.ts:2:3 index f",
    ],
    [
      "an unproven overflow is refused",
      "/s/t.ts",
      `{"kind":"overflow","line":5,"column":7,"proven":false}`,
      "/s/t.ts:5:7 overflow f",
    ],
    [
      "a call into the module under test passes",
      "/s/t.ts",
      `{"kind":"call","line":2,"column":3,"callee":"stubBytes","via":"index"}`,
      "",
    ],
    [
      "a call into a helper is refused",
      "/s/t.ts",
      `{"kind":"call","line":2,"column":3,"callee":"hexOf","via":"oom"}`,
      "/s/t.ts:2:3 call f -> hexOf",
    ],
    [
      "a call to an unknown function is refused",
      "/s/t.ts",
      `{"kind":"call","line":2,"column":3,"callee":"nope","via":"index"}`,
      "/s/t.ts:2:3 call f -> nope",
    ],
    [
      "a site without a proven flag is refused",
      "/s/t.ts",
      `{"kind":"index","line":2,"column":3}`,
      "/s/t.ts:2:3 index f",
    ],
    [
      "an allowed site that is not out of memory is refused",
      "/s/t.ts",
      `{"kind":"index","line":2,"column":3,"allowed":true}`,
      "/s/t.ts:2:3 index f",
    ],
    ["out of memory passes unproven", "/s/t.ts", `{"kind":"oom","line":2,"column":3,"proven":false}`, ""],
    [
      "a call into a module only named like the module under test is refused",
      "/s/t.ts",
      `{"kind":"call","line":2,"column":3,"callee":"lookalike","via":"index"}`,
      "/s/t.ts:2:3 call f -> lookalike",
    ],
    [
      "a call without a callee is refused",
      "/s/t.ts",
      `{"kind":"call","line":2,"column":3,"via":"index"}`,
      "/s/t.ts:2:3 call f -> ?",
    ],
    [
      "a site in another module is not the emitter's",
      "/r/other.ts",
      `{"kind":"index","line":2,"column":3,"proven":false}`,
      "",
    ],
  ]
  for (const r of rows) {
    const got = panicsRefused(panicsReport(r[1], r[2]), "/s/t.ts", UNDER_TEST)
    t.ok(`${r[0]}: the report reads`, got.isOk())
    if (got.isOk()) {
      t.eqStr(r[0], got.value.join("\n"), r[3])
    }
  }
  const rq: string[][] = [
    ["", "", "no"],
    ["true", "", "yes"],
    ["false", "", "no"],
    ["1", "", "no"],
    ["", "1", "yes"],
    ["", "0", "no"],
    ["", "true", "no"],
    ["true", "0", "yes"],
  ]
  for (const r of rq) {
    t.eqStr(
      `CI=${r[0]} VECTOR_PROVER_REQUIRED=${r[1]} requires the prover`,
      panicsProverRequired(r[0], r[1]) ? "yes" : "no",
      r[2],
    )
  }
  t.ok("a report without functions is an error", !panicsRefused("{}", "/s/t.ts", UNDER_TEST).isOk())
}
