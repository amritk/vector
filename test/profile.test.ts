import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { validateContractShape } from "../src/rfc/contract.ts";
import { BYTES_MESSAGE as BYTES_HINT } from "../src/rfc/front/ts.ts";
import { runGates } from "../src/rfc/gates.ts";
import {
  isLiteralError,
  parseCall,
  parseLiteral,
  settle,
  settleVector,
} from "../src/rfc/literals.ts";
import {
  type Refusal,
  type RfcResolver,
  VECTOR_HEADER,
  profileToContract,
} from "../src/rfc/profile.ts";
import { parseRfc } from "../src/rfc/rfctext.ts";
import { parseV3 } from "../src/rfc/xmlv3.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

/** rfcs/rfcN.xml through parseV3 when it exists, else rfcs/rfcN.txt. */
const resolver: RfcResolver = (n) => {
  const xml = new URL(`../rfcs/rfc${n}.xml`, import.meta.url);
  if (existsSync(xml)) return parseV3(readFileSync(xml, "utf8"), xml.pathname);
  return parseRfc(read(`../rfcs/rfc${n}.txt`));
};

const REFS = `<references>
<reference anchor="RFC4648"><front><title>B</title></front><seriesInfo name="RFC" value="4648"/></reference>
<reference anchor="RFC8707"><front><title>R</title></front><seriesInfo name="RFC" value="8707"/></reference>
<reference anchor="RFC9999"><front><title>M</title></front><seriesInfo name="RFC" value="9999"/></reference>
<reference anchor="RFC5869"><front><title>H</title></front><seriesInfo name="RFC" value="5869"/></reference>
<reference anchor="BOOK"><front><title>N</title></front></reference>
</references>`;

const IFACE_CODE = `
// module: nish/hex
export function hexDecode(text: string): u8[] | null
export function hexEncode(bytes: u8[]): string
export function isHex(text: string): boolean
`;
const iface = (code = IFACE_CODE) =>
  `<sourcecode type="ts-interface"><![CDATA[${code}]]></sourcecode>`;
const IFACE = `<section><name>Interface</name>${iface()}</section>`;

/** A one-file spec: the interface section, then `middle`. */
const spec = (middle: string, { docName = "draft-t-00", head = IFACE } = {}) =>
  `<rfc docName="${docName}" version="3"><front><title>T</title></front><middle>
${head}${middle}</middle><back>${REFS}</back></rfc>`;

const run = (xml: string, path = "specs/t.xml", resolve = resolver) =>
  profileToContract(parseV3(xml, path), path, resolve);

const refusals = (xml: string, path?: string): Refusal[] => {
  const r = run(xml, path);
  if (!("refusals" in r)) throw new Error("expected refusals");
  return r.refusals;
};
const messages = (xml: string, path?: string) =>
  refusals(xml, path).map((r) => r.message);
/** Each refusal's line, column when it has one, and message; the file is checked. */
const located = (xml: string) =>
  refusals(xml).map(({ file, line, col, message }) => {
    expect(file).toBe("specs/t.xml");
    return col === undefined ? { line, message } : { line, col, message };
  });
const contract = (xml: string) => {
  const r = run(xml);
  if (!("contract" in r)) throw new Error(JSON.stringify(r.refusals));
  return r.contract;
};

const sec = (body: string, attrs = "") =>
  `<section${attrs}><name>S</name>${body}</section>`;
