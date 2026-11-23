//! A broken order/read: every function gets the byte order or the mask wrong,
//! so `vector spec run --lang rust` finds each byte-order-read clause VIOLATED.

/// Eight bytes big-endian, top two bits kept, wrongly.
pub fn varint62(b: &[u8]) -> u64 {
    u64::from_be_bytes(b.try_into().unwrap())
}

/// Four bytes as a signed integer, wrongly big-endian.
pub fn read_le_i32(b: &[u8]) -> i32 {
    i32::from_be_bytes(b.try_into().unwrap())
}

/// Two bytes as an unsigned integer, wrongly little-endian.
pub fn read_be_u16(b: &[u8]) -> u16 {
    u16::from_le_bytes(b.try_into().unwrap())
}

/// A u32 as four bytes, wrongly little-endian.
pub fn put_be32(n: u32) -> Vec<u8> {
    n.to_le_bytes().to_vec()
}

/// An i64 as eight bytes in two's complement, wrongly big-endian.
pub fn put_le64(n: i64) -> Vec<u8> {
    n.to_be_bytes().to_vec()
}

/// `n` with its low bit wrongly flipped: a u32 parameter that takes an i32 read.
pub fn id_u32(n: u32) -> u32 {
    n ^ 1
}

/// `n` with its low bit wrongly flipped: a u16 parameter that takes a u16 read.
pub fn id_u16(n: u16) -> u16 {
    n ^ 1
}

/// `n` with its low bit wrongly flipped: a i32 parameter that takes a i32 read.
pub fn id_i32(n: i32) -> i32 {
    n ^ 1
}

/// `n` with its low bit wrongly flipped: a u64 parameter that takes a u64 read.
pub fn id_u64(n: u64) -> u64 {
    n ^ 1
}

/// `n` with its low bit wrongly flipped: a i64 parameter that takes a i64 read.
pub fn id_i64(n: i64) -> i64 {
    n ^ 1
}
