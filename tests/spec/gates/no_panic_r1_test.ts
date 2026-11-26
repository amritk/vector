import { Suite } from "nish/testing"
import { split } from "nish/text"
import { CheckContext } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { gateQuoteWhole } from "../../../src/spec/gates/cite"
import { gateFidelity } from "../../../src/spec/gates/fidelity"
import { gateWarnings } from "../../../src/spec/gates/note"
import { gateModuleSignatures } from "../../../src/spec/gates/signatures"
import { gateTyping } from "../../../src/spec/gates/typing"
import { LoadedSource, SourceSet } from "../../../src/spec/source/load"
import { rfcParse } from "../../../src/spec/source/rfc"

/** RFC 4231 §4 with one 16-byte value under each call label, label i's bytes from 16 * i + 1 up. */
const noPanicR1Rfc = (labels: string[]): string => {
  const out = [
    "Request for Comments: 4231",
    "",
    "1.  Rules",
    "",
    "   It MUST derive.",
    "",
    "4.  Test Vectors",
    "",
    "   the key",
    "   = 0a0b0c0d",
    "",
  ]
  for (let i = 0; i < labels.length; i++) {
    out.push(`   ${labels[i]} =`)
    const digits = "0123456789abcdef"
    const bytes: string[] = []
    for (let b = 0; b < 16; b++) {
      const v = 16 * i + b + 1
      bytes.push(`${digits.substring(v / 16, v / 16 + 1)}${digits.substring(v % 16, (v % 16) + 1)}`)
    }
    out.push(`   ${bytes.join(" ")}`)
    out.push("")
  }
  return out.join("\n")
}

/** The findings and warnings for a vector of kdf citing §4, expecting the first label's value. */
const noPanicR1Kdf = (labels: string[]): string => {
  const contract = `{
  "contract": "c6",
  "source": {"title": "T", "rfc": 4231},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "1", "level": "MUST", "quote": "It MUST derive."}],
  "functions": [{"name": "kdf", "params": [{"name": "k", "type": "bytes"}], "returns": "bytes"}],
  "clauses": [
    {"kind": "vector", "id": "W1", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "4"}}, "call": "kdf",
     "args": [{"hex": "0a0b0c0d"}], "expect": {"hex": "0102030405060708090a0b0c0d0e0f10", "label": "${labels[0]}"}}
  ]
}`
  const ctx = new CheckContext("contracts/c6.json", ".")
  ctx.contract = contractParse(contract, "c6").expect("parse")
  const set = new SourceSet()
  set.main = "rfc4231"
  set.sources.push(new LoadedSource("rfc4231", "r.txt", "r.txt", rfcParse(noPanicR1Rfc(labels))))
  ctx.sources = set
  const out = gateFidelity(ctx)
  for (const n of gateWarnings(ctx)) {
    out.push(n.message)
  }
  return out.join("|")
}

/** A contract whose iterated vector feeds `mix` (two parameters) a count of names and next of its own. */
const noPanicR1Iterate = (names: string, next: string): string => {
  const contract = `{
  "contract": "c2",
  "source": {"title": "T", "rfc": 7748},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "5.2", "level": "MUST", "quote": "Q"}],
  "functions": [{"name": "mix", "params": [{"name": "a", "type": "bytes"}, {"name": "b", "type": "bytes"}], "returns": "bytes"}],
  "clauses": [
    {"kind": "vector", "id": "I1", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "5.2"}}, "call": "mix", "args": [{"hex": "00"}, {"hex": "00"}], "expect": {"hex": "00"},
     "iterate": {"count": 2, "names": [${names}], "next": [${next}]}}
  ]
}`
  const ctx = new CheckContext("contracts/c2.json", ".")
  ctx.contract = contractParse(contract, "c2").expect("parse")
  return gateTyping(ctx).join("|")
}

/** The names of a source's signatures. */
const noPanicR1Sigs = (source: string): string =>
  gateModuleSignatures(source)
    .map((s): string => s.name)
    .join(",")

/** The round-1 review's rows: the guards a refusal now reports instead of skipping. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/no_panic_r1")
  const variant =
    'the value is printed under "KDF (c=1)", one of "KDF (c=1)" or "KDF (c=3)" or "KDF (c=5)" in RFC §4 ("Test Vectors"), and nothing in the name kdf says which variant it computes: not checked that this is its own'
  const kdfRows: string[][] = [
    // Consecutive out of order: the highest is not the last.
    ["KDF (c=1)|KDF (c=3)|KDF (c=2)", ""],
    ["KDF (c=3)|KDF (c=2)|KDF (c=1)", ""],
    ["KDF (c=1)|KDF (c=2)|KDF (c=3)", ""],
    // Not consecutive: variants, not test cases.
    ["KDF (c=1)|KDF (c=3)|KDF (c=5)", variant],
  ]
  for (const r of kdfRows) {
    t.eqStr(`test cases counted by ${r[0]}`, noPanicR1Kdf(split(r[0], "|")), r[1])
  }

  t.eqBool("an empty quote is not whole", gateQuoteWhole("It MUST hold.", ""), false)
  t.eqBool("nor in an empty text", gateQuoteWhole("", ""), false)
  t.eqBool("a one-byte quote still is", gateQuoteWhole("a b", "b"), true)

  t.eqStr("a trailing export with no =", noPanicR1Sigs("export const a = (x: u8): u8 => x\nexport const name"), "a")
  t.eqStr("one with = and nothing after", noPanicR1Sigs("export const a = (x: u8): u8 => x\nexport const b ="), "a")
  t.eqStr("one cut in its parameters", noPanicR1Sigs("export const a = (x: u8): u8 => x\nexport const b = (x"), "a")
  t.eqStr("and one after a bare export", noPanicR1Sigs("export const name\nexport const b = (x: u8): u8 => x"), "b")

  const call = `{"call": "mix", "args": [{"var": "a"}, {"var": "b"}]}`
  t.eqStr("next and names fit", noPanicR1Iterate(`"a", "b"`, `${call}, {"var": "a"}`), "")
  t.eqStr(
    "next short of the parameters",
    noPanicR1Iterate(`"a", "b"`, call),
    "I1: iterate.next: mix takes 2 argument(s), got 1",
  )
  t.eqStr(
    "next past the parameters",
    noPanicR1Iterate(`"a", "b"`, `${call}, {"var": "a"}, {"var": "b"}`),
    "I1: iterate.next: mix takes 2 argument(s), got 3",
  )
  t.eqStr(
    "names short of the parameters",
    noPanicR1Iterate(`"a"`, `${call}, {"var": "a"}`),
    "I1: iterate.names: mix takes 2 argument(s), got 1",
  )
  return t.done()
}
