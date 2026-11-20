---
title: "Block bounds fixture: a result before a property whose title reads as a retraction."
abbrev: nish/mini
docname: draft-block-bounds-retract-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-19
author:
  - name: Vector Authors
    org: vector
--- abstract

Status: proposed. Module: std/mini.ts (nish/mini). a result before a property whose title reads as a retraction.

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

# Validity {#validity}

A text is valid when it is an even run of hex digits.

miniIsValid MUST return false for any text other than an even run of hex digits.
{: #R-VALID}

~~~ ts-property
// P-ODD covers R-VALID — a text of odd length is not
forall (t: string /* 1..33 hexdigit */) => miniIsValid(t) === false
where t.length % 2 === 1
~~~

# Test Vectors

| Id | Call | Expected | Covers | Source | Title |
|----|------|----------|--------|--------|-------|
| V1 | `miniIsValid("abc")` | `false` | R-VALID | {{validity}} | an odd length is not valid |
