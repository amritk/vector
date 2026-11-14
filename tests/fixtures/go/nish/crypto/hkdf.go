// Package hkdf is nish/crypto/hkdf in Go: the port `vector spec run --lang go`
// checks against contracts/rfc5869-hkdf-sha256.json, written out from
// RFC 5869 §2.
package hkdf

import (
	"errors"

	"nish/crypto/hmac"
)

const hashLen = 32

// HkdfExtractSha256 is PRK = HMAC-Hash(salt, IKM); an empty salt is HashLen zeros.
func HkdfExtractSha256(salt, ikm []byte) []byte {
	if len(salt) == 0 {
		salt = make([]byte, hashLen)
	}
	return hmac.HmacSha256(salt, ikm)
}

// HkdfExpandSha256 is the first length octets of T(1) | T(2) | ...; an error
// past 255 * HashLen or below 0.
func HkdfExpandSha256(prk, info []byte, length int32) ([]byte, error) {
	if length < 0 || int(length) > 255*hashLen {
		return nil, errors.New("hkdf: length out of range")
	}
	okm := make([]byte, 0, int(length)+hashLen)
	var t []byte
	for i := byte(1); len(okm) < int(length); i++ {
		msg := append(append(append([]byte{}, t...), info...), i)
		t = hmac.HmacSha256(prk, msg)
		okm = append(okm, t...)
	}
	return okm[:length], nil
}
