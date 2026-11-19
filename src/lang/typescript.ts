/**
 * `lang/typescript` — the TypeScript table: how TypeScript writes each construct of the
 * contract vocabulary, and what it drops. Its name and module rules are in
 * `lang/names`.
 */

import { LangTable, langSpell, langUnsupported } from "./table"

/**
 * The TypeScript table.
 *
 * @returns TypeScript's mapping of every construct, its standards and its choices
 */
export const langTableTypescript = (): LangTable => {
  const t = new LangTable(
    "typescript",
    "TypeScript",
    "ECMA-262 (ECMAScript 2024), §6.1.6.1 The Number Type, §6.1.6.2 The BigInt Type, §23.2 TypedArray Objects (Uint8Array)",
    "Google TypeScript Style Guide, Identifiers › Naming style and Camel case (lowerCamelCase; acronyms cased as whole words)",
  )
  t.type("bytes", langSpell("Uint8Array", ""))
  t.type(
    "string",
    langSpell("string", "UTF-16; a lone surrogate is also representable, and is the implementation's to refuse"),
  )
  t.type("bool", langSpell("boolean", ""))
  t.type(
    "f64",
    langSpell("number", "binary64, but a NaN payload is not preserved (ECMA-262 §6.1.6.1: all NaNs are one value)"),
  )
  t.type("secret-bytes", langSpell("Uint8Array", "no secret type; secrecy is dropped (fill(0) can wipe a copy)"))
  t.type("i8", langSpell("number", ""))
  t.type("i16", langSpell("number", ""))
  t.type("i32", langSpell("number", ""))
  t.type("i64", langSpell("bigint", "number is exact only to 2^53"))
  t.type("u8", langSpell("number", ""))
  t.type("u16", langSpell("number", ""))
  t.type("u32", langSpell("number", ""))
  t.type("u64", langSpell("bigint", "as i64"))
  t.outcome("refusing-return", langSpell("{T} | null", "null is the refusal"))
  t.outcome("optional-input", langSpell("{T} | undefined", "an optional parameter; undefined is the absent argument"))
  t.literal("hex", langSpell("Uint8Array.of(0x0b, 0x0b)", ""))
  t.literal("ascii", langSpell('new TextEncoder().encode("abc")', "UTF-8, of which ASCII is a subset"))
  t.literal("str", langSpell('"abc"', "non-ASCII and control characters as \\u{…} escapes"))
  t.literal("int", langSpell("42", "42n for i64 and u64"))
  t.literal(
    "f64",
    langSpell(
      "new DataView(Uint8Array.of(0x3f, 0xf8, 0, 0, 0, 0, 0, 0).buffer).getFloat64(0)",
      "from its bits, so -0 is exact; a NaN payload is lost",
    ),
  )
  t.literal("bool", langSpell("true", ""))
  t.literal("null", langSpell("null", ""))
  t.literal("concat", langSpell("Uint8Array.of(...a, ...b)", ""))
  t.type("words16", langSpell("Uint16Array", ""))
  t.type("words32", langSpell("Uint32Array", ""))
  t.type("words64", langSpell("BigUint64Array", ""))
  t.literal("words16", langSpell("Uint16Array.of(0x6170, 0x7865)", ""))
  t.literal("words32", langSpell("Uint32Array.of(0x61707865, 0x3320646e)", ""))
  t.literal("words64", langSpell("BigUint64Array.of(0x3320646e61707865n, 0x6b20657479622d32n)", ""))
  t.moduleForm = "file"
  t.moduleNote =
    'an ES module at the neutral path, imported as a namespace named for its last segment: nish/crypto/hkdf → import * as hkdf from "nish/crypto/hkdf", called hkdf.<name>; a - in a segment stays in the path and becomes _ in the namespace: nish/net/quic-packet → import * as quic_packet from "nish/net/quic-packet"'
  t.nameRule =
    "functions and parameters lowerCamelCase, an acronym cased as a whole word (the guide's loadHttpUrl): words split at each capital, a digit run stays on the word before it (parseHTTPRequest → parseHttpRequest, readIOStream → readIoStream, hkdfExpandSha256 → hkdfExpandSha256). A name that is a reserved word takes a name override."
  t.choices.push(
    "Widths up to 32 bits are number, and i64/u64 are bigint, so every integer is exact; the type no longer states the width.",
  )
  t.choices.push("f64 is number: every binary64 value but a NaN's payload is kept. That payload is dropped.")
  t.choices.push(
    "A refusing return is null and an optional input is undefined, so the two outcomes of ? keep different spellings.",
  )
  return t
}
