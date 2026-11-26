---
title: "Byte parts fixture: a format constant in a concat"
abbrev: Byte parts format
docname: draft-byte-parts-format-hex-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-26
author:
  - name: Vector Fixture
    org: vector
keyword:
  - vector-main-RFC6979
normative:
  ECDSA:
    title: Deterministic Usage of the Digital Signature Algorithm (DSA) and Elliptic Curve Digital Signature Algorithm (ECDSA)
    author:
      - ins: T. Pornin
    date: 2013-08
    seriesinfo:
      RFC: 6979
--- abstract

A fixture, not a specification: RFC 6979's P-256 public key, encoded as
SEC1's uncompressed point, a prefix byte the RFC does not print, then Ux
and Uy.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

This fixture adds nothing; it exists to be read.

# Interface

~~~ ts-interface
// module: nish/crypto/p256
export function p256Public(x: u8[]): u8[]
~~~

# Key pair

> public key: U = xG
> {{Section A.2.5 of ECDSA}}
{: #R-PUB gi="blockquote"}

# Test Vectors {#vectors}

| Id | Call | Expected | Covers | Source | Title |
|---|---|---|---|---|---|
| P256-PUB | `p256Public(x = c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721)` | `concat([04], Ux = 60fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb6, Uy = 7903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d4462299)` | R-PUB | {{Section A.2.5 of ECDSA}} | RFC 6979 A.2.5: the P-256 public key, SEC1 uncompressed |

Format: P256-PUB expect.concat[0] is 05, SEC1 prefixes an uncompressed point with 04
