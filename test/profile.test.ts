import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  type RfcContract,
  validateContractShape,
} from "../src/rfc/contract.ts";
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
  locate,
  profileToContract,
  shapeRefusals,
} from "../src/rfc/profile.ts";
import { parseRfc } from "../src/rfc/rfctext.ts";
import { parseV3 } from "../src/rfc/xmlv3.ts";

const LABELLED =
  "a labelled value is `Label = hex` (lowercase hex pairs with no spaces), `Label = 42` or `Label = 22 × 0b`";

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
/**
 * A section holding R-A and one vector covering it, sourced from the
 * section itself: no RFC is cited. A contract needs a requirement and a clause.
 */
const MIN = sec(
  REQ +
    table([
      vector('hexDecode("66")', '"f"', { source: `<xref target="min"/>` }),
    ]),
  ' anchor="min"',
);
const property = (code: string) =>
  `<sourcecode type="ts-property"><![CDATA[\n${code}\n]]></sourcecode>`;
/** A property covering R-D and R-N, which are binding and so need a clause. */
const COVER_DN = property(
  "// P-DN covers R-D, R-N — t\nforall (b: u8[] /* 0..4 */) => hexEncode(b) === hexEncode(b)",
);

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
        MIN +
          sec(`<blockquote anchor="R-Q"><t>a client MAY indicate</t>
<t>the protected resource <xref target="RFC8707" section="2"/></t></blockquote>
<blockquote anchor="R-D"><t>(a.k.a. resource server, application, API, etc.)
<xref target="RFC8707" section="2"/></t></blockquote>
<blockquote anchor="R-N"><t>The URI MUST NOT include a fragment component.
<xref target="RFC8707" section="2"/></t></blockquote>${COVER_DN}`),
      ),
    );
    expect(c.requirements.slice(1)).toEqual([
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

  test("a prose table is not a vector table: it has at most two vector header names", () => {
    const prose = [
      ["Name"],
      ["ID", "Algorithm", "Notes"],
      ["Case", "Input", "Expected"],
      ["Name", "Call", "Effect"],
      ["Id", "Title"],
    ];
    const c = contract(
      spec(MIN + sec(prose.map((h) => table([row("x")], h)).join(""))),
    );
    expect(c.clauses.map((v) => v.id)).toEqual(["V1"]);
  });

  test("an anchored paragraph without BCP 14 is no requirement", () => {
    expect(
      contract(
        spec(MIN + sec(`<t anchor="note">Just prose.</t>`)),
      ).requirements.map((r) => r.id),
    ).toEqual(["R-A"]);
  });

  test("sections in <back> are lettered, and nested sections numbered", () => {
    const xml = `<rfc docName="draft-t-00" version="3"><front><title>T</title></front><middle>${IFACE}${MIN.replace(REQ, "")}</middle><back>${REFS}<section><name>A</name>${sec(REQ)}</section></back></rfc>`;
    expect(contract(xml).requirements[0].section).toBe("A.1");
  });

  test("a document with no <back> still reads", () => {
    const xml = `<rfc docName="draft-t-00" version="3"><front><title>T</title></front><middle>${IFACE}${MIN}</middle></rfc>`;
    expect(contract(xml).requirements.map((r) => r.id)).toEqual(["R-A"]);
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
      spec(MIN + sec(`<t>See <xref target="RFC9999" section="99"/>.</t>`)),
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
      located(
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
      ),
    ).toEqual([
      { line: 8, message: "cell must be a single code span" },
      { line: 9, message: "cell must be a single code span" },
    ]);
  });

  test("two ts-interface blocks", () => {
    expect(located(spec(sec(iface())))).toEqual([
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
    expect(located(spec(sec(bad.join("\n"))))).toEqual(
      ["R-B", "R-C", "R-D", "R-E", "R-F"].map((a, i) => ({
        line: 7 + i,
        message: `blockquote ${a} must be <t> paragraphs, the last ending with {{Section N of RFCx}}`,
      })),
    );
  });

  test("a requirement, an exclusion and a vector table in an unnumbered section", () => {
    expect(
      located(
        spec(
          sec(
            `${REQ}\n<t>It <bcp14>SHOULD</bcp14> be.</t><t>Untested: no.</t>\n${table([])}`,
            ` numbered="false"`,
          ),
        ),
      ),
    ).toEqual([
      {
        line: 7,
        message:
          "R-A is in an unnumbered section; a requirement needs a section number",
      },
      {
        line: 8,
        message:
          "an excluded sentence is in an unnumbered section; it needs a section number",
      },
      {
        line: 9,
        message:
          "a vector table is in an unnumbered section; it needs a section number",
      },
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
    expect(located(spec(sec(table([], ["Id", "Call", "Expected"]))))).toEqual([
      {
        line: 7,
        message:
          "a vector table's header is Id | Call | Expected | Covers | Source | Title, not Id | Call | Expected",
      },
    ]);
  });

  test("a vector row with the wrong cell count, and one with no title", () => {
    expect(
      located(
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
    ).toEqual([
      { line: 8, message: "a vector row has 6 cells, not 2" },
      { line: 9, message: "vector V1 has no title" },
    ]);
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
      located(
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
      {
        line: 8,
        message:
          "Source must be {{Section N of RFCx}}, a section anchor, or a single code span",
      },
      {
        line: 9,
        message: 'Source names "nowhere", which is no numbered section',
      },
      { line: 10, message: 'xref to "BOOK" names no RFC <reference>' },
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
      ["K = 0A", LABELLED, 1],
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
        message: `Call: ${LABELLED}`,
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
      ).replace("</middle>", `${MIN}</middle>`),
    );
    expect(c.requirements.slice(0, 1)).toEqual([
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
    const h: string[] = [...VECTOR_HEADER];
    const bad = [
      ["ID", ...h.slice(1)],
      ["Id", "Call", "Expected"],
      [h[1], h[0], ...h.slice(2)],
      ["Name", ...h.slice(1)],
      ["Id", "Input", "Output", ...h.slice(3)],
      [h[0], h[2], h[1], ...h.slice(3)],
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
      ),
    ).toEqual([
      {
        line: 10,
        message: "Call: argument 1 of hexDecode (text) is string, not an int 1",
      },
      { line: 10, message: 'Covers names "R-NO", which is no requirement' },
      { line: 10, message: "Expected: hexDecode returns bytes?, not an int 1" },
      {
        line: 10,
        message:
          "Source must be {{Section N of RFCx}}, a section anchor, or a single code span",
      },
      {
        line: 10,
        message:
          'clause id "-V" is not letters, digits, ".", "_" and "-", starting with a letter or digit',
      },
      { line: 10, message: "vector -V has no title" },
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
    expect(ms).toBeLessThan(10000);
  });
});

describe("refusals of review round 2", () => {
  /** A spec whose one numbered section holds `ls`, one a line. */
  const lines = (...ls: string[]) =>
    spec(sec(`\n${ls.join("\n")}\n`, ' numbered="true"'));
  const T = (rows: string[]) => table(rows);
  const src = (source: string, expected = '"f"', id = "V1") =>
    vector('hexDecode("66")', expected, { id, source });

  test("a blank command source, and one whose Expected is null or a bool", () => {
    expect(
      located(
        lines(
          REQ,
          T([
            src("<tt/>"),
            src("<tt>   </tt>", '"f"', "V2"),
            src(tt("echo"), "null", "V3"),
            vector('isHex("66")', "true", { id: "V4", source: tt("echo") }),
          ]),
        ),
      ),
    ).toEqual([
      { line: 10, message: "Source: a command is a shell command, not blank" },
      { line: 11, message: "Source: a command is a shell command, not blank" },
      {
        line: 12,
        message:
          "Source: a command prints bytes or a string, so its Expected is one, not null",
      },
      {
        line: 13,
        message:
          "Source: a command prints bytes or a string, so its Expected is one, not bool",
      },
    ]);
  });

  test("a blockquote of only its citation, and one holding a control character", () => {
    expect(
      located(
        lines(
          `<blockquote anchor="R-X"><t>${RFC10}</t></blockquote>`,
          `<blockquote anchor="R-Y"><t>a&#127; ${RFC10}</t></blockquote>`,
          REQ,
          T([src(RFC10)]),
        ),
      ),
    ).toEqual([
      { line: 8, message: "R-X's quote is empty" },
      { line: 9, message: "R-Y's quote holds a control character (U+007F)" },
    ]);
  });

  test("an excluded sentence or reason holding a control character", () => {
    expect(
      located(
        lines(
          "<t>x <bcp14>MUST</bcp14> y&#127;.</t>",
          "<t>Untested: no&#127;.</t>",
          REQ,
          T([src(RFC10)]),
        ),
      ),
    ).toEqual([
      {
        line: 8,
        message: "the excluded sentence holds a control character (U+007F)",
      },
      {
        line: 9,
        message: "the Untested: reason holds a control character (U+007F)",
      },
    ]);
  });

  test("a requirement anchor that is not an id", () => {
    expect(
      located(
        lines(
          `<t anchor="_R">hexDecode <bcp14>MUST</bcp14> work.</t>`,
          REQ,
          T([src(RFC10)]),
        ),
      ),
    ).toEqual([
      {
        line: 8,
        message:
          'requirement id "_R" is not letters, digits, ".", "_" and "-", starting with a letter or digit',
      },
    ]);
  });

  test("an xref section that is not a section number", () => {
    expect(
      located(lines(REQ, T([src(`<xref target="RFC4648" section="three"/>`)]))),
    ).toEqual([
      {
        line: 10,
        message:
          'section "three" of RFC4648 is not a section number like 2.3 or A.1',
      },
    ]);
  });

  test("a contract name that is not an id, and a title that is blank or holds a control character", () => {
    expect(
      refusals(spec(MIN, { docName: "draft-_t-00" }), "specs/_t.xml"),
    ).toEqual([
      {
        file: "specs/_t.xml",
        line: 1,
        message:
          'docName "draft-_t-00" names contract "_t", which is not letters, digits, ".", "_" and "-", starting with a letter or digit',
      },
    ]);
    expect(
      located(spec(MIN).replace("<title>T</title>", "<title> </title>")),
    ).toEqual([{ line: 1, message: "the title is empty" }]);
    expect(
      located(spec(MIN).replace("<title>T</title>", "<title>T&#127;</title>")),
    ).toEqual([
      { line: 1, message: "the title holds a control character (U+007F)" },
    ]);
  });

  test("a function name the generated test uses itself, at its own line", () => {
    const head = `<section><name>I</name>${iface(`${IFACE_CODE}export function plain_x(a: string): string\n`)}</section>`;
    expect(located(spec(MIN, { head }))).toEqual([
      {
        line: 7, // the function's own line in the block
        message:
          "function plain_x: the generated test uses this name itself (its helpers, and names starting plain_ clause_ table_ v_ a_ s_), so it cannot call such a function",
      },
    ]);
  });

  test("a spec with no requirement, or no clause", () => {
    expect(located(lines(T([])))).toEqual([
      {
        line: 1,
        message:
          "a spec needs at least one clause: a vector table row or a ts-property block",
      },
      { line: 1, message: "a spec needs at least one requirement" },
    ]);
    expect(located(lines(REQ))).toEqual([
      {
        line: 1,
        message:
          "a spec needs at least one clause: a vector table row or a ts-property block",
      },
    ]);
  });

  test("a v2 <texttable>", () => {
    expect(
      located(
        lines(
          REQ,
          "<texttable><ttcol>a</ttcol><c>b</c></texttable>",
          T([src(RFC10)]),
        ),
      ),
    ).toEqual([
      {
        line: 9,
        message:
          "a <texttable> is v2 XML; write a v3 <table> (xml2rfc --v2v3 converts one)",
      },
    ]);
  });

  test("Id, Covers and header cells are read raw: a non-breaking hyphen is not a hyphen", () => {
    expect(
      located(
        lines(
          REQ,
          T([
            vector('hexDecode("66")', '"f"', { covers: "R&#8209;A" }),
            vector('hexDecode("66")', '"f"', { id: "V&#8209;2" }),
          ]),
        ),
      ),
    ).toEqual([
      { line: 10, message: 'Covers names "R‑A", which is no requirement' },
      {
        line: 11,
        message:
          'clause id "V‑2" is not letters, digits, ".", "_" and "-", starting with a letter or digit',
      },
    ]);
    const h: string[] = [...VECTOR_HEADER];
    h[4] = "So&#8209;urce";
    expect(located(lines(REQ, table([], h)))).toEqual([
      {
        line: 9,
        message:
          "a vector table's header is Id | Call | Expected | Covers | Source | Title, not Id | Call | Expected | Covers | So‑urce | Title",
      },
    ]);
  });

  test("a Definition may quote a keyword; MUST NOT and SHOULD NOT come from an anchored <t>", () => {
    const c = contract(
      lines(
        `<t anchor="R-D">Definition: "<bcp14>MUST</bcp14>" is a keyword.</t>`,
        `<t anchor="R-N">hexDecode <bcp14>MUST NOT</bcp14> fail.</t>`,
        `<t anchor="R-S">hexDecode <bcp14>SHOULD NOT</bcp14> fail.</t>`,
        REQ,
        T([src(RFC10)]),
        COVER_DN,
      ),
    );
    expect(c.requirements.map((q) => [q.id, q.level])).toEqual([
      ["R-D", "DEFINITION"],
      ["R-N", "MUST NOT"],
      ["R-S", "SHOULD NOT"],
      ["R-A", "MUST"],
    ]);
  });

  test("shapeRefusals maps each issue to its element's line, else the root", () => {
    const c = contract(lines(REQ, T([src(RFC10)])));
    const broken = {
      ...c,
      contract: "-bad",
      requirements: [{ ...c.requirements[0], quote: "" }],
      clauses: [{ ...c.clauses[0], title: "" }],
    } as RfcContract;
    const at = (xmlLine: number) => ({ xmlLine });
    expect(
      shapeRefusals(broken, "f.xml", at(1), {
        requirements: [at(5)],
        exclusions: [],
        clauses: [at(7)],
        functions: [at(2), at(2), at(2)],
      }).map(({ file, line, message }) => ({
        file,
        line,
        issue: message.replace("the contract read here is not valid: ", ""),
      })),
    ).toEqual(
      validateContractShape(broken)
        .map((issue) => ({
          file: "f.xml",
          line: issue.startsWith("requirements")
            ? 5
            : issue.startsWith("clauses")
              ? 7
              : 1,
          issue,
        }))
        .sort((a, b) => a.line - b.line),
    );
    expect(validateContractShape(broken).length).toBe(3);
  });
});

describe("refusals of review round 3", () => {
  const lines = (...ls: string[]) =>
    spec(sec(`\n${ls.join("\n")}\n`, ' numbered="true"'));
  const V = table([
    vector('hexDecode("66")', '"f"', {
      source: `<xref target="RFC4648" section="10"/>`,
    }),
  ]);

  test("a binding requirement no clause covers; a non-binding one may be", () => {
    expect(
      located(
        lines(
          REQ,
          `<t anchor="R-B">hexEncode <bcp14>SHALL</bcp14> work.</t>`,
          `<t anchor="R-M">hexEncode <bcp14>MAY</bcp14> work.</t>`,
          V,
        ),
      ),
    ).toEqual([
      {
        line: 9,
        message:
          "R-B is SHALL, but no clause covers it; cover it with a vector or a property, or follow it with an Untested: paragraph",
      },
    ]);
  });

  test("a property whose assertion calls no function under test", () => {
    expect(
      located(
        lines(
          REQ,
          V,
          property(
            "// P-X covers R-A — t\nforall (b: u8[] /* 0..4 */) => b === b",
          ),
        ),
      ),
    ).toEqual([
      {
        line: 12, // its covers line
        message:
          "property P-X's assertion calls none of the functions under test, so it checks nothing",
      },
    ]);
  });

  test("the locator puts a line on each issue the gates find", () => {
    const r = run(
      lines(
        REQ,
        `<t anchor="R-B.2">isHex <bcp14>MUST</bcp14> work.</t>`,
        table([
          vector('hexDecode("66")', '"f"', { covers: "R-A, R-B.2" }),
          vector("hexEncode([66])", '"f"', { id: "V.2", covers: "R-A" }),
        ]),
      ),
    );
    if (!("contract" in r)) throw new Error(JSON.stringify(r.refusals));
    const { contract: c, locator } = r;
    expect(locator.at).toEqual({
      "R-A": 8,
      "R-B.2": 9,
      V1: 11,
      "V.2": 12,
      hexDecode: 4,
      hexEncode: 5,
      isHex: 6,
    });
    // Break V.2 and R-B.2 so the gates name each; every issue gets its line.
    const broken = {
      ...c,
      clauses: [{ ...c.clauses[0], covers: ["R-A"] }, ...c.clauses.slice(1)],
      functions: [...c.functions, c.functions[0]],
    } as RfcContract;
    const g = runGates(broken);
    expect(g.issues.map((i) => [i.at, locate(locator, i.at).line])).toEqual([
      ["hexDecode", 4],
      ["R-B.2", 9],
    ]);
    expect(locate(locator, "V.2.expect")).toEqual({
      file: "specs/t.xml",
      line: 12,
    });
    expect(locate(locator, "sources.rfc4648").line).toBe(locator.root);
    expect(locate(locator, "").line).toBe(locator.root);
  });
});
