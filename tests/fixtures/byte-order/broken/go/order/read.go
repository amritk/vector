// Package read is a broken order/read: every function gets the byte order or the mask
// wrong, so `vector spec run --lang go` finds each clause VIOLATED.
package read

import "encoding/binary"

// Varint62 is eight bytes big-endian, top two bits kept, wrongly.
func Varint62(b []byte) uint64 {
	return binary.BigEndian.Uint64(b)
}

// ReadLeI32 is four bytes as a signed integer, wrongly big-endian.
func ReadLeI32(b []byte) int32 {
	return int32(binary.BigEndian.Uint32(b))
}

// ReadBeU16 is two bytes as an unsigned integer, wrongly little-endian.
func ReadBeU16(b []byte) uint16 {
	return binary.LittleEndian.Uint16(b)
}

// PutBe32 is a u32 as four bytes, wrongly little-endian.
func PutBe32(n uint32) []byte {
	return binary.LittleEndian.AppendUint32(nil, n)
}

// PutLe64 is an i64 as eight bytes in two's complement, wrongly big-endian.
func PutLe64(n int64) []byte {
	return binary.BigEndian.AppendUint64(nil, uint64(n))
}

// IDU32 is n with its low bit wrongly flipped: a u32 parameter that takes an i32 read.
func IDU32(n uint32) uint32 {
	return n ^ 1
}

// IDU16 is n with its low bit wrongly flipped: a u16 parameter that takes a u16 read.
func IDU16(n uint16) uint16 {
	return n ^ 1
}

// IDI32 is n with its low bit wrongly flipped: a i32 parameter that takes a i32 read.
func IDI32(n int32) int32 {
	return n ^ 1
}

// IDU64 is n with its low bit wrongly flipped: a u64 parameter that takes a u64 read.
func IDU64(n uint64) uint64 {
	return n ^ 1
}

// IDI64 is n with its low bit wrongly flipped: a i64 parameter that takes a i64 read.
func IDI64(n int64) int64 {
	return n ^ 1
}