const tt = (s: string) => `<tt>${s}</tt>`;
const row = (...cells: string[]) =>
  `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
const table = (rows: string[], header: readonly string[] = VECTOR_HEADER) =>
  // One row a line, from the line after the table's, so a row's line is known.
  `<table><thead><tr>${header.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>\n${rows.join("\n")}</tbody></table>`;
const RFC10 = `<xref target="RFC4648" section="10"/>`;
const vector = (call: string, expected: string, extra: Partial<Cells> = {}) =>
  row(
    extra.id ?? "V1",
    extra.call ?? tt(call),
    extra.expected ?? tt(expected),
    extra.covers ?? "R-A",
    extra.source ?? RFC10,
    extra.title ?? "a title",
  );
interface Cells {
  id: string;
  call: string;
  expected: string;
  covers: string;
  source: string;
  title: string;
}
const REQ = `<t anchor="R-A">hexDecode <bcp14>MUST</bcp14> work.</t>`;
const property = (code: string) =>
  `<sourcecode type="ts-property"><![CDATA[\n${code}\n]]></sourcecode>`;

describe("fixtures", () => {
  test("the kramdown fixture is refused for its quote and its .repeat, exactly", () => {
    const path = "test/fixtures/kramdown/profile.xml";
    const r = profileToContract(
      parseV3(read("fixtures/kramdown/profile.xml"), path),
      path,
      resolver,
    );
    expect(JSON.stringify(r)).toBe(
      JSON.stringify({
        refusals: [
          {
            file: path,
            line: 68,
            message:
              'R-RFC-VECTORS is not in Section 10 of RFC4648: "The base 16 encoding of "f" is "66"."',
          },
          {
            file: path,
            line: 79,
            col: 98,
            message: "`.repeat` is not in the ts-property subset",
          },
          {
            file: path,
            line: 180,
            message: "Expected: hexEncode returns string, not bytes",
          },
        ],
      }),
    );
  });

  test("profile-hex reads into the contract pinned beside it", () => {
    const path = "test/fixtures/profile/profile-hex.xml";
    const r = profileToContract(
      parseV3(read("fixtures/profile/profile-hex.xml"), path),
      path,
      resolver,
    );
    // Compared as compact JSON so key order is pinned and layout is biome's.
    expect(JSON.stringify(r)).toBe(
      JSON.stringify(JSON.parse(read("fixtures/profile/profile-hex.json"))),
    );
  });

  test("the pinned profile-hex contract has a valid shape and passes the gates", () => {
    const pinned = JSON.parse(read("fixtures/profile/profile-hex.json"));
    expect(validateContractShape(pinned.contract)).toEqual([]);
    const g = runGates(pinned.contract);
    expect(g.issues).toEqual([]);
    expect(g.ok).toBe(true);
  });

  test("profile-hex has each construct example-hex has", () => {
    const text = read("fixtures/profile/profile-hex.json");
    for (const k of [
      '{"hex":"abcd"}', // bytes expected for a bytes return
      '{"ascii":"foo"}', // several characters as ascii
      '"op":"unwrap"',
      '"op":"notNull"',
      '"op":"and"',
      '"op":"strConcat"',
      '"alphabet":["g","G"," ","\\"","x"]', // a JSON-string alphabet
      '"label":"Key"',
      '"concat":',
    ])
      expect([k, JSON.stringify(JSON.parse(text)).includes(k)]).toEqual([
        k,
        true,
      ]);
  });

  test("the same input gives the same output", () => {
    const xml = read("fixtures/profile/profile-hex.xml");
    const first = run(xml, "x/profile-hex.xml");
    expect("contract" in first).toBe(true);
    const once = JSON.stringify(first);
    expect(JSON.stringify(run(xml, "x/profile-hex.xml"))).toBe(once);
  });
});

describe("contract", () => {
  test("a minimal spec", () => {
    const c = contract(
      spec(sec(REQ + table([vector('hexDecode("66")', '"f"')]))),
    );
    expect(c.contract).toBe("t");
    expect(c.sources).toEqual([
      { id: "t", path: "../specs/t.xml" },
      { id: "rfc4648", rfc: 4648 },
    ]);
    expect(c.target).toEqual({ module: "nish/hex" });
    expect(c.requirements).toEqual([
      { id: "R-A", section: "2", level: "MUST", quote: "hexDecode MUST work." },
    ]);
    expect(c.exclusions).toEqual([]);
    expect(c.clauses).toEqual([
      {
        kind: "vector",
        id: "V1",
        title: "a title",
        covers: ["R-A"],
        source: { cite: { source: "rfc4648", section: "10" } },
        call: "hexDecode",
        args: [{ str: "66" }],
        expect: { ascii: "f" },
      },
    ]);
  });

  test("a blockquote quoting an XML RFC, with its keyword as its level", () => {
    const c = contract(
      spec(
        sec(`<blockquote anchor="R-Q"><t>a client MAY indicate</t>
<t>the protected resource <xref target="RFC8707" section="2"/></t></blockquote>
<blockquote anchor="R-D"><t>(a.k.a. resource server, application, API, etc.)
<xref target="RFC8707" section="2"/></t></blockquote>
<blockquote anchor="R-N"><t>The URI MUST NOT include a fragment component.
<xref target="RFC8707" section="2"/></t></blockquote>`),
      ),
    );
    expect(c.requirements).toEqual([
      {
        id: "R-Q",
        source: "rfc8707",
        section: "2",
        level: "MAY",
        quote: "a client MAY indicate the protected resource",
      },
      {
        id: "R-D",
        source: "rfc8707",
        section: "2",
        level: "DEFINITION",
        quote: "(a.k.a. resource server, application, API, etc.)",
      },
      {
        id: "R-N",
        source: "rfc8707",
        section: "2",
        level: "MUST NOT",
        quote: "The URI MUST NOT include a fragment component.",
      },
    ]);
    expect((c.sources ?? []).map((s) => s.id)).toEqual(["t", "rfc8707"]);
  });

  test("a section anchor in Source cites the spec, or is the spec for null and booleans", () => {
    const c = contract(
      spec(
        sec(
          REQ +
            table([
              vector('hexDecode("66")', '"f"', {
                source: `<xref target="here"/>`,
              }),
              vector('isHex("z")', "false", {
                id: "V2",
                source: `<xref target="here"/>`,
              }),
            ]),
          ` anchor="here"`,
        ),
      ),
    );
    expect(c.clauses.map((v) => "source" in v && v.source)).toEqual([
      { cite: { section: "2" } },
      { spec: "2" },
    ]);
    expect(c.clauses[1]).toMatchObject({
      section: "2",
      expect: { bool: false },
    });
  });

  test("cited RFCs are listed in ascending order", () => {
    const c = contract(
      spec(
        sec(
          `${REQ}<blockquote anchor="R-Q"><t>a client MAY indicate <xref target="RFC8707" section="2"/></t></blockquote>${table([vector('hexDecode("66")', '"f"')])}`,
        ),
      ),
    );
    expect((c.sources ?? []).map((s) => s.id)).toEqual([
      "t",
      "rfc4648",
      "rfc8707",
    ]);
  });

  test("a table whose first header is not Id is not a vector table", () => {
    const c = contract(spec(sec(table([row("x")], ["Name"]))));
    expect(c.clauses).toEqual([]);
  });

  test("an anchored paragraph without BCP 14 is no requirement", () => {
    expect(
      contract(spec(sec(`<t anchor="note">Just prose.</t>`))).requirements,
    ).toEqual([]);
  });

  test("sections in <back> are lettered, and nested sections numbered", () => {
    const xml = `<rfc docName="draft-t-00" version="3"><front><title>T</title></front><middle>${IFACE}</middle><back>${REFS}<section><name>A</name>${sec(REQ)}</section></back></rfc>`;
    expect(contract(xml).requirements[0].section).toBe("A.1");
  });

  test("a document with no <back> still reads", () => {
    const xml = `<rfc docName="draft-t-00" version="3"><front><title>T</title></front><middle>${IFACE}</middle></rfc>`;
    expect(contract(xml).requirements).toEqual([]);
  });
});

describe("refusals", () => {
  test("a BCP 14 sentence with no anchor and no exclusion", () => {
    expect(
      refusals(spec(sec("<t>hexDecode <bcp14>MUST</bcp14> work.</t>"))),
    ).toEqual([
      {
        file: "specs/t.xml",
        line: 7,
        message:
          'BCP 14 sentence has no anchor and no Untested: paragraph after it: "hexDecode MUST work."',
      },
    ]);
  });

  test("an unknown Covers id, in a vector and in a property", () => {
    expect(
      messages(
        spec(
          sec(
            REQ +
              property(
                "// P-X covers R-NOPE — t\nforall (b: u8[] /* 0..4 */) => hexEncode(b) === hexEncode(b)",
              ) +
              table([
                vector('hexDecode("66")', '"f"', { covers: "R-A, R-GONE" }),
              ]),
          ),
        ),
      ),
    ).toEqual([
      'Covers names "R-NOPE", which is no requirement',
      'Covers names "R-GONE", which is no requirement',
    ]);
  });

  test("an xref to an RFC with no <reference>, and a section xref to a non-RFC reference", () => {
    expect(
      messages(
        spec(
          sec(`<t>See <xref target="RFC1234"/> and <xref target="BOOK" section="3"/> and <xref target="x"/>.</t>
<blockquote anchor="R-B"><t>quote <xref target="BOOK" section="3"/></t></blockquote>`),
        ),
      ),
    ).toEqual([
      "xref to RFC1234 has no <reference> for it",
      'xref to "BOOK" names no RFC <reference>',
    ]);
  });

  test("a section an RFC used as a source does not have, in prose too", () => {
    expect(
      located(
        spec(
          sec(
            `${REQ}\n<t>See <xref target="RFC4648" section="99"/>.</t>\n${table([vector('hexDecode("66")', '"f"')])}`,
          ),
        ),
      ),
    ).toEqual([{ line: 8, message: "Section 99 of RFC4648 does not exist" }]);
  });

  test("a section xref to an RFC nothing cites needs no file", () => {
    const asked: number[] = [];
    const r = run(
      spec(sec(`<t>See <xref target="RFC9999" section="99"/>.</t>`)),
      "specs/t.xml",
      (n) => {
        asked.push(n);
        return resolver(n);
      },
    );
    expect("contract" in r).toBe(true);
    expect(asked).toEqual([]);
  });

  test("a section the RFC does not have, in a blockquote", () => {
    expect(
      messages(
        spec(
          sec(
            `<blockquote anchor="R-B"><t>quote <xref target="RFC4648" section="99"/></t></blockquote>`,
          ),
        ),
      ),
    ).toEqual(["Section 99 of RFC4648 does not exist"]);
  });

  test("an RFC with no <reference>, in a blockquote and a Source cell, is refused once each", () => {
    expect(
      messages(
        spec(
          sec(
            `${REQ}<blockquote anchor="R-B"><t>quote <xref target="RFC1234" section="1"/></t></blockquote>${table(
              [
                vector('hexDecode("66")', '"f"', {
                  source: `<xref target="RFC1234" section="1"/>`,
                }),
              ],
            )}`,
          ),
        ),
      ),
    ).toEqual([
      "xref to RFC1234 has no <reference> for it",
      "xref to RFC1234 has no <reference> for it",
    ]);
  });

  test("a missing RFC file: the resolver's error propagates", () => {
    expect(() =>
      run(
        spec(
          sec(
            `<blockquote anchor="R-B"><t>q <xref target="RFC9999" section="1"/></t></blockquote>`,
          ),
        ),
      ),
    ).toThrow("ENOENT");
  });

  test("each RFC is resolved once", () => {
    const asked: number[] = [];
    run(
      spec(
        sec(
          `${REQ}<t><xref target="RFC4648" section="10"/> <xref target="RFC4648" section="4"/></t>${table([vector('hexDecode("66")', '"f"')])}`,
        ),
      ),
      "specs/t.xml",
      (n) => {
        asked.push(n);
        return resolver(n);
      },
    );
    expect(asked).toEqual([4648]);
  });

  test("a literal the types do not settle", () => {
    expect(
      messages(
        spec(
          sec(
            REQ +
              table([
                vector('isHex("ab")', '"yes"'),
                vector('hexDecode("66", "x")', '"f"', { id: "V2" }),
              ]),
          ),
        ),
      ),
    ).toEqual([
      'Expected: the types do not settle "yes": a quoted string goes where bytes or a string does, not bool',
      "Call: hexDecode takes 1 argument(s), not 2",
      'Call: the types do not settle "x": a quoted string goes where bytes or a string does, not past the last parameter',
    ]);
  });

  test("a cell without backticks", () => {
    expect(
      refusals(
        spec(
          sec(
            REQ +
              table([
                vector("", "", {
                  call: 'hexDecode("66")',
                  expected: tt('"f"'),
                }),
                vector("", "", {
                  id: "V2",
                  call: tt('hexDecode("66")'),
                  expected: `${tt('"f"')} or so`,
                }),
              ]),
          ),
        ),
      ).map((r) => r.message),
    ).toEqual([
      "cell must be a single code span",
      "cell must be a single code span",
    ]);
  });

  test("two ts-interface blocks", () => {
    expect(
      refusals(spec(sec(iface()))).map(({ line, message }) => ({
        line,
        message,
      })),
    ).toEqual([
      {
        line: 7,
        message: "a spec has exactly one ts-interface block; this one has 2",
      },
    ]);
  });

  test("no ts-interface block", () => {
    expect(messages(spec(sec(REQ), { head: "" }))).toEqual([
      "a spec has exactly one ts-interface block; this one has 0",
    ]);
  });

  test("a ts-property without a covers line, at the block's line", () => {
    expect(
      refusals(
        spec(sec(property("forall (t: string /* 0..4 */) => isHex(t)"))),
      ),
    ).toEqual([
      {
        file: "specs/t.xml",
        line: 8,
        col: 1,
        message: "missing `// P-ID covers R-ID — title` line",
      },
    ]);
  });

  test("an interface the front end refuses", () => {
    const head = `<section><name>I</name>${iface("\nexport function f(\n")}</section>`;
    expect(located(spec("", { head }))).toEqual([
      {
        line: 3,
        col: 1,
        message: "missing `// module: nish/<name>` first line",
      },
    ]);
  });

  test("a sourcecode type no front end reads", () => {
    expect(
      messages(
        spec(
          sec(
            `<sourcecode type="rust-property">x</sourcecode><sourcecode type="text">y</sourcecode>`,
          ),
        ),
      ),
    ).toEqual(['no front end reads sourcecode type "rust-property"']);
  });

  test("docName must be draft-<name>-NN and agree with the file name", () => {
    expect(messages(spec("", { docName: "t" }))).toEqual([
      'docName "t" is not draft-<name>-NN',
    ]);
    expect(messages(spec(""), "specs/other.xml")).toEqual([
      'docName "draft-t-00" names contract "t", but the file is other.xml',
    ]);
    const noName = `<rfc version="3"><front><title>T</title></front><middle>${IFACE}</middle></rfc>`;
    expect(messages(noName)).toEqual(['docName "" is not draft-<name>-NN']);
  });

  test("an anchored paragraph with two BCP 14 sentences", () => {
    expect(
      messages(
        spec(
          sec(
            `<t anchor="R-T">It <bcp14>MUST</bcp14> do a. It <bcp14>MUST</bcp14> do b.</t>`,
          ),
        ),
      ),
    ).toEqual(["R-T holds 2 BCP 14 sentences; give each its own anchor"]);
  });

  test("a malformed blockquote", () => {
    const bad = [
      `<blockquote anchor="R-B"><t>no xref</t></blockquote>`,
      `<blockquote anchor="R-C"><ul><li>x</li></ul></blockquote>`,
      `<blockquote anchor="R-D"><t>x <xref target="RFC4648"/></t></blockquote>`,
      `<blockquote anchor="R-E"></blockquote>`,
      `<blockquote anchor="R-F"><t><xref target="RFC4648" section="10"/> after</t></blockquote>`,
    ];
    expect(messages(spec(sec(bad.join(""))))).toEqual(
      ["R-B", "R-C", "R-D", "R-E", "R-F"].map(
        (a) =>
          `blockquote ${a} must be <t> paragraphs, the last ending with {{Section N of RFCx}}`,
      ),
    );
  });

  test("a requirement, an exclusion and a vector table in an unnumbered section", () => {
    expect(
      messages(
        spec(
          sec(
            `${REQ}<t>It <bcp14>SHOULD</bcp14> be.</t><t>Untested: no.</t>${table([])}`,
            ` numbered="false"`,
          ),
        ),
      ),
    ).toEqual([
      "R-A is in an unnumbered section; a requirement needs a section number",
      "a vector table is in an unnumbered section; it needs a section number",
      "an excluded sentence is in an unnumbered section; it needs a section number",
    ]);
  });

  test("a quote that is not in the RFC section, anchored or excluded", () => {
    expect(
      messages(
        spec(
          sec(`<blockquote anchor="R-B"><t>not there <xref target="RFC4648" section="10"/></t></blockquote>
<blockquote><t>nor here <xref target="RFC4648" section="10"/></t></blockquote>`),
        ),
      ),
    ).toEqual(['R-B is not in Section 10 of RFC4648: "not there"']);
  });

  test("an excluded blockquote whose quote is not in the RFC", () => {
    expect(
      messages(
        spec(
          sec(`<blockquote anchor="R-B"><t>not there <xref target="RFC4648" section="10"/></t></blockquote>
<t>Untested: because.</t>`),
        ),
      ),
    ).toEqual(['R-B is not in Section 10 of RFC4648: "not there"']);
  });

  test("a vector table with the wrong header", () => {
    expect(messages(spec(sec(table([], ["Id", "Call", "Expected"]))))).toEqual([
      "a vector table's header is Id | Call | Expected | Covers | Source | Title, not Id | Call | Expected",
    ]);
  });

  test("a vector row with the wrong cell count, and one with no title", () => {
    expect(
      messages(
        spec(
          sec(
            REQ +
              table([
                row("V1", "x"),
                vector('hexDecode("66")', '"f"', { title: "" }),
              ]),
          ),
        ),
      ),
    ).toEqual(["a vector row has 6 cells, not 2", "vector V1 has no title"]);
  });

  test("Call and Expected cells that do not parse, with columns", () => {
    expect(
      refusals(
        spec(
          sec(
            REQ +
              table([
                vector("hexDecode", '"f"'),
                vector('hexDecode("66")', "‖", { id: "V2" }),
                vector('nope("66")', '"f"', { id: "V3" }),
              ]),
          ),
        ),
      ).map(({ line, col, message }) => ({ line, col, message })),
    ).toEqual([
      { line: 8, col: 1, message: "Call: a call is `name(args…)`" },
      {
        line: 9,
        col: 1,
        message: "Expected: `‖` is not a literal; write concat(a, b)",
      },
      {
        line: 10,
        col: undefined,
        message: '"nope" is not a function of the ts-interface block',
      },
    ]);
  });

  test("a Source cell that is none of the three forms", () => {
    expect(
      messages(
        spec(
          sec(
            REQ +
              table([
                vector('hexDecode("66")', '"f"', { source: "the RFC" }),
                vector('hexDecode("66")', '"f"', {
                  id: "V2",
                  source: `<xref target="nowhere"/>`,
                }),
                vector('hexDecode("66")', '"f"', {
                  id: "V3",
                  source: `<xref target="BOOK" section="1"/>`,
                }),
              ]),
          ),
        ),
      ),
    ).toEqual([
      "Source must be {{Section N of RFCx}}, a section anchor, or a single code span",
      'Source names "nowhere", which is no numbered section',
      'xref to "BOOK" names no RFC <reference>',
    ]);
  });

  test("refusals are collected across the document and sorted by line", () => {
    const rs = refusals(
      spec(
        `${sec("<t>a <bcp14>MUST</bcp14>.</t>")}\n\n${sec("<t>b <bcp14>MUST</bcp14>.</t>")}`,
        { docName: "bad" },
      ),
    );
    expect(rs.map((r) => r.line)).toEqual([1, 7, 9]);
  });
});

