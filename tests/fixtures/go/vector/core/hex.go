// Package hex is vector's src/core/hex.ts ported to Go: the implementation
// `vector spec run contracts/vector-core-hex.json --lang go` checks.
package hex

import "crypto/sha256"

const hexDigits = "0123456789abcdef"

// ToHex is each byte of data as two lowercase hex digits.
func ToHex(data []byte) string {
	out := make([]byte, 0, 2*len(data))
	for _, b := range data {
		out = append(out, hexDigits[b>>4], hexDigits[b&15])
	}
	return string(out)
}

// Sha256Hex is the SHA-256 of text's UTF-8 bytes, as lowercase hex.
func Sha256Hex(text string) string {
	sum := sha256.Sum256([]byte(text))
	return ToHex(sum[:])
}

// Sha256Pair is the SHA-256 of a followed by b, as lowercase hex: a
// two-argument function, so an iterated vector can swap its arguments.
func Sha256Pair(a string, b string) string {
	return Sha256Hex(a + b)
}
