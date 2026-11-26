---
title: "Byte parts fixture: a result printed as a value's tail"
abbrev: Byte parts tail
docname: draft-byte-parts-tail-none-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-26
author:
  - name: Vector Fixture
    org: vector
keyword:
  - vector-main-RFC9001
normative:
  QUIC-TLS:
    title: Using TLS to Secure QUIC
    author:
      - ins: M. Thomson
    date: 2021-05
    seriesinfo:
      RFC: 9001
--- abstract

A fixture, not a specification: RFC 9001's Retry packet, printed whole
with its 16-byte integrity tag last; the vector's argument is the packet
before the tag and its expected value the tag. The connection ID the
tag also covers is the one Appendix A uses throughout.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

This fixture adds nothing; it exists to be read.

# Interface

~~~ ts-interface
// module: nish/quic/retry
export function retryTag(packet: u8[]): u8[]
~~~

# Retry

> This shows a Retry packet that might be sent in response to the
> Initial packet in Appendix A.2.
> {{Section A.4 of QUIC-TLS}}
{: #R-RETRY gi="blockquote"}

# Test Vectors {#vectors}

| Id | Call | Expected | Covers | Source | Title |
|---|---|---|---|---|---|
| A.4-RETRY | `retryTag(value is not included in the final Retry packet = ff000000010008f067a5502a4262b5746f6b656e)` | `[04 a2 65 ba 2e ff 4d 82 90 58 fb 3f 0f 24 96 ba]` | R-RETRY | {{Section A.4 of QUIC-TLS}} | RFC 9001 A.4: the Retry packet's integrity tag |
