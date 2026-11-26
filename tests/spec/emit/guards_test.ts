import { Suite } from "nish/testing"
import { Sample, SampleTable, checkAddSample } from "../../../src/spec/check"
import { contractLoadFile } from "../../../src/spec/contract/contract"
import { Clause, Contract, Expr, ExprKind, LitKind, Literal } from "../../../src/spec/contract/types"
import { EmitOptions, emitProgram } from "../../../src/spec/emit/emit"
import { emitGoProgram } from "../../../src/spec/emit/go"
import { emitCommentText, emitLiteralHex, emitQuote } from "../../../src/spec/emit/lit"
import { EmitPackages, emitModuleFile, emitPackageFlags, emitParsePackages } from "../../../src/spec/emit/packages"
import { emitPyProgram } from "../../../src/spec/emit/python"
import { emitRsProgram } from "../../../src/spec/emit/rust"
import { EmitTarget, emitTargetFlags, emitTargetParse } from "../../../src/spec/emit/target"
import { emitTsProgram } from "../../../src/spec/emit/typescript"

const GUARDS_FORMS: string = "tests/spec/emit/fixtures/forms.json"
/** Every language vector emits. */
const guardsLangs = (): string[] => ["nish", "go", "rust", "python", "typescript"]

/** The emitted program in `lang`, or its errors joined by `|` behind `ERR `. */
const guardsEmit = (lang: string, c: Contract, table: SampleTable, opts: EmitOptions): string => {
  const r =
    lang === "nish"
      ? emitProgram(c, table, opts)
      : lang === "go"
        ? emitGoProgram(c, table, opts, "standalone")
        : lang === "rust"
          ? emitRsProgram(c, table, opts, "standalone")
          : lang === "python"
            ? emitPyProgram(c, table, opts, "standalone")
            : emitTsProgram(c, table, opts, "standalone")
  return r.isOk() ? r.value : `ERR ${r.error.join("|")}`
}

/** The forms contract cut to the one clause `id`, or null when it has none. */
const guardsOnly = (id: string): Contract | null => {
  const c = contractLoadFile(GUARDS_FORMS).expect("load the forms contract")
  const keep: Clause[] = []
  for (const k of c.clauses) {
    if (k.id === id) {
      keep.push(k)
    }
  }
  if (keep.length === 0) {
    return null
  }
  c.clauses = keep
  return c
}

const guardsInt = (n: string): Literal => new Literal(LitKind.Int, n)

/** A table of P-WRAP samples, each with `n` values. */
const guardsWrapTable = (n: i32): SampleTable => {
  const t = new SampleTable()
  const args: Literal[] = []
  for (let i = 0; i < n; i++) {
    args.push(guardsInt("1"))
  }
  checkAddSample(t, new Sample("P-WRAP", args, "by hand"))
  return t
}

/** Every language emits `c`, or refuses it with exactly `want`. */
const guardsEvery = (t: Suite, what: string, c: Contract | null, table: SampleTable, want: string | null): void => {
  guardsIn(t, guardsLangs(), what, c, table, want)
}

/** Each of `langs` emits `c`, or refuses it with exactly `want`. */
const guardsIn = (
  t: Suite,
  langs: string[],
  what: string,
  c: Contract | null,
  table: SampleTable,
  want: string | null,
): void => {
  if (c === null) {
    t.fail(what, "no such clause")
    return
  }
  for (const lang of langs) {
    const got = guardsEmit(lang, c, table, new EmitOptions("ab"))
    if (want === null) {
      t.ok(`${what} (${lang}) emits`, !got.startsWith("ERR "))
    } else {
      t.eqStr(`${what} (${lang})`, got, `ERR ${want}`)
    }
  }
}

/**
 * The languages that index a vector's arguments, or an iterate's lists, by
 * the function's parameters; Python's and TypeScript's iterate, and Python's
 * vector, walk the lists themselves and index nothing.
 */
const guardsIndexing = (iterate: boolean): string[] =>
  iterate ? ["nish", "go", "rust"] : ["nish", "go", "rust", "typescript"]

