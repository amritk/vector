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
    "functions[0].returns: one of bytes bytes? string string? bool bool? f64 f64? secret-bytes secret-bytes? i8 i8? i16 i16? i32 i32? i64 i64? u8 u8? u16 u16? u32 u32? u64 u64?",
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
    "clauses[1].assert.op: one of len concat slice zeros fill flipBit xor bitAnd bitOr unwrap isNull notNull + - * % le64 < <= > >= == != and or not implies strLen strConcat lower upper utf8 ascii charAt",
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
