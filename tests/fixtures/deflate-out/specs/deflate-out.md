---
title: "Raw DEFLATE written into a caller's buffer"
abbrev: deflate out
docname: draft-deflate-out-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-19
author:
  - name: Vector Fixture
    org: vector
--- abstract

A fixture, not a specification: raw DEFLATE as nish's std compress writes
it, into a caller's buffer from an index, answering the index just past the
last byte or a negative code. The interface declares each (out, at) -> end
write as a bytes result, and the negative code as null.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

The module is nish's own nish/compress/deflate, checked and run with
`--nish-root`. Its tests in tests/spec/emit run the same emitted test
against copies of it that write past the end they answer, which the contract
refuses. A compressor's output is not fixed, so the compressed vector is a
stored block, which zlib and nish write alike, and a property checks the
rest by a round trip.

# Interface

~~~ ts-interface
// module: nish/compress/deflate
export const deflateCompress = (src: u8[] /* window */, out: u8[] /* out 2 * src.length + 18 */, level: i32): u8[]
export const deflateDecompress = (src: u8[] /* window */, out: u8[] /* out 4096 */, limit: i32): u8[] | null
~~~

# Compressing {#compress}

deflateCompress MUST write a raw DEFLATE stream of the window's bytes, and
at level 0 that stream MUST be stored blocks.
{: #R-DEFLATE-STORED}

# Decompressing {#decompress}

deflateDecompress MUST write the bytes a raw DEFLATE stream holds, and only
those bytes.
{: #R-INFLATE}

deflateDecompress MUST return null for a stream that ends before its last
block does.
{: #R-INFLATE-TRUNCATED}

~~~ ts-property
// P-ROUND-TRIP covers R-INFLATE — what deflateCompress writes, deflateDecompress reads back
forall (d: u8[] /* 0..64 */) => {
  const e = deflateDecompress(deflateCompress(d, 6), 4096);
  return e !== null && unwrap(e) === d;
}
~~~

# Arguments {#arguments}

The vectors compress at Level = 0, which stores the bytes, and decompress
with Limit = 4096, the capacity the interface declares.

# Security Considerations

A stream can claim far more output than its length: `limit` and the
capacity bound what deflateDecompress writes.

# Test Vectors

| Id | Call | Expected | Covers | Source | Title |
|----|------|----------|--------|--------|-------|
| V1 | `deflateCompress("hello", Level = 0)` | `[01 05 00 fa ff 68 65 6c 6c 6f]` | R-DEFLATE-STORED | `python3 -c 'import zlib;c=zlib.compressobj(0,zlib.DEFLATED,-15);print((c.compress(b"hello")+c.flush()).hex())'` | one stored block |
| V2 | `deflateDecompress([cb 48 cd c9 c9 57 c8 40 27 01], Limit = 4096)` | `"hello hello hello hello"` | R-INFLATE | `python3 -c 'import zlib;print(zlib.decompress(bytes.fromhex("cb48cdc9c957c8402701"),-15).hex())'` | zlib's fixed-Huffman stream |
| V3 | `deflateDecompress([01 05 00 fa ff 68 65 6c 6c 6f], Limit = 4096)` | `"hello"` | R-INFLATE | `python3 -c 'import zlib;print(zlib.decompress(bytes.fromhex("010500faff68656c6c6f"),-15).hex())'` | a stored block |
| V4 | `deflateDecompress([cb 48], Limit = 4096)` | `null` | R-INFLATE-TRUNCATED | {{decompress}} | a stream cut short |