/** A vector's and a call's argument count against the function's. */
const guardsArity = (t: Suite): void => {
  const t0 = new SampleTable()
  guardsEvery(t, "V-I64-MIN as written", guardsOnly("V-I64-MIN"), t0, null)
  const short = guardsOnly("V-I64-MIN")
  if (short !== null) {
    short.clauses[0].args.pop()
  }
  guardsIn(
    t,
    guardsIndexing(false),
    "a vector one argument short",
    short,
    t0,
    "V-I64-MIN: addI64 takes 2 arguments, got 1",
  )
  const long = guardsOnly("V-I64-MIN")
  if (long !== null) {
    long.clauses[0].args.push(guardsInt("1"))
  }
  guardsIn(
    t,
    guardsIndexing(false),
    "a vector one argument over",
    long,
    t0,
    "V-I64-MIN: addI64 takes 2 arguments, got 3",
  )
  const table = guardsWrapTable(2)
  guardsEvery(t, "P-WRAP as written", guardsOnly("P-WRAP"), table, null)
  // P-WRAP asserts addI64(a, b) == a + b: drop the call's b, then the =='s right side.
  const call = guardsOnly("P-WRAP")
  if (call !== null) {
    const a = call.clauses[0].assert
    if (a !== null) {
      a.args[0].args.pop()
    }
  }
  guardsEvery(t, "a call one argument short", call, table, "addI64 takes 2 arguments, got 1")
  const op = guardsOnly("P-WRAP")
  if (op !== null) {
    const a = op.clauses[0].assert
    if (a !== null) {
      a.args.pop()
    }
  }
  guardsEvery(t, "an op one argument short", op, table, "== has no argument 1")
}

/** An iterate's names, next and the function's parameters, which must agree. */
const guardsIterate = (t: Suite): void => {
  const t0 = new SampleTable()
  guardsEvery(t, "IT-FIB as written", guardsOnly("IT-FIB"), t0, null)
  const names = guardsOnly("IT-FIB")
  if (names !== null) {
    const it = names.clauses[0].iterate
    if (it !== null) {
      it.names.pop()
    }
  }
  guardsIn(
    t,
    guardsIndexing(true),
    "an iterate one name short",
    names,
    t0,
    "IT-FIB: the iterate has 1 names and 2 next for 2 parameters",
  )
  const next = guardsOnly("IT-FIB")
  if (next !== null) {
    const it = next.clauses[0].iterate
    if (it !== null) {
      it.next.push(new Expr(ExprKind.Var, "a"))
    }
  }
  guardsIn(
    t,
    guardsIndexing(true),
    "an iterate one next over",
    next,
    t0,
    "IT-FIB: the iterate has 2 names and 3 next for 2 parameters",
  )
}

/** A sample with a value for every forall variable, and one short of them. */
const guardsSamples = (t: Suite): void => {
  guardsEvery(t, "a sample one value short", guardsOnly("P-WRAP"), guardsWrapTable(1), "a sample has no value for b")
  guardsEvery(
    t,
    "a sample with no values",
    guardsOnly("P-WRAP"),
    guardsWrapTable(0),
    "a sample has no value for a|a sample has no value for b",
  )
}

/** One import path per local module, in every language that imports them (Go imports by package path). */
const guardsLocal = (t: Suite): void => {
  const c = guardsOnly("V-I64-MIN")
  if (c === null) {
    t.fail("local modules", "no V-I64-MIN")
    return
  }
  for (const lang of ["nish", "rust", "python", "typescript"]) {
    const more = new EmitOptions("ab")
    more.localModules.push("acme/x")
    t.eqStr(
      `a module with no path (${lang})`,
      guardsEmit(lang, c, new SampleTable(), more),
      "ERR 1 local modules but 0 import paths",
    )
    const fewer = new EmitOptions("ab")
    fewer.localImports.push("./x")
    t.eqStr(
      `a path with no module (${lang})`,
      guardsEmit(lang, c, new SampleTable(), fewer),
      "ERR 0 local modules but 1 import paths",
    )
    const both = new EmitOptions("ab")
    both.localModules.push("acme/x")
    both.localImports.push("./x")
    t.ok(`a module and its path (${lang})`, !guardsEmit(lang, c, new SampleTable(), both).startsWith("ERR "))
  }
}

/** Quoting and comment text, stepped a code point at a time. */
const guardsLit = (t: Suite): void => {
  t.eqStr("quote: empty", emitQuote(""), '""')
  t.eqStr("quote: escapes", emitQuote('a"\\\n\t\r'), '"a\\"\\\\\\n\\t\\r"')
  t.eqStr("quote: 0x01", emitQuote("\u0001"), '"\\u0001"')
  t.eqStr("quote: 0x1f, the last control", emitQuote("\u001f"), '"\\u001f"')
  t.eqStr("quote: a space is as written", emitQuote(" "), '" "')
  t.eqStr("quote: 0x7e is as written", emitQuote("~"), '"~"')
  t.eqStr("quote: 0x7f", emitQuote("\u007f"), '"\\u007f"')
  t.eqStr("quote: two to four bytes as written", emitQuote('é€😀"'), '"é€😀\\""')
  t.eqStr("comment: */ is broken", emitCommentText("a*/b"), "a* /b")
  t.eqStr("comment: **/ too", emitCommentText("**/"), "** /")
  t.eqStr("comment: a leading / is kept", emitCommentText("/a"), "/a")
  t.eqStr("comment: / after another character is kept", emitCommentText("a/"), "a/")
  t.eqStr("comment: / after four bytes is kept", emitCommentText("😀/"), "😀/")
  t.eqStr("comment: * after four bytes still counts", emitCommentText("😀*/"), "😀* /")
  t.eqStr("comment: control characters are spaces", emitCommentText("a\u0001\nb"), "a  b")
  t.eqStr("comment: a two-byte character between * and /", emitCommentText("*é/"), "*é/")
  t.eqStr("hex: upper case is lowered", emitLiteralHex(new Literal(LitKind.Hex, "0AfF9")), "0aff9")
  t.eqStr("hex: A and F, the edges", emitLiteralHex(new Literal(LitKind.Hex, "AF")), "af")
}

