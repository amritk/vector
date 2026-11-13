import { type LanguageTable, basename, camel, snake } from "./table.ts";

export const zig: LanguageTable = {
  id: "zig",
  title: "Zig",
  typeStandard:
    "The Zig Language Reference, Primitive Types, Slices, Optionals and Error Union Type",
  nameStandard:
    "The Zig Language Reference, Style Guide › Names (camelCase functions, snake_case variables)",
  types: {
    bytes: {
      spelling: "[]const u8",
      note: "a returned slice is []u8 allocated from a caller-supplied std.mem.Allocator",
    },
    string: {
      spelling: "[]const u8",
      note: "Zig has no string type: UTF-8 bytes, so the guarantee that they are valid UTF-8 is dropped",
    },
    bool: { spelling: "bool" },
    f64: { spelling: "f64", note: "IEEE-754-2008 binary64" },
    "secret-bytes": {
      spelling: "[]const u8",
      note: "no secret type; secrecy is dropped (std.crypto.secureZero can wipe a copy)",
    },
    i8: { spelling: "i8" },
    i16: { spelling: "i16" },
    i32: { spelling: "i32" },
    i64: { spelling: "i64" },
    u8: { spelling: "u8" },
    u16: { spelling: "u16" },
    u32: { spelling: "u32" },
    u64: { spelling: "u64" },
  },
  outcomes: {
    "refusing-return": {
      spelling: "?{T}",
      note: "null is the refusal; a function that allocates returns std.mem.Allocator.Error!?{T}",
    },
    "optional-input": { spelling: "?{T}", note: "null is the absent argument" },
  },
  literals: {
    hex: { spelling: "&[_]u8{ 0x0b, 0x0b }" },
    ascii: { spelling: '"abc"' },
    str: { spelling: '"abc"', note: "non-ASCII as \\u{…} escapes" },
    int: {
      spelling: "@as(u32, 42)",
      note: "typed by @as, so every width is exact",
    },
    f64: {
      spelling: "@as(f64, @bitCast(@as(u64, 0x3ff8000000000000)))",
      note: "from its bits, so -0 and NaN payloads are exact",
    },
    bool: { spelling: "true" },
    null: { spelling: "null" },
    concat: {
      spelling: "a ++ b",
      note: "comptime; at run time std.mem.concat",
    },
  },
  module: {
    form: "file",
    apply: (m) => `${m}.zig`,
    qualify: (m, n) => `${basename(m)}.${n}`,
    note: 'a source file is a struct; the neutral path plus .zig, imported under its last segment: nish/crypto/hkdf → nish/crypto/hkdf.zig, const hkdf = @import("nish/crypto/hkdf.zig")',
  },
  nameRule:
    'functions camelCase and parameters snake_case (Style Guide): words split at each capital, an acronym is a word like any other (parseHTTPRequest → parseHttpRequest, parse_http_request), and a digit run stays on the word before it (chacha20Poly1305Seal → chacha20Poly1305Seal, hkdfExpandSha256 → hkdfExpandSha256). A derived name that is a keyword or a primitive type name (error, type, fn, test, u8, bool) is written @"…" or takes a name override. A name override always wins.',
  name: (n, kind) => (kind === "function" ? camel(n, "word") : snake(n)),
  choices: [
    "A refusing return is an optional ?T, not an error union !T: the contract's refusal carries no reason, so an error set would be invented. Where the function allocates, the error union holds only allocation failure (Allocator.Error!?T), so the two never mix.",
    "bytes and string share one type, []const u8; the string's UTF-8 guarantee is dropped.",
    "Inputs are slices []const u8; outputs are allocated from a caller-supplied std.mem.Allocator, which the contract does not name (it is an extra first parameter).",
  ],
};
