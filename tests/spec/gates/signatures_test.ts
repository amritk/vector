import { Suite } from "nish/testing"
import { CheckContext, CheckNote } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { gateWarnings } from "../../../src/spec/gates/note"
import { GateModuleSig, gateModuleSignatures, gateNishType, gateSignatures } from "../../../src/spec/gates/signatures"

/** A contract whose declarations match the fixture module, or don't. */
const SIGNATURES_TEST_C: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/fixtures/sig_module"},
  "requirements": [],
  "functions": [
    {"name": "derive", "params": [{"name": "s", "type": "bytes?"}, {"name": "k", "type": "secret-bytes"}, {"name": "n", "type": "u32"}], "returns": "bytes"},
    {"name": "check", "params": [{"name": "a", "type": "string"}, {"name": "b", "type": "string"}], "returns": "bool"},
    {"name": "pick", "params": [{"name": "a", "type": "bytes"}], "returns": "bytes"},
    {"name": "quarter", "params": [{"name": "s", "type": "words32"}, {"name": "a", "type": "i32"}], "returns": "words32?"},
    {"name": "wordsOut", "params": [{"name": "k", "type": "bytes"}], "returns": "bytes"},
    {"name": "bytesOut", "params": [{"name": "k", "type": "words32"}], "returns": "words32"},
    {"name": "narrow", "params": [{"name": "k", "type": "words64"}], "returns": "words64"},
    {"name": "maybeOut", "params": [{"name": "k", "type": "words32"}], "returns": "words32"},
    {"name": "maybeIn", "params": [{"name": "k", "type": "words32"}], "returns": "words32"},
    {"name": "oneWord", "params": [{"name": "k", "type": "words32"}], "returns": "words32"},
    {"name": "halfWords", "params": [{"name": "k", "type": "words32"}], "returns": "words32"},
    {"name": "winRight", "params": [{"name": "d", "type": "bytes", "form": "window"}], "returns": "u32"},
    {"name": "winTwo", "params": [{"name": "a", "type": "bytes", "form": "window"}, {"name": "n", "type": "u32"}, {"name": "b", "type": "bytes", "form": "window"}], "returns": "u32"},
    {"name": "winPlain", "params": [{"name": "d", "type": "bytes", "form": "window"}], "returns": "u32"},
    {"name": "winUnsigned", "params": [{"name": "d", "type": "bytes", "form": "window"}], "returns": "u32"},
    {"name": "winOrder", "params": [{"name": "d", "type": "bytes", "form": "window"}], "returns": "u32"},
    {"name": "winShort", "params": [{"name": "d", "type": "bytes", "form": "window"}], "returns": "u32"},
    {"name": "winUndeclared", "params": [{"name": "d", "type": "bytes"}], "returns": "u32"},
    {"name": "outRight", "params": [{"name": "s", "type": "bytes", "form": "window"}, {"name": "level", "type": "i32"}], "returns": "bytes", "out": {"at": 1, "capacity": "64"}},
    {"name": "outFirst", "params": [{"name": "n", "type": "u32"}], "returns": "bytes?", "out": {"at": 0, "capacity": "8"}},
    {"name": "outLast", "params": [{"name": "k", "type": "bytes"}], "returns": "bytes", "out": {"at": 1, "capacity": "k.length"}},
    {"name": "outBytes", "params": [{"name": "k", "type": "bytes"}], "returns": "bytes", "out": {"at": 1, "capacity": "k.length"}},
    {"name": "outUnsignedEnd", "params": [{"name": "k", "type": "bytes"}], "returns": "bytes", "out": {"at": 1, "capacity": "k.length"}},
    {"name": "outNoAt", "params": [{"name": "k", "type": "bytes"}], "returns": "bytes", "out": {"at": 1, "capacity": "k.length"}},
    {"name": "outMoved", "params": [{"name": "k", "type": "bytes"}], "returns": "bytes", "out": {"at": 1, "capacity": "k.length"}},
    {"name": "outUnsignedAt", "params": [{"name": "k", "type": "bytes"}], "returns": "bytes", "out": {"at": 1, "capacity": "k.length"}},
    {"name": "outUndeclared", "params": [{"name": "k", "type": "bytes"}, {"name": "o", "type": "bytes"}, {"name": "at", "type": "i32"}], "returns": "bytes"},
    {"name": "hmac", "module": "nish/other", "params": [{"name": "a", "type": "bytes"}], "returns": "bytes"}
  ],
  "clauses": []
}`

/** A context for the contract, with the module found by path or under a root. */
const signaturesTestCtx = (file: string | null, root: string | null): CheckContext => {
  const ctx = new CheckContext("contracts/c1.json", ".")
  ctx.contract = contractParse(SIGNATURES_TEST_C, "c1").expect("parse")
  ctx.moduleFile = file
  ctx.nishRoot = root
  return ctx
}

/** One signature as text. */
const signaturesTestText = (s: GateModuleSig): string => `${s.name}(${s.params.join(", ")}): ${s.returns}`

/** The signatures gate. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/signatures")
  const sigs = gateModuleSignatures(
    "export const a = (x: u8[], y:  string |  null): i32 =>\nexport const b = (f: (n: i32) => i32, m: Map<string, u8[]>): void => {}\nexport const C = 1",
  )
  t.eqLines(
    "parsed signatures",
    sigs.map((s: GateModuleSig): string => signaturesTestText(s)),
    ["a(u8[], string | null): i32", "b((n: i32) => i32, Map<string, u8[]>): void"],
  )
  t.eqStr("bytes", gateNishType("u8[]"), "bytes")
  t.eqStr("optional bytes", gateNishType("null | u8[]"), "bytes?")
  t.eqStr("secret", gateNishType("Secret<u8[]> | null"), "secret-bytes?")
  t.eqStr("bool", gateNishType("boolean"), "bool")
  t.eqStr("an integer", gateNishType("u64"), "u64")
  t.eqStr("unknown", gateNishType("Map<string, i32>"), "?Map<string, i32>")
  t.eqStr("not Nish", gateNishType("bytes"), "?bytes")
  t.eqStr("u16 words", gateNishType("u16[]"), "words16")
  t.eqStr("u32 words", gateNishType("u32[]"), "words32")
  t.eqStr("optional u32 words", gateNishType("u32[] | null"), "words32?")
  t.eqStr("optional u64 words, null first", gateNishType("null | u64[]"), "words64?")
  t.eqStr("i32 words are not a word array", gateNishType("i32[]"), "?i32[]")
  t.eqStr("the contract's word is not Nish", gateNishType("words32"), "?words32")

  const fixture = "tests/spec/gates/fixtures/sig_module.txt"
  const all = gateSignatures(signaturesTestCtx(fixture, null))
  t.eqLines("findings", all, [
    "check: declared (string, string) -> bool, but nish/fixtures/sig_module has (string, Map<string, i32>): boolean",
    "pick: nish/fixtures/sig_module does not export pick",
    "wordsOut: declared (bytes) -> bytes, but nish/fixtures/sig_module has (u8[]): u32[]",
    "bytesOut: declared (words32) -> words32, but nish/fixtures/sig_module has (u32[]): u8[]",
    "narrow: declared (words64) -> words64, but nish/fixtures/sig_module has (u64[]): u16[]",
    "maybeOut: declared (words32) -> words32, but nish/fixtures/sig_module has (u32[]): u32[] | null",
    "maybeIn: declared (words32) -> words32, but nish/fixtures/sig_module has (u32[] | null): u32[]",
    "oneWord: declared (words32) -> words32, but nish/fixtures/sig_module has (u32[]): u32",
    "halfWords: declared (words32) -> words32, but nish/fixtures/sig_module has (u16[]): u32[]",
    "winPlain: declared (bytes, i32, i32) -> u32, but nish/fixtures/sig_module has (u8[]): u32",
    "winUnsigned: declared (bytes, i32, i32) -> u32, but nish/fixtures/sig_module has (u8[], u32, u32): u32",
    "winOrder: declared (bytes, i32, i32) -> u32, but nish/fixtures/sig_module has (i32, i32, u8[]): u32",
    "winShort: declared (bytes, i32, i32) -> u32, but nish/fixtures/sig_module has (u8[], i32): u32",
    "winUndeclared: declared (bytes) -> u32, but nish/fixtures/sig_module has (u8[], i32, i32): u32",
    "outBytes: declared (bytes, bytes, i32) -> i32 (its /* out */ is the (bytes, i32) pair at 1, returning end), but nish/fixtures/sig_module has (u8[], u8[], i32): u8[]",
    "outUnsignedEnd: declared (bytes, bytes, i32) -> i32 (its /* out */ is the (bytes, i32) pair at 1, returning end), but nish/fixtures/sig_module has (u8[], u8[], i32): u32",
    "outNoAt: declared (bytes, bytes, i32) -> i32 (its /* out */ is the (bytes, i32) pair at 1, returning end), but nish/fixtures/sig_module has (u8[], u8[]): i32",
    "outMoved: declared (bytes, bytes, i32) -> i32 (its /* out */ is the (bytes, i32) pair at 1, returning end), but nish/fixtures/sig_module has (u8[], i32, u8[]): i32",
    "outUnsignedAt: declared (bytes, bytes, i32) -> i32 (its /* out */ is the (bytes, i32) pair at 1, returning end), but nish/fixtures/sig_module has (u8[], u8[], u32): i32",
    "outUndeclared: declared (bytes, bytes, i32) -> bytes, but nish/fixtures/sig_module has (u8[], u8[], i32): i32",
  ])
  t.eqLines("under a nish root", gateSignatures(signaturesTestCtx(null, "tests/spec/gates/..")), [
    "signatures: cannot read tests/spec/gates/../std/fixtures/sig_module.ts, the source of nish/fixtures/sig_module",
  ])
  const none = signaturesTestCtx(null, null)
  t.ok("no module: no finding", gateSignatures(none).length === 0)
  t.ok(
    "no module: a warning",
    gateWarnings(none).some((n: CheckNote): boolean => n.message.indexOf("signatures were not checked") >= 0),
  )
  return t.done()
}
