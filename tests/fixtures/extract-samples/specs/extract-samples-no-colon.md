---
title: "Extract fixture: a samples line without its colon"
abbrev: nish/hex
docname: draft-extract-samples-no-colon-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-11
author:
  - name: Vector Authors
    org: vector
normative:
  RFC4648:
--- abstract

Status: proposed. Module: std/hex.ts (nish/hex). A hexadecimal codec for
nish: hexEncode writes lowercase hex, and hexDecode reads hex in any case and
refuses everything else with null.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

Nish has no public hex codec, and 38 test files define their own. This spec
adds one, for tests, test vectors and configuration that carries keys in hex.

# Interface

~~~ ts-interface
// module: nish/hex
export const hexEncode = (bytes: u8[]): string
export const hexDecode = (text: string): u8[] | null
~~~

# Encoding

## Length

hexEncode MUST return exactly two characters per input byte.
{: #R-ENC-LEN}

~~~ ts-property
// P-ENC-LEN covers R-ENC-LEN — two characters per byte
forall (b: u8[] /* 0..64 */) => hexEncode(b).length === 2 * b.length
~~~

## Digits

Each byte MUST be written high nibble first, using the digits 0-9 and a-f.
{: #R-ENC-DIGITS}

hexEncode MUST NOT emit uppercase digits, separators or a prefix.
{: #R-ENC-ONLY}

~~~ ts-property
// P-ENC-LOWER covers R-ENC-ONLY — the encoding has no uppercase digit
forall (b: u8[] /* 0..64 */) => {
  const e = hexEncode(b);
  return e === e.toLowerCase();
}
~~~

~~~ ts-property
// P-ROUND-TRIP covers R-ROUND-TRIP, R-ENC-ONLY — hexDecode(hexEncode(b)) is b
// samples 96
forall (b: u8[] /* 0..64 */) => {
  const d = hexDecode(hexEncode(b));
  return d !== null && unwrap(d) === b;
}
~~~

# Decoding

## Accepted input

hexDecode MUST accept the digits 0-9, a-f and A-F, in any mix of case.
{: #R-DEC-ACCEPT}

~~~ ts-property
// P-CANONICAL covers R-ENC-DIGITS, R-DEC-ACCEPT — lowercase hex re-encodes to itself, high nibble first
forall (t: string /* 0..32 hexdigit */) => {
  const d = hexDecode(t);
  return d !== null && hexEncode(unwrap(d)) === t;
}
where t.length % 2 === 0
~~~

~~~ ts-property
// P-ANY-CASE covers R-DEC-ACCEPT — any mix of case decodes as its lowercase
forall (t: string /* 0..32 hexdigit HEXDIGIT */) => {
  const d = hexDecode(t);
  return d !== null && hexEncode(unwrap(d)) === t.toLowerCase();
}
where t.length % 2 === 0
~~~

## Rejected input {#rejected-input}

hexDecode MUST return null when the text has an odd length or contains any
other character, including whitespace and a "0x" prefix.
{: #R-DEC-REJECT}

~~~ ts-property
// P-ODD covers R-DEC-REJECT — an odd length is refused
forall (t: string /* 1..33 hexdigit HEXDIGIT */) => hexDecode(t) === null
where t.length % 2 === 1
~~~

~~~ ts-property
// P-OTHER covers R-DEC-REJECT — any other character, anywhere in an even-length text, is refused
forall (
  a: string /* 0..16 hexdigit HEXDIGIT */,
  x: string /* 1..1 " \t\n\r!\"#$%&'()*+,-./:;<=>?@GHIJKLMNOPQRSTUVWXYZ[\\]^_`ghijklmnopqrstuvwxyz{|}~" */,
  z: string /* 0..16 hexdigit HEXDIGIT */,
) => hexDecode(a + (x + z)) === null
where (a + (x + z)).length % 2 === 0
~~~

~~~ ts-property
// P-OTHER-EDGE covers R-DEC-REJECT — the characters next to each digit range are refused
forall (
  a: string /* 0..16 hexdigit HEXDIGIT */,
  x: string /* 1..1 "/:@G`g" */,
  z: string /* 0..16 hexdigit HEXDIGIT */,
) => hexDecode(a + (x + z)) === null
where (a + (x + z)).length % 2 === 0
~~~

~~~ ts-property
// P-PREFIX covers R-DEC-REJECT — a "0x" prefix is refused
forall (t: string /* 0..32 hexdigit HEXDIGIT */) => hexDecode("0x" + t) === null
where t.length % 2 === 0
~~~

## Empty input

hexDecode of the empty string MUST return an empty array, not null.
{: #R-DEC-EMPTY}

## Round trip

For all bytes b, hexDecode(hexEncode(b)) MUST equal b.
{: #R-ROUND-TRIP}

# Security Considerations

Test vectors and configuration decoded by this module are often key material.

hexDecode MUST NOT index a table by the value of a digit, so that its running
time depends only on the length of its input.

Untested: A constraint on how hexDecode is written and on its timing, not on what it returns: no functional test observes a table lookup or a data-dependent running time. Review the implementation for it.

# Test Vectors

| Id | Call | Expected | Covers | Source | Title |
|----|------|----------|--------|--------|-------|
| V1 | `hexDecode("")` | `""` | R-DEC-EMPTY | {{Section 10 of RFC4648}} | RFC 4648 §10: BASE16("") = "" decodes to the empty array |
| V2 | `hexDecode("66")` | `"f"` | R-DEC-ACCEPT, R-ROUND-TRIP | {{Section 10 of RFC4648}} | RFC 4648 §10: BASE16("f") = "66" decodes back |
| V3 | `hexDecode("666F6F")` | `"foo"` | R-DEC-ACCEPT | {{Section 10 of RFC4648}} | RFC 4648 §10: uppercase "666F6F" decodes to "foo" |
| V4 | `hexDecode("666F6F626172")` | `"foobar"` | R-DEC-ACCEPT | {{Section 10 of RFC4648}} | RFC 4648 §10: uppercase "666F6F626172" decodes to "foobar" |
| V6 | `hexDecode("aBcD")` | `[ab cd]` | R-DEC-ACCEPT | `python3 -c 'print(bytes.fromhex("aBcD").hex())'` | mixed case decodes |
| V7 | `hexDecode("abc")` | `null` | R-DEC-REJECT | {{rejected-input}} | an odd length is refused with null |
| V8 | `hexDecode("0x00")` | `null` | R-DEC-REJECT | {{rejected-input}} | a "0x" prefix is refused with null |
| V9 | `hexDecode("ab cd")` | `null` | R-DEC-REJECT | {{rejected-input}} | whitespace is refused with null |
