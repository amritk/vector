import { Suite } from "nish/testing"
import { CheckContext } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { Clause, Contract, Expr, ExprKind, Requirement } from "../../../src/spec/contract/types"
import { gateDerivedResult } from "../../../src/spec/gates/derive"
import { gateProvenance, gateResultApart } from "../../../src/spec/gates/provenance"
import { LoadedSource, SourceSet } from "../../../src/spec/source/load"
import { rfcParse } from "../../../src/spec/source/rfc"

/** A vector cited to section 7, its expected value printed there. */
const deriveTestCited = (id: string, call: string, args: string, want: string): string =>
  `{"kind": "vector", "id": "${id}", "title": "t", "covers": ["R7"], "source": {"cite": {"source": "rfc9999", "section": "7"}},
    "call": "${call}", "args": [${args}], "expect": {"hex": "${want}"}}`

/** The public key of a seed, unwrapped. */
const DERIVE_TEST_PK: string = `{"op": "unwrap", "args": [{"call": "pk", "args": [{"var": "seed"}]}]}`

/** The signature of a message under a seed, unwrapped. */
const DERIVE_TEST_SIGN: string = `{"op": "unwrap", "args": [{"call": "sign", "args": [{"var": "seed"}, {"var": "msg"}]}]}`

/** The message variable. */
const DERIVE_TEST_MSG: string = `{"var": "msg"}`

/** A call of verify. */
const deriveTestCall = (pk: string, msg: string, sig: string): string =>
  `{"call": "verify", "args": [${pk}, ${msg}, ${sig}]}`

/** An equality. */
const deriveTestEq = (l: string, r: string): string => `{"op": "==", "args": [${l}, ${r}]}`

/** A property P covering R5, over a seed of 1 byte and a message of 0..1, `more` (from ", ") quantified too. */
const deriveTestProp = (more: string, assert: string): string =>
  `{"kind": "property", "id": "P", "title": "t", "covers": ["R5"],
    "forall": [{"name": "seed", "type": "bytes", "minLen": 1, "maxLen": 1}, {"name": "msg", "type": "bytes", "minLen": 0, "maxLen": 1}${more}],
    "assert": ${assert}}`

/** The round trip P-RT, with `where` as its where clause ("" for none, else ending in a comma). */
const deriveTestRt = (where: string): string =>
  `{"kind": "property", "id": "P-RT", "title": "t", "covers": ["R5"],
    "forall": [{"name": "seed", "type": "bytes", "minLen": 1, "maxLen": 1}, {"name": "msg", "type": "bytes", "minLen": 0, "maxLen": 1}],
    ${where}
    "assert": ${deriveTestEq(deriveTestCall(DERIVE_TEST_PK, DERIVE_TEST_MSG, DERIVE_TEST_SIGN), `{"bool": true}`)}}`

/** The tamper property P-FLIP, its bit declared by `bit` (the fields after the name). */
const deriveTestFlip = (bit: string): string =>
  `{"kind": "property", "id": "P-FLIP", "title": "t", "covers": ["R5"],
    "forall": [{"name": "seed", "type": "bytes", "minLen": 1, "maxLen": 1}, {"name": "msg", "type": "bytes", "minLen": 0, "maxLen": 1},
      {"name": "bit", ${bit}}],
    "assert": ${deriveTestEq(
      deriveTestCall(
        DERIVE_TEST_PK,
        DERIVE_TEST_MSG,
        `{"call": "flip", "args": [${DERIVE_TEST_SIGN}, {"var": "bit"}]}`,
      ),
      `{"bool": false}`,
    )}}`

/** P-FLIP's bit: an i32 of 0..7. */
const DERIVE_TEST_FLIP: string = `"type": "i32", "min": 0, "max": 7`

/**
 * A signature-shaped contract: `props`, the siblings K1 pk(01) = aa,
 * K2 pk(aa) = a2, K3 pk(a2) = a3, S1 sign(01, 02) = bb and
 * S2 sign(01, 0203) = dd, and `vectors`.
 */
const deriveTestBase = (props: string, vectors: string): string => `{
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
      {"name": "sig", "type": "bytes"}], "returns": "bool"},
    {"name": "look", "params": [{"name": "key", "type": "bytes"}], "returns": "bytes?"},
    {"name": "use", "params": [{"name": "v", "type": "bytes?"}], "returns": "bool"},
    {"name": "gate", "params": [{"name": "key", "type": "bytes"}, {"name": "b", "type": "bool"}], "returns": "bool"}
  ],
  "clauses": [
    ${props},
    ${deriveTestCited("K1", "pk", `{"hex": "01"}`, "aa")},
    ${deriveTestCited("K2", "pk", `{"hex": "aa"}`, "a2")},
    ${deriveTestCited("K3", "pk", `{"hex": "a2"}`, "a3")},
    ${deriveTestCited("S1", "sign", `{"hex": "01"}, {"hex": "02"}`, "bb")},
    ${deriveTestCited("S2", "sign", `{"hex": "01"}, {"hex": "0203"}`, "dd")},
    ${vectors}
  ]
}`

