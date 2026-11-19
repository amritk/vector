// Package read is order/read in Go: integers read from and written to bytes,
// the module the byte-order-read contract checks against vector's read and write ops.
package read

import "encoding/binary"

// Varint62 is eight bytes big-endian, top two bits cleared.
func Varint62(b []byte) uint64 {
	return binary.BigEndian.Uint64(b) & (1<<62 - 1)
}

// ReadLeI32 is four bytes as a signed integer, little-endian.
func ReadLeI32(b []byte) int32 {
	return int32(binary.LittleEndian.Uint32(b))
}

// ReadBeU16 is two bytes as an unsigned integer, big-endian.
func ReadBeU16(b []byte) uint16 {
	return binary.BigEndian.Uint16(b)
}

// PutBe32 is a u32 as four bytes, big-endian.
func PutBe32(n uint32) []byte {
	return binary.BigEndian.AppendUint32(nil, n)
}

// PutLe64 is an i64 as eight bytes in two's complement, little-endian.
func PutLe64(n int64) []byte {
	return binary.LittleEndian.AppendUint64(nil, uint64(n))
}

// IDU32 is n unchanged: a u32 parameter that takes an i32 read.
func IDU32(n uint32) uint32 {
	return n
}

// IDU16 is n unchanged: a u16 parameter that takes a u16 read.
func IDU16(n uint16) uint16 {
	return n
}

// IDI32 is n unchanged: a i32 parameter that takes a i32 read.
func IDI32(n int32) int32 {
	return n
}

// IDU64 is n unchanged: a u64 parameter that takes a u64 read.
func IDU64(n uint64) uint64 {
	return n
}

// IDI64 is n unchanged: a i64 parameter that takes a i64 read.
func IDI64(n int64) int64 {
	return n
}
