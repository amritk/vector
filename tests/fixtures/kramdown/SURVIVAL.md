# What survives kramdown-rfc 1.7.43 → xml2rfc 3.35.0 `--v2v3`

`profile.md` holds one instance of every row of the plan's **Profile decisions**
table. `profile.xml` is what `scripts/build-spec.sh profile.md` built from it
(`--check` keeps the two in step). For each row: the markdown written, the XML
it became, and whether it survived as the plan expected. `profile` and
`extract` follow this file where it differs from the plan.

## Summary

All rows survive as planned except one:

- **Quoted-RFC blockquote: `{: #R-ID}` alone does not survive.** kramdown-rfc
  turns an anchored blockquote into `<ul empty="true" anchor="R-ID"><li>…</li></ul>`
  (its v2-compatible encoding of a quote). The closest form that does survive
  is the same blockquote with `{: #R-ID gi="blockquote"}`, which gives
  `<blockquote anchor="R-ID">`. Spec authors write `gi="blockquote"`; the
  profile reads `<blockquote anchor>` only.

Things the profile stage must know that the plan did not say:

- The `{::boilerplate bcp14-tagged}` sentence is itself a paragraph full of
  `<bcp14>` tags (all eleven keywords) with xrefs to RFC2119 and RFC8174. It
  has no anchor and is not a requirement; skip it (it is the paragraph whose
  text starts `The key words "MUST", …`), or completeness will see eleven
  untested keywords. The keyword spans may wrap a newline (`<bcp14>SHALL⏎NOT</bcp14>`).
- kramdown-rfc puts processing instructions (`<?line N?>`, including a
  negative `<?line -18?>` after the boilerplate) and blank lines between
  elements; a reader must ignore PIs, comments and whitespace-only text nodes.
- After `--v2v3`, `<sourcecode>` sits directly in `<section>` — there is no
  `<figure>` wrapper and no `<artwork>`. Its body is a CDATA section beginning
  and ending with a newline.
- Code-span table cells come out as `<td align="left">⏎ <tt>…</tt></td>`:
  whitespace before the `<tt>`. "Exactly one code span" means one `<tt>` child
  and nothing but whitespace around it.
- A paragraph's `{: #R-ID}` line is folded into the paragraph; the text keeps
  its source line breaks (`R-DEC-REJECT` spans two lines in the XML).

## Rows

| Row | Markdown | XML | Survived |
|---|---|---|---|
| `contract` | `docname: draft-profile-00` | `<rfc … docName="draft-profile-00" … version="3">` and `<seriesInfo name="Internet-Draft" value="draft-profile-00"/>` | yes |
| `contract` (unknown key) | `vector-contract: x` in the front matter | nothing; kramdown-rfc prints `*** attributes left {"vector-contract"=>"x"}!` | as expected: it never reaches the XML. `build-spec.sh` makes that warning fatal, so the key is not in the fixture; `test/build-spec.test.ts` covers it |
| `target.module` | first line of `~~~ ts-interface`: `// module: nish/hex` | `<sourcecode type="ts-interface"><![CDATA[⏎// module: nish/hex⏎export const hexEncode = …` | yes |
| DEFINITION | `Definition: a hex digit is …` then `{: #R-DEF-DIGIT}` | `<t anchor="R-DEF-DIGIT">Definition: a hex digit is one of the characters 0-9, a-f and A-F.</t>` | yes |
| quoted-RFC | `> The base 16 encoding of "f" is "66".`⏎`> {{Section 10 of RFC4648}}`⏎`{: #R-RFC-VECTORS}` | `<ul empty="true" anchor="R-RFC-VECTORS"><li><t>… <xref section="10" sectionFormat="of" target="RFC4648"/></t></li></ul>` | **no** |
| quoted-RFC (used) | same, last line `{: #R-RFC-VECTORS gi="blockquote"}` | `<blockquote anchor="R-RFC-VECTORS">`⏎`<t>The base 16 encoding of "f" is "66".`⏎`<xref section="10" sectionFormat="of" target="RFC4648"/></t>`⏎`</blockquote>` | yes — the closest surviving form. The xref is the last child of the blockquote's last `<t>`, after a newline |
| implies | `implies(n % 2 === 1, hexDecode(t.repeat(n)) === null)` in a ts-property | unchanged inside CDATA | yes |
| concat | `` `hexEncode(concat([00], [ff]))` `` in a Call cell | `<tt>hexEncode(concat([00], [ff]))</tt>` | yes |
| command-vector `section` | the vector table under `# Test Vectors` | `<section anchor="test-vectors">` holding the `<table>`; `xml2rfc --text` numbers it 6 | yes |
| `let` in properties | `=> { const e = hexEncode(b); return e === e.toLowerCase(); }` | unchanged inside CDATA, with the following `where t.length % 2 === 0` line | yes |
| forall bounds | `(b: u8[] /* 0..64 */)`, `(n: i32 /* 0..31 */)`, `(t: string /* 0..32 hexdigit HEXDIGIT */)`, `(t: string /* 1..1 " \t\n\r!" */)` | unchanged inside CDATA; the JSON escapes stay two characters each | yes |
| clause titles (vectors) | `\| Id \| Call \| Expected \| Covers \| Source \| Title \|` | `<thead><tr><th align="left">Id</th><th align="left">Call</th>…<th align="left">Title</th></tr></thead>`; Title cells are plain text: `<td align="left">one byte</td>` | yes |
| clause titles (properties) | `// P-ENC-LEN covers R-ENC-LEN, R-ENC-DIGITS — two characters per byte` | unchanged inside CDATA, em-dash as the UTF-8 character | yes |
| sample count | `// samples: 48` as line 2 of P-ENC-LEN's `~~~ ts-property`, right after its covers line | unchanged inside CDATA, still line 2: `// P-ENC-LEN covers …⏎// samples: 48⏎forall (b: u8[] …` | yes |
| `allowSurvivors` | — | — | not applicable: a sidecar JSON file, never in the spec |
| exclusion | `Untested: timing is not observable from a unit test. Checked by: code review.` right after `{: #R-DEC-TIMING}` | `<t anchor="R-DEC-TIMING">hexDecode <bcp14>MUST NOT</bcp14> …</t>` followed by the sibling `<t>Untested: … Checked by: code review.</t>` | yes |
| vector cells | Call and Expected each one code span | `<td align="left">⏎ <tt>hexDecode("66")</tt></td>`, `<td align="left">⏎ <tt>"f"</tt></td>` | yes |

