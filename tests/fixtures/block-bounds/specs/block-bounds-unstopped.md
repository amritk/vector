---
title: "Block bounds fixture: a result that ends its paragraph without a period, before a property."
abbrev: nish/mini
docname: draft-block-bounds-unstopped-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-19
author:
  - name: Vector Authors
    org: vector
--- abstract

Status: proposed. Module: std/mini.ts (nish/mini). a result that ends its paragraph without a period, before a property.

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


For a text of odd length, miniIsValid MUST return false
{: #R-VALID}

~~~ ts-property
// P-ODD covers R-VALID — an odd length is never valid
forall (t: string /* 1..33 hexdigit */) => miniIsValid(t) === false
where t.length % 2 === 1
~~~

# Test Vectors

| Id | Call | Expected | Covers | Source | Title |
|----|------|----------|--------|--------|-------|
| V1 | `miniIsValid("abc")` | `false` | R-VALID | {{validity}} | an odd length is not valid |