describe("literals", () => {
  const lit = (text: string) => parseLiteral(text);
  test("each form", () => {
    expect(lit('"a\\u0041"')).toEqual({ kind: "string", value: "aA" });
    expect(lit("[00 ff]")).toEqual({ kind: "bytes", hex: "00ff" });
    expect(lit("[]")).toEqual({ kind: "bytes", hex: "" });
    expect(lit("(empty)")).toEqual({ kind: "empty" });
    expect(lit("null")).toEqual({ kind: "null" });
    expect(lit("true")).toEqual({ kind: "bool", value: true });
    expect(lit("-12")).toEqual({ kind: "int", value: -12 });
    expect(lit("Key 2 = 0a")).toEqual({
      kind: "labelled",
      label: "Key 2",
      hex: "0a",
    });
    expect(lit('concat([00], "a")')).toEqual({
      kind: "concat",
      parts: [
        { kind: "bytes", hex: "00" },
        { kind: "string", value: "a" },
      ],
    });
    expect(parseCall("f()")).toEqual({ call: "f", args: [] });
    expect(parseCall("f( 1 , K = 00 )")).toEqual({
      call: "f",
      args: [
        { kind: "int", value: 1 },
        { kind: "labelled", label: "K", hex: "00" },
      ],
    });
  });

  test("refusals, with the 1-based column", () => {
    const cases: [string, string, number][] = [
      ['"\\x"', "a quoted string is a JSON string; bad escape", 1],
      ["[0 1]", BYTES_HINT, 1],
      ["concat()", "concat needs at least one part", 1],
      ["concat(concat([00]))", "concat does not nest; list every part", 8],
      [
        "K = 0A",
        "a labelled value is `Label = hex`, lowercase hex pairs with no spaces",
        1,
      ],
      ["a ‖ b", "not a literal", 1],
      ["‖", "`‖` is not a literal; write concat(a, b)", 1],
      ["1 2", "unexpected text after the value", 3],
      ["01", "not a literal", 1],
    ];
    for (const [text, message, col] of cases)
      expect([text, lit(text)]).toEqual([text, { message, col }]);
    expect(parseCall("f(1 2)")).toEqual({
      message: "expected `,` or `)`",
      col: 5,
    });
    expect(parseCall("f(1) x")).toEqual({
      message: "unexpected text after the value",
      col: 6,
    });
    expect(isLiteralError({ kind: "null" })).toBe(false);
  });

  test("settling: a string by its type, the rest as written", () => {
    const s = { kind: "string", value: "f" } as const;
    expect(settle(s, "bytes")).toEqual({ ascii: "f" });
    expect(settle(s, "string")).toEqual({ str: "f" });
    expect(settle({ kind: "int", value: 3 }, "u32")).toEqual({ int: 3 });
    expect(settle({ kind: "bool", value: true }, undefined)).toEqual({
      bool: true,
    });
    expect(
      settle(
        { kind: "concat", parts: [s, { kind: "bytes", hex: "00" }] },
        "bytes",
      ),
    ).toEqual({
      concat: [{ ascii: "f" }, { hex: "00" }],
    });
    for (const part of [
      { kind: "int", value: 1 },
      { kind: "null" },
      { kind: "bool", value: true },
    ] as const)
      expect(settle({ kind: "concat", parts: [part, s] }, "bytes")).toMatch(
        /^a concat part is bytes, not /,
      );
    expect(settle({ kind: "string", value: "é" }, "bytes")).toBe(
      'a quoted string is printable ASCII, tab, LF and CR only; "é" is not',
    );
  });

  test("a vector is typed by the signature: arity, kind, nullability, range", () => {
    const fn = (params: string[], returns: string) =>
      ({
        name: "f",
        params: params.map((type, i) => ({ name: `p${i}`, type })),
        returns,
      }) as Parameters<typeof settleVector>[0];
    const lit = (t: string) => {
      const r = parseLiteral(t);
      if (isLiteralError(r)) throw new Error(t);
      return r;
    };
    const cases: [string[], string, string[], string, string[]][] = [
      [
        ["string"],
        "bytes?",
        ["[00]"],
        "null",
        ["Call: argument 1 of f (p0) is string, not bytes"],
      ],
      [
        ["string"],
        "bytes?",
        ["null"],
        "null",
        ["Call: argument 1 of f (p0) is string, not null"],
      ],
      [
        ["string"],
        "bytes?",
        ["(empty)"],
        "null",
        ["Call: argument 1 of f (p0) is string, not bytes"],
      ],
      [
        ["string"],
        "bytes?",
        ["-1"],
        "null",
        ["Call: argument 1 of f (p0) is string, not an int -1"],
      ],
      [
        ["string"],
        "bytes?",
        [],
        "null",
        ["Call: f takes 1 argument(s), not 0"],
      ],
      [
        ["u32"],
        "bool",
        ["-1"],
        "true",
        ["Call: argument 1 of f (p0) is u32, not an int -1"],
      ],
      [
        ["u32"],
        "bool",
        ["4294967296"],
        "true",
        ["Call: argument 1 of f (p0) is u32, not an int 4294967296"],
      ],
      [
        ["i32"],
        "bool",
        ["2147483648"],
        "true",
        ["Call: argument 1 of f (p0) is i32, not an int 2147483648"],
      ],
      [
        ["bytes"],
        "string",
        ["[00]"],
        "[00]",
        ["Expected: f returns string, not bytes"],
      ],
      [
        ["bytes"],
        "string",
        ["[00]"],
        "null",
        ["Expected: f returns string, not null"],
      ],
      [
        ["bytes"],
        "u32",
        ["[00]"],
        "-1",
        ["Expected: f returns u32, not an int -1"],
      ],
    ];
    for (const [params, returns, args, expected, want] of cases) {
      const r = settleVector(fn(params, returns), args.map(lit), lit(expected));
      expect([args, expected, r]).toEqual([
        args,
        expected,
        want.map((w) => {
          const [cell, ...m] = w.split(": ");
          return { cell: cell as "Call" | "Expected", message: m.join(": ") };
        }),
      ]);
    }
    expect(
      settleVector(
        fn(["u32", "i32"], "bytes?"),
        [lit("4294967295"), lit("-2147483648")],
        lit("null"),
      ),
    ).toEqual({
      args: [{ int: 4294967295 }, { int: -2147483648 }],
      expect: { null: true },
    });
  });
});

