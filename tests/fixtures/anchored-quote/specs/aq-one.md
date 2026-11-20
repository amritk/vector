---
title: "Spec 0001: aq — anchored quotes"
abbrev: aq
docname: draft-aq-one-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-19
author:
  - name: Vector Authors
    org: vector
normative:
  RFC4648:
--- abstract

Status: proposed. Module: std/aq.ts (nish/aq). Two quotes of RFC 4648 in one section.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

A spec that quotes another RFC's requirements in its own sections.

# Interface

~~~ ts-interface
// module: nish/aq
export const aqEncode = (bytes: u8[]): string
~~~

# Encoding

> Implementations MUST NOT add line feeds to base-encoded data unless the
> specification referring to this document explicitly directs base encoders
> to add line feeds after a specific number of characters.
> {{Section 3.1 of RFC4648}}
{: #R-NO-LF gi="blockquote"}

~~~ ts-property
// P-NO-LF covers R-NO-LF — no line feed
forall (b: u8[] /* 0..64 */) => aqEncode(b).length % 4 === 0
~~~

> Implementations MUST include appropriate pad characters at the end of
> encoded data unless the specification referring to this document
> explicitly states otherwise.
> {{Section 3.2 of RFC4648}}
{: #R-PAD gi="blockquote"}

~~~ ts-property
// P-PAD covers R-PAD — a whole number of quanta
forall (b: u8[] /* 0..64 */) => aqEncode(b).length % 4 === 0
~~~
