---
title: "ChaCha20 and Poly1305: the quarter round"
abbrev: ChaCha20 quarter round
docname: draft-rfc8439-quarter-round-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-17
keyword:
  - vector-main-RFC8439
author:
  - name: Vector Fixture
    org: vector
normative:
  RFC8439:

--- abstract

A fixture, not a specification: the quarter-round test vectors of RFC 8439
Sections 2.1.1 and 2.2.1, over a u32[] state, from spec to a run of the
fixture quarter round in tests/fixtures/chacha20. Every binding sentence of
RFC 8439 is quoted here, and those this fixture does not test are excluded.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

The module is the fixture quarter round of tests/fixtures/chacha20/fixture,
run with `--package fixture=tests/fixtures/chacha20/fixture`. It takes the
ChaCha state as 32-bit words and the indices of the four it operates on,
and returns the state after the quarter round. Section 2.1.1 runs it on a
state of four words, and Section 2.2.1 on the whole 16-word state.

# Interface

~~~ ts-interface
// module: fixture/chacha20
export const chacha20QuarterRound = (state: u32[], a: i32, b: i32, c: i32, d: i32): u32[] | null
~~~

# The Quarter Round

> After running a Quarter Round on these four numbers, we get these:
> {{Section 2.1.1 of RFC8439}}
{: #R-QUARTER-ROUND gi="blockquote"}

> Note that only the numbers in positions 2, 7, 8, and 13 changed.
> {{Section 2.2.1 of RFC8439}}
{: #R-QUARTER-ROUND-STATE gi="blockquote"}

# Excluded

> Words 13-15 are a nonce, which MUST not be repeated for the same key.
> {{Section 2.3 of RFC8439}}
{: gi="blockquote"}

Untested: this fixture checks the quarter round only

> The pair (r,s) should be unique, and MUST be unpredictable for each invocation (that is why it was originally obtained by encrypting a nonce), while "r" MAY be constant, but needs to be modified as follows before being used: ("r" is treated as a 16-octet little-endian number):
> {{Section 2.5 of RFC8439}}
{: gi="blockquote"}

Untested: this fixture checks the quarter round only

> Any document that specifies the use of Poly1305 as a MAC algorithm for some protocol MUST specify that 256 bits are allocated for the integrity key.
> {{Section 2.6 of RFC8439}}
{: gi="blockquote"}

Untested: this fixture checks the quarter round only

> This MUST be unique per invocation with the same key, so it MUST NOT be randomly generated.
> {{Section 2.6 of RFC8439}}
{: gi="blockquote"}

Untested: this fixture checks the quarter round only

> Additionally, any protocol using this algorithm MUST include the complete tag to minimize the opportunity for forgery.
> {{Section 4 of RFC8439}}
{: gi="blockquote"}

Untested: this fixture checks the quarter round only

> Tag truncation MUST NOT be done.
> {{Section 4 of RFC8439}}
{: gi="blockquote"}

Untested: this fixture checks the quarter round only

> The Poly1305 key MUST be unpredictable to an attacker.
> {{Section 4 of RFC8439}}
{: gi="blockquote"}

Untested: this fixture checks the quarter round only

> For this reason, with online protocols, implementation MUST use a constant-time comparison function rather than relying on optimized but insecure library functions such as the C language's memcmp().
> {{Section 4 of RFC8439}}
{: gi="blockquote"}

Untested: this fixture checks the quarter round only

# Vectors

| Id | Call | Expected | Covers | Source | Title |
|----|------|----------|--------|--------|-------|
| 2.1.1-QUARTER-ROUND | `chacha20QuarterRound([0x11111111 0x01020304 0x9b8d6f43 0x01234567], 0, 1, 2, 3)` | `[0xea2a92f4 0xcb1cf8ce 0x4581472e 0x5881c4bb]` | R-QUARTER-ROUND | {{Section 2.1.1 of RFC8439}} | RFC 8439 2.1.1: a quarter round on four numbers |
| 2.2.1-QUARTER-ROUND-STATE | `chacha20QuarterRound(Sample ChaCha State = [879531e0 c5ecf37d 516461b1 c9a62f8a 44c20ef3 3390af7f d9fc690b 2a5f714c 53372767 b00a5631 974c541a 359e9963 5c971061 3d631689 2098d9d6 91dbd320], 2, 7, 8, 13)` | `[879531e0 c5ecf37d bdb886dd c9a62f8a 44c20ef3 3390af7f d9fc690b cfacafd2 e46bea80 b00a5631 974c541a 359e9963 5c971061 ccc07c79 2098d9d6 91dbd320]` | R-QUARTER-ROUND-STATE | {{Section 2.2.1 of RFC8439}} | RFC 8439 2.2.1: QUARTERROUND(2, 7, 8, 13) on the ChaCha state |
