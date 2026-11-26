import { Suite } from "nish/testing"
import { CheckContext, CheckNote } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { Clause, Contract } from "../../../src/spec/contract/types"
import { gateCoverage } from "../../../src/spec/gates/coverage"
import { gateDerivedResult } from "../../../src/spec/gates/derive"
import { gateWarnings } from "../../../src/spec/gates/note"

// The guards that prove src/spec/gates cannot panic, driven through the
// gates on the inputs where each one decides.

/** A vector of `call` cited to section 7, its expected value printed there. */
const noPanicCited = (id: string, call: string, args: string, want: string): string =>
  `{"kind": "vector", "id": "${id}", "title": "t", "covers": ["R7"], "source": {"cite": {"source": "rfc9999", "section": "7"}},
    "call": "${call}", "args": [${args}], "expect": {"hex": "${want}"}}`

/** An equality. */
const noPanicEq = (l: string, r: string): string => `{"op": "==", "args": [${l}, ${r}]}`

/** verify(unwrap(pk(seed)), msg, `sig`). */
const noPanicVerify = (sig: string): string =>
  `{"call": "verify", "args": [{"op": "unwrap", "args": [{"call": "pk", "args": [{"var": "seed"}]}]}, {"var": "msg"}, ${sig}]}`

/** unwrap(sign(seed, msg)). */
const NO_PANIC_SIGN: string = `{"op": "unwrap", "args": [{"call": "sign", "args": [{"var": "seed"}, {"var": "msg"}]}]}`

/** The variables seed (1 byte) and msg (0..1 bytes), then `more` (from ", "). */
const noPanicForall = (more: string): string =>
  `[{"name": "seed", "type": "bytes", "minLen": 1, "maxLen": 1}, {"name": "msg", "type": "bytes", "minLen": 0, "maxLen": 1}${more}]`

/** The round trip P-RT and the tamper property P-FLIP, its bit an int `bit` (the fields after the name). */
const noPanicProps = (bit: string): string =>
  `{"kind": "property", "id": "P-RT", "title": "t", "covers": ["R5"], "forall": ${noPanicForall("")},
    "assert": ${noPanicEq(noPanicVerify(NO_PANIC_SIGN), `{"bool": true}`)}},
  {"kind": "property", "id": "P-FLIP", "title": "t", "covers": ["R5"], "forall": ${noPanicForall(`, {"name": "bit", ${bit}}`)},
    "assert": ${noPanicEq(noPanicVerify(`{"call": "flip", "args": [${NO_PANIC_SIGN}, {"var": "bit"}]}`), `{"bool": false}`)}}`

/**
 * The contract over P-RT and P-FLIP (its bit typed `ty`, `bit` the domain's
 * fields), the siblings K1 pk(01) = aa, S1 sign(01, 02) = bb and
 * F1 flip(bb, `at`) = ee, and V: verify(aa, 02, ee) is false.
 */
const noPanicContract = (ty: string, bit: string, at: string): string =>
  noPanicWith(`${noPanicProps(`"type": "${ty}", ${bit}`)},`, ty, at)

/** The contract of noPanicContract, its properties `props` (each followed by a comma, or ""). */
const noPanicWith = (props: string, ty: string, at: string): string => `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/x"},
  "requirements": [
    {"id": "R5", "section": "5", "level": "MUST", "quote": "It MUST check the signature."},
    {"id": "R7", "section": "7", "level": "MUST", "quote": "It MUST print the vectors."}
  ],
  "functions": [
    {"name": "pk", "params": [{"name": "seed", "type": "bytes"}], "returns": "bytes?"},
    {"name": "sign", "params": [{"name": "seed", "type": "bytes"}, {"name": "msg", "type": "bytes"}], "returns": "bytes?"},
    {"name": "flip", "params": [{"name": "sig", "type": "bytes"}, {"name": "bit", "type": "${ty}"}], "returns": "bytes"},
    {"name": "verify", "params": [{"name": "pk", "type": "bytes"}, {"name": "msg", "type": "bytes"},
      {"name": "sig", "type": "bytes"}], "returns": "bool"}
  ],
  "clauses": [
    ${props}
    ${noPanicCited("K1", "pk", `{"hex": "01"}`, "aa")},
    ${noPanicCited("S1", "sign", `{"hex": "01"}, {"hex": "02"}`, "bb")},
    ${noPanicCited("F1", "flip", `{"hex": "bb"}, {"int": ${at}}`, "ee")},
    {"kind": "vector", "id": "V", "title": "t", "covers": ["R5"], "source": {"spec": "5"}, "section": "7",
      "call": "verify", "args": [{"hex": "aa"}, {"hex": "02"}, {"hex": "ee"}], "expect": {"bool": false}}
  ]
}`

