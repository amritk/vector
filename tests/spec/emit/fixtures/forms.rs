//! nish/forms in Rust: the module tests/spec/emit/fixtures/forms.json's
//! Rust test runs against, as forms.ts is for its Nish test. A form the
//! Rust emitter writes wrong fails that test, or does not compile.
//! The results come back in several forms (an array, a borrowed str, a Vec)
//! because the test takes any of them.

/// x as it is.
pub fn id_i32(x: i32) -> i32 {
    x
}

/// a + b, wrapping to 64 bits.
pub fn add_i64(a: i64, b: i64) -> i64 {
    a.wrapping_add(b)
}

/// x sign-extended to 64 bits, as 8 little-endian bytes.
pub fn le_bytes(x: i32) -> [u8; 8] {
    (x as i64).to_le_bytes()
}

/// a XOR b, as long as the shorter.
pub fn xor_b(a: &[u8], b: &[u8]) -> Vec<u8> {
    a.iter().zip(b).map(|(x, y)| x ^ y).collect()
}

/// s, or None when it is empty.
pub fn non_empty(s: &str) -> Option<&str> {
    if s.is_empty() { None } else { Some(s) }
}

/// a, or None when it is empty.
pub fn non_empty_b(a: &[u8]) -> Option<Vec<u8>> {
    if a.is_empty() { None } else { Some(a.to_vec()) }
}

/// Half of x.
pub fn half(x: f64) -> f64 {
    x / 2.0
}

/// Whether x is the largest u64.
pub fn is_max(x: u64) -> bool {
    x == u64::MAX
}

/// A copy of k; None when u is empty.
pub fn keep(k: &[u8], u: &[u8]) -> Option<Vec<u8>> {
    if u.is_empty() { None } else { Some(k.to_vec()) }
}

/// k, or None when there is none.
pub fn keep_base(k: Option<&[u8]>) -> Option<Vec<u8>> {
    k.map(|v| v.to_vec())
}
