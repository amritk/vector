import { JSON_VALUE_NONE, JsonDocument, JsonValue } from "nish/json-value"
import { Suite } from "nish/testing"
import { newJsonDocument, readJsonFile } from "../../../src/core/json"
import { charsIsWordList } from "../../../src/spec/contract/chars"
import { typesWordsKey, typesWordsKind } from "../../../src/spec/contract/types"
import {
  Outcome,
  VOCAB_JSON_SAFE_MAX,
  vocabBaseOf,
  vocabBaseTypes,
  vocabCompareDecimal,
  vocabFitsInt,
  vocabHas,
  vocabIntMax,
  vocabIntMin,
  vocabIntTypes,
  vocabIsBinding,
  vocabIsDecimal,
  vocabIsIntType,
  vocabIsJsonSafe,
  vocabIsOptional,
  vocabIsWordType,
  vocabLanguages,
  vocabLevels,
  vocabLiteralKinds,
  vocabOps,
  vocabOutcomeOf,
  vocabSigTypes,
  vocabValueType,
  vocabWordDigits,
  vocabWordTypes,
} from "../../../src/spec/contract/vocab"

/** The strings of a JSON array. */
const vocabTestStrings = (doc: JsonDocument, a: JsonValue): string[] => {
  const out: string[] = []
  for (let i = 0; i < doc.length(a); i++) {
    out.push(doc.string(doc.at(a, i)))
  }
  return out
}

/** The keys of a JSON object, in order. */
const vocabTestKeys = (doc: JsonDocument, o: JsonValue): string[] => {
  const out: string[] = []
  for (let i = 0; i < doc.length(o); i++) {
    out.push(doc.keyAt(o, i))
  }
  return out
}

/** The enum of the schema definition `name`. */
const vocabTestEnum = (doc: JsonDocument, defs: JsonValue, name: string): string[] =>
  vocabTestStrings(doc, doc.get(doc.get(defs, name), "enum"))

/** Whether two lists hold the same strings, ignoring order. */
const vocabTestSameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((s: string): boolean => b.indexOf(s) >= 0)

