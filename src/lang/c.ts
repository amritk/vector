/**
 * `lang/c` — the C table: how C writes each construct of the
 * contract vocabulary, and what it drops. Its name and module rules are in
 * `lang/names`.
 */

import { LangTable, langSpell, langUnsupported } from "./table"

/**
 * The C table.
 *
 * @returns C's mapping of every construct, its standards and its choices
 */
export const langTableC = (): LangTable => {
  const t = new LangTable(
    "c",
    "C",
    "ISO/IEC 9899:2018 (C17), §7.20 <stdint.h>, §7.18 <stdbool.h>, Annex F (IEC 60559 floating point)",
    "ISO C has no naming standard; the common convention of lower snake_case behind a module prefix (as in POSIX and OpenSSL), invented for this table where none fits",
  )
  t.type(
    "bytes",
    langSpell(
      "const uint8_t *, size_t",
      "a pointer and a length; a returned value goes through out-parameters uint8_t *out, size_t *out_len",
    ),
  )
  t.type(
    "string",
    langSpell(
      "const char *",
      "NUL-terminated UTF-8, so a string holding U+0000 cannot be passed; that value is dropped. A returned string goes into a caller-supplied buffer char *out, size_t out_cap, so the caller owns it",
    ),
  )
  t.type("bool", langSpell("bool", "<stdbool.h>"))
  t.type("f64", langSpell("double", "binary64 where __STDC_IEC_559__ is defined (Annex F)"))
  t.type(
    "secret-bytes",
    langSpell("const uint8_t *, size_t", "no secret type; secrecy is dropped (C23 memset_explicit can wipe a copy)"),
  )
  t.type("i8", langSpell("int8_t", ""))
  t.type("i16", langSpell("int16_t", ""))
  t.type("i32", langSpell("int32_t", ""))
  t.type("i64", langSpell("int64_t", ""))
  t.type("u8", langSpell("uint8_t", ""))
  t.type("u16", langSpell("uint16_t", ""))
  t.type("u32", langSpell("uint32_t", ""))
  t.type("u64", langSpell("uint64_t", ""))
  t.outcome(
    "refusing-return",
    langSpell(
      "int f(..., {T} *out)",
      "returns 0 with the value in *out, or a nonzero status for the refusal; which nonzero value is outside the contract",
    ),
  )
  t.outcome(
    "optional-input",
    langSpell(
      "const {T} *",
      "NULL is the absent argument; for bytes, a NULL pointer (its length ignored), so absent and empty stay distinct",
    ),
  )
  t.literal(
    "hex",
    langSpell(
      "(const uint8_t[]){0x0b, 0x0b}",
      "a compound literal, with its length sizeof'd; empty bytes as a non-NULL pointer and length 0, as C before C23 has no empty initializer",
    ),
  )
  t.literal("ascii", langSpell('(const uint8_t[]){"abc"}', "without the terminating NUL in its length"))
  t.literal(
    "str",
    langSpell(
      '"abc"',
      'non-ASCII and control characters as their UTF-8 bytes in \\x escapes ("\\xc3\\xa9" for é), split into adjacent literals where a hex digit follows ("\\xc3\\xa9" "b"); a u8 literal is char8_t, not char, in C23',
    ),
  )
  t.literal(
    "int",
    langSpell(
      "UINT32_C(42)",
      "<stdint.h> constant macros give each width; a minimum is its INTn_MIN macro, or (-INT64_MAX - 1)",
    ),
  )
  t.literal(
    "f64",
    langSpell(
      "((union { uint64_t u; double d; }){.u = 0x3ff8000000000000u}).d",
      "an expression: a compound literal of a union, read through its other member (C17 §6.5.2.3 footnote 97), so -0 and NaN payloads are exact",
    ),
  )
  t.literal("bool", langSpell("true", ""))
  t.literal("null", langSpell("NULL", ""))
  t.literal(
    "concat",
    langSpell("(const uint8_t[]){0x0b, 0x61}", "no concatenation of arrays; the joined bytes are written as one array"),
  )
  t.type(
    "words16",
    langSpell(
      "const uint16_t *",
      "a pointer/length pair, as bytes are; a returned array goes to a caller-supplied buffer",
    ),
  )
  t.type(
    "words32",
    langSpell(
      "const uint32_t *",
      "a pointer/length pair, as bytes are; a returned array goes to a caller-supplied buffer",
    ),
  )
  t.type(
    "words64",
    langSpell(
      "const uint64_t *",
      "a pointer/length pair, as bytes are; a returned array goes to a caller-supplied buffer",
    ),
  )
  t.literal("words16", langSpell("(const uint16_t[]){0x6170, 0x7865}", "a compound literal, with its length sizeof'd"))
  t.literal(
    "words32",
    langSpell("(const uint32_t[]){0x61707865, 0x3320646e}", "a compound literal, with its length sizeof'd"),
  )
  t.literal(
    "words64",
    langSpell(
      "(const uint64_t[]){0x3320646e61707865, 0x6b20657479622d32}",
      "a compound literal, with its length sizeof'd",
    ),
  )
  t.moduleForm = "header-prefix"
  t.moduleNote =
    "a header at the neutral path plus .h, and every symbol prefixed by the segments joined with _ (C has one namespace for external names): nish/crypto/hkdf → nish/crypto/hkdf.h, nish_crypto_hkdf_<name>; a - in a segment stays in the header and becomes _ in the prefix: nish/net/quic-packet → nish/net/quic-packet.h, nish_net_quic_packet_<name>"
  t.nameRule =
    "functions and parameters lower snake_case, a function behind its module prefix: words split at each capital, an acronym is one word (parseHTTPRequest → parse_http_request), and a digit run stays on the word before it (hkdfExpandSha256 → nish_crypto_hkdf_hkdf_expand_sha256). The prefix repeats a segment when the name does; a name override removes the repetition."
  t.choices.push(
    "A refusing return is an int status (0 success, nonzero the refusal) with the value through an out-parameter. The contract gives no reason, so the nonzero value carries none.",
  )
  t.choices.push(
    "Bytes are a pointer/length pair; returned bytes go to a caller-supplied buffer (uint8_t *out, size_t *out_len), so a function returning bytes always returns a status: a buffer too small is a status the contract does not define, and is outside it.",
  )
  t.choices.push(
    "An optional input is a pointer that may be NULL. For bytes the NULL pointer is the absence, so (NULL, 0) and an empty buffer differ.",
  )
  t.choices.push(
    "A string is NUL-terminated, so a string containing U+0000 cannot be passed: that one value is dropped.",
  )
  return t
}
