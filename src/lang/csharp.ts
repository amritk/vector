/**
 * `lang/csharp` — the C# table: how C# writes each construct of the
 * contract vocabulary, and what it drops. Its name and module rules are in
 * `lang/names`.
 */

import { LangTable, langSpell, langUnsupported } from "./table"

/**
 * The C# table.
 *
 * @returns C#'s mapping of every construct, its standards and its choices
 */
export const langTableCsharp = (): LangTable => {
  const t = new LangTable(
    "csharp",
    "C#",
    "ECMA-334 (C# Language Specification), Types › Simple types and Nullable value types",
    ".NET Framework Design Guidelines, Capitalization Conventions (PascalCase members, camelCase parameters; two-letter acronyms in capitals)",
  )
  t.type(
    "bytes",
    langSpell("byte[]", "a ReadOnlySpan<byte> input would avoid a copy; byte[] is chosen for one type in and out"),
  )
  t.type("string", langSpell("string", "UTF-16; every Unicode scalar value is representable"))
  t.type("bool", langSpell("bool", ""))
  t.type("f64", langSpell("double", "IEC 60559 binary64"))
  t.type(
    "secret-bytes",
    langSpell("byte[]", "no secret type; secrecy is dropped (CryptographicOperations.ZeroMemory can wipe a copy)"),
  )
  t.type("i8", langSpell("sbyte", ""))
  t.type("i16", langSpell("short", ""))
  t.type("i32", langSpell("int", ""))
  t.type("i64", langSpell("long", ""))
  t.type("u8", langSpell("byte", ""))
  t.type("u16", langSpell("ushort", ""))
  t.type("u32", langSpell("uint", ""))
  t.type("u64", langSpell("ulong", ""))
  t.outcome(
    "refusing-return",
    langSpell(
      "{T}?",
      "null is the refusal: a nullable reference type for byte[] and string, Nullable<T> for value types",
    ),
  )
  t.outcome(
    "optional-input",
    langSpell(
      "{T}?",
      "null is the absent argument; byte[]? and string? assume a nullable context (<Nullable>enable</Nullable>)",
    ),
  )
  t.literal("hex", langSpell("new byte[] { 0x0b, 0x0b }", 'or Convert.FromHexString("0b0b")'))
  t.literal("ascii", langSpell('"abc"u8.ToArray()', "a UTF-8 literal (C# 11), ASCII being a subset"))
  t.literal("str", langSpell('"abc"', "non-ASCII as \\u escapes, a scalar above U+FFFF as \\U"))
  t.literal(
    "int",
    langSpell(
      "42u",
      "per width: sbyte, short, byte and ushort by a cast ((sbyte)-128), int bare, uint 42u, long 42L, ulong 42UL; -2147483648 and -9223372036854775808 are valid as written",
    ),
  )
  t.literal(
    "f64",
    langSpell(
      "BitConverter.UInt64BitsToDouble(0x3ff8000000000000UL)",
      "from its bits (.NET 6), so -0 and NaN payloads are exact; Int64BitsToDouble would not take a hex literal with the sign bit set, which is a ulong (C# spec §6.4.5.3)",
    ),
  )
  t.literal("bool", langSpell("true", ""))
  t.literal("null", langSpell("null", ""))
  t.literal("concat", langSpell("[.. a, .. b]", "a collection expression (C# 12)"))
  t.moduleForm = "class"
  t.moduleNote =
    "a static class named for the last segment, in a namespace of the others, all PascalCase (Design Guidelines, Names of Namespaces): nish/crypto/hkdf → static class Hkdf in namespace Nish.Crypto"
  t.nameRule =
    "methods PascalCase and parameters camelCase: words split at each capital, a digit run stays on the word before it (hkdfExpandSha256 → HkdfExpandSha256), a two-letter acronym stays in capitals and a longer one is cased like a word (readIOStream → ReadIOStream, parseHTTPRequest → ParseHttpRequest). A parameter whose camelCase name is a keyword (in, out, string, object, params, event, base) is written with @ (@in) or takes a name override. A name override always wins."
  t.choices.push(
    "A refusing return is a null return ({T}?), not a thrown exception or the Try pattern (bool TryX(..., out T)): a refusal is an expected outcome, tested by the vectors, and null maps the contract's null one-to-one. An implementation that throws ArgumentException is still checkable by mapping the throw to the refusal.",
  )
  t.choices.push("bytes are byte[] in both positions, though ReadOnlySpan<byte> would avoid a copy on input.")
  t.choices.push(
    "A namespace holds no functions, so the module is a static class of static methods named for its last segment. A method whose PascalCase name equals that class's name is CS0542, so it takes a name override.",
  )
  return t
}
