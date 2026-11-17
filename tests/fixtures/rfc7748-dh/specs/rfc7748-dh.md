---
title: "Elliptic Curves for Security: X25519's Diffie-Hellman vector"
abbrev: X25519 DH
docname: draft-rfc7748-dh-00
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

A fixture, not a specification: the Diffie-Hellman test vector of RFC
7748 Section 6.1, cited under the labels the RFC prints it with, from
spec to a run of the reference X25519 in tests/fixtures/x25519. Every
binding sentence of RFC 7748 is quoted here, and those this fixture does
not test are excluded.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

The module is the reference X25519 of tests/fixtures/x25519/fixture, run
with `--package fixture=tests/fixtures/x25519/fixture`. Each row cites the
values of Section 6.1 under the labels the RFC prints them with, such as
`Alice's private key, a` and `Alice's public key, X25519(a, 9)`, so
fidelity checks every byte against the RFC.

# Interface

~~~ ts-interface
// module: fixture/x25519
export const x25519 = (scalar: Secret<u8[]>, u: u8[]): Secret<u8[]> | null
export const x25519Base = (scalar: Secret<u8[]>): u8[] | null
~~~

# The X25519 Function

> The functions take a scalar and a u-coordinate as inputs and produce a u-coordinate as output.
> {{Section 5 of RFC7748}}
{: #R-FUNC gi="blockquote"}

> When receiving such an array, implementations of X25519 (but not X448) MUST mask the most significant bit in the final byte.
> {{Section 5 of RFC7748}}
{: gi="blockquote"}

Untested: this fixture checks the Section 6.1 vector only; amritk/nish's specs/rfc7748-x25519.md tests the mask

> Implementations MUST accept non-canonical values and process them as if they had been reduced modulo the field prime.
> {{Section 5 of RFC7748}}
{: gi="blockquote"}

Untested: this fixture checks the Section 6.1 vector only; amritk/nish's specs/rfc7748-x25519.md tests non-canonical values

> For X25519, the unused, most significant bit MUST be zero.
> {{Section 5 of RFC7748}}
{: gi="blockquote"}

Untested: this fixture checks the Section 6.1 vector only; amritk/nish's specs/rfc7748-x25519.md tests the output's top bit

> The cswap function SHOULD be implemented in constant time (i.e., independent of the swap argument).
> {{Section 5 of RFC7748}}
{: gi="blockquote"}

Untested: timing is not observable by a functional test

# Diffie-Hellman

> Both now share K = X25519(a, X25519(b, 9)) = X25519(b, X25519(a, 9)) as a shared secret.
> {{Section 6.1 of RFC7748}}
{: #R-DH gi="blockquote"}

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
| 6.1-ALICE | `x25519Base(Alice's private key, a = 77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a)` | `Alice's public key, X25519(a, 9) = 8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a` | R-FUNC, R-DH | {{Section 6.1 of RFC7748}} | Alice's public key |
| 6.1-K | `x25519(Alice's private key, a = 77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a, Bob's public key, X25519(b, 9) = de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f)` | `Their shared secret, K = 4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742` | R-DH | {{Section 6.1 of RFC7748}} | the shared secret |