/** The contract over P-RT (under `where`) and P-FLIP, with `vectors`. */
const deriveTestContract = (where: string, vectors: string): string =>
  deriveTestBase(`${deriveTestRt(where)}, ${deriveTestFlip(DERIVE_TEST_FLIP)}`, vectors)

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

/** The clause of a contract with an id, or its first clause when none has it. */
const deriveTestClause = (c: Contract, id: string): Clause => {
  for (const k of c.clauses) {
    if (k.id === id) {
      return k
    }
  }
  return c.clauses[0]
}

/** What gateDerivedResult says of vector V, given `props` ("" for P-RT and P-FLIP) and `vectors`. */
const deriveTestWhy = (props: string, vectors: string, reqs: string[]): string => {
  const json = props.length === 0 ? deriveTestContract("", vectors) : deriveTestBase(props, vectors)
  const r = contractParse(json, "c1")
  if (r.isErr()) {
    return `unparsed: ${r.error.join("; ")}`
  }
  const c = r.value
  const why = gateDerivedResult(c.clauses, reqs, deriveTestClause(c, "V"))
  return why === null ? "" : why
}

/** One row of the table: the properties and vectors, and what the derived rule says of V ("" when it derives). */
class DeriveTestCase {
  /** The case's name. */
  name: string
  /** The properties' JSON, "" for P-RT and P-FLIP. */
  props: string
  /** The vectors' JSON: V, and any sibling the case adds. */
  vectors: string
  /** The expected reasons, "" when a property derives the result. */
  want: string
  /**
   * A case.
   *
   * @param name the case's name
   * @param props the properties' JSON
   * @param vectors the vectors' JSON
   * @param want the expected reasons
   */
  constructor(name: string, props: string, vectors: string, want: string) {
    this.name = name
    this.props = props
    this.vectors = vectors
    this.want = want
  }
}

/** A vector of verify cited to section 7, with `extra` JSON fields (from ", "), its result to section 5. */
const deriveTestRow = (pk: string, msg: string, sig: string, want: string, extra: string): string =>
  `{"kind": "vector", "id": "V", "title": "t", "covers": ["R5"], "source": {"spec": "5"}, "section": "7",
    "call": "verify", "args": [{"hex": "${pk}"}, ${msg}, {"hex": "${sig}"}], "expect": {"bool": ${want}}${extra}}`

/** A sibling of sign(01, 02), cited to section 7, with `extra` JSON fields. */
const deriveTestLoose = (id: string, want: string, extra: string): string =>
  `{"kind": "vector", "id": "${id}", "title": "t", "covers": ["R7"], "source": {"cite": {"source": "rfc9999", "section": "7"}},
    "call": "sign", "args": [{"hex": "01"}, {"hex": "02"}], "expect": {"hex": "${want}"}${extra}}`

/** A property P covering R5, over one key of 1 byte. */
const deriveTestOne = (assert: string): string =>
  `{"kind": "property", "id": "P", "title": "t", "covers": ["R5"],
    "forall": [{"name": "key", "type": "bytes", "minLen": 1, "maxLen": 1}], "assert": ${assert}}`

/** A vector V cited to section 7, its result to section 5, calling `call` on `args` and expecting `want`. */
const deriveTestV = (call: string, args: string, want: string): string =>
  `{"kind": "vector", "id": "V", "title": "t", "covers": ["R5"], "source": {"spec": "5"}, "section": "7",
    "call": "${call}", "args": [${args}], "expect": ${want}}`

/** L1, look(01) = null, cited to section 7. */
const DERIVE_TEST_L1: string = `{"kind": "vector", "id": "L1", "title": "t", "covers": ["R7"],
  "source": {"cite": {"source": "rfc9999", "section": "7"}}, "call": "look", "args": [{"hex": "01"}], "expect": {"null": true}}`

/** A sibling K9, pk(01) = c1, with `source` as its source's JSON. */
const deriveTestK9 = (source: string): string =>
  `{"kind": "vector", "id": "K9", "title": "t", "covers": ["R7"], "source": ${source},
    "call": "pk", "args": [{"hex": "01"}], "expect": {"hex": "c1"}}`

/** A call of use. */
const deriveTestUse = (arg: string): string => `{"call": "use", "args": [${arg}]}`

