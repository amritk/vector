// Package forms is nish/forms in Go: the module
// tests/spec/emit/fixtures/forms.json's Go test runs against, as forms.ts is
// for its Nish test. A form the Go emitter writes wrong fails that test, or
// does not compile.
package forms

import "errors"

// IDI32 is x as it is.
func IDI32(x int32) int32 {
	return x
}

// AddI64 is a + b, wrapping to 64 bits.
func AddI64(a, b int64) int64 {
	return a + b
}

// AddI32 is a + b, wrapping to 32 bits.
func AddI32(a, b int32) int32 {
	return a + b
}

// SubI32 is a - b, wrapping to 32 bits.
func SubI32(a, b int32) int32 {
	return a - b
}

// MulI32 is a * b, wrapping to 32 bits.
func MulI32(a, b int32) int32 {
	return a * b
}

// LeBytes is x sign-extended to 64 bits, as 8 little-endian bytes.
func LeBytes(x int32) []byte {
	n := uint64(int64(x))
	out := make([]byte, 8)
	for i := range out {
		out[i] = byte(n >> (8 * i))
	}
	return out
}

// XorB is a XOR b, as long as the shorter.
func XorB(a, b []byte) []byte {
	n := len(a)
	if len(b) < n {
		n = len(b)
	}
	out := make([]byte, n)
	for i := range out {
		out[i] = a[i] ^ b[i]
	}
	return out
}

var errEmpty = errors.New("empty")

// NonEmpty is s, or an error when it is empty.
func NonEmpty(s string) (string, error) {
	if s == "" {
		return "", errEmpty
	}
	return s, nil
}

// NonEmptyB is a, or an error when it is empty.
func NonEmptyB(a []byte) ([]byte, error) {
	if len(a) == 0 {
		return nil, errEmpty
	}
	return append([]byte{}, a...), nil
}

// Half is half of x.
func Half(x float64) float64 {
	return x / 2
}

// IsMax is whether x is the largest uint64.
func IsMax(x uint64) bool {
	return x == ^uint64(0)
}

// Keep is a copy of k; an error when u is empty.
func Keep(k, u []byte) ([]byte, error) {
	if len(u) == 0 {
		return nil, errEmpty
	}
	return append([]byte{}, k...), nil
}

// KeepBase is k, or an error when there is none.
func KeepBase(k *[]byte) ([]byte, error) {
	if k == nil {
		return nil, errEmpty
	}
	return append([]byte{}, (*k)...), nil
}
