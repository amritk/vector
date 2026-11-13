import { type LanguageTable, basename, isAcronym, words } from "./table.ts";

/** golint's commonInitialisms, the list Go Code Review Comments § Initialisms points to. */
export const GO_INITIALISMS = new Set([
  "ACL",
  "API",
  "ASCII",
  "CPU",
  "CSS",
  "DNS",
  "EOF",
  "GUID",
  "HTML",
  "HTTP",
  "HTTPS",
  "ID",
  "IP",
  "JSON",
  "LHS",
  "QPS",
  "RAM",
  "RHS",
  "RPC",
  "SLA",
  "SMTP",
  "SQL",
  "SSH",
  "TCP",
  "TLS",
  "TTL",
  "UDP",
  "UI",
  "UID",
  "UUID",
  "URI",
  "URL",
  "UTF8",
  "VM",
  "XML",
  "XMPP",
  "XSRF",
  "XSS",
]);

const goWord = (w: string, first: boolean): string =>
  first
    ? w.toLowerCase()
    : isAcronym(w) || GO_INITIALISMS.has(w.toUpperCase())
      ? w.toUpperCase()
      : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

/** Go's mixedCaps with initialisms in capitals; `exported` capitalizes the first word too. */
const goName = (n: string, exported: boolean): string =>
  words(n)
    .map((w, i) => goWord(w, i === 0 && !exported))
    .join("");

export const go: LanguageTable = {
  id: "go",
  title: "Go",
  typeStandard:
    "The Go Programming Language Specification, Types (Numeric types, String types, Slice types)",
  nameStandard:
    "Effective Go, Names (MixedCaps; an upper-case first letter exports) and Go Code Review Comments, Initialisms",
  types: {
    bytes: { spelling: "[]byte" },
    string: {
      spelling: "string",
      note: "a Go string may hold any bytes; the UTF-8 guarantee is the implementation's",
    },
    bool: { spelling: "bool" },
    f64: {
      spelling: "float64",
      note: "IEEE 754 binary64 (Spec, Numeric types)",
    },
    "secret-bytes": {
      spelling: "[]byte",
      note: "no secret type; secrecy is dropped",
    },
    i8: { spelling: "int8" },
    i16: { spelling: "int16" },
    i32: { spelling: "int32" },
    i64: { spelling: "int64" },
    u8: { spelling: "uint8" },
    u16: { spelling: "uint16" },
    u32: { spelling: "uint32" },
    u64: { spelling: "uint64" },
  },
  outcomes: {
    "refusing-return": {
      spelling: "({T}, error)",
      note: "a non-nil error is the refusal; which error it is is outside the contract",
    },
    "optional-input": { spelling: "*{T}", note: "nil is the absent argument" },
  },
  literals: {
    hex: { spelling: "[]byte{0x0b, 0x0b}" },
    ascii: { spelling: '[]byte("abc")' },
    str: { spelling: '"abc"', note: "non-ASCII as \\u escapes" },
    int: {
      spelling: "uint32(42)",
      note: "converted to its type, so every width is exact",
    },
    f64: {
      spelling: "math.Float64frombits(0x3ff8000000000000)",
      note: "from its bits, so -0 and NaN payloads are exact",
    },
    bool: { spelling: "true" },
    null: { spelling: "nil" },
    concat: { spelling: "append(append([]byte{}, a...), b...)" },
  },
  module: {
    form: "package",
    apply: (m) => m,
    qualify: (m, n) => `${basename(m).replace(/_/g, "")}.${n}`,
    note: 'the neutral path is the import path; the package name is its last segment without underscores (Effective Go, Package names): nish/crypto/hkdf → import "nish/crypto/hkdf", package hkdf',
  },
  nameRule:
    "MixedCaps: a function is exported, so its first letter is a capital (hkdfExpandSha256 → HkdfExpandSha256); a parameter is unexported (lowerCamel). Words split at each capital and a digit run stays on the word before it (chacha20Poly1305Seal → Chacha20Poly1305Seal). An initialism, one the contract writes in capitals or one in golint's list (ID, URL, HTTP, UTF8, …), is all capitals after the first word (userId → userID, parseHttpRequest → ParseHTTPRequest); HKDF and SHA are not on the list, so they stay Hkdf and Sha. A name override always wins.",
  name: (n, kind) => goName(n, kind === "function"),
  choices: [
    "A refusing return is (T, error): Go has no optional, and the error result is how Go reports that a call declined (Effective Go, Errors). The contract gives no reason, so any non-nil error is the refusal and its message is dropped.",
    "An optional input is a pointer *T, nil when absent, so absent and empty stay distinct (a nil []byte and an empty one compare equal under len).",
    "Initialisms follow a fixed list (golint's commonInitialisms) plus whatever the contract writes in capitals, so the rule is deterministic; HKDF, HMAC, SHA, AEAD are not on the list, and a name override can spell them HKDF.",
  ],
};
