import { type LanguageTable, snake } from "./table.ts";

export const c: LanguageTable = {
  id: "c",
  title: "C",
  typeStandard:
    "ISO/IEC 9899:2018 (C17), §7.20 <stdint.h>, §7.18 <stdbool.h>, Annex F (IEC 60559 floating point)",
  nameStandard:
    "ISO C has no naming standard; the common convention of lower snake_case behind a module prefix (as in POSIX and OpenSSL), invented for this table where none fits",
  types: {
    bytes: {
      spelling: "const uint8_t *, size_t",
      note: "a pointer and a length; a returned value goes through out-parameters uint8_t *out, size_t *out_len",
    },
    string: {
      spelling: "const char *",
      note: "NUL-terminated UTF-8, so a string holding U+0000 cannot be passed; that value is dropped",
    },
    bool: { spelling: "bool", note: "<stdbool.h>" },
    f64: {
      spelling: "double",
      note: "binary64 where __STDC_IEC_559__ is defined (Annex F)",
    },
    "secret-bytes": {
      spelling: "const uint8_t *, size_t",
      note: "no secret type; secrecy is dropped (C23 memset_explicit can wipe a copy)",
    },
    i8: { spelling: "int8_t" },
    i16: { spelling: "int16_t" },
    i32: { spelling: "int32_t" },
    i64: { spelling: "int64_t" },
    u8: { spelling: "uint8_t" },
    u16: { spelling: "uint16_t" },
    u32: { spelling: "uint32_t" },
    u64: { spelling: "uint64_t" },
  },
  outcomes: {
    "refusing-return": {
      spelling: "int f(..., {T} *out)",
      note: "returns 0 with the value in *out, or a nonzero status for the refusal; which nonzero value is outside the contract",
    },
    "optional-input": {
      spelling: "const {T} *",
      note: "NULL is the absent argument; for bytes, a NULL pointer (its length ignored), so absent and empty stay distinct",
    },
  },
  literals: {
    hex: {
      spelling: "(const uint8_t[]){0x0b, 0x0b}",
      note: "a compound literal, with its length sizeof'd",
    },
    ascii: {
      spelling: '(const uint8_t[]){"abc"}',
      note: "without the terminating NUL in its length",
    },
    str: {
      spelling: '"abc"',
      note: "non-ASCII as \\u escapes in a u8 literal",
    },
    int: {
      spelling: "UINT32_C(42)",
      note: "<stdint.h> constant macros give each width; INT64_MIN is written (-INT64_MAX - 1)",
    },
    f64: {
      spelling: "memcpy(&d, &(uint64_t){0x3ff8000000000000}, 8)",
      note: "from its bits, so -0 and NaN payloads are exact",
    },
    bool: { spelling: "true" },
    null: { spelling: "NULL" },
    concat: {
      spelling: "(const uint8_t[]){0x0b, 0x61}",
      note: "no concatenation of arrays; the joined bytes are written as one array",
    },
  },
  module: {
    form: "header-prefix",
    apply: (m) => `${m}.h`,
    qualify: (m, n) => `${m.replace(/\.h$/, "").split("/").join("_")}_${n}`,
    note: "a header at the neutral path plus .h, and every symbol prefixed by the segments joined with _ (C has one namespace for external names): nish/crypto/hkdf → nish/crypto/hkdf.h, nish_crypto_hkdf_<name>",
  },
  nameRule:
    "functions and parameters lower snake_case, a function behind its module prefix: words split at each capital, an acronym is one word (parseHTTPRequest → parse_http_request), and a digit run stays on the word before it (hkdfExpandSha256 → nish_crypto_hkdf_hkdf_expand_sha256). The prefix repeats a segment when the name does; a name override removes the repetition.",
  name: (n) => snake(n),
  choices: [
    "A refusing return is an int status (0 success, nonzero the refusal) with the value through an out-parameter. The contract gives no reason, so the nonzero value carries none.",
    "Bytes are a pointer/length pair; returned bytes go to a caller-supplied buffer (uint8_t *out, size_t *out_len), so a function returning bytes always returns a status: a buffer too small is a status the contract does not define, and is outside it.",
    "An optional input is a pointer that may be NULL. For bytes the NULL pointer is the absence, so (NULL, 0) and an empty buffer differ.",
    "A string is NUL-terminated, so a string containing U+0000 cannot be passed: that one value is dropped.",
  ],
};