/** The clause of a contract with an id, or its first clause when none has it. */
const noPanicClause = (c: Contract, id: string): Clause => {
  for (const k of c.clauses) {
    if (k.id === id) {
      return k
    }
  }
  return c.clauses[0]
}

/** What gateDerivedResult says of V when F1's bit is `at`, P-FLIP's of type `ty` over `bit`; "" when it derives. */
const noPanicDerive = (ty: string, bit: string, at: string): string => {
  const r = contractParse(noPanicContract(ty, bit, at), "c1")
  if (r.isErr()) {
    return `unparsed: ${r.error.join("; ")}`
  }
  const c = r.value
  const why = gateDerivedResult(c.clauses, ["R5"], noPanicClause(c, "V"))
  return why === null ? "" : why
}

/** The warnings gateCoverage records of a contract, one per line. */
const noPanicCoverageWarnings = (json: string): string => {
  const ctx = new CheckContext("contracts/c1.json", ".")
  const r = contractParse(json, "c1")
  if (r.isErr()) {
    return `unparsed: ${r.error.join("; ")}`
  }
  ctx.contract = r.value
  gateCoverage(ctx)
  return gateWarnings(ctx)
    .map((n: CheckNote): string => n.message)
    .join("\n")
}

/** What the derived rule says of V when P-FLIP's bit admits only F1's. */
const NO_PANIC_ONLY_BIT: string =
  "P-RT asserts another result than the vector's; P-FLIP admits only the vector's value for bit (its domain and where allow no other), so it restates the vector instead of deriving its result"

/** The guards that keep src/spec/gates from panicking, where each one decides. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/no-panic")
  // A tamper bit admits the neighbour below it, and the ends of an i64 have one neighbour.
  t.eqStr("only the neighbour below", noPanicDerive("i32", `"min": 2, "max": 3`, "3"), "")
  t.eqStr("only the neighbour above", noPanicDerive("i32", `"min": 3, "max": 4`, "3"), "")
  t.eqStr("no neighbour", noPanicDerive("i32", `"min": 3, "max": 3`, "3"), NO_PANIC_ONLY_BIT)
  const max = `"9223372036854775807"`
  const min = `"-9223372036854775808"`
  t.eqStr("the i64 maximum", noPanicDerive("i64", `"min": "9223372036854775806", "max": ${max}`, max), "")
  t.eqStr("the i64 maximum alone", noPanicDerive("i64", `"min": ${max}, "max": ${max}`, max), NO_PANIC_ONLY_BIT)
  t.eqStr("the i64 minimum", noPanicDerive("i64", `"min": ${min}, "max": "-9223372036854775807"`, min), "")
  t.eqStr("the i64 minimum alone", noPanicDerive("i64", `"min": ${min}, "max": ${min}`, min), NO_PANIC_ONLY_BIT)
  // A contract warns that it has no property only when none of its clauses is one.
  t.eqStr("a contract with properties", noPanicCoverageWarnings(noPanicContract("i32", `"min": 2, "max": 3`, "3")), "")
  t.eqStr(
    "a contract of vectors alone",
    noPanicCoverageWarnings(noPanicWith("", "i32", "3")),
    "no property clauses: the contract checks only the RFC's own vectors",
  )
  return t.done()
}
