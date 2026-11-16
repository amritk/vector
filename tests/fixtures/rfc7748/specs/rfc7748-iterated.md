---
title: "Elliptic Curves for Security: X25519's iterated vectors"
abbrev: X25519 iterated
docname: draft-rfc7748-iterated-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-16
keyword:
  - vector-main-RFC7748
author:
  - name: Vector Fixture
    org: vector
normative:
  RFC7748:

--- abstract

A fixture, not a specification: the iterated test vectors of RFC 7748
Section 5.2, after one, 1,000 and 1,000,000 iterations of X25519, from
spec to a run of the reference X25519 in tests/fixtures/x25519. Every
binding sentence of RFC 7748 is quoted here, and those this fixture does
not test are excluded.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

The module is the reference X25519 of tests/fixtures/x25519/fixture, run
with `--package fixture=tests/fixtures/x25519/fixture`. The one-iteration
vector is a plain row. The 1,000- and 1,000,000-iteration vectors are rows
whose Call holds the initial arguments and whose Expected holds the final
k, each with an Iterate paragraph after the table; the 1,000,000 one is
slow, so it runs only under `--slow`.

# Interface

~~~ ts-interface
// module: fixture/x25519
export const x25519 = (scalar: Secret<u8[]>, u: u8[]): Secret<u8[]> | null
~~~

# The X25519 Function

> The functions take a scalar and a u-coordinate as inputs and produce a u-coordinate as output.
> {{Section 5 of RFC7748}}
{: #R-FUNC gi="blockquote"}

> When receiving such an array, implementations of X25519 (but not X448) MUST mask the most significant bit in the final byte.
> {{Section 5 of RFC7748}}
{: gi="blockquote"}

Untested: this fixture checks the iterated vectors only; amritk/nish's specs/rfc7748-x25519.md tests the mask

> Implementations MUST accept non-canonical values and process them as if they had been reduced modulo the field prime.
> {{Section 5 of RFC7748}}
{: gi="blockquote"}

Untested: this fixture checks the iterated vectors only; amritk/nish's specs/rfc7748-x25519.md tests non-canonical values

> For X25519, the unused, most significant bit MUST be zero.
> {{Section 5 of RFC7748}}
{: gi="blockquote"}

Untested: this fixture checks the iterated vectors only; amritk/nish's specs/rfc7748-x25519.md tests the output's top bit

> The cswap function SHOULD be implemented in constant time (i.e., independent of the swap argument).
> {{Section 5 of RFC7748}}
{: gi="blockquote"}

Untested: timing is not observable by a functional test

# Test Vectors of Section 5.2

> For each iteration, set k to be the result of calling the function and u to be the old value of k.
> {{Section 5.2 of RFC7748}}
{: #R-ITER gi="blockquote"}

# Deterministic Generation

> The trace of Frobenius MUST NOT be in {0, 1} in order to rule out the attacks described in [smart], [satoh], and [semaev], as in [brainpool] and [safecurves].
> {{Appendix A of RFC7748}}
{: gi="blockquote"}

Untested: an obligation on choosing a curve, which Curve25519 already meets; nothing an implementation of X25519 does can satisfy or violate it

> MOV Degree [reducing]: the embedding degree MUST be greater than (order - 1) / 100, as in [brainpool] and [safecurves].
> {{Appendix A of RFC7748}}
{: gi="blockquote"}

Untested: an obligation on choosing a curve, which Curve25519 already meets; nothing an implementation of X25519 does can satisfy or violate it

> CM Discriminant: discriminant D MUST be greater than 2^100, as in [safecurves].
> {{Appendix A of RFC7748}}
{: gi="blockquote"}

Untested: an obligation on choosing a curve, which Curve25519 already meets; nothing an implementation of X25519 does can satisfy or violate it

# Vectors

| Id | Call | Expected | Covers | Source | Title |
|----|------|----------|--------|--------|-------|
| 5.2-ITER-1 | `x25519(For X25519 = 0900000000000000000000000000000000000000000000000000000000000000, For X25519 = 0900000000000000000000000000000000000000000000000000000000000000)` | `After one iteration = 422c8e7a6227d7bca1350b3e2bb7279f7897b87bb6854b783c60e80311ae3079` | R-FUNC, R-ITER | {{Section 5.2 of RFC7748}} | RFC 7748 5.2: one iteration from k = u = 9 |
| 5.2-ITER-1000 | `x25519(For X25519 = 0900000000000000000000000000000000000000000000000000000000000000, For X25519 = 0900000000000000000000000000000000000000000000000000000000000000)` | `After 1,000 iterations = 684cf59ba83309552800ef566f2f4d3c1c3887c49360e3875f2eb94d99532c51` | R-ITER | {{Section 5.2 of RFC7748}} | RFC 7748 5.2: 1,000 iterations from k = u = 9 |
| 5.2-ITER-1M | `x25519(For X25519 = 0900000000000000000000000000000000000000000000000000000000000000, For X25519 = 0900000000000000000000000000000000000000000000000000000000000000)` | `After 1,000,000 iterations = 7c3911e0ab2586fd864497297e575e6f3bc601c0883c30df5f4dd2d24f665424` | R-ITER | {{Section 5.2 of RFC7748}} | RFC 7748 5.2: 1,000,000 iterations from k = u = 9 |

Iterate: 5.2-ITER-1000 1,000 times, (k, u) <- (x25519(k, u), k)

Iterate: 5.2-ITER-1M 1,000,000 times, slow, (k, u) <- (x25519(k, u), k)