/** The expression forms an argument may take, each against the sampler's meaning of it. */
const deriveTestForms = (): DeriveTestCase[] => {
  const key = `{"var": "key"}`
  const look = `{"call": "look", "args": [${key}]}`
  const vUse = deriveTestV("use", `{"null": true}`, `{"bool": true}`)
  const yes = `{"bool": true}`
  const sx = deriveTestCited("SX", "sign", `{"hex": "03"}, {"hex": "04"}`, "b9")
  const sy = deriveTestCited("SY", "sign", `{"hex": "01"}, {"hex": "01"}`, "b9")
  const twice = `{"op": "unwrap", "args": [{"call": "sign", "args": [${key}, ${key}]}]}`
  return [
    new DeriveTestCase(
      "unwrap of a sibling expecting null",
      deriveTestOne(deriveTestEq(deriveTestUse(`{"op": "unwrap", "args": [${look}]}`), yes)),
      `${DERIVE_TEST_L1}, ${vUse}`,
      "P unwraps look where the vector has null, a value unwrap never gives",
    ),
    new DeriveTestCase(
      "unwrap where no sibling expects null",
      deriveTestOne(deriveTestEq(deriveTestUse(`{"op": "unwrap", "args": [${look}]}`), yes)),
      vUse,
      "P unwraps look where the vector has null, a value unwrap never gives",
    ),
    new DeriveTestCase(
      "a plain call of a sibling expecting null",
      deriveTestOne(deriveTestEq(deriveTestUse(look), yes)),
      `${DERIVE_TEST_L1}, ${vUse}`,
      "",
    ),
    new DeriveTestCase(
      "a literal null matches, the key left unbound",
      deriveTestOne(deriveTestEq(deriveTestUse(`{"null": true}`), yes)),
      vUse,
      "P leaves key unbound",
    ),
    new DeriveTestCase(
      "a literal that is not null",
      deriveTestOne(deriveTestEq(deriveTestUse(`{"hex": ""}`), yes)),
      vUse,
      "P passes a literal that is not the vector's value",
    ),
    new DeriveTestCase(
      "a plain call where no sibling expects null",
      deriveTestOne(deriveTestEq(deriveTestUse(look), yes)),
      vUse,
      "P calls look for a value no cited vector of look expects with matching arguments",
    ),
    new DeriveTestCase(
      "derives null",
      deriveTestOne(deriveTestEq(look, `{"null": true}`)),
      deriveTestV("look", `{"hex": "02"}`, `{"null": true}`),
      "",
    ),
    new DeriveTestCase(
      "a null asserted for a true vector",
      deriveTestOne(deriveTestEq(deriveTestUse(look), `{"null": true}`)),
      `${DERIVE_TEST_L1}, ${vUse}`,
      "P asserts another result than the vector's",
    ),
    new DeriveTestCase(
      "a true asserted for a null vector",
      deriveTestOne(deriveTestEq(look, yes)),
      deriveTestV("look", `{"hex": "02"}`, `{"null": true}`),
      "P asserts another result than the vector's",
    ),
    new DeriveTestCase(
      "a failed sibling leaves no binding",
      deriveTestOne(deriveTestEq(deriveTestCall(`{"hex": "aa"}`, `{"hex": "02"}`, twice), yes)),
      `${sx}, ${sy}, ${deriveTestRow("aa", `{"hex": "02"}`, "b9", "true", "")}`,
      "",
    ),
    new DeriveTestCase(
      "a sibling of the wrong arity",
      deriveTestOne(
        deriveTestEq(
          deriveTestCall(
            `{"op": "unwrap", "args": [{"call": "pk", "args": [${key}]}]}`,
            `{"hex": "02"}`,
            `{"hex": "bb"}`,
          ),
          yes,
        ),
      ),
      `${deriveTestCited("K8", "pk", `{"hex": "01"}, {"hex": "02"}`, "c8")}, ${deriveTestRow("c8", `{"hex": "02"}`, "bb", "true", "")}`,
      "P passes 1 arguments where 2 are given",
    ),
    new DeriveTestCase(
      "a sibling with an argument not evaluated",
      deriveTestOne(
        deriveTestEq(
          deriveTestCall(
            `{"op": "unwrap", "args": [{"call": "pk", "args": [${key}]}]}`,
            `{"hex": "02"}`,
            `{"hex": "bb"}`,
          ),
          yes,
        ),
      ),
      `${deriveTestCited("K8", "pk", `{"f64": "1.5"}`, "c8")}, ${deriveTestRow("c8", `{"hex": "02"}`, "bb", "true", "")}`,
      "P calls pk for a value no cited vector of pk expects with matching arguments",
    ),
  ]
}

/** The siblings a value may come from: only another vector, cited to a section. */
const deriveTestSiblings = (): DeriveTestCase[] => {
  const row = deriveTestRow("c1", `{"hex": "02"}`, "bb", "true", "")
  const none =
    "P-RT calls pk for a value no cited vector of pk expects with matching arguments; P-FLIP asserts another result than the vector's"
  return [
    new DeriveTestCase(
      "a cited sibling",
      "",
      `${deriveTestK9(`{"cite": {"source": "rfc9999", "section": "7"}}`)}, ${row}`,
      "",
    ),
    new DeriveTestCase("a spec-sourced sibling", "", `${deriveTestK9(`{"spec": "7"}`)}, ${row}`, none),
    new DeriveTestCase("a command-sourced sibling", "", `${deriveTestK9(`{"command": "echo c1"}`)}, ${row}`, none),
  ]
}

