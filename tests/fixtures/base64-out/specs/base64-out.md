---
title: "Base 64 written into a caller's buffer"
abbrev: base64 out
docname: draft-base64-out-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-19
author:
  - name: Vector Fixture
    org: vector
--- abstract

A fixture, not a specification: base 64 encoding as nish's std base64
writes it, into a caller's buffer from an index, answering the index just
past the last character. The interface declares that (out, at) -> end
write as a bytes result.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

The module is nish's own nish/base64, checked and run with `--nish-root`.
Its tests in tests/spec/emit run the same emitted test against copies of it
that write one byte wrong, past the end, or answer the wrong end, which the
contract refuses: the test passes the buffer at a nonzero index, between
guard bytes, and checks every byte outside the written range.

# Interface

~~~ ts-interface
// module: nish/base64
export const base64EncodeInto = (src: u8[] /* window */, dst: u8[] /* out 2 * src.length + 4 */): u8[]
~~~

# Encoding {#encoding}

base64EncodeInto MUST write the padded base 64 of the window's bytes, in the
standard alphabet, and only those characters, from the index it is given.
{: #R-B64-ENCODE}

base64EncodeInto MUST answer the index just past the last character it
wrote.
{: #R-B64-END}

# Security Considerations

Base 64 is an encoding, not a cipher: it hides nothing.

# Test Vectors

| Id | Call | Expected | Covers | Source | Title |
|----|------|----------|--------|--------|-------|
| V1 | `base64EncodeInto("foobar")` | `"Zm9vYmFy"` | R-B64-ENCODE, R-B64-END | `python3 -c 'import base64;print(base64.b64encode(b"foobar").hex())'` | whole groups |
| V2 | `base64EncodeInto("fo")` | `"Zm8="` | R-B64-ENCODE, R-B64-END | `python3 -c 'import base64;print(base64.b64encode(b"fo").hex())'` | one pad character |
| V3 | `base64EncodeInto("f")` | `"Zg=="` | R-B64-ENCODE, R-B64-END | `python3 -c 'import base64;print(base64.b64encode(b"f").hex())'` | two pad characters |
| V4 | `base64EncodeInto("")` | `""` | R-B64-END | `python3 -c 'import base64;print(base64.b64encode(b"").hex())'` | nothing written: the end is the index |
