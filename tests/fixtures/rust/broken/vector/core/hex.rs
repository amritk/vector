//! A port of vector's src/core/hex.ts with a bug: uppercase hex digits.
//! `vector spec run` judges it VIOLATED.

#[path = "../../../sha256.rs"]
mod sha256;

/// Each byte of `data` as two hex digits, wrongly uppercase.
pub fn to_hex(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02X}", b)).collect()
}

/// The SHA-256 of `text`'s UTF-8 bytes, as lowercase hex.
pub fn sha256_hex(text: &str) -> String {
    sha256::sha256(text.as_bytes()).iter().map(|b| format!("{:02x}", b)).collect()
}
