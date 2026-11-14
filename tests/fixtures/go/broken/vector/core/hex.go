// Package hex is a port of vector's src/core/hex.ts with a bug: uppercase
// hex digits. `vector spec run` judges it VIOLATED.
package hex

import "crypto/sha256"

// ToHex is each byte of data as two hex digits, wrongly uppercase.
func ToHex(data []byte) string {
	return hexIn(data, "0123456789ABCDEF")
}

// Sha256Hex is the SHA-256 of text's UTF-8 bytes, as lowercase hex.
func Sha256Hex(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hexIn(sum[:], "0123456789abcdef")
}

func hexIn(data []byte, digits string) string {
	out := make([]byte, 0, 2*len(data))
	for _, b := range data {
		out = append(out, digits[b>>4], digits[b&15])
	}
	return string(out)
}