### Vector cell literals

Each literal form of the plan's "Vector cells" list, in a code span, comes out
as the same characters inside `<tt>`:

| Markdown cell | XML |
|---|---|
| `` `[00 0f f0 ff]` `` | `<tt>hexEncode([00 0f f0 ff])</tt>` |
| `` `[]` ``, `` `(empty)` `` | `<tt>hexEncode([])</tt>`, `<tt>(empty)</tt>` |
| `` `null` ``, `` `""` ``, `` `"f"` `` | `<tt>null</tt>`, `<tt>""</tt>`, `<tt>"f"</tt>` |
| `` `hexDecode("a\"b\\c\u0041\n")` `` | `<tt>hexDecode("a\"b\\c\u0041\n")</tt>` — backslash escapes are not interpreted |
| `` `Key = 00ff` ``, `` `hexEncode(Key = 0b0b0b)` `` | `<tt>Key = 00ff</tt>`, `<tt>hexEncode(Key = 0b0b0b)</tt>` |

### Vector sources

| Markdown cell | XML |
|---|---|
| `{{Section 10 of RFC4648}}` | `<xref section="10" sectionFormat="of" target="RFC4648"/>` (rendered "Section 10 of [RFC4648]") |
| `{{empty-input}}` (a local anchor from `## Empty input {#empty-input}`) | `<xref target="empty-input"/>` (rendered "Section 4.3") |
| `` `python3 -c '…'` ``, `` `echo 0b0b0b` `` | `<tt>python3 -c 'print(bytes([0,15,240,255]).hex())'</tt>`, `<tt>echo 0b0b0b</tt>` |

## Section layout for the example-hex port

The layout `specs/example-hex.md` has today is reproducible: `xml2rfc --text`
on `profile.xml` numbers 1 Introduction, 2 Interface, 3 Encoding (3.1, 3.2),
4 Decoding (4.1–4.4), 5 Security Considerations, 6 Test Vectors; the
`{: numbered="false"}` section has no number; `--- back` gives Appendix A;
Normative References is unnumbered.

**Where the boilerplate goes:** inside `# Introduction`, as its first
paragraph. `{::boilerplate bcp14-tagged}` emits a paragraph and no heading, so
it adds no section. It cannot go before the first heading of `--- middle`:
that yields `<t>` directly in `<middle>`, which `xml2rfc --v2v3` passes but
`xml2rfc --text` rejects (`Error: Did not expect element t there, at
/rfc/middle/t`), so `build-spec.sh` fails. A separate "Conventions" section
would shift every number after it.

## Authoring rules found along the way

- Close the YAML front matter directly with `--- abstract`. A bare `---`
  followed by `--- abstract` makes kramdown-rfc print `*** sections left [nil]!`.
- Pin `date:` in the front matter (`build-spec.sh` refuses a spec without one);
  otherwise `<date>` is the build day and every rebuild drifts.
- `numbered="false"` on a heading is an IAL on the next line: `{: numbered="false"}`.

### RFC profile constructs

The constructs the RFC profiles (`specs/rfc5869-hkdf-sha256.md`,
`specs/rfc8439-chacha20-poly1305.md`) add, as those specs built them with the
same tools:

| Row | Markdown | XML | Survived |
|---|---|---|---|
| main-source key | `keyword:`⏎`  - vector-main-RFC5869` in the front matter | `<keyword>vector-main-RFC5869</keyword>` in `<front>` | yes |
| excluded RFC blockquote | `> Words 13-15 are a nonce, which MUST not be repeated for the same key.`⏎`> {{Section 2.3 of RFC8439}}`⏎`{: gi="blockquote"}`, a blank line, then `Untested: …` | `<blockquote>`⏎`<t>Words 13-15 are a nonce, which <bcp14>MUST</bcp14> not be repeated for the same key.`⏎`<xref section="2.3" sectionFormat="of" target="RFC8439"/></t>`⏎`</blockquote>` followed by the sibling `<t>Untested: …</t>` | yes. Without `gi="blockquote"` it becomes `<ul empty="true">`, as for an anchored one. kramdown-rfc tags the quote's capital keywords `<bcp14>` |
| note | `Note: The RFC states the bound; …` right after `{: #R-L gi="blockquote"}` | the sibling `<t>Note: The RFC states the bound; …</t>` | yes |
| reference module | a later `// module: nish/crypto/hmac` line in `~~~ ts-interface` | unchanged inside CDATA | yes |
| digit-start label | `` `concat(32-bit fixed-common part = 07000000, IV = 4041424344454647)` `` in a Call cell | `<tt>…concat(32-bit fixed-common part = 07000000, IV = 4041424344454647)…</tt>` | yes |
