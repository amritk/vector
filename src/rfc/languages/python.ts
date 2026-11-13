import { type LanguageTable, snake } from "./table.ts";

/** The note on each integer width the type does not state. */
const WIDTH = "arbitrary precision; the width is the implementation's to check";

export const python: LanguageTable = {
  id: "python",
  title: "Python",
  typeStandard:
    "The Python Language Reference, §3.2 The standard type hierarchy; PEP 484 (type hints), PEP 604 (X | None)",
  nameStandard: "PEP 8, Naming Conventions › Function and Variable Names",
  types: {
    bytes: { spelling: "bytes" },
    string: {
      spelling: "str",
      note: "every Unicode scalar value is representable",
    },
    bool: { spelling: "bool" },
    f64: {
      spelling: "float",
      note: "binary64 on every CPython platform (sys.float_info)",
    },
    "secret-bytes": {
      spelling: "bytes",
      note: "no secret type and bytes are immutable, so a copy cannot be wiped; secrecy is dropped",
    },
    i8: {
      spelling: "int",
      note: WIDTH,
    },
    i16: { spelling: "int", note: WIDTH },
    i32: { spelling: "int", note: WIDTH },
    i64: { spelling: "int", note: WIDTH },
    u8: { spelling: "int", note: WIDTH },
    u16: { spelling: "int", note: WIDTH },
    u32: { spelling: "int", note: WIDTH },
    u64: { spelling: "int", note: WIDTH },
  },
  outcomes: {
    "refusing-return": {
      spelling: "{T} | None",
      note: "None is the refusal (PEP 604)",
    },
    "optional-input": {
      spelling: "{T} | None",
      note: "None is the absent argument, passed explicitly; = None may be added only when every later parameter also has a default, as a default before a parameter without one is a SyntaxError",
    },
  },
  literals: {
    hex: { spelling: 'bytes.fromhex("0b0b")' },
    ascii: { spelling: 'b"abc"' },
    str: {
      spelling: '"abc"',
      note: "non-ASCII and control characters as \\u or \\U escapes",
    },
    int: { spelling: "42" },
    f64: {
      spelling: 'struct.unpack(">d", bytes.fromhex("3ff8000000000000"))[0]',
      note: "from its bits, so -0 and NaN payloads are exact",
    },
    bool: { spelling: "True" },
    null: { spelling: "None" },
    concat: { spelling: "a + b" },
  },
  module: {
    form: "module",
    apply: (m) => m.split("/").join("."),
    qualify: (m, n) => `${m}.${n}`,
    note: "a module at the dotted neutral path, lowercase (PEP 8, Package and Module Names): nish/crypto/hkdf → nish.crypto.hkdf",
  },
  nameRule:
    "functions and parameters lower snake_case: words split at each capital, an acronym is one word (parseHTTPRequest → parse_http_request), and a digit run stays on the word before it (hkdfExpandSha256 → hkdf_expand_sha256). A name that is a keyword takes a name override.",
  name: (n) => snake(n),
  choices: [
    "Every integer width is int: the width is not in the type, so a value out of range is the implementation's to refuse.",
    "A refusing return is None, not a raised ValueError. The idiomatic raise is still checkable by mapping the exception to the refusal.",
    "secret-bytes is bytes: Python cannot wipe an immutable object, so secrecy is dropped.",
  ],
};
