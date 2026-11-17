---
title: "Test Vector scope: a plain cite of a section with one case per subsection"
abbrev: nish/crypto/chacha20poly1305
docname: draft-scope-plain-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-17
author:
  - name: vector
normative:
  RFC8439:
--- abstract

A plain cite reads as before.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

A test fixture over the unmodified RFC 8439.

# Interface

~~~ ts-interface
// module: nish/crypto/chacha20poly1305
export const chacha20Block = (key: u8[], counter: u32, nonce: u8[]): u8[] | null
export const poly1305 = (key: u8[], msg: u8[]): u8[] | null
~~~

# Requirements

> The output is 64 random-looking bytes.
> {{Section 2.3 of RFC8439}}
{: #R-BLOCK gi="blockquote"}

> Poly1305 takes a 32-byte one-time key and a message and produces a 16-byte tag.
> {{Section 2.5 of RFC8439}}
{: #R-POLY gi="blockquote"}

# Test Vectors

| Id | Call | Expected | Covers | Source | Title |
|----|------|----------|--------|--------|-------|
| A.1-BLOCK-1 | `chacha20Block(Key = 0000000000000000000000000000000000000000000000000000000000000000, Block Counter = 0, Nonce = 000000000000000000000000)` | `Keystream = 76b8e0ada0f13d90405d6ae55386bd28bdd219b8a08ded1aa836efcc8b770dc7da41597c5157488d7724e03fb8d84a376a43b8f41518a11cc387b669b2ee6586` | R-BLOCK | {{Section A.1 of RFC8439}} | RFC 8439 A.1 Test Vector #1: the ChaCha20 block function |
| 2.5.2-POLY1305 | `poly1305(Key Material = 85d6be7857556d337f4452fe42d506a80103808afb0db2fd4abff6af4149f51b, Message to be Authenticated = 43727970746f6772617068696320466f72756d2052657365617263682047726f7570)` | `Tag = a8061dc1305136c6c22b8baf0c0127a9` | R-POLY | {{Section 2.5.2 of RFC8439}} | RFC 8439 2.5.2: Poly1305 tags the message |
