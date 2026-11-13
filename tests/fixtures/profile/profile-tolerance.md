---
title: "Profile fixture: f64 vectors compared within a tolerance"
abbrev: Profile tolerance
docname: draft-profile-tolerance-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-13
author:
  - name: Vector Fixture
    org: vector
--- abstract

A fixture, not a specification: two f64 vectors, each with a tolerance
stated by its own section of the spec.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

This fixture adds nothing; it exists to be read.

# Interface

~~~ ts-interface
// module: nish/fmath
export function fmathSqrt(x: f64): f64
export function fmathHalf(x: f64): f64
~~~

# Accuracy {#accuracy}

fmathSqrt MUST return a result within one unit in the last place of the exact square root.
{: #R-SQRT}

fmathHalf MUST return a result within 1e-9 of half its argument.
{: #R-HALF}

# Test Vectors {#vectors}

| Id | Call | Expected | Covers | Source | Title |
|---|---|---|---|---|---|
| V1 | `fmathSqrt(2)` | `1.4142135623730951` | R-SQRT | {{vectors}} | the square root of two |
| V2 | `fmathHalf(1)` | `0.5` | R-HALF | {{vectors}} | half of one |

Tolerance: V1 ulps 1, {{accuracy}}: "within one unit in the last place of the exact square root"

Tolerance: V2 abs 1e-9, {{accuracy}}: "within 1e-9 of half its argument"
