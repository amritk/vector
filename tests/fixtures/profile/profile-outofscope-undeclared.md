---
title: "Profile fixture: an export left undeclared"
abbrev: Profile out of scope
docname: draft-profile-outofscope-undeclared-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-16
author:
  - name: Vector Fixture
    org: vector
--- abstract

A fixture, not a specification: one function under test, and one export
of the same module that the spec neither tests nor declares out of scope.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

This fixture adds nothing; it exists to be read.

# Interface

~~~ ts-interface
// module: nish/fmath
export function fmathHalf(x: f64): f64
~~~


# Halving {#halving}

fmathHalf MUST return half its argument.
{: #R-HALF}

# Test Vectors {#vectors}

| Id | Call | Expected | Covers | Source | Title |
|---|---|---|---|---|---|
| V1 | `fmathHalf(1)` | `0.5` | R-HALF | {{vectors}} | half of one |
