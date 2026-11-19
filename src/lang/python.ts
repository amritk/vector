/**
 * `lang/python` — the Python table: how Python writes each construct of the
 * contract vocabulary, and what it drops. Its name and module rules are in
 * `lang/names`.
 */

import { LangTable, langSpell, langUnsupported } from "./table"

/**
 * The Python table.
 *
 * @returns Python's mapping of every construct, its standards and its choices
 */
export const langTablePython = (): LangTable => {
  const t = new LangTable(
    "python",
    "Python",
    "The Python Language Reference, §3.2 The standard type hierarchy; PEP 484 (type hints), PEP 604 (X | None)",
    "PEP 8, Naming Conventions › Function and Variable Names",
  )
  t.type("bytes", langSpell("bytes", ""))
  t.type("string", langSpell("str", "every Unicode scalar value is representable"))
  t.type("bool", langSpell("bool", ""))
  t.type("f64", langSpell("float", "binary64 on every CPython platform (sys.float_info)"))
  t.type(
    "secret-bytes",
    langSpell("bytes", "no secret type and bytes are immutable, so a copy cannot be wiped; secrecy is dropped"),
  )
  t.type("i8", langSpell("int", "arbitrary precision; the width is the implementation's to check"))
  t.type("i16", langSpell("int", "arbitrary precision; the width is the implementation's to check"))
  t.type("i32", langSpell("int", "arbitrary precision; the width is the implementation's to check"))
  t.type("i64", langSpell("int", "arbitrary precision; the width is the implementation's to check"))
  t.type("u8", langSpell("int", "arbitrary precision; the width is the implementation's to check"))
  t.type("u16", langSpell("int", "arbitrary precision; the width is the implementation's to check"))
  t.type("u32", langSpell("int", "arbitrary precision; the width is the implementation's to check"))
  t.type("u64", langSpell("int", "arbitrary precision; the width is the implementation's to check"))
  t.outcome("refusing-return", langSpell("{T} | None", "None is the refusal (PEP 604)"))
  t.outcome(
    "optional-input",
    langSpell(
      "{T} | None",
      "None is the absent argument, passed explicitly; = None may be added only when every later parameter also has a default, as a default before a parameter without one is a SyntaxError",
    ),
  )
  t.literal("hex", langSpell('bytes.fromhex("0b0b")', ""))
  t.literal("ascii", langSpell('b"abc"', ""))
  t.literal("str", langSpell('"abc"', "non-ASCII and control characters as \\u or \\U escapes"))
  t.literal("int", langSpell("42", ""))
  t.literal(
    "f64",
    langSpell(
      'struct.unpack(">d", bytes.fromhex("3ff8000000000000"))[0]',
      "from its bits, so -0 and NaN payloads are exact",
    ),
  )
  t.literal("bool", langSpell("True", ""))
  t.literal("null", langSpell("None", ""))
  t.literal("concat", langSpell("a + b", ""))
  t.type("words16", langSpell("list[int]", "arbitrary precision; the width is the implementation's to check"))
  t.type("words32", langSpell("list[int]", "arbitrary precision; the width is the implementation's to check"))
  t.type("words64", langSpell("list[int]", "arbitrary precision; the width is the implementation's to check"))
  t.literal("words16", langSpell("[0x6170, 0x7865]", ""))
  t.literal("words32", langSpell("[0x61707865, 0x3320646e]", ""))
  t.literal("words64", langSpell("[0x3320646e61707865, 0x6b20657479622d32]", ""))
  t.moduleForm = "module"
  t.moduleNote =
    "a module at the dotted neutral path, lowercase (PEP 8, Package and Module Names): nish/crypto/hkdf → nish.crypto.hkdf; a - in a segment becomes _, while a file --package places keeps it: nish/net/quic-packet → nish.net.quic_packet"
  t.nameRule =
    "functions and parameters lower snake_case: words split at each capital, an acronym is one word (parseHTTPRequest → parse_http_request), and a digit run stays on the word before it (hkdfExpandSha256 → hkdf_expand_sha256). A name that is a keyword takes a name override."
  t.choices.push(
    "Every integer width is int: the width is not in the type, so a value out of range is the implementation's to refuse.",
  )
  t.choices.push(
    "A refusing return is None, not a raised ValueError. The idiomatic raise is still checkable by mapping the exception to the refusal.",
  )
  t.choices.push("secret-bytes is bytes: Python cannot wipe an immutable object, so secrecy is dropped.")
  return t
}