/**
 * The context whose properties cover R6 in place of R5, and V covers R5 and
 * R6, R6 quoted from `section` of `source` (null for the main source): the
 * derivation holds only when R6 is a requirement of V's result's section.
 */
const deriveTestShared = (section: string, source: string | null): CheckContext => {
  const ctx = deriveTestCtx(deriveTestContract("", deriveTestRow("aa", `{"hex": "02"}`, "bb", "true", "")))
  const r6 = new Requirement()
  r6.id = "R6"
  r6.source = source
  r6.section = section
  r6.level = "MUST"
  r6.quote = "It MUST check the signature."
  ctx.contract.requirements.push(r6)
  deriveTestClause(ctx.contract, "P-RT").covers = ["R6"]
  deriveTestClause(ctx.contract, "P-FLIP").covers = ["R6"]
  deriveTestClause(ctx.contract, "V").covers.push("R6")
  const set = ctx.sources
  if (source !== null && source !== "rfc9999" && set !== null) {
    set.sources.push(new LoadedSource(source, "o.txt", "o.txt", rfcParse(DERIVE_TEST_RFC)))
  }
  return ctx
}

/** The derived rule over P-RT and P-FLIP, case by case. */
const deriveTestCases = (): DeriveTestCase[] => {
  const m02 = `{"hex": "02"}`
  const rtOther = "P-FLIP asserts another result than the vector's"
  const flipOther = "P-RT asserts another result than the vector's"
  const f1 = deriveTestCited("F1", "flip", `{"hex": "bb"}, {"int": 3}`, "ee")
  const f2 = deriveTestCited("F2", "flip", `{"hex": "bb"}, {"int": 9}`, "ef")
  const f3 = deriveTestCited("F3", "flip", `{"hex": "bb"}, {"int": -1}`, "e1")
  const f4 = deriveTestCited("F4", "flip", `{"hex": "bb"}, {"hex": "03"}`, "e2")
  const tol = `, "tolerance": {"ulps": 1, "section": "7", "quote": "It MUST print the vectors."}`
  return [
    new DeriveTestCase("derives true", "", deriveTestRow("aa", m02, "bb", "true", ""), ""),
    new DeriveTestCase("derives false", "", `${f1}, ${deriveTestRow("aa", m02, "ee", "false", "")}`, ""),
    new DeriveTestCase(
      "no vector of the tamper function",
      "",
      deriveTestRow("aa", m02, "bb", "false", ""),
      `${flipOther}; P-FLIP calls flip for a value no cited vector of flip expects with matching arguments`,
    ),
    new DeriveTestCase(
      "a key no vector expects",
      "",
      deriveTestRow("cc", m02, "bb", "true", ""),
      `P-RT calls pk for a value no cited vector of pk expects with matching arguments; ${rtOther}`,
    ),
    new DeriveTestCase(
      "a signature one byte off",
      "",
      deriveTestRow("aa", m02, "bc", "true", ""),
      `P-RT calls sign for a value no cited vector of sign expects with matching arguments; ${rtOther}`,
    ),
    new DeriveTestCase(
      "a message outside the domain",
      "",
      deriveTestRow("aa", `{"hex": "0203"}`, "dd", "true", ""),
      `P-RT binds msg to a 2-byte value, outside its domain 0..1; ${rtOther}`,
    ),
    new DeriveTestCase(
      "a message the signature is not of",
      "",
      deriveTestRow("aa", `{"hex": "03"}`, "bb", "true", ""),
      `P-RT uses msg for two different values; ${rtOther}`,
    ),
    new DeriveTestCase(
      "a tamper bit below its domain",
      "",
      `${f3}, ${deriveTestRow("aa", m02, "e1", "false", "")}`,
      `${flipOther}; P-FLIP binds bit to -1, outside its domain 0..7`,
    ),
    new DeriveTestCase(
      "bytes for an integer variable",
      "",
      `${f4}, ${deriveTestRow("aa", m02, "e2", "false", "")}`,
      `${flipOther}; P-FLIP binds bit, of type i32, which is not bound here`,
    ),
    new DeriveTestCase(
      "a tamper bit outside its domain",
      "",
      `${f2}, ${deriveTestRow("aa", m02, "ef", "false", "")}`,
      `${flipOther}; P-FLIP binds bit to 9, outside its domain 0..7`,
    ),
    new DeriveTestCase(
      "a u64 variable",
      `${deriveTestRt("")}, ${deriveTestFlip(`"type": "u64", "min": 0, "max": 7`)}`,
      `${f1}, ${deriveTestRow("aa", m02, "ee", "false", "")}`,
      `${flipOther}; P-FLIP binds bit, of type u64, which is not bound here`,
    ),
    new DeriveTestCase(
      "an f64 variable",
      `${deriveTestRt("")}, ${deriveTestFlip(`"type": "f64", "min": "0", "max": "7"`)}`,
      `${f1}, ${deriveTestRow("aa", m02, "ee", "false", "")}`,
      `${flipOther}; P-FLIP binds bit, of type f64, which is not bound here`,
    ),
    new DeriveTestCase(
      "an unbounded variable",
      `${deriveTestRt("")}, ${deriveTestFlip(`"type": "string", "minLen": 0, "maxLen": 1, "alphabet": ["a"]`)}`,
      `${f1}, ${deriveTestRow("aa", m02, "ee", "false", "")}`,
      `${flipOther}; P-FLIP binds bit, of type string, which is not bound here`,
    ),
    new DeriveTestCase(
      "a truncated sibling",
      "",
      `${deriveTestLoose("S3", "b1", `, "truncate": {"bytes": 1}`)}, ${deriveTestRow("aa", m02, "b1", "true", "")}`,
      `P-RT calls sign for a value no cited vector of sign expects with matching arguments (unused: S3 compares only the first 1 bytes of its result, so its expected value is not its call's); ${rtOther}`,
    ),
    new DeriveTestCase(
      "an iterated sibling",
      "",
      `${deriveTestLoose(
        "S3",
        "b2",
        `, "iterate": {"count": 2, "names": ["seed", "msg"], "next": [{"var": "seed"}, {"var": "msg"}]}`,
      )}, ${deriveTestRow("aa", m02, "b2", "true", "")}`,
      `P-RT calls sign for a value no cited vector of sign expects with matching arguments (unused: S3 iterates its call 2 times, so its expected value is not its call's); ${rtOther}`,
    ),
    new DeriveTestCase(
      "a toleranced sibling",
      "",
      `${deriveTestLoose("S3", "b3", tol)}, ${deriveTestRow("aa", m02, "b3", "true", "")}`,
      `P-RT calls sign for a value no cited vector of sign expects with matching arguments (unused: S3 allows a tolerance, so its expected value is not its call's); ${rtOther}`,
    ),
    new DeriveTestCase(
      "a truncated row",
      "",
      deriveTestRow("aa", m02, "bb", "true", `, "truncate": {"bytes": 1}`),
      "V compares only the first 1 bytes of its result, so its expected value is not its call's",
    ),
    new DeriveTestCase(
      "an iterated row",
      "",
      deriveTestRow(
        "aa",
        m02,
        "bb",
        "true",
        `, "iterate": {"count": 2, "names": ["pk", "msg", "sig"], "next": [{"var": "pk"}, {"var": "msg"}, {"var": "sig"}]}`,
      ),
      "V iterates its call 2 times, so its expected value is not its call's",
    ),
    new DeriveTestCase(
      "a toleranced row",
      "",
      deriveTestRow("aa", m02, "bb", "true", tol),
      "V allows a tolerance, so its expected value is not its call's",
    ),
    new DeriveTestCase(
      "not a null or a bool",
      "",
      `{"kind": "vector", "id": "V", "title": "t", "covers": ["R5"], "source": {"spec": "5"}, "section": "7",
        "call": "pk", "args": [{"hex": "01"}], "expect": {"hex": "aa"}}`,
      "V expects neither null, true nor false",
    ),
    new DeriveTestCase(
      "no shared requirement",
      "",
      `{"kind": "vector", "id": "V", "title": "t", "covers": ["R7"], "source": {"spec": "5"}, "section": "7",
        "call": "verify", "args": [{"hex": "aa"}, {"hex": "02"}, {"hex": "bb"}], "expect": {"bool": true}}`,
      "no property covers a requirement of the result's section that V covers",
    ),
  ]
}

