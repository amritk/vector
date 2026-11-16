---
title: "Run fixture: vector/core/hex with property sample counts"
abbrev: vector/core/hex
docname: draft-core-hex-samples-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-13
author:
  - name: Vector Authors
    org: vector
--- abstract

Module: src/core/hex.ts (vector/core/hex), vector's own. The helpers every
command shares to name bytes: toHex writes bytes as lowercase hex, and
sha256Hex names a text by its SHA-256 digest, the hash a contract records for
each source it quotes. This copy of vector's own spec is a fixture: two of
its properties set their sample counts, 96 and 200, for the CLI goldens.

This spec leaves two things out. It does not cover utf8Bytes, because the
emitted test defines a helper with that name. It does not cover text outside
ASCII, because a string domain or quoted string in a spec can hold only
printable ASCII.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

A contract pins every source it quotes by sha256Hex of the source's text, and
an emitted test names its contract the same way, so a wrong digest or a
digest spelled in another case would make every frozen check fail or, worse,
pass on the wrong bytes. This spec pins the three helpers down.

# Interface

~~~ ts-interface
// module: vector/core/hex
export const toHex = (bytes: u8[]): string
export const sha256Hex = (text: string): string
~~~

# Hex

## Length {#hex-length}

toHex MUST return exactly two characters per input byte.
{: #R-HEX-LEN}

~~~ ts-property
// P-HEX-LEN covers R-HEX-LEN — two characters per byte
// samples: 96
forall (b: u8[] /* 0..64 */) => toHex(b).length === 2 * b.length
~~~

## Digits {#hex-digits}

toHex MUST write each byte high nibble first, using only the digits 0-9 and
a-f.
{: #R-HEX-DIGITS}

~~~ ts-property
// P-HEX-LOWER covers R-HEX-DIGITS — the encoding has no uppercase digit
forall (b: u8[] /* 0..64 */) => {
  const e = toHex(b);
  return e === e.toLowerCase();
}
~~~

~~~ ts-property
// P-HEX-CONCAT covers R-HEX-LEN, R-HEX-DIGITS — each byte is written on its own, in order
// samples: 200
forall (a: u8[] /* 0..32 */, b: u8[] /* 0..32 */) => toHex(a.concat(b)) === toHex(a) + toHex(b)
~~~

# SHA-256 {#sha-256}

sha256Hex MUST return the SHA-256 digest of the UTF-8 encoding of its text,
as FIPS 180-4 defines SHA-256, written as toHex writes bytes.
{: #R-SHA256}

~~~ ts-property
// P-SHA256-LEN covers R-SHA256 — a digest is 64 lowercase hex digits
forall (t: string /* 0..80 ascii-printable */) => {
  const d = sha256Hex(t);
  return d.length === 64 && d === d.toLowerCase();
}
~~~

# Security Considerations

sha256Hex names the bytes a contract was frozen against; a collision in it
would let a changed source pass the frozen check. SHA-256 is chosen for that.

# Test Vectors

| Id | Call | Expected | Covers | Source | Title |
|----|------|----------|--------|--------|-------|
| V1 | `toHex([])` | `""` | R-HEX-LEN | `python3 -c 'print(bytes([]).hex())'` | no bytes, no digits |
| V2 | `toHex([00 0f 10 ff])` | `"000f10ff"` | R-HEX-LEN, R-HEX-DIGITS | `python3 -c 'print(bytes([0,15,16,255]).hex())'` | every nibble boundary, high nibble first, lowercase |
| V3 | `toHex("foobar")` | `"666f6f626172"` | R-HEX-DIGITS | `python3 -c 'print(b"foobar".hex())'` | RFC 4648's BASE16("foobar"), in lowercase |
| V4 | `sha256Hex("abc")` | `"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"` | R-SHA256 | `python3 -c 'import hashlib; print(hashlib.sha256(b"abc").hexdigest())'` | FIPS 180-4's one-block message "abc" |
| V5 | `sha256Hex("")` | `"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"` | R-SHA256 | `python3 -c 'import hashlib; print(hashlib.sha256(b"").hexdigest())'` | the empty message |
| V6 | `sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")` | `"248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"` | R-SHA256 | `python3 -c 'import hashlib; print(hashlib.sha256(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq").hexdigest())'` | FIPS 180-4's two-block message: padding crosses a block |
