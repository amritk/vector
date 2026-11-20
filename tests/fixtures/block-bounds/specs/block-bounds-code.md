---
title: "Block bounds fixture: a requirement after a property's code block."
abbrev: nish/mini
docname: draft-block-bounds-code-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-19
author:
  - name: Vector Authors
    org: vector
--- abstract

Status: proposed. Module: std/mini.ts (nish/mini). a requirement after a property's code block.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

Each sentence this spec states ends at its own block.

# Interface

~~~ ts-interface
// module: nish/mini
export const miniEncode = (bytes: u8[]): string
export const miniIsValid = (text: string): boolean
~~~

# Length

No bytes encode as the empty text, "".

miniEncode MUST return exactly two characters per input byte.
{: #R-ENC-LEN}

~~~ ts-property
// P-ENC-LEN covers R-ENC-LEN, R-ENC-LOWER — two characters per byte
forall (b: u8[] /* 0..64 */) => miniEncode(b).length === 2 * b.length
~~~

miniEncode MUST NOT emit uppercase digits.
{: #R-ENC-LOWER}

# Test Vectors

| Id | Call | Expected | Covers | Source | Title |
|----|------|----------|--------|--------|-------|
| V1 | `miniEncode([])` | `""` | R-ENC-LEN | {{length}} | no bytes, no characters |