/** The derived rule over one property P, shape by shape, each against verify(aa, 02, bb) = true unless named. */
const deriveTestShapes = (): DeriveTestCase[] => {
  const row = deriveTestRow("aa", `{"hex": "02"}`, "bb", "true", "")
  const yes = `{"bool": true}`
  const rt = deriveTestCall(DERIVE_TEST_PK, DERIVE_TEST_MSG, DERIVE_TEST_SIGN)
  const bb = `{"hex": "bb"}`
  const lit = deriveTestCall(DERIVE_TEST_PK, DERIVE_TEST_MSG, bb)
  const pk2 = `{"op": "unwrap", "args": [{"call": "pk", "args": [${DERIVE_TEST_PK}]}]}`
  const pk3 = `{"op": "unwrap", "args": [{"call": "pk", "args": [${pk2}]}]}`
  const single = "P does not assert a single equality"
  return [
    new DeriveTestCase("the literal on the left", deriveTestProp("", deriveTestEq(yes, rt)), row, ""),
    new DeriveTestCase(
      "a block body",
      deriveTestProp(
        "",
        `{"let": [{"name": "s", "value": ${DERIVE_TEST_SIGN}}], "in": ${deriveTestEq(
          deriveTestCall(DERIVE_TEST_PK, DERIVE_TEST_MSG, `{"var": "s"}`),
          yes,
        )}}`,
      ),
      row,
      single,
    ),
    new DeriveTestCase(
      "an inequality",
      deriveTestProp("", `{"op": "!=", "args": [${rt}, {"bool": false}]}`),
      row,
      single,
    ),
    new DeriveTestCase(
      "a conjunction",
      deriveTestProp("", `{"op": "&&", "args": [${deriveTestEq(rt, yes)}, ${deriveTestEq(rt, yes)}]}`),
      row,
      single,
    ),
    new DeriveTestCase(
      "a non-literal side",
      deriveTestProp("", deriveTestEq(rt, DERIVE_TEST_MSG)),
      row,
      "P does not assert that verify is a literal",
    ),
    new DeriveTestCase(
      "another function",
      deriveTestProp("", deriveTestEq(`{"call": "pk", "args": [{"var": "seed"}]}`, yes)),
      row,
      "P does not assert that verify is a literal",
    ),
    new DeriveTestCase("a literal argument that is the vector's", deriveTestProp("", deriveTestEq(lit, yes)), row, ""),
    new DeriveTestCase(
      "a literal argument that is not",
      deriveTestProp("", deriveTestEq(deriveTestCall(DERIVE_TEST_PK, DERIVE_TEST_MSG, `{"hex": "bc"}`), yes)),
      row,
      "P passes a literal that is not the vector's value",
    ),
    new DeriveTestCase(
      "a computed argument",
      deriveTestProp(
        "",
        deriveTestEq(deriveTestCall(DERIVE_TEST_PK, `{"op": "concat", "args": [${DERIVE_TEST_MSG}]}`, bb), yes),
      ),
      row,
      "P computes an argument (concat) that is not matched here",
    ),
    new DeriveTestCase(
      "unwrap of a non-call",
      deriveTestProp(
        "",
        deriveTestEq(deriveTestCall(`{"op": "unwrap", "args": [{"var": "seed"}]}`, DERIVE_TEST_MSG, bb), yes),
      ),
      row,
      "P computes an argument (unwrap) that is not matched here",
    ),
    new DeriveTestCase(
      "unwrap of two calls",
      deriveTestProp(
        "",
        deriveTestEq(
          deriveTestCall(
            `{"op": "unwrap", "args": [${deriveTestCall(DERIVE_TEST_PK, DERIVE_TEST_MSG, bb)}, ${deriveTestCall(DERIVE_TEST_PK, DERIVE_TEST_MSG, bb)}]}`,
            DERIVE_TEST_MSG,
            bb,
          ),
          yes,
        ),
      ),
      row,
      "P computes an argument (unwrap) that is not matched here",
    ),
    new DeriveTestCase(
      "two calls deep",
      deriveTestProp("", deriveTestEq(deriveTestCall(pk2, DERIVE_TEST_MSG, bb), yes)),
      deriveTestRow("a2", `{"hex": "02"}`, "bb", "true", ""),
      "",
    ),
    new DeriveTestCase(
      "three calls deep",
      deriveTestProp("", deriveTestEq(deriveTestCall(pk3, DERIVE_TEST_MSG, bb), yes)),
      deriveTestRow("a3", `{"hex": "02"}`, "bb", "true", ""),
      "P reaches pk more than 2 calls deep",
    ),
    new DeriveTestCase(
      "a variable for two values",
      deriveTestProp("", deriveTestEq(deriveTestCall(DERIVE_TEST_PK, `{"var": "seed"}`, bb), yes)),
      row,
      "P uses seed for two different values",
    ),
    new DeriveTestCase(
      "a variable it does not quantify over",
      deriveTestProp("", deriveTestEq(deriveTestCall(DERIVE_TEST_PK, `{"var": "m"}`, bb), yes)),
      row,
      "P uses m, which it does not quantify over",
    ),
    new DeriveTestCase(
      "a variable left unbound",
      deriveTestProp(`, {"name": "z", "type": "bytes", "minLen": 0, "maxLen": 1}`, deriveTestEq(lit, yes)),
      row,
      "P leaves z unbound",
    ),
    new DeriveTestCase(
      "too few arguments",
      deriveTestProp("", deriveTestEq(`{"call": "verify", "args": [${DERIVE_TEST_PK}, ${DERIVE_TEST_MSG}]}`, yes)),
      row,
      "P passes 2 arguments where 3 are given",
    ),
    new DeriveTestCase(
      "a number for a bytes variable",
      deriveTestProp("", deriveTestEq(lit, yes)),
      deriveTestRow("aa", `{"int": 2}`, "bb", "true", ""),
      "P binds msg, a bytes variable, to a value that is not bytes",
    ),
    new DeriveTestCase(
      "a message domain as wide as it goes",
      `{"kind": "property", "id": "P", "title": "t", "covers": ["R5"],
        "forall": [{"name": "seed", "type": "bytes", "minLen": 1, "maxLen": 1}, {"name": "msg", "type": "bytes", "minLen": 0, "maxLen": 4096}],
        "assert": ${deriveTestEq(rt, yes)}}`,
      deriveTestRow("aa", `{"hex": "0203"}`, "dd", "true", ""),
      "",
    ),
    new DeriveTestCase(
      "a key shorter than its domain",
      deriveTestProp("", deriveTestEq(lit, yes)),
      `${deriveTestCited("K0", "pk", `{"hex": ""}`, "a0")}, ${deriveTestRow("a0", `{"hex": "02"}`, "bb", "true", "")}`,
      "P binds seed to a 0-byte value, outside its domain 1..1",
    ),
  ]
}

