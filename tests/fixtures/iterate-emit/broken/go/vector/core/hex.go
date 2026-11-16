// Package hex is a port of vector's src/core/hex.ts with a bug: Sha256Hex
// writes uppercase digits once it is fed a 64-character text, as a chain feeds
// it its own digest. `vector spec run` finds the 1,000-step chain VIOLATED.
package hex

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// ToHex is each byte of data as two lowercase hex digits.
func ToHex(data []byte) string {
	return hex.EncodeToString(data)
}

// Sha256Hex is the SHA-256 of text's UTF-8 bytes, wrongly uppercase for a
// 64-character text.
func Sha256Hex(text string) string {
	sum := sha256.Sum256([]byte(text))
	out := hex.EncodeToString(sum[:])
	if len(text) == 64 {
		return strings.ToUpper(out)
	}
	return out
}
