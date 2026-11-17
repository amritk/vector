---
title: "Profile fixture: a vector held to its truncated result"
abbrev: Profile truncate
docname: draft-profile-truncate-unprinted-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-17
author:
  - name: Vector Fixture
    org: vector
keyword:
  - vector-main-RFC4231
normative:
  HMAC:
    title: Identifiers and Test Vectors for HMAC-SHA-224, HMAC-SHA-256, HMAC-SHA-384, and HMAC-SHA-512
    author:
      - ins: M. Nystrom
    date: 2005-12
    seriesinfo:
      RFC: 4231
--- abstract

A fixture, not a specification: HMAC-SHA-256's truncated test vector, a
vector table row with a Truncate: paragraph after the table.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

This fixture adds nothing; it exists to be read.

# Interface

~~~ ts-interface
// module: nish/crypto/hmac
export function hmacSha256(key: u8[], data: u8[]): u8[]
~~~

# Truncation

> Test with a truncation of output to 128 bits.
> {{Section 4.6 of HMAC}}
{: #R-TRUNC gi="blockquote"}

# Test Vectors {#vectors}

| Id | Call | Expected | Covers | Source | Title |
|---|---|---|---|---|---|
| 4.2-256 | `hmacSha256(Key = 0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b, Data = 4869205468657265)` | `HMAC-SHA-256 = b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7` | R-TRUNC | {{Section 4.2 of HMAC}} | RFC 4231 4.2: Test Case 1, HMAC-SHA-256 |
| 4.6-256 | `hmacSha256(Key = 0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c, Data = 546573742057697468205472756e636174696f6e)` | `HMAC-SHA-256 = a3b6167473100ee06e0c796c2955552b` | R-TRUNC | {{Section 4.6 of HMAC}} | RFC 4231 4.6: Test Case 5, HMAC-SHA-256 truncated to 128 bits |

Truncate: 4.6-256 to 16 bytes
