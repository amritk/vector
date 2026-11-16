//! A port of vector's src/core/hex.ts with a bug: sha256_hex writes uppercase
//! digits once it is fed a 64-character text, as a chain feeds it its own
//! digest. `vector spec run` finds the 1,000-step chain VIOLATED.

#[path = "../../../../../rust/sha256.rs"]
mod sha256;

/// Each byte of `data` as two lowercase hex digits.
pub fn to_hex(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect()
}

/// The SHA-256 of `text`'s UTF-8 bytes, wrongly uppercase for a 64-character text.
pub fn sha256_hex(text: &str) -> String {
    let out = to_hex(&sha256::sha256(text.as_bytes()));
    if text.len() == 64 { out.to_uppercase() } else { out }
}
