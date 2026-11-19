---
title: "Elliptic Curves for Security: X25519's Diffie-Hellman agreement"
abbrev: X25519 DH property
docname: draft-x25519-property-00
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

A fixture, not a specification: the Diffie-Hellman agreement of RFC
7748 Section 6.1 as a property over sampled scalars, from spec to a run
of the reference X25519 in tests/fixtures/x25519. A property passes u8[]
to a Secret<u8[]> parameter; the test wraps it in secret() and exposes a
Secret result. Every
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

A property passes u8[] scalars to the Secret<u8[]> parameters, and compares
the Secret results as bytes:

~~~ ts-property
// P-DH covers R-DH — both sides derive the same shared secret
// samples: 8
forall (a: u8[] /* 32..32 */, b: u8[] /* 32..32 */) =>
  x25519(a, unwrap(x25519Base(b))) === x25519(b, unwrap(x25519Base(a)))
~~~

~~~ ts-property
// P-BASE covers R-FUNC — the base point's u-coordinate is 9
// samples: 8
forall (a: u8[] /* 32..32 */) => x25519(a, concat([09], zeros(31))) === x25519Base(a)
~~~

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
