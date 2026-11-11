---
title: "Profile fixture: a spec the profile reads into a contract"
abbrev: Profile hex
docname: draft-profile-hex-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-11
author:
  - name: Vector Fixture
    org: vector
normative:
  RFC4648:
--- abstract

A fixture, not a specification: test/fixtures/kramdown/profile.md with the
two constructs the profile refuses there made readable, plus an exclusion of
an unanchored sentence and of a quote.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

This fixture adds nothing; it exists to be read.

# Interface

~~~ ts-interface
// module: nish/hex
export const hexEncode = (bytes: u8[]): string
export function hexDecode(text: string): u8[] | null
~~~

# Encoding

## Length

hexEncode MUST return exactly two characters per input byte.
{: #R-ENC-LEN}

~~~ ts-property
// P-ENC-LEN covers R-ENC-LEN, R-ENC-DIGITS — two characters per byte
forall (b: u8[] /* 0..64 */) => hexEncode(b).length === 2 * b.length
~~~

## Digits

Each byte MUST be written high nibble first, using the digits 0-9 and a-f.
{: #R-ENC-DIGITS}

~~~ ts-property
// P-ENC-LOWER covers R-ENC-DIGITS — output is lowercase
forall (b: u8[] /* 0..64 */, t: string /* 0..32 hexdigit HEXDIGIT */) => { const e = hexEncode(b); return e === e.toLowerCase(); }
where t.length % 2 === 0
~~~

# Decoding

## Accepted input

Definition: a hex digit is one of the characters 0-9, a-f and A-F.
{: #R-DEF-DIGIT}

> BASE16("f") = "66"
> {{Section 10 of RFC4648}}
{: #R-RFC-VECTORS gi="blockquote"}

> BASE16("fo") = "666F"
> {{Section 10 of RFC4648}}
{: #R-RFC-UPPER gi="blockquote"}

Untested: the reference prints uppercase digits. Checked by: R-ENC-DIGITS.

## Rejected input

hexDecode MUST return null when the text has an odd length or contains any
other character, including whitespace and a "0x" prefix.
{: #R-DEC-REJECT}

~~~ ts-property
// P-DEC-ODD covers R-DEC-REJECT — odd-length text is rejected
forall (t: string /* 1..33 hexdigit */) => implies(t.length % 2 === 1, hexDecode(t) === null)
~~~

## Empty input {#empty-input}

hexDecode of the empty string MUST return an empty array, not null.
{: #R-DEC-EMPTY}

## Timing

hexDecode MUST NOT index a table by the value of a digit.
{: #R-DEC-TIMING}

Untested: timing is not observable from a unit test. Checked by: code review.

Callers SHOULD NOT decode secrets with this module.

Untested: an obligation on the caller.

# Test Vectors

| Id | Call | Expected | Covers | Source | Title |
|----|------|----------|--------|--------|-------|
| V1 | `hexDecode("")` | `(empty)` | R-DEC-EMPTY | {{Section 10 of RFC4648}} | empty input decodes to empty bytes |
| V2 | `hexDecode("66")` | `"f"` | R-RFC-VECTORS | {{Section 10 of RFC4648}} | one byte |
| V3 | `hexEncode([00 0f f0 ff])` | `"000ff0ff"` | R-ENC-LEN | `python3 -c 'print(bytes([0,15,240,255]).hex())'` | bytes literal |
| V4 | `hexDecode("abc")` | `null` | R-DEC-REJECT | {{empty-input}} | odd length |
| V5 | `hexEncode([])` | `""` | R-DEC-EMPTY | {{empty-input}} | empty bytes literal |
| V6 | `hexDecode("a\"b\\cA\n")` | `null` | R-DEC-REJECT, R-DEF-DIGIT | {{empty-input}} | string with escapes |
| V7 | `hexEncode(concat([00], [ff]))` | `Key = 00ff` | R-ENC-LEN | {{Section 10 of RFC4648}} | concat and a labelled value |
| V8 | `hexEncode(Key = 0b0b0b)` | `"0b0b0b"` | R-ENC-DIGITS | `echo 0b0b0b` | labelled argument |

# Unnumbered Notes
{: numbered="false"}

This section is unnumbered.

--- back

# Appendix Section

An appendix, lettered A.