/** A where clause that the message is `n` bytes long. */
const deriveTestLen = (n: string): string =>
  `"where": {"op": "==", "args": [{"op": "len", "args": [{"var": "msg"}]}, {"int": ${n}}]},`

/** The where clause, holding and not. */
const deriveTestWheres = (): DeriveTestCase[] => {
  const row = deriveTestRow("aa", `{"hex": "02"}`, "bb", "true", "")
  const flip = deriveTestFlip(DERIVE_TEST_FLIP)
  return [
    new DeriveTestCase("a where that holds", `${deriveTestRt(deriveTestLen("1"))}, ${flip}`, row, ""),
    new DeriveTestCase(
      "a where that does not hold",
      `${deriveTestRt(deriveTestLen("0"))}, ${flip}`,
      row,
      "P-RT's where does not hold for the vector's inputs; P-FLIP asserts another result than the vector's",
    ),
    new DeriveTestCase(
      "a where that cannot be evaluated",
      `${deriveTestRt(`"where": ${deriveTestEq(`{"call": "pk", "args": [{"var": "seed"}]}`, `{"hex": "aa"}`)},`)}, ${flip}`,
      row,
      "P-RT's where cannot be evaluated: calls pk, and a call is not evaluated here; P-FLIP asserts another result than the vector's",
    ),
  ]
}

