//! vector's src/core/hex.ts ported to Rust: the implementation
//! `vector spec run contracts/vector-core-hex.json --lang rust` checks.

#[path = "../../sha256.rs"]
mod sha256;

/// Each byte of `data` as two lowercase hex digits.
pub fn to_hex(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect()
}

/// The SHA-256 of `text`'s UTF-8 bytes, as lowercase hex.
pub fn sha256_hex(text: &str) -> String {
    to_hex(&sha256::sha256(text.as_bytes()))
}

/// The SHA-256 of `a` followed by `b`, as lowercase hex: a two-argument
/// function, so an iterated vector can swap its arguments.
pub fn sha256_pair(a: &str, b: &str) -> String {
    sha256_hex(&format!("{}{}", a, b))
}
