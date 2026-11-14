// Package hmac is nish/crypto/hmac in Go, over the fixtures' SHA-256 (RFC 2104).
package hmac

import "nish/crypto/sha256"

// HmacSha256 is the HMAC-SHA-256 of data under key.
func HmacSha256(key, data []byte) []byte {
	var k [64]byte
	if len(key) > 64 {
		sum := sha256.Sum(key)
		copy(k[:], sum[:])
	} else {
		copy(k[:], key)
	}
	inner := make([]byte, 0, 64+len(data))
	outer := make([]byte, 0, 64+32)
	for _, b := range k {
		inner = append(inner, b^0x36)
		outer = append(outer, b^0x5c)
	}
	inner = append(inner, data...)
	sum := sha256.Sum(inner)
	mac := sha256.Sum(append(outer, sum[:]...))
	return mac[:]
}
