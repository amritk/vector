# Third-party notices

vector itself is MIT-licensed (see `LICENSE`, © 2026 Amrit Kahlon). This file
covers everything in this repository, and in the compiled `dist/vector` binary,
that someone else wrote. The compiled binary prints this file, after vector's
own `LICENSE`, when run as `vector --licenses`.

| Component | Where it ends up | License |
|---|---|---|
| Bun runtime | compiled binary | MIT; statically links LGPL-2 JavaScriptCore/WebKit, LGPL-2.1 TinyCC and others (see below) |
| Z3 4.16.0 | compiled binary (`z3` + `libz3`) | MIT |
| RFC 4648, RFC 5869, RFC 8439 | `rfcs/`, excerpts in `contracts/` | IETF Trust Legal Provisions |
| nish v0.34.0 excerpts | `test/fixtures/mutate/` | MIT |

`test/notices.test.ts` bundles the CLI and fails if the set of npm packages in
the bundle differs from the `npm:` sections below, so this file cannot silently
fall behind a dependency change.

---

## Runtimes and native code in the compiled binary

### Bun

`bun build --compile` produces an executable that contains the Bun runtime of
the `bun` that ran the build; `vector --licenses` prints that version. Bun is
MIT-licensed, and its full license and third-party list, for the version that
built a given binary, is at
`https://github.com/oven-sh/bun/blob/bun-v<version>/LICENSE.md`.

Bun statically links libraries under other licenses. The ones with obligations
beyond keeping a notice are:

- **JavaScriptCore and WebCore (WebKit), LGPL-2.** Bun's patched WebKit is
  published at <https://github.com/oven-sh/WebKit>. To relink vector against a
  modified JavaScriptCore: build a modified `bun` as described in Bun's
  `LICENSE.md` (clone that WebKit fork into `vendor/WebKit`, run
  `bun sync-webkit-source`, then `bun run build:local`), then rebuild vector
  from this repository's source with that `bun`
  (`bun install && bun run fetch-z3 && bun run build`). vector's complete source
  is in this repository, so the application part of the binary is always
  available for relinking.
- **TinyCC, LGPL-2.1.** The same applies; TinyCC's source is at
  <https://github.com/tinycc/tinycc>, and Bun's build pins the version it links.

The other statically linked libraries (BoringSSL, brotli, c-ares, ICU,
libarchive, libdeflate, mimalloc, simdutf, uSockets/uWebSockets, zlib-ng,
zstd and the rest) are under permissive licenses, listed with links to their
texts in Bun's `LICENSE.md`. As of Bun 1.4.4, which built the binaries this
repository's CI tests, that file reads, in part:

> Bun itself is MIT-licensed.
>
> Bun statically links JavaScriptCore (and WebKit) which is LGPL-2 licensed.
> WebCore files from WebKit are also licensed under LGPL2.

### Z3

The binary embeds the `z3` executable and `libz3` shared library from the
`z3-solver==4.16.0` wheel (`bun run fetch-z3`) and unpacks them on first use.
The wheel ships no license file; this is the license from the Z3 4.16.0 source
release (<https://github.com/Z3Prover/z3/blob/z3-4.16.0/LICENSE.txt>):

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

## npm packages bundled into the binary

None. vector calls no model API, so it has no SDK, and nothing the CLI runs
imports an npm package: the binary is vector's own code, Bun and Z3. If that
changes, the package gets an `### npm:` section here (the drift test above
requires it).

---

## Files in this repository

### IETF RFCs (`rfcs/`, `contracts/`)

`rfcs/rfc4648.txt`, `rfcs/rfc5869.txt` and `rfcs/rfc8439.txt` are complete,
unmodified copies of the RFC Editor's plain-text publications, byte-identical
to <https://www.rfc-editor.org/rfc/rfc4648.txt>,
<https://www.rfc-editor.org/rfc/rfc5869.txt> and
<https://www.rfc-editor.org/rfc/rfc8439.txt>, with their copyright notices,
legends and authors' addresses intact. Every contract records the SHA-256 of
the RFC it was checked against, so a modified copy is caught.

| RFC | Title | Stream | Copyright |
|---|---|---|---|
| 4648 | The Base16, Base32, and Base64 Data Encodings | IETF | © The Internet Society (2006) |
| 5869 | HMAC-based Extract-and-Expand Key Derivation Function (HKDF) | IETF | © 2010 IETF Trust and the persons identified as the document authors |
| 8439 | ChaCha20 and Poly1305 for IETF Protocols | IRTF | © 2018 IETF Trust and the persons identified as the document authors |

They are redistributed under BCP 78 and the IETF Trust's Legal Provisions
Relating to IETF Documents (<https://trustee.ietf.org/license-info>), §3.c.i:
"to copy, publish, display and distribute IETF Contributions and IETF
Documents in full and without modification".

The contracts in `contracts/` (and the Nish tests `vector spec emit` writes from
them) quote short, unmodified portions of these RFCs: requirement sentences and
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
from IETF RFC 4648, 5869 and 8439; please reproduce this note if possible.

### nish (`test/fixtures/mutate/`)

`test/fixtures/mutate/cli-style.ts.txt` and
`test/fixtures/mutate/json-number.ts.txt` are excerpts of nish v0.34.0
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

The rest of `test/fixtures/` (including `nish-hex/`) and `specs/` was written
for vector and is under vector's own license.

---

## Used, not redistributed

These are used to build, test or develop vector, but none of their code is in
this repository, the npm package's runtime, or the compiled binary, so they
impose no notice obligation here: TypeScript (Apache-2.0), Biome (MIT OR
Apache-2.0), `bun-types` and `@types/node` (MIT), `@amritk/mjst` and its
generators (MIT; `src/generated/` is its output from `schemas/`), `@amritk/helpers`
(MIT; imported by `src/generated/`, which only the tests run), the
`z3-solver` wheel (MIT) as fetched into the git-ignored `.z3/`, and nish itself,
which `vector spec run` runs but does not ship.
