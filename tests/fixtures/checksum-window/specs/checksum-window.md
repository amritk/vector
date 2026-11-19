---
title: "A checksum over a window"
abbrev: checksum window
docname: draft-checksum-window-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-19
author:
  - name: Vector Fixture
    org: vector
--- abstract

A fixture, not a specification: CRC-32 and Adler-32 over a window of a
buffer, as nish's std checksum takes them, from spec to a run of that
module. Each function takes its bytes as (buf, off, len), which the
interface declares as one bytes parameter.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

The module is nish's own nish/compress/checksum, checked and run with
`--nish-root`. Its tests in tests/spec/emit run the same emitted test
against copies of it with one window read wrong, which the contract
refuses: the test passes every window at a nonzero offset, between guard
bytes.

# Interface

~~~ ts-interface
// module: nish/compress/checksum
export const crc32 = (buf: u8[] /* window */): u32
export const adler32 = (buf: u8[] /* window */): u32
export const adler32Update = (adler: u32, buf: u8[] /* window */): u32
~~~

# CRC-32 {#crc32}

crc32 MUST return the CRC-32 of the window's bytes, the reflected CRC with
polynomial 0xEDB88320 that zlib computes, and only of those bytes.
{: #R-CRC32}

# Adler-32 {#adler32}

adler32 MUST return the Adler-32 of the window's bytes, as zlib computes it,
and only of those bytes.
{: #R-ADLER32}

adler32Update MUST return the Adler-32 of the bytes an earlier checksum
covered followed by the window's bytes.
{: #R-ADLER32-UPDATE}

~~~ ts-property
// P-ADLER32-SPLIT covers R-ADLER32, R-ADLER32-UPDATE — a checksum continued over a second window is the checksum of both
forall (a: u8[] /* 0..32 */, b: u8[] /* 0..32 */) => adler32Update(adler32(a), b) === adler32(a.concat(b))
~~~

# Check values {#check-values}

These values are what zlib's crc32 and adler32 print in Python 3, as
`python3 -c 'import zlib; print(zlib.crc32(b"123456789"))'` does.

The CRC-32 of "123456789" is Check = 3421780262, and of "" it is Zero = 0.

The Adler-32 of "Wikipedia" is Adler = 300286872, and of "" it is Initial = 1.

The Adler-32 of "abc" continued from Start = 300286872 is Continued = 519570622.

# Security Considerations

Neither checksum resists a deliberate change: both detect accidental errors
only.

# Test Vectors

| Id | Call | Expected | Covers | Source | Title |
|----|------|----------|--------|--------|-------|
| V1 | `crc32("123456789")` | `Check = 3421780262` | R-CRC32 | {{check-values}} | the CRC-32 check value |
| V2 | `crc32("")` | `Zero = 0` | R-CRC32 | {{check-values}} | no bytes |
| V3 | `adler32("Wikipedia")` | `Adler = 300286872` | R-ADLER32 | {{check-values}} | the Adler-32 of "Wikipedia" |
| V4 | `adler32("")` | `Initial = 1` | R-ADLER32 | {{check-values}} | no bytes: the initial value |
| V5 | `adler32Update(Start = 300286872, "abc")` | `Continued = 519570622` | R-ADLER32-UPDATE | {{check-values}} | "abc" after "Wikipedia" |
