import { Suite } from "nish/testing"
import { CheckContext } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { Clause, Contract } from "../../../src/spec/contract/types"
import { gateDerivedResult } from "../../../src/spec/gates/derive"
import { gateProvenance } from "../../../src/spec/gates/provenance"
import { LoadedSource, SourceSet } from "../../../src/spec/source/load"
import { rfcParse } from "../../../src/spec/source/rfc"

/** A vector of verify, its inputs cited to section 7 and its result to section 5. */
const deriveTestVerify = (id: string, covers: string, pk: string, msg: string, sig: string, want: string): string =>
  `{"kind": "vector", "id": "${id}", "title": "t", "covers": [${covers}], "source": {"spec": "5"}, "section": "7",
    "call": "verify", "args": [{"hex": "${pk}"}, {"hex": "${msg}"}, {"hex": "${sig}"}], "expect": {"bool": ${want}}}`

/** A vector cited to section 7, its expected value printed there. */
const deriveTestCited = (id: string, call: string, args: string, want: string): string =>
  `{"kind": "vector", "id": "${id}", "title": "t", "covers": ["R7"], "source": {"cite": {"source": "rfc9999", "section": "7"}},
    "call": "${call}", "args": [${args}], "expect": {"hex": "${want}"}}`

/**
 * A signature-shaped contract: a round-trip property over a message of 0..1
 * bytes, with `where` as its where clause ("" for none), and `vectors`.
 */
const deriveTestContract = (where: string, vectors: string): string => `{
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
    {"name": "flip", "params": [{"name": "sig", "type": "bytes"}, {"name": "bit", "type": "i32"}], "returns": "bytes"},
    {"name": "verify", "params": [{"name": "pk", "type": "bytes"}, {"name": "msg", "type": "bytes"},
      {"name": "sig", "type": "bytes"}], "returns": "bool"}
  ],
  "clauses": [
    {"kind": "property", "id": "P-RT", "title": "t", "covers": ["R5"],
     "forall": [{"name": "seed", "type": "bytes", "minLen": 1, "maxLen": 1}, {"name": "msg", "type": "bytes", "minLen": 0, "maxLen": 1}],
     ${where}
     "assert": {"op": "==", "args": [{"call": "verify", "args": [{"op": "unwrap", "args": [{"call": "pk", "args": [{"var": "seed"}]}]},
       {"var": "msg"}, {"op": "unwrap", "args": [{"call": "sign", "args": [{"var": "seed"}, {"var": "msg"}]}]}]}, {"bool": true}]}},
    {"kind": "property", "id": "P-FLIP", "title": "t", "covers": ["R5"],
     "forall": [{"name": "seed", "type": "bytes", "minLen": 1, "maxLen": 1}, {"name": "msg", "type": "bytes", "minLen": 0, "maxLen": 1},
       {"name": "bit", "type": "i32", "min": 0, "max": 7}],
     "assert": {"op": "==", "args": [{"call": "verify", "args": [{"op": "unwrap", "args": [{"call": "pk", "args": [{"var": "seed"}]}]},
       {"var": "msg"}, {"call": "flip", "args": [{"op": "unwrap", "args": [{"call": "sign", "args": [{"var": "seed"}, {"var": "msg"}]}]},
       {"var": "bit"}]}]}, {"bool": false}]}},
    ${deriveTestCited("K1", "pk", `{"hex": "01"}`, "aa")},
    ${deriveTestCited("S1", "sign", `{"hex": "01"}, {"hex": "02"}`, "bb")},
    ${deriveTestCited("S2", "sign", `{"hex": "01"}, {"hex": "0203"}`, "dd")},
    ${vectors}
  ]
}`

/** The RFC the contract cites: section 5 says nothing of true or false. */
const DERIVE_TEST_RFC: string = `Request for Comments: 9999

5.  Verify

   It MUST check the signature.

7.  Vectors

   It MUST print the vectors.
`

/** A context over a contract, with the RFC as its main source. */
const deriveTestCtx = (json: string): CheckContext => {
  const ctx = new CheckContext("contracts/c1.json", ".")
  ctx.contract = contractParse(json, "c1").expect("parse ctx")
  const set = new SourceSet()
  set.main = "rfc9999"
  set.sources.push(new LoadedSource("rfc9999", "r.txt", "r.txt", rfcParse(DERIVE_TEST_RFC)))
  ctx.sources = set
  return ctx
}

/** The clause of a contract with an id; the test fails loudly when there is none. */
const deriveTestClause = (c: Contract, id: string): Clause => {
  for (const k of c.clauses) {
    if (k.id === id) {
      return k
    }
  }
  return c.clauses[0]
}

/** What gateDerivedResult says of one vector, under a where clause. */
const deriveTestWhy = (where: string, vector: string, id: string, reqs: string[]): string => {
  const r = contractParse(deriveTestContract(where, vector), "c1")
  if (r.isErr()) {
    return `unparsed: ${r.error.join("; ")}`
  }
  const c = r.value
  const why = gateDerivedResult(c.clauses, reqs, deriveTestClause(c, id))
  return why === null ? "" : why
}

