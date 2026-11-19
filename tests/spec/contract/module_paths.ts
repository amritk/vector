/**
 * The module paths every reader of one must agree on: `charsIsModule`, the
 * contract's shape check and the ts-interface module lines each accept the
 * first list and refuse the second.
 */

/** Module paths the segment grammar accepts, hyphenated and not. */
export const modulePathsAccepted = (): string[] => [
  "nish/a-b",
  "nish/net/quic-packet",
  "nish/net/http1-codec",
  "nish/crypto/x509-random",
  "nish/a-1",
  "nish/a_b-c",
  "nish/a-b-c",
  "nish-x/a",
  "nish/crypto/hkdf",
  "nish/a1_",
]

/** Module paths the segment grammar refuses: a hyphen at a word's edge, doubled, before `_` or beside a capital. */
export const modulePathsRefused = (): string[] => [
  "nish/-a",
  "nish/a-",
  "nish/a--b",
  "nish/A-b",
  "nish/a-_b",
  "nish/a-B",
  "-nish/a",
  "nish-/a",
  "nish/a/-",
  "nish/-",
  "nish/a-/b",
  "nish",
  "nish-a",
  "Nish/a",
  "nish//a",
  "nish/1a",
  "nish/_a",
]