/**
 * What gateDerivedResult says of V when P passes a let as verify's first
 * argument: the reader takes a let only at the assert, so the let is set
 * in place of the parsed argument.
 */
const deriveTestLetArg = (): string => {
  const props = deriveTestProp(
    "",
    deriveTestEq(deriveTestCall(DERIVE_TEST_PK, DERIVE_TEST_MSG, `{"hex": "bb"}`), `{"bool": true}`),
  )
  const r = contractParse(deriveTestBase(props, deriveTestRow("aa", `{"hex": "02"}`, "bb", "true", "")), "c1")
  if (r.isErr()) {
    return `unparsed: ${r.error.join("; ")}`
  }
  const c = r.value
  const a = deriveTestClause(c, "P").assert
  if (a === null || a.args.length === 0) {
    return "no assert"
  }
  a.args[0].args[0] = new Expr(ExprKind.Let, "")
  const why = gateDerivedResult(c.clauses, ["R5"], deriveTestClause(c, "V"))
  return why === null ? "" : why
}

/** The derived rule, alone and through the provenance gate. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/derive")
  for (const c of deriveTestCases()) {
    t.eqStr(c.name, deriveTestWhy(c.props, c.vectors, ["R5"]), c.want)
  }
  for (const c of deriveTestShapes()) {
    t.eqStr(c.name, deriveTestWhy(c.props, c.vectors, ["R5"]), c.want)
  }
  t.eqStr("a let as an argument", deriveTestLetArg(), "P computes an argument (a let) that is not matched here")
  for (const c of deriveTestWheres()) {
    t.eqStr(c.name, deriveTestWhy(c.props, c.vectors, ["R5"]), c.want)
  }
  for (const c of deriveTestForms()) {
    t.eqStr(c.name, deriveTestWhy(c.props, c.vectors, ["R5"]), c.want)
  }
  for (const c of deriveTestSiblings()) {
    t.eqStr(c.name, deriveTestWhy(c.props, c.vectors, ["R5"]), c.want)
  }
  const unsourced = contractParse(
    deriveTestContract(
      "",
      `${deriveTestK9(`{"cite": {"source": "rfc9999", "section": "7"}}`)}, ${deriveTestRow("c1", `{"hex": "02"}`, "bb", "true", "")}`,
    ),
    "c1",
  ).expect("parse unsourced")
  deriveTestClause(unsourced, "K9").source = null
  const unsourcedWhy = gateDerivedResult(unsourced.clauses, ["R5"], deriveTestClause(unsourced, "V"))
  t.eqStr(
    "a sibling without a source",
    unsourcedWhy === null ? "" : unsourcedWhy,
    "P-RT calls pk for a value no cited vector of pk expects with matching arguments; P-FLIP asserts another result than the vector's",
  )
  const selfJson = deriveTestBase(
    deriveTestOne(
      deriveTestEq(
        `{"call": "gate", "args": [{"var": "key"}, {"call": "gate", "args": [{"var": "key"}, {"bool": true}]}]}`,
        `{"bool": true}`,
      ),
    ),
    `{"kind": "vector", "id": "V", "title": "t", "covers": ["R5"], "source": {"cite": {"source": "rfc9999", "section": "7"}},
      "call": "gate", "args": [{"hex": "01"}, {"bool": true}], "expect": {"bool": true}}`,
  )
  const selfC = contractParse(selfJson, "c1").expect("parse self")
  const selfWhy = gateDerivedResult(selfC.clauses, ["R5"], deriveTestClause(selfC, "V"))
  t.eqStr(
    "the row is not its own sibling",
    selfWhy === null ? "" : selfWhy,
    "P calls gate for a value no cited vector of gate expects with matching arguments",
  )
  const row = deriveTestRow("aa", `{"hex": "02"}`, "bb", "true", "")
  t.eqStr(
    "only the result's section's requirements",
    deriveTestWhy("", row, ["R7"]),
    "no property covers a requirement of the result's section that V covers",
  )
  const good = gateProvenance(deriveTestCtx(deriveTestContract("", row)))
  t.eqStr("the gate passes a derived result", good.join("\n"), "")
  const bad = gateProvenance(
    deriveTestCtx(deriveTestContract("", deriveTestRow("aa", `{"hex": "03"}`, "bb", "true", ""))),
  )
  t.ok(
    "the gate refuses an underived result, naming both sections",
    bad.length === 1 &&
      bad[0].indexOf(
        `V.source: RFC §5 ("Verify"), the result citation of V (inputs §7), does not state the expected result: R5 `,
      ) === 0 &&
      bad[0].indexOf("; and no property derives it: P-RT uses msg for two different values") > 0,
  )
  if (bad.length !== 1) {
    console.log(bad.join("\n"))
  }
  const none = "; and no property derives it: no property covers a requirement of the result's section that V covers"
  t.eqStr("the gate derives through a requirement of B", gateProvenance(deriveTestShared("5", null)).join("\n"), "")
  const other = gateProvenance(deriveTestShared("7", null))
  t.ok(
    "the gate does not derive through a requirement of another section",
    other.length === 1 && other[0].indexOf(none) > 0,
  )
  if (other.length !== 1) {
    console.log(other.join("\n"))
  }
  t.eqStr(
    "the gate derives through a requirement of B naming the main source",
    gateProvenance(deriveTestShared("5", "rfc9999")).join("\n"),
    "",
  )
  const elsewhere = gateProvenance(deriveTestShared("5", "rfc8888"))
  t.ok(
    "the gate does not derive through a requirement of another source",
    elsewhere.length === 1 && elsewhere[0].indexOf(none) > 0,
  )
  if (elsewhere.length !== 1) {
    console.log(elsewhere.join("\n"))
  }
  const apartC = deriveTestCtx(deriveTestContract("", row)).contract
  t.ok("V cites its result apart", gateResultApart(apartC, deriveTestClause(apartC, "V")))
  t.ok("a cited sibling does not", !gateResultApart(apartC, deriveTestClause(apartC, "K1")))
  t.ok("a property does not", !gateResultApart(apartC, deriveTestClause(apartC, "P-RT")))
  const truncated = gateProvenance(
    deriveTestCtx(
      deriveTestContract("", deriveTestRow("aa", `{"hex": "02"}`, "bb", "true", `, "truncate": {"bytes": 1}`)),
    ),
  )
  t.ok(
    "the gate refuses a truncated row",
    truncated.length === 1 &&
      truncated[0].indexOf(
        "; and no property derives it: V compares only the first 1 bytes of its result, so its expected value is not its call's",
      ) > 0,
  )
  const alone = deriveTestContract(
    "",
    `{"kind": "vector", "id": "V", "title": "t", "covers": ["R5"], "source": {"spec": "5"},
      "call": "verify", "args": [{"hex": "aa"}, {"hex": "02"}, {"hex": "bb"}], "expect": {"bool": true}}`,
  )
  const single =
    'V.source: RFC §5 ("Verify") does not state the expected result: R5 does not require "true" as the result (an affirmative MUST, SHALL or REQUIRED to, a result verb, then "true")'
  t.eqStr("a vector citing one section is not derived", gateProvenance(deriveTestCtx(alone)).join("\n"), single)
  const same = deriveTestContract(
    "",
    `{"kind": "vector", "id": "V", "title": "t", "covers": ["R5"], "source": {"spec": "5"}, "section": "5",
      "call": "verify", "args": [{"hex": "aa"}, {"hex": "02"}, {"hex": "bb"}], "expect": {"bool": true}}`,
  )
  t.eqStr(
    "a vector citing its result to its inputs' section is not derived",
    gateProvenance(deriveTestCtx(same)).join("\n"),
    single,
  )
  const modCtx = deriveTestCtx(deriveTestContract("", row))
  modCtx.contract.source.main = "rfc9999"
  t.eqStr("a contract with a main source is not derived", gateProvenance(modCtx).join("\n"), single)
  return t.done()
}