describe("refusals of review round 1", () => {
  /** A spec whose one numbered section holds `lines`, one a line. */
  const lines = (...ls: string[]) =>
    spec(sec(`\n${ls.join("\n")}\n`, ' numbered="true"'));
  const T = (rows: string[]) => table(rows);

  test("a vector is typed by its signature in the spec", () => {
    expect(
      located(
        lines(
          REQ,
          T([
            vector("hexDecode([00])", "null"),
            vector("hexDecode(null)", "null", { id: "V2" }),
            vector("hexDecode((empty))", "null", { id: "V3" }),
            vector("hexDecode(-1)", "null", { id: "V4" }),
            vector("hexDecode()", "null", { id: "V5" }),
            vector("hexEncode(Key = , [00])", '"00"', { id: "V6" }),
            vector("hexEncode(-0)", '"00"', { id: "V7" }),
            vector("hexEncode([00])", "[00]", { id: "V8" }),
            vector('isHex("ab")', "-1", { id: "V9" }),
          ]),
        ),
      ),
    ).toEqual([
      {
        line: 10,
        message: "Call: argument 1 of hexDecode (text) is string, not bytes",
      },
      {
        line: 11,
        message: "Call: argument 1 of hexDecode (text) is string, not null",
      },
      {
        line: 12,
        message: "Call: argument 1 of hexDecode (text) is string, not bytes",
      },
      {
        line: 13,
        message:
          "Call: argument 1 of hexDecode (text) is string, not an int -1",
      },
      { line: 14, message: "Call: hexDecode takes 1 argument(s), not 0" },
      {
        line: 15,
        col: 11,
        message:
          "Call: a labelled value is `Label = hex`, lowercase hex pairs with no spaces",
      },
      { line: 16, col: 11, message: "Call: not a literal" },
      { line: 17, message: "Expected: hexEncode returns string, not bytes" },
      { line: 18, message: "Expected: isHex returns bool, not an int -1" },
    ]);
  });

  test("a cell is read as its raw text, spaces and all", () => {
    expect(
      located(lines(REQ, T([vector("hexEncode([00  0f])", '"000f"')]))),
    ).toEqual([{ line: 10, col: 11, message: `Call: ${BYTES_HINT}` }]);
    const c = contract(lines(REQ, T([vector('hexDecode("a  b")', "null")])));
    expect(c.clauses[0]).toMatchObject({
      call: "hexDecode",
      args: [{ str: "a  b" }],
    });
  });

  test("a quoted string outside printable ASCII, tab, LF and CR", () => {
    expect(
      located(
        lines(
          REQ,
          T([
            vector('hexEncode(concat([00], "é"))', '"00"'),
            vector('hexDecode("\\u0000")', "null", { id: "V2" }),
          ]),
        ),
      ),
    ).toEqual([
      {
        line: 10,
        message:
          'Call: a quoted string is printable ASCII, tab, LF and CR only; "é" is not',
      },
      {
        line: 11,
        message:
          'Call: a quoted string is printable ASCII, tab, LF and CR only; "\\u0000" is not',
      },
    ]);
  });

  test("a Definition: with BCP 14, and one with no anchor", () => {
    expect(
      located(
        lines(
          `<t anchor="R-D">Definition: hex <bcp14>MUST</bcp14> be lowercase.</t>`,
          "<t>Definition: hex is base 16.</t>",
        ),
      ),
    ).toEqual([
      {
        line: 8,
        message:
          "R-D is a definition but holds BCP 14 keywords; a definition holds none",
      },
      { line: 9, message: "a Definition: paragraph needs an anchor" },
    ]);
  });

  test("two levels in one sentence", () => {
    expect(
      located(
        lines(
          `<t anchor="R-T">It <bcp14>MUST</bcp14> and <bcp14>MAY</bcp14> be.</t>`,
          "<t>It <bcp14>SHOULD</bcp14> or <bcp14>SHOULD NOT</bcp14> be.</t>",
          "<t>Untested: none.</t>",
        ),
      ),
    ).toEqual([
      {
        line: 8,
        message:
          "R-T holds more than one BCP 14 level (MUST, MAY); give each level its own sentence",
      },
      {
        line: 9,
        message:
          "an excluded paragraph holds more than one BCP 14 level (SHOULD, SHOULD NOT); exclude each level apart",
      },
    ]);
  });

  test("an Untested: that excludes nothing, and a second one", () => {
    expect(
      located(
        lines(
          "<t>Untested: nothing before.</t>",
          "<t>It <bcp14>SHOULD</bcp14> be.</t>",
          "<t>Untested: once.</t>",
          "<t>Untested: twice.</t>",
        ),
      ),
    ).toEqual([
      {
        line: 8,
        message:
          "this Untested: paragraph excludes nothing; it must directly follow the requirement or BCP 14 paragraph it excludes",
      },
      {
        line: 11,
        message:
          "this Untested: paragraph excludes nothing; it must directly follow the requirement or BCP 14 paragraph it excludes",
      },
    ]);
  });

  test("a blockquote's level is the reader's: NOT RECOMMENDED is SHOULD NOT", () => {
    const c = contract(
      lines(
        `<blockquote anchor="R-NR"><t>This, however, is NOT RECOMMENDED <xref target="RFC5869" section="3.3"/></t></blockquote>`,
      ),
    );
    expect(c.requirements).toEqual([
      expect.objectContaining({ id: "R-NR", level: "SHOULD NOT" }),
    ]);
  });

  test("a blockquote of two levels", () => {
    expect(
      located(
        lines(
          `<blockquote anchor="R-Q"><t>The URI MUST NOT include a fragment component. It SHOULD NOT include a query component <xref target="RFC8707" section="2"/></t></blockquote>`,
        ),
      ),
    ).toEqual([
      {
        line: 8,
        message:
          "blockquote R-Q holds more than one BCP 14 level (MUST NOT, SHOULD NOT); quote one level per requirement",
      },
    ]);
  });

  test("a requirement id given twice is refused by the parser, at the second", () => {
    expect(() =>
      parseV3(lines(REQ, REQ.replace("work", "run")), "specs/t.xml"),
    ).toThrow('specs/t.xml:9: anchor "R-A" is used again; first on line 8');
  });

  test("a table that resembles the vector header must be it", () => {
    const h = [...VECTOR_HEADER];
    const bad = [
      ["ID", ...h.slice(1)],
      [h[1], h[0], ...h.slice(2)],
      ["Name", "Call"],
      ["Ids", "x"],
      ["Thing", "expected"],
    ];
    expect(
      located(
        lines(
          REQ,
          ...bad.map((hd) => table([], hd)),
          table([], ["Name", "Value"]),
        ),
      ),
    ).toEqual(
      bad.map((hd, i) => ({
        line: 9 + 2 * i,
        message: `a vector table's header is Id | Call | Expected | Covers | Source | Title, not ${hd.join(" | ")}`,
      })),
    );
  });

  test("a second vector table", () => {
    expect(
      located(
        lines(
          REQ,
          T([vector('hexDecode("66")', '"f"')]),
          T([vector('hexDecode("67")', '"g"', { id: "V2" })]),
        ),
      ),
    ).toEqual([
      { line: 11, message: "a spec has one vector table; this is a second" },
    ]);
  });

  test("Id and Covers cells", () => {
    expect(
      located(
        lines(
          REQ,
          T([
            vector('hexDecode("66")', '"f"', { id: "" }),
            vector('hexDecode("66")', '"f"', { id: "-V" }),
            vector('hexDecode("66")', '"f"', { id: "V3", covers: "" }),
            vector('hexDecode("66")', '"f"', { id: "V4", covers: "R-A,, R-A" }),
            vector('hexDecode("66")', '"f"', { id: "V4" }),
          ]),
        ),
      ),
    ).toEqual([
      {
        line: 10,
        message:
          'clause id "" is not letters, digits, ".", "_" and "-", starting with a letter or digit',
      },
      {
        line: 11,
        message:
          'clause id "-V" is not letters, digits, ".", "_" and "-", starting with a letter or digit',
      },
      { line: 12, message: "Covers names no requirement" },
      { line: 13, message: "Covers has an empty item" },
      { line: 13, message: 'Covers names "R-A" twice' },
      { line: 14, message: "clause id V4 is given twice" },
    ]);
  });

  test("a clause id shared by a vector and a property", () => {
    expect(
      located(
        lines(
          REQ,
          T([vector('hexDecode("66")', '"f"', { id: "P-X" })]),
          property(
            "// P-X covers R-A — t\nforall (b: u8[] /* 0..4 */) => hexEncode(b) === hexEncode(b)",
          ),
        ),
      ),
    ).toEqual([{ line: 12, message: "clause id P-X is given twice" }]);
  });

  test("a row refusal reports every cell", () => {
    expect(
      located(
        lines(
          REQ,
          T([row("-V", tt("hexDecode(1)"), tt("1"), "R-NO", "the RFC", "")]),
        ),
      ).map((r) => r.message),
    ).toEqual([
      "Call: argument 1 of hexDecode (text) is string, not an int 1",
      'Covers names "R-NO", which is no requirement',
      "Expected: hexDecode returns bytes?, not an int 1",
      "Source must be {{Section N of RFCx}}, a section anchor, or a single code span",
      'clause id "-V" is not letters, digits, ".", "_" and "-", starting with a letter or digit',
      "vector -V has no title",
    ]);
  });

  test("many paragraphs are read in linear time", () => {
    const n = 20000;
    const body = Array.from({ length: n }, (_, i) =>
      i % 2 === 0
        ? `<t>It <bcp14>SHOULD</bcp14> be ${i}.</t>`
        : "<t>Untested: many.</t>",
    );
    const xml = lines(REQ, ...body, T([vector('hexDecode("66")', '"f"')]));
    const doc = parseV3(xml, "specs/t.xml");
    const t0 = performance.now();
    const r = profileToContract(doc, "specs/t.xml", resolver);
    const ms = performance.now() - t0;
    expect("contract" in r && r.contract.exclusions?.length).toBe(n / 2);
    expect(ms).toBeLessThan(2000);
  });
});