/** The vocabulary against schemas/rfc-contract.json, and the vocabulary's helpers. */
export const main = (): i32 => {
  const t = new Suite("spec/contract vocab")
  const doc = newJsonDocument()
  const read = readJsonFile(doc, "schemas/rfc-contract.json")
  if (read.isErr()) {
    t.fail("schema reads", read.error)
    return t.done()
  }
  const defs = doc.get(read.value, "$defs")
  t.eqStr("paramType is SIG_TYPES", vocabTestEnum(doc, defs, "paramType").join(" "), vocabSigTypes().join(" "))
  t.eqStr("returnType is SIG_TYPES", vocabTestEnum(doc, defs, "returnType").join(" "), vocabSigTypes().join(" "))
  t.eqStr("intType is INT_TYPES", vocabTestEnum(doc, defs, "intType").join(" "), vocabIntTypes().join(" "))
  const level = doc.get(doc.get(doc.get(defs, "requirement"), "properties"), "level")
  t.eqStr("level is LEVELS", vocabTestStrings(doc, doc.get(level, "enum")).join(" "), vocabLevels().join(" "))
  const langs = vocabTestKeys(doc, doc.get(doc.get(defs, "nameOverrides"), "properties"))
  t.ok("nameOverrides is LANGUAGES", vocabTestSameSet(langs, vocabLanguages()))
  const mods = vocabTestKeys(doc, doc.get(doc.get(defs, "moduleOverrides"), "properties"))
  t.ok("moduleOverrides is LANGUAGES", vocabTestSameSet(mods, vocabLanguages()))
  const forms = doc.get(doc.get(defs, "literal"), "anyOf")
  const kinds: string[] = []
  for (let i = 0; i < doc.length(forms); i++) {
    kinds.push(doc.keyAt(doc.get(doc.at(forms, i), "properties"), 0))
  }
  t.eqStr("literal anyOf is LITERAL_KINDS", kinds.join(" "), vocabLiteralKinds().join(" "))
  const exprs = doc.get(doc.get(defs, "expr"), "anyOf")
  let ops: string[] = []
  for (let i = 0; i < doc.length(exprs); i++) {
    const op = doc.get(doc.get(doc.at(exprs, i), "properties"), "op")
    if (doc.kind(op) !== JSON_VALUE_NONE) {
      ops = vocabTestStrings(doc, doc.get(op, "enum"))
    }
  }
  t.eqStr("op is OPS", ops.join(" "), vocabOps().join(" "))

  // The helpers.
  t.ok(
    "base types are unoptional",
    vocabBaseTypes().every((b: string): boolean => !vocabIsOptional(b)),
  )
  t.ok("vocabHas", vocabHas(vocabOps(), "xor") && !vocabHas(vocabOps(), "pow"))
  t.ok("MUST binds", vocabIsBinding("MUST") && vocabIsBinding("SHALL NOT"))
  t.ok("SHOULD and MAY do not bind", !vocabIsBinding("SHOULD") && !vocabIsBinding("MAY"))
  t.eqStr("base of u8?", vocabBaseOf("u8?"), "u8")
  t.eqStr("base of bytes", vocabBaseOf("bytes"), "bytes")
  t.eqStr("secret-bytes is bytes", vocabValueType("secret-bytes?"), "bytes?")
  t.ok("bytes? return outcome", vocabOutcomeOf(true, "bytes?") === Outcome.RefusingReturn)
  t.ok(
    "param outcomes",
    vocabOutcomeOf(false, "bytes?") === Outcome.OptionalInput && vocabOutcomeOf(false, "bytes") === Outcome.None,
  )
  t.ok("u64 is an int type", vocabIsIntType("u64") && !vocabIsIntType("f64"))
  t.ok(
    "decimals",
    vocabIsDecimal("-12") &&
      vocabIsDecimal("0") &&
      !vocabIsDecimal("01") &&
      !vocabIsDecimal("-0") &&
      !vocabIsDecimal("1.0"),
  )
  t.ok(
    "compare",
    vocabCompareDecimal("-5", "3") < 0 && vocabCompareDecimal("100", "99") > 0 && vocabCompareDecimal("7", "7") === 0,
  )
  t.ok("compare negatives", vocabCompareDecimal("-100", "-99") < 0)
  t.eqStr("i64 min", vocabIntMin("i64"), "-9223372036854775808")
  t.eqStr("u64 max", vocabIntMax("u64"), "18446744073709551615")
  t.eqStr("u8 min", vocabIntMin("u8"), "0")
  t.eqStr("i16 max", vocabIntMax("i16"), "32767")
  t.ok("fits", vocabFitsInt("255", "u8") && !vocabFitsInt("256", "u8") && !vocabFitsInt("-1", "u64"))
  t.ok("i64 bounds fit", vocabFitsInt("-9223372036854775808", "i64") && !vocabFitsInt("9223372036854775808", "i64"))
  t.eqStr("JSON safe max", VOCAB_JSON_SAFE_MAX, "9007199254740991")
  t.ok("2^53-1 is JSON safe", vocabIsJsonSafe("9007199254740991") && vocabIsJsonSafe("-9007199254740991"))
  t.ok("2^53 is not", !vocabIsJsonSafe("9007199254740992") && !vocabIsJsonSafe("-9007199254740992"))

  t.eqLines("the word-array types", vocabWordTypes(), ["words16", "words32", "words64"])
  const wordTypes: string[] = ["words16", "words32", "words64", "words8", "words32?", "bytes", "u32", ""]
  const wordDigits: i32[] = [4, 8, 16, 0, 0, 0, 0, 0]
  for (let i = 0; i < wordTypes.length; i++) {
    t.ok(`${wordTypes[i]} is a word type: ${wordDigits[i] > 0}`, vocabIsWordType(wordTypes[i]) === wordDigits[i] > 0)
    t.ok(`${wordTypes[i]} words have ${wordDigits[i]} digits`, vocabWordDigits(wordTypes[i]) === wordDigits[i])
  }
  for (const d of [4, 8, 16]) {
    t.eqStr(`the kind of ${d}-digit words`, typesWordsKey(typesWordsKind(d)), `words${d * 4}`)
  }

  const lists: string[][] = [
    ["0x11111111", "0x01020304"],
    ["11111111", "01020304"],
    ["0x11111111", "01020304"],
    ["11111111", "0x01020304"],
    ["1111111", "01020304"],
    ["0x1111111f1", "0x01020304"],
    ["0X11111111"],
    ["1111111F"],
    ["ffff"],
    ["ffffffffffffffff"],
    [],
  ]
  const listDigits: i32[] = [8, 8, 8, 8, 8, 8, 8, 8, 4, 16, 8]
  const listOk: boolean[] = [true, true, false, false, false, false, false, false, true, true, false]
  for (let i = 0; i < lists.length; i++) {
    t.ok(
      `[${lists[i].join(" ")}] is ${listOk[i] ? "" : "not "}a ${listDigits[i]}-digit word list`,
      charsIsWordList(lists[i], listDigits[i]) === listOk[i],
    )
  }
  t.ok("8-digit words are not 4-digit words", !charsIsWordList(["11111111"], 4))
  return t.done()
}
