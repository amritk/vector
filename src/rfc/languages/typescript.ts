import { type LanguageTable, basename, camel } from "./table.ts";

export const typescript: LanguageTable = {
  id: "typescript",
  title: "TypeScript",
  typeStandard:
    "ECMA-262 (ECMAScript 2024), §6.1.6.1 The Number Type, §6.1.6.2 The BigInt Type, §23.2 TypedArray Objects (Uint8Array)",
  nameStandard:
    "Google TypeScript Style Guide, Identifiers › Naming style and Camel case (lowerCamelCase; acronyms cased as whole words)",
  types: {
    bytes: { spelling: "Uint8Array" },
    string: {
      spelling: "string",
      note: "UTF-16; a lone surrogate is also representable, and is the implementation's to refuse",
    },
    bool: { spelling: "boolean" },
    f64: {
      spelling: "number",
      note: "binary64, but a NaN payload is not preserved (ECMA-262 §6.1.6.1: all NaNs are one value)",
    },
    "secret-bytes": {
      spelling: "Uint8Array",
      note: "no secret type; secrecy is dropped (fill(0) can wipe a copy)",
    },
    i8: { spelling: "number" },
    i16: { spelling: "number" },
    i32: { spelling: "number" },
    i64: { spelling: "bigint", note: "number is exact only to 2^53" },
    u8: { spelling: "number" },
    u16: { spelling: "number" },
    u32: { spelling: "number" },
    u64: { spelling: "bigint", note: "as i64" },
  },
  outcomes: {
    "refusing-return": { spelling: "{T} | null", note: "null is the refusal" },
    "optional-input": {
      spelling: "{T} | undefined",
      note: "an optional parameter; undefined is the absent argument",
    },
  },
  literals: {
    hex: { spelling: "Uint8Array.of(0x0b, 0x0b)" },
    ascii: {
      spelling: 'new TextEncoder().encode("abc")',
      note: "UTF-8, of which ASCII is a subset",
    },
    str: {
      spelling: '"abc"',
      note: "non-ASCII and control characters as \\u{…} escapes",
    },
    int: { spelling: "42", note: "42n for i64 and u64" },
    f64: {
      spelling:
        "new DataView(Uint8Array.of(0x3f, 0xf8, 0, 0, 0, 0, 0, 0).buffer).getFloat64(0)",
      note: "from its bits, so -0 is exact; a NaN payload is lost",
    },
    bool: { spelling: "true" },
    null: { spelling: "null" },
    concat: { spelling: "Uint8Array.of(...a, ...b)" },
  },
  module: {
    form: "file",
    apply: (m) => m,
    qualify: (m, n) => `${basename(m)}.${n}`,
    note: 'an ES module at the neutral path, imported as a namespace named for its last segment: nish/crypto/hkdf → import * as hkdf from "nish/crypto/hkdf", called hkdf.<name>',
  },
  nameRule:
    "functions and parameters lowerCamelCase, an acronym cased as a whole word (the guide's loadHttpUrl): words split at each capital, a digit run stays on the word before it (parseHTTPRequest → parseHttpRequest, readIOStream → readIoStream, hkdfExpandSha256 → hkdfExpandSha256). A name that is a reserved word takes a name override.",
  name: (n) => camel(n, "word"),
  choices: [
    "Widths up to 32 bits are number, and i64/u64 are bigint, so every integer is exact; the type no longer states the width.",
    "f64 is number: every binary64 value but a NaN's payload is kept. That payload is dropped.",
    "A refusing return is null and an optional input is undefined, so the two outcomes of ? keep different spellings.",
  ],
};
