---
title: "Fixture: command sources that print an integer, a bool or null"
abbrev: Command values
docname: draft-command-values-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-19
author:
  - name: Vector Fixture
    org: vector
--- abstract

A fixture, not a specification: vectors whose expected integer, bool or null
a shell command prints, as RFC 9000 A.1's 151288809941952652 would be.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

This fixture adds nothing; it exists to be read.

# Interface

~~~ ts-interface
// module: fixture/varint
export function varintRead(b: u8[]): u64
export function varintSigned(b: u8[]): i64
export function varintMinimal(b: u8[]): boolean
export function varintFind(b: u8[]): i32 | null
~~~

# Reading

varintRead MUST return the value an eight-byte varint encodes.
{: #R-READ}

# Test Vectors

| Id | Call | Expected | Covers | Source | Title |
|---|---|---|---|---|---|
| V-WIDE | `varintRead([c2 19 7c 5e ff 14 e8 8c])` | `151288809941952652` | R-READ | `printf 151288809941952652` | an integer above 2^53 |
| V-NEG | `varintSigned([ff])` | `-1` | R-READ | `echo -1` | a negative integer |
| V-ZERO | `varintSigned([00])` | `0` | R-READ | `printf '0\n\n'` | zero, the output trimmed |
| V-TRUE | `varintMinimal([25])` | `true` | R-READ | `echo true` | a bool |
| V-FALSE | `varintMinimal([40 25])` | `false` | R-READ | `echo false` | the other bool |
| V-NULL | `varintFind([01])` | `null` | R-READ | `echo null` | null |
