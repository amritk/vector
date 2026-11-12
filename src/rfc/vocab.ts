// The contract's vocabulary: every construct a contract can carry, named
// once and in no language's terms. schemas/rfc-contract.json spells the same
// lists (test/vocab.test.ts holds them equal); the contract types, the gates
// and each language's mapping table are typed against these unions. A
// language maps each construct down to what it can express and says what it
// lost; nothing is left out of here because some language lacks it.

/**
 * Fixed-width integers: `iN` is two's complement and `uN` unsigned, each
 * N bits wide, as the exact-width `intN_t`/`uintN_t` of ISO C11 §7.20.1.1
 * (and IEEE Std 1003.1 <stdint.h>). `+ - *` wrap modulo 2^N, as C11
 * §6.2.5¶9 defines for unsigned types; for `iN` the result is the two's
 * complement of that residue (C leaves signed overflow undefined, so this
 * part is vector's own rule).
 * In JSON a value beyond ±(2^53−1) is carried as a decimal string, per
 * RFC 7493 (I-JSON) §2.2 and RFC 8259 §6.
 */
export const INT_TYPES = [
  "i8",
  "i16",
  "i32",
  "i64",
  "u8",
  "u16",
  "u32",
  "u64",
] as const;
export type IntType = (typeof INT_TYPES)[number];

/**
 * The value types.
 *
 *   bytes         an octet string; written as lowercase base16 (RFC 4648 §8)
 *   string        a Unicode string, UTF-8 encoded (RFC 3629, RFC 8259 §8.1)
 *   bool          true or false
 *   f64           an IEEE 754-2019 binary64 value (§3.4); decimal text is
 *                 converted with roundTiesToEven (§4.3.1, §5.12.2)
 *   secret-bytes  bytes whose value is secret; a language may wrap them in
 *                 its own secret type, but in the contract they are bytes
 *   i8 … u64      the fixed-width integers (INT_TYPES)
 */
export const BASE_TYPES = [
  "bytes",
  "string",
  "bool",
  "f64",
  "secret-bytes",
  ...INT_TYPES,
] as const;
export type BaseType = (typeof BASE_TYPES)[number];

/**
 * A parameter's or result's type: a base type `B`, or `B?`. What `B?` means
 * depends on its position (see OUTCOMES and outcomeOf); either way its
 * absent value is written `null` in literals.
 */
export const SIG_TYPES = [
  "bytes",
  "bytes?",
  "string",
  "string?",
  "bool",
  "bool?",
  "f64",
  "f64?",
  "secret-bytes",
  "secret-bytes?",
  "i8",
  "i8?",
  "i16",
  "i16?",
  "i32",
  "i32?",
  "i64",
  "i64?",
  "u8",
  "u8?",
  "u16",
  "u16?",
  "u32",
  "u32?",
  "u64",
  "u64?",
] as const satisfies readonly (BaseType | `${BaseType}?`)[];
export type SigType = (typeof SIG_TYPES)[number];

/**
 * The two things `B?` can mean.
 *
 *   refusing-return  as a result: the function declines this input and
 *                    returns no value
 *   optional-input   as a parameter: the argument may be absent
 */
export const OUTCOMES = ["refusing-return", "optional-input"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/**
 * The literal forms, by their key in the contract: `hex` bytes (RFC 4648 §8,
 * lowercase), `ascii` bytes, a `str` string, an `int` (a JSON integer, or a
 * decimal string beyond ±(2^53−1), RFC 7493 §2.2), an `f64` (decimal text
 * read with roundTiesToEven, IEEE 754-2019 §5.12.2, or its binary64 bits),
 * `bool`, `null` (the absent value of a `B?`), and a `concat` of byte
 * literals.
 */
export const LITERAL_KINDS = [
  "hex",
  "ascii",
  "str",
  "int",
  "f64",
  "bool",
  "null",
  "concat",
] as const;
export type LiteralKind = (typeof LITERAL_KINDS)[number];

/** The languages a contract can name a function, parameter or module for. */
export const LANGUAGES = [
  "rust",
  "ruby",
  "zig",
  "go",
  "cpp",
  "csharp",
  "c",
  "java",
  "kotlin",
  "python",
  "typescript",
  "php",
  "swift",
  "dart",
] as const;
export type Language = (typeof LANGUAGES)[number];

const signed = (bits: bigint) => ({
  min: -(1n << (bits - 1n)),
  max: (1n << (bits - 1n)) - 1n,
});
const unsigned = (bits: bigint) => ({ min: 0n, max: (1n << bits) - 1n });

/**
 * Each integer type's inclusive range: −2^(N−1) … 2^(N−1)−1 for `iN`, and
 * 0 … 2^N−1 for `uN` (ISO C11 §7.20.2.1).
 */
export const INT_RANGE: Readonly<
  Record<IntType, Readonly<{ min: bigint; max: bigint }>>
> = {
  i8: signed(8n),
  i16: signed(16n),
  i32: signed(32n),
  i64: signed(64n),
  u8: unsigned(8n),
  u16: unsigned(16n),
  u32: unsigned(32n),
  u64: unsigned(64n),
};

/** Whether `t` is `B?`. */
export const isOptional = (t: SigType): boolean => t.endsWith("?");

/** The base type of `t`: `B` for both `B` and `B?`. */
export const baseOf = (t: SigType): BaseType =>
  (isOptional(t) ? t.slice(0, -1) : t) as BaseType;

/**
 * What `t` means at `position`: a `B?` result is a refusing return, a `B?`
 * parameter an optional input; a plain `B` is neither (undefined).
 */
export const outcomeOf = (
  position: "param" | "return",
  t: SigType,
): Outcome | undefined =>
  !isOptional(t)
    ? undefined
    : position === "return"
      ? "refusing-return"
      : "optional-input";

/**
 * A per-language override of a name (a function's or a parameter's), for
 * where the language's default name rule gives the wrong one. A language not
 * listed uses its rule.
 */
export type NameOverrides = Partial<Record<Language, string>>;

/** A per-language override of the target's module form, as that language writes it. */
export type ModuleOverrides = Partial<Record<Language, string>>;
