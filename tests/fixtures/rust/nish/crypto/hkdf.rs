//! nish/crypto/hkdf in Rust: the port `vector spec run --lang rust` checks
//! against contracts/rfc5869-hkdf-sha256.json, written out from RFC 5869 §2.

#[path = "hmac.rs"]
mod hmac;

const HASH_LEN: usize = 32;

/// PRK = HMAC-Hash(salt, IKM); an empty salt is HashLen zeros.
pub fn hkdf_extract_sha256(salt: &[u8], ikm: &[u8]) -> [u8; 32] {
    if salt.is_empty() {
        return hmac::hmac_sha256(&[0u8; HASH_LEN], ikm);
    }
    hmac::hmac_sha256(salt, ikm)
}

/// The first `length` octets of T(1) | T(2) | ...; None past 255 * HashLen or below 0.
pub fn hkdf_expand_sha256(prk: &[u8], info: &[u8], length: i32) -> Option<Vec<u8>> {
    if length < 0 || length as usize > 255 * HASH_LEN {
        return None;
    }
    let mut okm: Vec<u8> = Vec::new();
    let mut t: Vec<u8> = Vec::new();
    let mut i: u8 = 1;
    while okm.len() < length as usize {
        let mut msg = t.clone();
        msg.extend_from_slice(info);
        msg.push(i);
        t = hmac::hmac_sha256(prk, &msg).to_vec();
        okm.extend_from_slice(&t);
        i = i.wrapping_add(1);
    }
    okm.truncate(length as usize);
    Some(okm)
}
