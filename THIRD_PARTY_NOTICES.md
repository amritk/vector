# Third-party notices

vector itself is MIT-licensed (see `LICENSE`, © 2026 Amrit Kahlon). This file
covers everything in this repository, and in the compiled `dist/vector` binary,
that someone else wrote.

| Component | Where it ends up | License |
|---|---|---|
| Nish runtime and standard library | compiled binary | MIT; parts under BSL-1.0 and the fdlibm notice (see below) |
| Z3 4.16.0 | fetched into `.z3/`, run as a separate process | MIT |
| RFC 4648, RFC 5869, RFC 8439, RFC 8707 | `rfcs/`, excerpts in `contracts/` and `tests/` | IETF Trust Legal Provisions |
| nish v0.34.0 excerpts | `tests/fixtures/mutate/` | MIT |

---

## Code in the compiled binary

### Nish runtime and standard library

`npm run build` compiles vector's Nish source with the nish compiler pinned in
`.nish-version`. The binary it links holds vector's own code plus the
parts of nish's C runtime and standard library that vector uses
(<https://github.com/amritk/nish>), under nish's MIT license:

```
MIT License

Copyright (c) 2026 Nish contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Some of that code carries its own license, kept beside it in the compiler
release (`.nish/runtime/LICENSE-*`, `.nish/std/LICENSE-*`):

- **zmij** (float-to-string, `.nish/runtime/LICENSE-zmij`) and **fast_float**
  (string-to-float, `.nish/std/LICENSE-fast-float`) are under the Boost
  Software License 1.0, which requires no notice in machine-executable object
  code.
- **fdlibm** (the math functions in `std/math.ts`) asks that its notice be
  preserved:

```
====================================================
Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.

Developed at SunPro, a Sun Microsystems, Inc. business.
Permission to use, copy, modify, and distribute this
software is freely granted, provided that this notice
is preserved.
====================================================

====================================================
Copyright (C) 2004 by Sun Microsystems, Inc. All rights reserved.

Permission to use, copy, modify, and distribute this
software is freely granted, provided that this notice
is preserved.
====================================================
```

### Z3 (run, not linked)

vector runs `z3` as a child process; it is not part of `dist/vector`.
`scripts/fetch-z3.sh` fetches the `z3` executable and `libz3` from the
`z3-solver==4.16.0` wheel into the git-ignored `.z3/`. The wheel ships no
license file; this is the license from the Z3 4.16.0 source release
(<https://github.com/Z3Prover/z3/blob/z3-4.16.0/LICENSE.txt>):

```
Z3
Copyright (c) Microsoft Corporation
All rights reserved. 
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

---

## npm packages

None ships: the binary is native code compiled from Nish, and nothing in it
imports an npm package. The npm dependencies in `package.json` are development
tools, listed under "Used, not redistributed" below.

---

## Files in this repository

### IETF RFCs (`rfcs/`, `contracts/`)

`rfcs/rfc4648.txt`, `rfcs/rfc5869.txt` and `rfcs/rfc8439.txt` are complete,
unmodified copies of the RFC Editor's plain-text publications, byte-identical
to <https://www.rfc-editor.org/rfc/rfc4648.txt>,
<https://www.rfc-editor.org/rfc/rfc5869.txt> and
<https://www.rfc-editor.org/rfc/rfc8439.txt>, with their copyright notices,
legends and authors' addresses intact. `rfcs/rfc8707.xml` is likewise the RFC
Editor's published RFC XML v3 (RFC 7991) source, byte-identical to
<https://www.rfc-editor.org/rfc/rfc8707.xml>, with its boilerplate intact.
Every contract records the SHA-256 of the RFC it was checked against, so a
modified copy is caught.

| RFC | Title | Stream | Copyright |
|---|---|---|---|
| 4648 | The Base16, Base32, and Base64 Data Encodings | IETF | © The Internet Society (2006) |
| 5869 | HMAC-based Extract-and-Expand Key Derivation Function (HKDF) | IETF | © 2010 IETF Trust and the persons identified as the document authors |
| 8439 | ChaCha20 and Poly1305 for IETF Protocols | IRTF | © 2018 IETF Trust and the persons identified as the document authors |
| 8707 | Resource Indicators for OAuth 2.0 | IETF | © 2020 IETF Trust and the persons identified as the document authors |

They are redistributed under BCP 78 and the IETF Trust's Legal Provisions
Relating to IETF Documents (<https://trustee.ietf.org/license-info>), §3.c.i:
"to copy, publish, display and distribute IETF Contributions and IETF
Documents in full and without modification".

The contracts in `contracts/` (and the Nish tests `vector spec emit` writes from
them), quote short, unmodified portions of these RFCs: requirement sentences and
their known-answer test vectors. That is permitted by §3.c.iii provided each
portion is attributed to the IETF and names the RFC it came from. Every contract
names its RFC in `source` / `sources`, and every requirement and vector cites
its section. Each contract quotes about 3% of its RFC's text, well under the
one-fifth threshold at which §3.c.iii(y) would require the RFC's full legends to
be reproduced too. The contracts never paraphrase a quote. `vector spec check`
refuses a quote or vector that is not verbatim in the RFC.

Where a quoted test vector or algorithm listing counts as a Code Component of an
IETF-stream RFC (RFC 5869), it is also available under the Revised BSD License
of TLP §4.c:

```
Copyright (c) 2010 IETF Trust and the persons identified as authors of the
code. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, is permitted pursuant to, and subject to the license terms
contained in, the Revised BSD License set forth in Section 4.c of the IETF
Trust's Legal Provisions Relating to IETF Documents
(http://trustee.ietf.org/license-info).
```

RFC 8439 is an IRTF-stream document, for which TLP §4's BSD grant may not
apply (§8); its excerpts rely on §3.c.iii alone. These portions are derived
from IETF RFC 4648, 5869, 8439 and 8707; please reproduce this note if possible.

### kramdown-rfc output (`tests/fixtures/xmlv3/`)

`tests/fixtures/xmlv3/kramdown.md` was written for vector.
`tests/fixtures/xmlv3/kramdown.xml` is what kramdown-rfc 1.7.43 produces from it,
with two edits: the compressed markdown-source comment is removed, and the
`<reference anchor="RFC2119">` it fetched from bib.ietf.org is replaced by a
hand-written stub (title and `seriesInfo` only). The generated XML is the
output of a program run on vector's own input, not kramdown-rfc's code, and is
under vector's license.

### BibXML references (bib.ietf.org)

Spec XML often carries `<reference>` elements that kramdown-rfc or xml2rfc
fetched from the IETF BibXML Service (<https://bib.ietf.org/>). As of v1.5.4
the service publishes no terms of use for the data it serves: its `/about`
page describes the service but states no license, the served
`reference.RFC.*.xml` files carry no notice, and the BSD-3-Clause license in
<https://github.com/ietf-tools/bibxml-service> (© 2022 The IETF Trust) covers
the service's code, not its data. A `<reference>` for an RFC is bibliographic
metadata (title, authors, date, series identifiers, and the RFC's own abstract)
derived from that IETF Document; where it reproduces the RFC's abstract it is
an excerpt covered by the IETF Trust Legal Provisions above.

vector commits fetched BibXML in two places:

- `.refcache/reference.RFC.2119.xml`, `.refcache/reference.RFC.4648.xml`,
  `.refcache/reference.RFC.5869.xml`, `.refcache/reference.RFC.8174.xml` and
  `.refcache/reference.RFC.8439.xml` are the `<reference>`s kramdown-rfc
  fetched from bib.ietf.org when it built `specs/*.xml`, kept unedited so a
  rebuild needs no network.
- Each built spec XML (`specs/example-hex.xml`,
  `specs/rfc5869-hkdf-sha256.xml`, `specs/rfc8439-chacha20-poly1305.xml`)
  embeds those `<reference>`s in its back matter, as kramdown-rfc wrote them.

Each holds the bibliographic metadata listed above and the cited RFC's
abstract, and is redistributed under the IETF Trust Legal Provisions that
cover the RFC it describes. The `tests/fixtures/xmlv3/` fixture uses a
hand-written stub in place of fetched BibXML. The `tests/fixtures/rfc-main/`
fixture's RFC 9990 and RFC 9991 are not IETF documents: vector wrote them, and
their `<reference>`s, as test input, under vector's license. A `<reference>` committed in a
published RFC's own XML (its back matter, as in `rfcs/rfc8707.xml`) is part of
that document and is redistributed with it under the same terms.

### nish (`tests/fixtures/mutate/`)

`tests/fixtures/mutate/cli-style.ts.txt` and
`tests/fixtures/mutate/json-number.ts.txt` are excerpts of nish v0.34.0
(`std/cli.ts` lines 60–126 and `std/json-typed.ts` lines 151–181), cut short to
exercise the mutation engine's parser. Each file's opening comment says so.
<https://github.com/amritk/nish>:

```
MIT License

Copyright (c) 2026 Nish contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The rest of `tests/fixtures/` (including `nish-hex/`) and `specs/` was written
for vector and is under vector's own license.

---

## Used, not redistributed

These are used to build, test or develop vector, but none of their code is in
this repository or the compiled binary, so they impose no notice obligation
here: the nish compiler itself (MIT; only the runtime and library code it links
in ships, as above), clang and lld (Apache-2.0 WITH LLVM-exception), which link
the binary, TypeScript (Apache-2.0), TypeDoc (Apache-2.0) and Biome (MIT OR
Apache-2.0). vector's RFC XML v3 rendering was checked against xml2rfc 3.35.0
(BSD-3-Clause, © 2022 IETF Trust) and its line mapping against kramdown-rfc
1.7.43 (MIT, © 2010-2015 Carsten Bormann), neither of which is copied,
imported or shipped.
