---
title: "Fixture: a command row in a spec whose main source is RFC 4648"
abbrev: RFC 4648 command row
docname: draft-rfc4648-command-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-19
author:
  - name: Vector Fixture
    org: vector
keyword:
  - vector-main-RFC4648
normative:
  RFC4648:
--- abstract

A fixture, not a specification: base 32 of RFC 4648, tested by one vector
whose expected value a command prints, in a spec whose main source is the RFC.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

This fixture adds nothing; it exists to be read.

# Interface

~~~ ts-interface
// module: nish/base32
export function base32Encode(data: u8[]): string
~~~

# Base 32

> The Base 32 encoding is designed to represent arbitrary sequences of octets in a form that needs to be case insensitive but that need not be human readable.
> {{Section 6 of RFC4648}}
{: #R-B32 gi="blockquote"}

# Left out

> Implementations MUST NOT add line feeds to base-encoded data unless the specification referring to this document explicitly directs base encoders to add line feeds after a specific number of characters.
> {{Section 3.1 of RFC4648}}
{: gi="blockquote"}

Untested: base32Encode writes no line feeds at all

> Implementations MUST include appropriate pad characters at the end of encoded data unless the specification referring to this document explicitly states otherwise.
> {{Section 3.2 of RFC4648}}
{: gi="blockquote"}

Untested: an obligation this fixture does not need to test

> Implementations MUST reject the encoded data if it contains characters outside the base alphabet when interpreting base-encoded data, unless the specification referring to this document explicitly states otherwise.
> {{Section 3.3 of RFC4648}}
{: gi="blockquote"}

Untested: an obligation on a decoder, which this fixture does not declare

> These pad bits MUST be set to zero by conforming encoders, which is described in the descriptions on padding below.
> {{Section 3.5 of RFC4648}}
{: gi="blockquote"}

Untested: an obligation this fixture does not need to test

# Test Vectors {#vectors}

Input = 666f6f

| Id | Call | Expected | Covers | Source | Title |
|---|---|---|---|---|---|
| T1 | `base32Encode(Input = 666f6f)` | `"MZXW6==="` | R-B32 | `python3 -c 'import base64,sys;sys.stdout.write(base64.b32encode(b"foo").decode())'` | base 32 of "foo" |
