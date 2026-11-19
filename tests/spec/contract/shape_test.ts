import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { contractLoad, contractLoadFile } from "../../../src/spec/contract/contract"
import { contractParse } from "../../../src/spec/contract/read"
import {
  contractShapeErrors,
  shapeAlphabetChars,
  shapeAlphabetClasses,
  shapeNishModuleFile,
  shapeTestNames,
  shapeTestPrefixes,
} from "../../../src/spec/contract/shape"

/** A small valid contract; each case below changes one part of it. */
const BASE: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 4648},
  "target": {"module": "nish/hex"},
  "requirements": [{"id": "R1", "section": "3.1", "level": "MUST", "quote": "Q"}],
  "functions": [{"name": "enc", "params": [{"name": "b", "type": "bytes"}], "returns": "string"}],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "10"}}, "call": "enc", "args": [{"hex": "00"}], "expect": {"str": "00"}},
    {"kind": "property", "id": "P1", "title": "p", "covers": ["R1"],
     "forall": [{"name": "x", "type": "u8", "min": 0, "max": 255}],
     "assert": {"op": "<=", "args": [{"var": "x"}, {"int": 255}]}}
  ]
}`

/** The shape errors of BASE with `from` replaced by `to`, or the read errors when it does not read. */
const shapeErrorsOf = (from: string, to: string): string[] => {
  const text = replaceAll(BASE, from, to)
  const c = contractParse(text, "base")
  if (c.isErr()) {
    return c.error.map((e: string): string => `read: ${e}`)
  }
  return contractShapeErrors(c.value)
}

/** Whether replacing `from` with `to` in BASE gives exactly the error `want`, among others. */
const shapeExpect = (t: Suite, from: string, to: string, want: string): void => {
  const errors = shapeErrorsOf(from, to)
  if (errors.indexOf(want) >= 0) {
    t.pass(want)
  } else {
    t.fail(want, `got:\n${errors.join("\n")}`)
  }
}

/** BASE's expect followed by an `iterate` of `body`. */
const shapeIter = (body: string): string => `"expect": {"str": "00"}, "iterate": ${body}`

/** The values the shape check refuses, each with its message. */
export const main = (): i32 => {
  const t = new Suite("spec/contract shape")
  t.eqStr("the base contract is valid", shapeErrorsOf("", "").join("\n"), "")

  // Top level.
  shapeExpect(t, `"c1"`, `"-c1"`, "contract.contract: an id ([A-Za-z0-9._-])")
  shapeExpect(
    t,
    `"nish/hex"`,
    `"Nish/hex"`,
    "contract.target.module: a module path <root>/<segment>/…, lowercase [a-z][a-z0-9_]* segments (RFC 3986 §3.3)",
  )
  shapeExpect(
    t,
    `"module": "nish/hex"}`,
    `"module": "nish/hex", "modules": {"go": ""}}`,
    "contract.target.modules.go: a non-empty string",
  )

  // Requirements.
  shapeExpect(
    t,
    `"section": "3.1", "level"`,
    `"section": "3.", "level"`,
    `requirements[0].section: a section number like "2.3" or "A.1"`,
  )
  shapeExpect(
    t,
    `"MUST"`,
    `"MUSTN'T"`,
    "requirements[0].level: one of MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY, OPTIONAL, DEFINITION",
  )
  shapeExpect(t, `"quote": "Q"`, `"quote": "  "`, "requirements[0].quote: a non-empty string")
  shapeExpect(
    t,
    `"quote": "Q"`,
    `"quote": "a\\u0085b"`,
    "requirements[0].quote: one line of text, without control characters (found U+0085); it is copied into comments in the generated test",
  )
  shapeExpect(
    t,
    `"quote": "Q"`,
    `"quote": "Q", "source": "rfc9999"`,
    `requirements[0].source: "rfc9999" is not an id from contract.sources (rfc4648)`,
  )

  // Functions.
  shapeExpect(
    t,
    `"name": "enc"`,
    `"name": "hexOf"`,
    `functions[0].name: "hexOf" is a name the generated test uses itself (its helpers and locals, and names starting plain_ clause_ table_ v_ a_ s_), so the test cannot call such a function`,
  )
  shapeExpect(t, `"name": "enc"`, `"name": "2enc"`, "functions[0].name: an identifier")
  shapeExpect(
    t,
    `"returns": "string"`,
    `"returns": "str"`,
    "functions[0].returns: one of bytes bytes? string string? bool bool? f64 f64? secret-bytes secret-bytes? i8 i8? i16 i16? i32 i32? i64 i64? u8 u8? u16 u16? u32 u32? u64 u64? words16 words16? words32 words32? words64 words64?",
  )
  shapeExpect(
    t,
    `{"name": "b", "type": "bytes"}`,
    `{"name": "b-1", "type": "bytes"}`,
    "functions[0].params[0].name: an identifier",
  )

  // Sources.
  shapeExpect(t, `"rfc": 4648}`, `"rfc": 4648, "sha256": "ABC"}`, "contract.source.sha256: 64 lowercase hex digits")
  shapeExpect(t, `"rfc": 4648}`, `"rfc": 4648, "main": "x"}`, "contract.source.main: only with contract.sources")
  const decl = `"rfc": 4648}, "sources": [{"id": "rfc4648", "rfc": 4648}, `
  shapeExpect(t, `"rfc": 4648}`, `"rfc": 4648}, "sources": []`, "contract.sources: a non-empty array")
  shapeExpect(t, `"rfc": 4648}`, `${decl}{"id": "rfc4648", "rfc": 1}]`, `sources[1].id: duplicate source id "rfc4648"`)
  shapeExpect(t, `"rfc": 4648}`, `${decl}{"id": "x"}]`, `sources[1]: needs "rfc", "path" or both`)
  shapeExpect(t, `"rfc": 4648}`, `${decl}{"id": "x", "path": ""}]`, "sources[1].path: a file path")
  shapeExpect(
    t,
    `"rfc": 4648}`,
    `${decl}{"id": "x", "path": "/etc/passwd"}]`,
    "sources[1].path: a path relative to the contract, not /etc/passwd",
  )
  const repoPath = "sources[1].file: a path inside the repo, with / separators, like rfcs/rfc4648.txt"
  shapeExpect(t, `"rfc": 4648}`, `${decl}{"id": "x", "rfc": 1, "file": "../secret.txt"}]`, repoPath)
  shapeExpect(t, `"rfc": 4648}`, `${decl}{"id": "x", "rfc": 1, "file": "rfcs/./a.txt"}]`, repoPath)
  shapeExpect(t, `"rfc": 4648}`, `${decl}{"id": "x", "rfc": 1, "file": "rfcs//a.txt"}]`, repoPath)
  shapeExpect(t, `"rfc": 4648}`, `${decl}{"id": "x", "rfc": 1, "file": "rfcs\\\\a.txt"}]`, repoPath)
  shapeExpect(
    t,
    `"rfc": 4648}`,
    `"rfc": 4648}, "sources": [{"id": "rfc4648", "rfc": 4649}]`,
    "sources[0].rfc: 4648, as contract.source.rfc says",
  )
  shapeExpect(t, `"title": "T", "rfc": 4648}`, `"title": "T"}`, "contract.source.rfc: the RFC number")
  shapeExpect(
    t,
    `"title": "T", "rfc": 4648}`,
    `"title": "T", "main": "nope"}, "sources": [{"id": "s", "path": "s.xml"}]`,
    "contract.source.main: the id of the main source in contract.sources",
  )

  // Vector clauses.
  shapeExpect(
    t,
    `"covers": ["R1"],\n     "source"`,
    `"covers": [],\n     "source"`,
    "clauses[0].covers: a non-empty array of requirement ids",
  )
  shapeExpect(t, `"call": "enc"`, `"call": "e.nc"`, "clauses[0].call: a function name")
  shapeExpect(
    t,
    `{"cite": {"section": "10"}}`,
    `{"cite": {"section": "10"}}, "section": "2"`,
    `clauses[0].section: a cited vector's args are read in source.cite; drop "section"`,
  )
  shapeExpect(t, `{"cite": {"section": "10"}}`, `{"command": " "}`, "clauses[0].source.command: a shell command")
  // A cite's case is `Test Vector #N`, N from 1 with no leading zero.
  t.eqStr(
    "a cite with a test case passes",
    shapeErrorsOf(`{"cite": {"section": "10"}}`, `{"cite": {"section": "10", "case": "Test Vector #12"}}`).join("\n"),
    "",
  )
  const badCases: string[] = ["Test Vector #0", "Test Vector #02", "Test vector #2", "Test Vector 2", "#2", ""]
  for (const bad of badCases) {
    shapeExpect(
      t,
      `{"cite": {"section": "10"}}`,
      `{"cite": {"section": "10", "case": "${bad}"}}`,
      "clauses[0].source.cite.case: a test case of the section, as Test Vector #N (N from 1, no leading zero)",
    )
  }
  t.ok(
    "a cite's case must be a string",
    shapeErrorsOf(`{"cite": {"section": "10"}}`, `{"cite": {"section": "10", "case": 2}}`)
      .join("\n")
      .startsWith("read: "),
  )
  shapeExpect(
    t,
    `{"cite": {"section": "10"}}`,
    `{"command": "x"}`,
    "clauses[0].section: the main-source section number printing the args",
  )
  t.eqStr(
    "a command source with a section passes",
    shapeErrorsOf(`{"cite": {"section": "10"}}`, `{"command": "x"}, "section": "2"`).join("\n"),
    "",
  )
  shapeExpect(
    t,
    `{"cite": {"section": "10"}}`,
    `{"spec": "x"}, "section": "2"`,
    "clauses[0].source.spec: a main-source section number",
  )
  shapeExpect(
    t,
    `{"cite": {"section": "10"}}`,
    `{"spec": "2"}, "section": "2"`,
    "clauses[0].expect: a spec source states only null or a bool; cite or compute any other value",
  )
  shapeExpect(
    t,
    `"expect": {"str": "00"}`,
    `"expect": {"int": 1}, "tolerance": {"abs": "-1", "section": "2", "quote": "q"}`,
    "clauses[0].tolerance.abs: a non-negative decimal as text",
  )
  shapeExpect(
    t,
    `"expect": {"str": "00"}`,
    `"expect": {"int": 1}, "tolerance": {"abs": "1e999", "section": "2", "quote": "q"}`,
    `clauses[0].tolerance.abs: "1e999" is past binary64's largest finite value and rounds to an infinity (IEEE 754-2019 §7.4); write Infinity or -Infinity if that is meant`,
  )

  // An iterated vector: enc(b) takes one parameter, so one name and one next element.
  const exp = `"expect": {"str": "00"}`
  const ok = `{"count": 2, "names": ["b"], "next": [{"call": "enc", "args": [{"var": "b"}]}]}`
  t.eqStr("an iterated vector passes", shapeErrorsOf(exp, shapeIter(ok)).join("\n"), "")
  t.eqStr(
    "an iterated vector that says it is slow passes",
    shapeErrorsOf(exp, shapeIter(replaceAll(ok, "}]}]}", '}]}], "slow": true}'))).join("\n"),
    "",
  )
  shapeExpect(
    t,
    exp,
    shapeIter(replaceAll(ok, `"count": 2`, `"count": 0`)),
    "read: clauses[0].iterate.count: an integer in 1..1000000000",
  )
  shapeExpect(
    t,
    exp,
    shapeIter(replaceAll(ok, `["b"]`, `["b", "c"]`)),
    "clauses[0].iterate.names: one name per parameter of enc: 1, got 2",
  )
  shapeExpect(
    t,
    exp,
    shapeIter(replaceAll(replaceAll(ok, `["b"]`, `["enc"]`), `"var": "b"`, `"var": "enc"`)),
    `clauses[0].iterate.names[0]: "enc" shadows a function`,
  )
  shapeExpect(
    t,
    exp,
    shapeIter(replaceAll(ok, `"var": "b"`, `"var": "c"`)),
    "clauses[0].iterate.next[0]: a call is enc on the names, in order",
  )
  shapeExpect(
    t,
    exp,
    shapeIter(replaceAll(ok, `{"call": "enc", "args": [{"var": "b"}]}`, `{"var": "c"}`)),
    `clauses[0].iterate.next[0]: "c" is not one of the names`,
  )
  shapeExpect(
    t,
    exp,
    shapeIter(replaceAll(ok, `{"call": "enc", "args": [{"var": "b"}]}`, `{"var": "b"}`)),
    "clauses[0].iterate.next: no element is enc on the names, so nothing feeds the result back",
  )
  shapeExpect(
    t,
    exp,
    shapeIter(replaceAll(ok, `{"call": "enc", "args": [{"var": "b"}]}`, `{"call": "dec", "args": [{"var": "b"}]}`)),
    "clauses[0].iterate.next[0]: a call is enc on the names, in order",
  )
  shapeExpect(
    t,
    exp,
    shapeIter(replaceAll(ok, "]}]}", `]}, {"var": "b"}]}`)),
    "clauses[0].iterate.next: one element per parameter of enc: 1, got 2",
  )
  shapeExpect(
    t,
    exp,
    shapeIter(replaceAll(ok, `"count": 2`, `"count": 1000000001`)),
    "read: clauses[0].iterate.count: an integer in 1..1000000000",
  )
  t.eqStr(
    "the largest count passes",
    shapeErrorsOf(exp, shapeIter(replaceAll(ok, `"count": 2`, `"count": 1000000000`))).join("\n"),
    "",
  )
  shapeExpect(
    t,
    exp,
    shapeIter(replaceAll(ok, `["b"]`, `["b", "b"]`)),
    `clauses[0].iterate.names[1]: "b" repeats names[0]`,
  )
  shapeExpect(t, exp, shapeIter(replaceAll(ok, `["b"]`, `["2b"]`)), "clauses[0].iterate.names[0]: an identifier")
  shapeExpect(
    t,
    exp,
    `"expect": {"null": true}, "iterate": ${ok}`,
    "clauses[0].iterate: an iterated vector's expect is a value its call returns, not null or a bool",
  )
  shapeExpect(
    t,
    exp,
    `"expect": {"bool": true}, "iterate": ${ok}`,
    "clauses[0].iterate: an iterated vector's expect is a value its call returns, not null or a bool",
  )
  shapeExpect(
    t,
    exp,
    `"expect": {"int": 1}, "tolerance": {"abs": "1", "section": "2", "quote": "q"}, "iterate": ${ok}`,
    "clauses[0].iterate: an iterated vector compares its last result exactly; drop the tolerance",
  )

  // Literals.
  shapeExpect(
    t,
    `{"hex": "00"}`,
    `{"hex": "0A"}`,
    "clauses[0].args[0].hex: lowercase hex with an even number of digits",
  )
  shapeExpect(t, `{"hex": "00"}`, `{"hex": "0"}`, "clauses[0].args[0].hex: lowercase hex with an even number of digits")
  shapeExpect(
    t,
    `{"hex": "00"}`,
    `{"hex": "00", "label": "1"}`,
    "clauses[0].args[0].label: the name the RFC prints the value under, with a letter",
  )
  shapeExpect(t, `{"hex": "00"}`, `{"hex": "00", "unchecked": " "}`, "clauses[0].args[0].unchecked: a non-empty reason")
  shapeExpect(t, `{"hex": "00"}`, `{"str": "é"}`, "clauses[0].args[0].str: a string of printable ASCII, tab, LF or CR")
  shapeExpect(
    t,
    `{"hex": "00"}`,
    `{"concat": [{"hex": "0g"}]}`,
    "clauses[0].args[0].concat[0].hex: lowercase hex with an even number of digits",
  )
  // Word arrays: each width, its spelling, and what a word list may not be.
  const wordOk: string[] = [
    `{"words16": ["0x1111", "0x2222"]}`,
    `{"words32": ["11111111", "22222222"], "label": "State"}`,
    `{"words64": ["0x0123456789abcdef"], "unchecked": "the RFC prints it once"}`,
  ]
  for (const w of wordOk) {
    t.eqStr(`${w} reads`, shapeErrorsOf(`{"hex": "00"}`, w).join("\n"), "")
  }
  const wordBad: string[] = [
    `{"words32": ["1111111"]}`,
    "clauses[0].args[0].words32: words of 8 lowercase hex digits, with 0x on every word or on none",
    `{"words32": ["0x1111"]}`,
    "clauses[0].args[0].words32: words of 8 lowercase hex digits, with 0x on every word or on none",
    `{"words16": ["11111111"]}`,
    "clauses[0].args[0].words16: words of 4 lowercase hex digits, with 0x on every word or on none",
    `{"words64": ["11111111"]}`,
    "clauses[0].args[0].words64: words of 16 lowercase hex digits, with 0x on every word or on none",
    `{"words32": ["1111111A"]}`,
    "clauses[0].args[0].words32: words of 8 lowercase hex digits, with 0x on every word or on none",
    `{"words32": ["1111111g"]}`,
    "clauses[0].args[0].words32: words of 8 lowercase hex digits, with 0x on every word or on none",
    `{"words32": ["0x11111111", "22222222"]}`,
    "clauses[0].args[0].words32: words of 8 lowercase hex digits, with 0x on every word or on none",
    `{"words32": ["0X11111111"]}`,
    "clauses[0].args[0].words32: words of 8 lowercase hex digits, with 0x on every word or on none",
    `{"words32": []}`,
    "read: clauses[0].args[0].words32: a non-empty array",
    `{"words32": [1]}`,
    "read: clauses[0].args[0].words32[0]: a string",
    `{"words32": ["11111111"], "label": "1"}`,
    "clauses[0].args[0].label: the name the RFC prints the value under, with a letter",
    `{"words32": ["11111111"], "hex": "00"}`,
    'read: clauses[0].args[0]: unknown field "words32"',
  ]
  for (let i = 0; i + 1 < wordBad.length; i += 2) {
    shapeExpect(t, `{"hex": "00"}`, wordBad[i], wordBad[i + 1])
  }
  shapeExpect(
    t,
    `{"hex": "00"}`,
    `{"f64": "1."}`,
    "clauses[0].args[0].f64: decimal text (RFC 8259 §6 number syntax), NaN, Infinity or -Infinity",
  )
  shapeExpect(
    t,
    `{"hex": "00"}`,
    `{"f64": "2e308"}`,
    `clauses[0].args[0].f64: "2e308" is past binary64's largest finite value and rounds to an infinity (IEEE 754-2019 §7.4); write Infinity or -Infinity if that is meant`,
  )
  shapeExpect(
    t,
    `{"hex": "00"}`,
    `{"f64": "1", "bits": "3FF0000000000000"}`,
    "clauses[0].args[0].bits: the binary64 encoding as 16 lowercase hex digits (IEEE 754-2019 §3.4)",
  )
  shapeExpect(
    t,
    `{"hex": "00"}`,
    `{"f64": "0.1", "bits": "3fb999999999999b"}`,
    "clauses[0].args[0].bits: 0.1 reads as 3fb999999999999a (roundTiesToEven, IEEE 754-2019 §5.12.2), not 3fb999999999999b",
  )
  shapeExpect(
    t,
    `{"hex": "00"}`,
    `{"f64": "NaN", "bits": "7ff0000000000000"}`,
    "clauses[0].args[0].bits: 7ff0000000000000 is not a NaN encoding",
  )
  t.eqStr(
    "a NaN with a NaN encoding passes",
    shapeErrorsOf(`{"hex": "00"}`, `{"f64": "NaN", "bits": "7ff8000000000001"}`).join("\n"),
    "",
  )
  t.eqStr(
    "matching bits pass",
    shapeErrorsOf(`{"hex": "00"}`, `{"f64": "-0", "bits": "8000000000000000"}`).join("\n"),
    "",
  )

  // Property clauses.
  shapeExpect(
    t,
    `"min": 0, "max": 255`,
    `"min": 0, "max": 256`,
    "clauses[1].forall[0]: u8 needs min <= max, both in 0..255",
  )
  shapeExpect(
    t,
    `"min": 0, "max": 255`,
    `"min": 9, "max": 8`,
    "clauses[1].forall[0]: u8 needs min <= max, both in 0..255",
  )
  shapeExpect(t, `"name": "x", "type": "u8"`, `"name": "x y", "type": "u8"`, "clauses[1].forall[0].name: an identifier")
  // A property's samples is its total, 1..256: 0 would be a test of nothing.
  const prop = `"assert": {"op": "<=", "args": [{"var": "x"}, {"int": 255}]}`
  t.eqStr(
    "samples 0 does not read",
    shapeErrorsOf(prop, `${prop}, "samples": 0`).join("\n"),
    "read: clauses[1].samples: an integer in 1..256",
  )
  t.eqStr(
    "samples 257 does not read",
    shapeErrorsOf(prop, `${prop}, "samples": 257`).join("\n"),
    "read: clauses[1].samples: an integer in 1..256",
  )
  t.eqStr("samples 1 reads", shapeErrorsOf(prop, `${prop}, "samples": 1`).join("\n"), "")
  t.eqStr("samples 256 reads", shapeErrorsOf(prop, `${prop}, "samples": 256`).join("\n"), "")
  const f64Var = `"name": "x", "type": "f64"`
  shapeExpect(
    t,
    `"name": "x", "type": "u8", "min": 0, "max": 255`,
    `${f64Var}, "min": "NaN", "max": "1"`,
    "clauses[1].forall[0].min: decimal text (RFC 8259 §6 number syntax), Infinity or -Infinity (a bound cannot be NaN: it orders nothing, IEEE 754-2019 §5.11)",
  )
  shapeExpect(
    t,
    `"name": "x", "type": "u8", "min": 0, "max": 255`,
    `${f64Var}, "min": "2", "max": "1"`,
    "clauses[1].forall[0]: f64 needs min <= max",
  )
  shapeExpect(
    t,
    `"name": "x", "type": "u8", "min": 0, "max": 255`,
    `"name": "x", "type": "bytes", "minLen": 5, "maxLen": 4`,
    "clauses[1].forall[0]: bytes needs integer 0 <= minLen <= maxLen <= 4096",
  )
  const strVar = `"name": "x", "type": "string", "minLen": 0, "maxLen": 4`
  shapeExpect(
    t,
    `"name": "x", "type": "u8", "min": 0, "max": 255`,
    `${strVar}, "alphabet": []`,
    "clauses[1].forall[0].alphabet: a non-empty array of characters and classes",
  )
  shapeExpect(
    t,
    `"name": "x", "type": "u8", "min": 0, "max": 255`,
    `${strVar}, "alphabet": ["digit", "ab"]`,
    "clauses[1].forall[0].alphabet[1]: one printable ASCII character (or tab, LF, CR) or a class: hexdigit HEXDIGIT digit alpha space ascii-printable",
  )
  shapeExpect(t, `{"var": "x"}`, `{"var": "1x"}`, "clauses[1].assert.args[0].var: an identifier")
  shapeExpect(
    t,
    `"op": "<="`,
    `"op": "=<"`,
    "clauses[1].assert.op: one of len concat slice zeros fill flipBit xor bitAnd bitOr unwrap isNull notNull + - * % le16 le32 le64 be16 be32 be64 leU16 leU32 leU64 beU16 beU32 beU64 leI32 leI64 beI32 beI64 < <= > >= == != and or not implies strLen strConcat lower upper utf8 ascii charAt",
  )

  // outOfScope and allowSurvivors.
  const oos = `"functions"`
  shapeExpect(
    t,
    oos,
    `"outOfScope": [{"name": "enc", "reason": "r"}], "functions"`,
    `outOfScope[0].name: "enc" is a function the contract tests, so it cannot be out of scope`,
  )
  shapeExpect(
    t,
    oos,
    `"outOfScope": [{"name": "dec", "reason": "r"}, {"name": "dec", "reason": "r"}], "functions"`,
    `outOfScope[1].name: duplicate "dec"`,
  )
  shapeExpect(
    t,
    oos,
    `"allowSurvivors": [{"file": "std/other.ts", "line": 1, "reason": "r"}], "functions"`,
    "allowSurvivors[0].file: std/other.ts is not the target module's file std/hex.ts",
  )
  shapeExpect(
    t,
    oos,
    `"allowSurvivors": [{"file": "std/hex.ts", "line": 1, "reason": "r"}, {"file": "std/hex.ts", "line": 1, "reason": "r"}], "functions"`,
    "allowSurvivors[1]: duplicate allowance for std/hex.ts:1",
  )

  // Every error is reported, not just the first.
  const many = shapeErrorsOf(`"c1"`, `"-"`).length + shapeErrorsOf(`"MUST"`, `"X"`).length
  const both = contractShapeErrors(
    contractParse(replaceAll(replaceAll(BASE, `"c1"`, `"-"`), `"MUST"`, `"X"`), "b").expect("reads"),
  ).length
  t.ok("two errors are both reported", many === 2 && both === 2)

  // The reader refuses values the schema does not allow, each with its reason.
  const v = `{"str": "00"}`
  const tol = `"expect": {"f64": "1", "bits": "3ff0000000000000"}, "tolerance": `
  const neg: string[] = [
    v,
    `{"int": 9007199254740992}`,
    "read: clauses[0].expect.int: an integer within ±(2^53−1), or a decimal string for one beyond it (RFC 7493 §2.2)",
    v,
    `{"int": "42"}`,
    'read: clauses[0].expect.int: "42" fits in ±(2^53−1), so it is written as a JSON integer, not a string (RFC 7493 §2.2)',
    v,
    `{"f64": 0.1}`,
    "read: clauses[0].expect.f64: a string",
    v,
    `{"f64": "1", "bits": "3ff0"}`,
    "clauses[0].expect.bits: the binary64 encoding as 16 lowercase hex digits (IEEE 754-2019 §3.4)",
    `"expect": {"str": "00"}`,
    `${tol}{"ulps": -1, "section": "2", "quote": "q"}`,
    "read: clauses[0].tolerance.ulps: an integer in 0..9007199254740991",
    `"expect": {"str": "00"}`,
    `${tol}{"abs": "1", "ulps": 1, "section": "2", "quote": "q"}`,
    'read: clauses[0].tolerance: an object with one of "abs" or "ulps"',
    `"quote": "Q"`,
    `"quote": ""`,
    "requirements[0].quote: a non-empty string",
    `"module": "nish/hex"`,
    `"module": "nish"`,
    "contract.target.module: a module path <root>/<segment>/…, lowercase [a-z][a-z0-9_]* segments (RFC 3986 §3.3)",
    `"type": "u8"`,
    `"type": "i128"`,
    'read: clauses[1].forall[0].type: an integer type (i8 i16 i32 i64 u8 u16 u32 u64), "f64", "bytes" or "string"',
    `"returns": "string"`,
    `"returns": "u64??"`,
    "functions[0].returns: one of bytes bytes? string string? bool bool? f64 f64? secret-bytes secret-bytes? i8 i8? i16 i16? i32 i32? i64 i64? u8 u8? u16 u16? u32 u32? u64 u64? words16 words16? words32 words32? words64 words64?",
    `"target": {"module": "nish/hex"}`,
    `"target": {"module": "nish/hex", "lang": "x"}`,
    'read: contract.target: unknown field "lang"',
    `"min": 0, "max": 255`,
    `"min": 0, "max": 255, "ulps": 1`,
    'read: clauses[1].forall[0]: unknown field "ulps"',
  ]
  for (let i = 0; i + 2 < neg.length; i += 3) {
    t.eqStr(`refused: ${neg[i + 1]}`, shapeErrorsOf(neg[i], neg[i + 1]).join(" | "), neg[i + 2])
  }

  // The helpers.
  t.eqStr("nish module file", shapeNishModuleFile("nish/crypto/hkdf") ?? "", "std/crypto/hkdf.ts")
  t.ok("a module outside nish has no file", shapeNishModuleFile("go/hex") === null)
  t.ok("a .. module has no file", shapeNishModuleFile("nish/../x") === null)
  t.eqStr("hexdigit", (shapeAlphabetChars("hexdigit") ?? []).join(""), "0123456789abcdef")
  t.eqStr("HEXDIGIT", (shapeAlphabetChars("HEXDIGIT") ?? []).join(""), "0123456789ABCDEF")
  t.ok("space", (shapeAlphabetChars("space") ?? []).length === 4)
  t.ok("ascii-printable", (shapeAlphabetChars("ascii-printable") ?? []).length === 95)
  t.ok("alpha", (shapeAlphabetChars("alpha") ?? []).length === 52)
  t.ok(
    "every class spells characters",
    shapeAlphabetClasses().every((c: string): boolean => shapeAlphabetChars(c) !== null),
  )
  t.ok("hexOf is reserved", shapeTestNames().indexOf("hexOf") >= 0)
  t.ok("v_ is a reserved prefix", shapeTestPrefixes().indexOf("v_") >= 0)

  // Loading runs both checks.
  t.ok("contractLoad accepts the base", contractLoad(BASE, "base").isOk())
  const bad = contractLoad(replaceAll(BASE, `"c1"`, `"-"`), "base")
  t.ok(
    "contractLoad reports a shape error",
    bad.isErr() && bad.error[0] === "contract.contract: an id ([A-Za-z0-9._-])",
  )
  const unread = contractLoad("{", "base")
  t.ok("contractLoad reports a read error", unread.isErr())
  t.ok("contractLoadFile reads a committed contract", contractLoadFile("contracts/example-hex.json").isOk())
  const missing = contractLoadFile("contracts/none.json")
  t.ok(
    "contractLoadFile reports a missing file",
    missing.isErr() && missing.error[0] === "contracts/none.json: cannot be read",
  )
  return t.done()
}
