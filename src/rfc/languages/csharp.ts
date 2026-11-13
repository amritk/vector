import { type LanguageTable, camel, pascal, pascalSegment } from "./table.ts";

export const csharp: LanguageTable = {
  id: "csharp",
  title: "C#",
  typeStandard:
    "ECMA-334 (C# Language Specification), Types › Simple types and Nullable value types",
  nameStandard:
    ".NET Framework Design Guidelines, Capitalization Conventions (PascalCase members, camelCase parameters; two-letter acronyms in capitals)",
  types: {
    bytes: {
      spelling: "byte[]",
      note: "a ReadOnlySpan<byte> input would avoid a copy; byte[] is chosen for one type in and out",
    },
    string: {
      spelling: "string",
      note: "UTF-16; every Unicode scalar value is representable",
    },
    bool: { spelling: "bool" },
    f64: { spelling: "double", note: "IEC 60559 binary64" },
    "secret-bytes": {
      spelling: "byte[]",
      note: "no secret type; secrecy is dropped (CryptographicOperations.ZeroMemory can wipe a copy)",
    },
    i8: { spelling: "sbyte" },
    i16: { spelling: "short" },
    i32: { spelling: "int" },
    i64: { spelling: "long" },
    u8: { spelling: "byte" },
    u16: { spelling: "ushort" },
    u32: { spelling: "uint" },
    u64: { spelling: "ulong" },
  },
  outcomes: {
    "refusing-return": {
      spelling: "{T}?",
      note: "null is the refusal: a nullable reference type for byte[] and string, Nullable<T> for value types",
    },
    "optional-input": {
      spelling: "{T}?",
      note: "null is the absent argument; byte[]? and string? assume a nullable context (<Nullable>enable</Nullable>)",
    },
  },
  literals: {
    hex: {
      spelling: "new byte[] { 0x0b, 0x0b }",
      note: 'or Convert.FromHexString("0b0b")',
    },
    ascii: {
      spelling: '"abc"u8.ToArray()',
      note: "a UTF-8 literal (C# 11), ASCII being a subset",
    },
    str: {
      spelling: '"abc"',
      note: "non-ASCII as \\u escapes, a scalar above U+FFFF as \\U",
    },
    int: {
      spelling: "42u",
      note: "per width: sbyte, short, byte and ushort by a cast ((sbyte)-128), int bare, uint 42u, long 42L, ulong 42UL; -2147483648 and -9223372036854775808 are valid as written",
    },
    f64: {
      spelling: "BitConverter.UInt64BitsToDouble(0x3ff8000000000000UL)",
      note: "from its bits (.NET 6), so -0 and NaN payloads are exact; Int64BitsToDouble would not take a hex literal with the sign bit set, which is a ulong (C# spec §6.4.5.3)",
    },
    bool: { spelling: "true" },
    null: { spelling: "null" },
    concat: {
      spelling: "[.. a, .. b]",
      note: "a collection expression (C# 12)",
    },
  },
  module: {
    form: "class",
    apply: (m) => m.split("/").map(pascalSegment).join("."),
    qualify: (m, n) => `${m}.${n}`,
    note: "a static class named for the last segment, in a namespace of the others, all PascalCase (Design Guidelines, Names of Namespaces): nish/crypto/hkdf → static class Hkdf in namespace Nish.Crypto",
  },
  nameRule:
    "methods PascalCase and parameters camelCase: words split at each capital, a digit run stays on the word before it (hkdfExpandSha256 → HkdfExpandSha256), a two-letter acronym stays in capitals and a longer one is cased like a word (readIOStream → ReadIOStream, parseHTTPRequest → ParseHttpRequest). A parameter whose camelCase name is a keyword (in, out, string, object, params, event, base) is written with @ (@in) or takes a name override. A name override always wins.",
  name: (n, kind) =>
    kind === "function" ? pascal(n, "short-caps") : camel(n, "short-caps"),
  choices: [
    "A refusing return is a null return ({T}?), not a thrown exception or the Try pattern (bool TryX(..., out T)): a refusal is an expected outcome, tested by the vectors, and null maps the contract's null one-to-one. An implementation that throws ArgumentException is still checkable by mapping the throw to the refusal.",
    "bytes are byte[] in both positions, though ReadOnlySpan<byte> would avoid a copy on input.",
    "A namespace holds no functions, so the module is a static class of static methods named for its last segment. A method whose PascalCase name equals that class's name is CS0542, so it takes a name override.",
  ],
};