/** `--package` flags, their path parts, and where a module lands. */
const guardsPackages = (t: Suite): void => {
  const refused = ["a=", "=b", "=", "", "a", "a//b=d", "a/.=d", "./a=d", "a/=d", "/a=d", "a/..=d", "a\\b=d"]
  for (const f of refused) {
    t.ok(`--package ${f} is refused`, emitParsePackages([f], "go").isErr())
  }
  const ok = emitParsePackages(["a=b", "c==d", "x/y=z/w"], "go")
  t.ok("a=b, c==d and x/y=z/w are read", ok.isOk())
  if (ok.isOk()) {
    const m = ok.value
    t.eqStr("each name", m.names.join(","), "a,c,x/y")
    t.eqStr("each dir, after the first =", m.dirs.join(","), "b,=d,z/w")
    t.eqStr("the flags again", emitPackageFlags(m), " --package a=b --package c==d --package x/y=z/w")
  }
  const m = new EmitPackages()
  m.names.push("acme")
  m.dirs.push("lib")
  m.names.push("acme/util")
  m.dirs.push("u")
  t.eqStr("the longest name wins", emitModuleFile(m, "acme/util/hex", ".go") ?? "null", "u/hex.go")
  t.eqStr("whatever order it came in", emitModuleFile(m, "acme/x", ".go") ?? "null", "lib/x.go")
  t.eqStr("a name must end at a /", emitModuleFile(m, "acmex/y", ".go") ?? "null", "null")
  t.eqStr("the name alone is no module", emitModuleFile(m, "acme/", ".go") ?? "null", "null")
  t.eqStr("a rest with ..", emitModuleFile(m, "acme/../y", ".go") ?? "null", "null")
  const hand = new EmitPackages()
  hand.names.push("acme")
  t.eqStr("a name with no dir maps nothing", emitModuleFile(hand, "acme/x", ".go") ?? "null", "null")
  t.eqStr("nor gives a flag", emitPackageFlags(hand), "")
}

/** `--lang` and `--harness`, and the flags that rebuild them. */
const guardsTarget = (t: Suite): void => {
  const d = emitTargetParse(null, null)
  t.ok("no flags read", d.isOk())
  if (d.isOk()) {
    t.eqStr("default: nish standalone", `${d.value.lang} ${d.value.harness}`, "nish standalone")
    t.eqStr("which needs no flag", emitTargetFlags(d.value), "")
  }
  const go = emitTargetParse("go", null)
  if (go.isOk()) {
    t.eqStr("go's default harness", go.value.harness, "standalone")
  } else {
    t.fail("go's default harness", go.error)
  }
  const gt = emitTargetParse("go", "gotest")
  if (gt.isOk()) {
    t.eqStr("a named harness", emitTargetFlags(gt.value), " --lang go --harness gotest")
  } else {
    t.fail("a named harness", gt.error)
  }
  t.ok("a harness of another language", emitTargetParse("go", "pytest").isErr())
  t.ok("no such language", emitTargetParse("cobol", null).isErr())
  t.eqStr(
    "a target built by hand",
    emitTargetFlags(new EmitTarget("cobol", "standalone")),
    " --lang cobol --harness standalone",
  )
}

/**
 * Checks the guards that keep the emitters panic-free on a contract no
 * checker passed: an argument count off by one either way, an iterate whose
 * lists disagree, a sample short of values, and local modules without their
 * paths, each refused in every language; and the text, package and target
 * helpers at their edges.
 */
export const main = (): i32 => {
  const t = new Suite("spec/emit guards")
  guardsArity(t)
  guardsIterate(t)
  guardsSamples(t)
  guardsLocal(t)
  guardsLit(t)
  guardsPackages(t)
  guardsTarget(t)
  return t.done()
}
