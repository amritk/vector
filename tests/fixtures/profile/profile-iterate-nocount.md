---
title: "Profile fixture: vectors that iterate their call"
abbrev: Profile iterate
docname: draft-profile-iterate-nocount-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-16
author:
  - name: Vector Fixture
    org: vector
keyword:
  - vector-main-RFC7748
normative:
  ECC:
    title: Elliptic Curves for Security
    author:
      - ins: A. Langley
      - ins: M. Hamburg
      - ins: S. Turner
    date: 2016-01
    seriesinfo:
      RFC: 7748
--- abstract

A fixture, not a specification: X25519's iterated test vectors, each a
vector table row with an Iterate: paragraph after the table.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

This fixture adds nothing; it exists to be read.

# Interface

~~~ ts-interface
// module: nish/crypto/x25519
export function x25519(k: u8[], u: u8[]): u8[]
~~~

# Iteration

> For each iteration, set k to be the result of calling the function and u to be the old value of k.
> {{Section 5.2 of ECC}}
{: #R-ITER gi="blockquote"}

# Test Vectors {#vectors}

| Id | Call | Expected | Covers | Source | Title |
|---|---|---|---|---|---|
| 5.2-ITER-1000 | `x25519(For X25519 = 0900000000000000000000000000000000000000000000000000000000000000, For X25519 = 0900000000000000000000000000000000000000000000000000000000000000)` | `After 1,000 iterations = 684cf59ba83309552800ef566f2f4d3c1c3887c49360e3875f2eb94d99532c51` | R-ITER | {{Section 5.2 of ECC}} | RFC 7748 5.2: 1,000 iterations from k = u = 9 |
| 5.2-ITER-1M | `x25519(For X25519 = 0900000000000000000000000000000000000000000000000000000000000000, For X25519 = 0900000000000000000000000000000000000000000000000000000000000000)` | `After 1,000,000 iterations = 7c3911e0ab2586fd864497297e575e6f3bc601c0883c30df5f4dd2d24f665424` | R-ITER | {{Section 5.2 of ECC}} | RFC 7748 5.2: 1,000,000 iterations from k = u = 9 |

Iterate: 5.2-ITER-1000 times, (k, u) <- (x25519(k, u), k)

Iterate: 5.2-ITER-1M 1000000 times, slow, (k, u) ← (x25519(k, u), k)