/** One row of the table: a vector, and what the derived rule says of it ("" when it derives). */
class DeriveTestCase {
  /** The case's name. */
  name: string
  /** The vector's JSON. */
  vector: string
  /** The where clause's JSON, "" for none. */
  where: string
  /** The expected reasons, "" when the property derives the result. */
  want: string
  /**
   * A case.
   *
   * @param name the case's name
   * @param where the where clause's JSON
   * @param vector the vector's JSON
   * @param want the expected reasons
   */
  constructor(name: string, where: string, vector: string, want: string) {
    this.name = name
    this.where = where
    this.vector = vector
    this.want = want
  }
}

/** The derived rule, case by case. */
const deriveTestCases = (): DeriveTestCase[] => {
  const ok = `"covers": ["R5"]`
  const shared = `"R5"`
  return [
    new DeriveTestCase("derives true", "", deriveTestVerify("V", shared, "aa", "02", "bb", "true"), ""),
    new DeriveTestCase(
      "the other result",
      "",
      deriveTestVerify("V", shared, "aa", "02", "bb", "false"),
      "P-RT asserts another result than the vector's; P-FLIP calls flip for a value no cited vector of flip expects with matching arguments",
    ),
    new DeriveTestCase(
      "a key no vector expects",
      "",
      deriveTestVerify("V", shared, "cc", "02", "bb", "true"),
      "P-RT calls pk for a value no cited vector of pk expects with matching arguments; P-FLIP asserts another result than the vector's",
    ),
    new DeriveTestCase(
      "a message outside the domain",
      "",
      deriveTestVerify("V", shared, "aa", "0203", "dd", "true"),
      "P-RT binds msg to a 2-byte value, outside its domain 0..1; P-FLIP asserts another result than the vector's",
    ),
    new DeriveTestCase(
      "a message the signature is not of",
      "",
      deriveTestVerify("V", shared, "aa", "03", "bb", "true"),
      "P-RT calls sign for a value no cited vector of sign expects with matching arguments; P-FLIP asserts another result than the vector's",
    ),
    new DeriveTestCase(
      "a where that holds",
      `"where": {"op": "==", "args": [{"op": "len", "args": [{"var": "msg"}]}, {"int": 1}]},`,
      deriveTestVerify("V", shared, "aa", "02", "bb", "true"),
      "",
    ),
    new DeriveTestCase(
      "a where that does not hold",
      `"where": {"op": "==", "args": [{"op": "len", "args": [{"var": "msg"}]}, {"int": 0}]},`,
      deriveTestVerify("V", shared, "aa", "02", "bb", "true"),
      "P-RT's where does not hold for the vector's inputs; P-FLIP asserts another result than the vector's",
    ),
    new DeriveTestCase(
      "no shared requirement",
      "",
      deriveTestVerify("V", `"R7"`, "aa", "02", "bb", "true"),
      "no property covers a requirement of the result's section that V covers",
    ),
    new DeriveTestCase(
      "not a null or a bool",
      "",
      `{"kind": "vector", "id": "V", "title": "t", ${ok}, "source": {"spec": "5"}, "section": "7",
        "call": "pk", "args": [{"hex": "01"}], "expect": {"hex": "aa"}}`,
      "V expects neither null, true nor false",
    ),
  ]
}

/** The derived rule, alone and through the provenance gate. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/derive")
  for (const c of deriveTestCases()) {
    t.eqStr(c.name, deriveTestWhy(c.where, c.vector, "V", ["R5"]), c.want)
  }
  t.eqStr(
    "only the result's section's requirements",
    deriveTestWhy("", deriveTestVerify("V", `"R5"`, "aa", "02", "bb", "true"), "V", ["R7"]),
    "no property covers a requirement of the result's section that V covers",
  )
  const good = gateProvenance(
    deriveTestCtx(deriveTestContract("", deriveTestVerify("V", `"R5"`, "aa", "02", "bb", "true"))),
  )
  t.eqStr("the gate passes a derived result", good.join("\n"), "")
  const bad = gateProvenance(
    deriveTestCtx(deriveTestContract("", deriveTestVerify("V", `"R5"`, "aa", "03", "bb", "true"))),
  )
  t.ok(
    "the gate refuses an underived result",
    bad.length === 1 &&
      bad[0].indexOf(`V.source: RFC §5 ("Verify") does not state the expected result: R5 `) === 0 &&
      bad[0].indexOf("; and no property derives it: P-RT calls sign for a value") > 0,
  )
  if (bad.length !== 1) {
    console.log(bad.join("\n"))
  }
  const alone = deriveTestContract(
    "",
    `{"kind": "vector", "id": "V", "title": "t", "covers": ["R5"], "source": {"spec": "5"},
      "call": "verify", "args": [{"hex": "aa"}, {"hex": "02"}, {"hex": "bb"}], "expect": {"bool": true}}`,
  )
  const one = gateProvenance(deriveTestCtx(alone))
  t.ok(
    "a vector citing one section is not derived",
    one.length === 1 && one[0].indexOf("no property derives it") < 0 && one[0].indexOf("V.source: RFC §5") === 0,
  )
  return t.done()
}
