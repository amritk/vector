import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  findSection,
  normativeSentences,
  sectionText,
} from "../src/rfc/rfctext.ts";
import { LOOSE_SECTION } from "../src/rfc/spectext.ts";
import {
  MAX_DEPTH,
  MAX_INPUT_BYTES,
  type XmlNode,
  XmlRefusal,
  codeOf,
  isElement,
  isV3Xml,
  parseV3,
  plainText,
  tableRows,
} from "../src/rfc/xmlv3.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const RFC8707 = read("../rfcs/rfc8707.xml");

const doc = (
  middle: string,
  back = "",
  front = "<front><title>T</title></front>",
) =>
  `<rfc number="1">${front}<middle>${middle}</middle><back>${back}</back></rfc>`;

function refusal(text: string): XmlRefusal {
  try {
    parseV3(text, "spec.xml");
  } catch (e) {
    expect(e).toBeInstanceOf(XmlRefusal);
    return e as XmlRefusal;
  }
  throw new Error("no refusal");
}

const refused = (text: string) => refusal(text).message;

/** The first element named `name`, depth first. */
function find(n: XmlNode, name: string): XmlNode {
  const hit = (k: XmlNode): XmlNode | undefined =>
    k.name === name ? k : k.children.filter(isElement).map(hit).find(Boolean);
  const r = hit(n);
  if (!r) throw new Error(`no <${name}>`);
  return r;
}

describe("RFC 8707, unmodified from rfc-editor.org", () => {
  const d = parseV3(RFC8707, "rfcs/rfc8707.xml");

  test("is the published file", () => {
    expect(createHash("sha256").update(RFC8707).digest("hex")).toBe(
      "6238c0d03724c4e52aa41df1315df52d1243b6129deecdeda49acf62fcac68f2",
    );
    expect(isV3Xml(RFC8707)).toBe(true);
  });

  test("front matter", () => {
    expect(d.number).toBe(8707);
    expect(d.title).toBe("Resource Indicators for OAuth 2.0");
    expect(d.docName).toBe("draft-ietf-oauth-resource-indicators-08");
    expect(d.root.name).toBe("rfc");
  });

  test("numbers the sections as xml2rfc did (its pn attributes)", () => {
    expect([...d.sections.keys()]).toEqual([
      "1",
      "1.1",
      "1.2",
      "2",
      "2.1",
      "2.2",
      "3",
      "4",
      "5",
      "5.1",
      "5.2",
    ]);
    const pn = [
      ...RFC8707.matchAll(/<section [^>]*pn="section-([0-9.]+)"/g),
    ].map((m) => m[1]);
    // The two references sections (6, 6.1, 6.2) are not sections here.
    expect(pn.filter((p) => !p.startsWith("6"))).toEqual([
      ...d.sections.keys(),
    ]);
    expect(d.sectionByAnchor.get("ResourceParameter")).toBe("2");
    expect(d.sectionByAnchor.get("authz-req")).toBe("2.1");
    expect(findSection(d, "2.2")?.title).toBe("Access Token Request");
    // Acknowledgements and Authors' Addresses are numbered="false".
    expect(d.sectionByAnchor.has("Acknowledgements")).toBe(false);
    expect(d.loose?.id).toBe(LOOSE_SECTION);
    expect(d.loose?.lines[0]).toStartWith(
      "This specification was developed within the OAuth Working Group under the chairmanship of Hannes Tschofenig and Rifaat Shekh-Yusef",
    );
  });

  test("references", () => {
    expect(d.references.map((r) => [r.anchor, r.rfc])).toEqual([
      ["IANA.OAuth.Parameters", undefined],
      ["RFC2119", 2119],
      ["RFC3986", 3986],
      ["RFC6749", 6749],
      ["RFC8174", 8174],
      ["I-D.ietf-oauth-jwsreq", undefined],
      ["RFC6750", 6750],
      ["RFC7519", 7519],
      ["RFC7644", 7644],
      ["RFC7662", 7662],
    ]);
  });

  // Expected strings copied from `xml2rfc --text rfcs/rfc8707.xml` (3.35.0),
  // whitespace collapsed.
  test("text round-trips against xml2rfc --text", () => {
    const s2 = sectionText(d.sections.get("2") as never);
    for (const quote of [
      "Its value MUST be an absolute URI, as specified by Section 4.3 of [RFC3986].",
      "The URI MUST NOT include a fragment component.",
      "The authorization server SHOULD audience-restrict issued access tokens to the resource(s) indicated by the resource parameter.",
    ]) {
      expect(s2).toContain(quote);
    }
    const s21 = sectionText(d.sections.get("2.1") as never);
    for (const quote of [
      "via the implicit flow (Section 4.2 of OAuth 2.0 [RFC6749]), the requested resource",
      "such as when using the JWT Secured Authorization Request [JWT-SAR], a single",
      "for use at https://api.example.com/app/ is shown in Figure 1 below",
    ]) {
      expect(s21).toContain(quote);
    }
    expect(d.sections.get("2.1")?.codeLines).toContain(
      "  GET /as/authorization.oauth2?response_type=token",
    );
  });

  test("normative sentences come from bcp14 markup, several per paragraph", () => {
    const in2 = d.normative.filter((n) => n.section === "2");
    expect(in2.slice(1, 4).map((n) => [n.level, n.sentence])).toEqual([
      [
        "MUST",
        "Its value MUST be an absolute URI, as specified by Section 4.3 of [RFC3986].",
      ],
      ["MUST NOT", "The URI MUST NOT include a fragment component."],
      [
        "SHOULD NOT",
        "It SHOULD NOT include a query component, but it is recognized that there are cases that make a query component a useful and necessary part of the resource parameter, such as when one or more query parameters are used to scope requests to an application.",
      ],
    ]);
    expect(in2[1].loc.xmlLine).toBe(
      RFC8707.split("\n").findIndex((l) =>
        l.includes("Its value <bcp14>MUST</bcp14>"),
      ) + 1,
    );
    expect(
      d.normative.filter((n) => n.section === "2.1").map((n) => n.level),
    ).toEqual(["MAY", "MAY"]);
    // The BCP 14 boilerplate's own keywords, one per level.
    expect(d.normative.filter((n) => n.section === "1.1")).toHaveLength(10);
    // Every MUST/SHALL the text-based reader finds in a section, the markup finds too.
    for (const s of normativeSentences(d)) {
      if (s.section === "1.1") continue;
      expect(
        d.normative.some(
          (n) => n.section === s.section && n.sentence === s.sentence,
        ),
      ).toBe(true);
    }
  });
});

describe("kramdown-rfc output", () => {
  const text = read("fixtures/xmlv3/kramdown.xml");
  const d = parseV3(text, "kramdown.xml");

  test("reads its DOCTYPE, texttable, spanx and sourcecode", () => {
    expect(isV3Xml(text)).toBe(true);
    expect(d.number).toBeNull();
    expect(d.docName).toBe("draft-test-00");
    expect([...d.sections.keys()]).toEqual(["1", "1.1", "2"]);
    const sub = d.sections.get("1.1");
    expect(sub?.lines).toEqual(["a", "b", "x", "y", '{"a":1}']);
    expect(sub?.spanLines).toEqual([[], [], ["x"], [], []]);
    expect(sub?.codeLines).toEqual([null, null, null, null, '{"a":1}']);
    expect(sub?.proseLines).toEqual(["", "", "", "", ""]);
    expect(d.sections.get("2")?.lines).toEqual([
      "See Section 2 and Section 2 of [RFC2119].",
    ]);
    expect(d.loose?.lines).toEqual(["Hi."]);
    // No boilerplate, so no bcp14 markup: the gates fall back to the text.
    expect(d.normative).toEqual([]);
  });

  test("maps XML lines to markdown lines through <?line?>", () => {
    const md = read("fixtures/xmlv3/kramdown.md").split("\n");
    const intro = find(d.root, "section");
    expect(intro.loc).toEqual({ xmlLine: 51, mdLine: 19 });
    expect(md[18]).toBe("# Intro");
    const t = find(intro, "t");
    expect(t.loc).toEqual({ xmlLine: 53, mdLine: 21 });
    expect(md[20]).toBe("The client MUST do X. It SHOULD do Y.");
    const code = codeOf(find(intro, "sourcecode"));
    // kramdown-rfc wrote the three-line markdown table as six lines of
    // texttable, so from here to the next <?line?> the markdown line is the
    // nearest recorded one plus the XML distance: 33, where the code is on 30.
    expect(code).toEqual({
      type: "json",
      text: '{"a":1}',
      loc: { xmlLine: 65, mdLine: 33 },
    });
    expect(md[29]).toBe('{"a":1}');
    const extra = find(find(d.root, "back"), "section");
    expect(extra.loc.mdLine).toBe(39);
    expect(md[38]).toBe("# Extra");
    // Before any <?line?>, there is no markdown line.
    expect(find(d.root, "title").loc).toEqual({ xmlLine: 17 });
  });
});

describe("section numbering", () => {
  test("middle 1, 2, 2.1; back A, B, A.1; numbered=false hides a subtree", () => {
    const d = parseV3(
      doc(
        `<section anchor="a"><name>One</name><t>1</t></section>
         <section anchor="b"><name>Two</name><t>2</t>
           <section anchor="b1"><name>Two one</name><t>21</t></section>
         </section>
         <section numbered="false" anchor="u"><name>Unnumbered</name><t>u</t>
           <section anchor="u1"><name>Under</name><t>u1</t></section>
         </section>`,
        `<references><name>Refs</name><reference anchor="R"><front><title>R</title></front></reference></references>
         <section anchor="x"><name>Ex</name><t>x</t>
           <section anchor="x1"><name>Ex one</name><t>x1</t></section>
         </section>
         <section anchor="y"><name>Why</name><t>y</t></section>`,
      ),
      "n.xml",
    );
    expect([...d.sections.keys()]).toEqual(["1", "2", "2.1", "A", "A.1", "B"]);
    expect([...d.sectionByAnchor]).toEqual([
      ["a", "1"],
      ["b", "2"],
      ["b1", "2.1"],
      ["x", "A"],
      ["x1", "A.1"],
      ["y", "B"],
    ]);
    expect(d.sections.get("2")?.lines).toEqual(["2", "21"]);
    expect(d.sections.get("2")?.ownLines).toEqual(["2"]);
    expect(d.sections.get("A")?.title).toBe("Ex");
    expect(d.loose?.lines).toEqual(["u", "u1"]);
  });

  test("abstract, notes and boilerplate are not sections", () => {
    const d = parseV3(
      doc(
        "<section><name>S</name><t>s</t></section>",
        "",
        "<front><title>T</title><abstract><t>abs</t></abstract><note><t>n</t></note><boilerplate><section><name>B</name><t>b</t></section></boilerplate></front>",
      ),
      "n.xml",
    );
    expect([...d.sections.keys()]).toEqual(["1"]);
    expect(d.loose).toBeUndefined();
  });

  test("a document with neither middle nor back has no sections", () => {
    const d = parseV3("<rfc/>", "n.xml");
    expect(d.sections.size).toBe(0);
    expect(d.title).toBe("");
    expect(d.number).toBeNull();
    expect(d.docName).toBeUndefined();
  });

  test("more than 26 appendices is refused", () => {
    const many = Array.from(
      { length: 27 },
      () => "<section><name>s</name></section>",
    ).join("\n");
    expect(refused(doc("", many))).toBe(
      "spec.xml:27: <back> has more than 26 sections; appendix letters run out at Z",
    );
  });
});

describe("plain text", () => {
  const t = (inner: string, back = "") => {
    const d = parseV3(
      doc(
        `<section anchor="s"><name>S</name><t anchor="p">${inner}</t></section>`,
        back,
      ),
      "p.xml",
    );
    return plainText(find(d.root, "t"));
  };
  const refs = `<references><name>R</name>
    <reference anchor="RFC1"><front><title>One Title</title></front><seriesInfo name="RFC" value="1"/></reference>
    <reference anchor="R2"><front><title>Two</title></front></reference>
    <displayreference target="R2" to="TWO"/></references>
    <section anchor="app"><name>App</name></section>`;

  test("entities resolved, inline markup reduced to its text, whitespace collapsed", () => {
    expect(
      t(
        "a&amp;b &lt;&gt;&quot;&apos; &#65;&#x42; <bcp14>MUST</bcp14>\n  <tt>tt</tt> <em>em</em> <strong>s</strong> x<sub>2</sub> y<sup>3</sup> <u>u</u>",
      ),
    ).toBe(`a&b <>"' AB MUST tt em s x2 y3 u`);
    expect(t("a<iref item='x'/>b<cref>note</cref>c<br/>d")).toBe("abc d");
    expect(t("non&#8209;breaking&#160;space&#8203;zero&#8288;joiner")).toBe(
      "non-breaking spacezerojoiner",
    );
    expect(t("<![CDATA[<raw> & ]]>text")).toBe("<raw> & text");
  });

  test("eref as xml2rfc renders it", () => {
    expect(t('<eref target="https://e.x"/>')).toBe("<https://e.x>");
    expect(t('<eref target="https://e.x">E</eref>')).toBe("E <https://e.x>");
    expect(t('<eref target="https://e.x" brackets="none"/>')).toBe(
      "https://e.x",
    );
    expect(t('<eref target="https://e.x" brackets="none">E</eref>')).toBe(
      "E (https://e.x)",
    );
    expect(t("<eref>E</eref>")).toBe("E <>");
  });

  test("xref to a reference", () => {
    expect(t('<xref target="RFC1"/>', refs)).toBe("[RFC1]");
    expect(t('<xref target="RFC1">the RFC</xref>', refs)).toBe(
      "the RFC [RFC1]",
    );
    expect(t('<xref target="R2"/>', refs)).toBe("[TWO]");
    expect(t('<xref target="RFC1" format="title"/>', refs)).toBe("One Title");
    expect(t('<xref target="RFC1" format="title">x</xref>', refs)).toBe(
      "x (One Title)",
    );
    expect(t('<xref target="RFC1" format="none">x</xref>', refs)).toBe("x");
    expect(t('<xref target="RFC1" derivedContent="D"/>', refs)).toBe("[D]");
  });

  test("xref with a section, in each sectionFormat", () => {
    expect(t('<xref target="RFC1" section="2.3"/>', refs)).toBe(
      "Section 2.3 of [RFC1]",
    );
    expect(t('<xref target="RFC1" section="A.1">x</xref>', refs)).toBe(
      "Appendix A.1 of x [RFC1]",
    );
    expect(
      t('<xref target="RFC1" section="II" sectionFormat="comma"/>', refs),
    ).toBe("[RFC1], Part II");
    expect(
      t('<xref target="RFC1" section="B" sectionFormat="parens"/>', refs),
    ).toBe("[RFC1] (Appendix B)");
    expect(
      t('<xref target="RFC1" section="2" sectionFormat="bare"/>', refs),
    ).toBe("2");
    expect(
      t('<xref target="RFC1" section="2" sectionFormat="bare">x</xref>', refs),
    ).toBe("2 (x)");
  });

  test("xref to a section, figure, table or other anchor", () => {
    const d = parseV3(
      doc(
        `<section anchor="s"><name>Sec <em>Name</em></name>
           <t>[<xref target="s"/>] [<xref target="s" format="counter"/>] [<xref target="s" format="title"/>] [<xref target="s" format="none"/>] [<xref target="s">see</xref>] [<xref target="s" format="none">see</xref>]</t>
           <t>[<xref target="u"/>] [<xref target="u" format="counter"/>] [<xref target="u2"/>] [<xref target="app"/>] [<xref target="nope"/>] [<xref target="p"/>] [<xref target="p" format="title"/>] [<xref/>]</t>
           <t>[<xref target="f"/>] [<xref target="f" format="counter"/>] [<xref target="tb"/>] [<xref target="tb" format="counter"/>] [<xref target="tt"/>]</t>
           <figure anchor="f"><artwork>art</artwork></figure>
           <table anchor="tb"><tr><td>c</td></tr></table>
           <texttable anchor="tt"><ttcol>h</ttcol></texttable>
           <t anchor="p">para</t>
         </section>
         <section numbered="false" anchor="u"><name>Un</name></section>
         <section numbered="false" anchor="u2"/>`,
        `<section anchor="app"><name>App</name></section>`,
      ),
      "x.xml",
    );
    const ts = d.sections.get("1")?.lines ?? [];
    expect(ts[0]).toBe("[Section 1] [1] [Sec Name] [] [see (Section 1)] [see]");
    expect(ts[1]).toBe(
      '[Section "Un"] [] [Section "u2"] [Appendix A] [nope] [p] [p] []',
    );
    expect(ts[2]).toBe("[Figure 1] [1] [Table 1] [1] [Table 2]");
  });

  test("xref and eref outside parseV3 fall back to their attributes", () => {
    const x: XmlNode = {
      name: "xref",
      attrs: { target: "Z" },
      children: [],
      loc: { xmlLine: 1 },
    };
    expect(plainText(x)).toBe("Z");
    expect(plainText({ ...x, attrs: { derivedContent: " Q " } })).toBe("Q");
    expect(plainText({ ...x, attrs: {} })).toBe("");
  });

  test("block elements stay apart; contact and author print their names", () => {
    const d = parseV3(
      doc(
        `<section><name>S</name><ul><li>one</li><li>two<contact fullname="Ann Lee"/></li></ul></section>`,
        "",
        `<front><title>T<br/>x</title><author fullname="Bo"><organization>Org</organization></author><author/></front>`,
      ),
      "b.xml",
    );
    expect(plainText(find(d.root, "ul"))).toBe("one two Ann Lee");
    expect(plainText(find(d.root, "front"))).toBe("T x Bo Org");
  });
});

describe("blocks", () => {
  const sec = (body: string) =>
    parseV3(
      doc(`<section anchor="s"><name>S</name>${body}</section>`),
      "b.xml",
    );

  test("lists, definition lists, asides and blockquotes", () => {
    const d = sec(
      `<t>p</t>
       <ul><li>a</li><li><t>b1</t><t>b2</t></li></ul>
       <ol><li>c</li></ol>
       <dl><dt>term</dt><dd>def</dd></dl>
       <aside><t>side</t></aside>
       <blockquote anchor="q">quoted <em>words</em></blockquote>
       <blockquote><t>q1</t><t>q2</t></blockquote>
       <!-- c --><?pi x?><cref>hidden</cref><iref item="i"/>
       loose text`,
    );
    const s = d.sections.get("1");
    expect(s?.lines).toEqual([
      "p",
      "a",
      "b1",
      "b2",
      "c",
      "term",
      "def",
      "side",
      "quoted words",
      "q1",
      "q2",
      "loose text",
    ]);
    expect(s?.proseLines).toEqual([
      "p",
      "a",
      "b1",
      "b2",
      "c",
      "term",
      "def",
      "side",
      "",
      "",
      "",
      "loose text",
    ]);
  });

  test("sourcecode and artwork keep their lines; figure and table names are prose", () => {
    const d = sec(
      `<figure><name>Fig</name><sourcecode type="abnf"><![CDATA[
  a = b

  c = d
]]></sourcecode></figure>
       <artwork>art</artwork>
       <table><name>Tab</name>
         <thead><tr><th>H <tt>code</tt></th><th>H2</th></tr></thead>
         <tbody><tr><td><t>cell <tt>x</tt> and <em><tt>y</tt></em></t></td><td/></tr></tbody>
         <tfoot><tr><td>f</td></tr></tfoot>
         <tr><td>bare</td></tr>
       </table>`,
    );
    const s = d.sections.get("1");
    expect(s?.lines).toEqual([
      "Fig",
      "  a = b",
      "",
      "  c = d",
      "art",
      "Tab",
      "H code",
      "H2",
      "cell x and y",
      "",
      "f",
      "bare",
    ]);
    expect(s?.codeLines).toEqual([
      null,
      "  a = b",
      "",
      "  c = d",
      "art",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(s?.proseLines?.[0]).toBe("Fig");
    expect(s?.proseLines?.[5]).toBe("Tab");
    expect(s?.spanLines?.[6]).toEqual(["code"]);
    expect(s?.spanLines?.[8]).toEqual(["x", "y"]);
  });

  test("tableRows keeps tt apart from the cell text; texttable reads as rows", () => {
    const d = sec(
      `<table><thead><tr><th>A</th></tr></thead><tbody><tr><td><tt>v</tt> w</td></tr></tbody></table>
       <texttable><ttcol>h1</ttcol><ttcol>h2</ttcol><c><spanx style="verb">a</spanx></c><c><spanx>b</spanx></c><c>c</c></texttable>
       <texttable><c>z</c></texttable>`,
    );
    const [table, texttable, bare] = d.root.children
      .filter(isElement)
      .flatMap((c) =>
        c.name === "middle"
          ? find(c, "section").children.filter(isElement)
          : [],
      )
      .filter((c) => c.name !== "name");
    expect(
      tableRows(table).map((r) => r.map((c) => [c.header, c.text, c.code])),
    ).toEqual([[[true, "A", []]], [[false, "v w", ["v"]]]]);
    expect(
      tableRows(texttable).map((r) => r.map((c) => [c.text, c.code])),
    ).toEqual([
      [
        ["h1", []],
        ["h2", []],
      ],
      [
        ["a", ["a"]],
        ["b", []],
      ],
      [["c", []]],
    ]);
    expect(tableRows(bare).map((r) => r.map((c) => c.text))).toEqual([["z"]]);
  });

  test("codeOf without a leading newline, type or text", () => {
    const d = sec("<artwork>one\ntwo</artwork><sourcecode/>");
    expect(codeOf(find(d.root, "artwork"))).toEqual({
      text: "one\ntwo",
      loc: { xmlLine: 1 },
    });
    expect(codeOf(find(d.root, "sourcecode"))).toEqual({
      text: "",
      loc: { xmlLine: 2 },
    });
  });
});

describe("bcp14 normative sentences", () => {
  const norm = (body: string) =>
    parseV3(
      doc(`<section anchor="s"><name>S</name>${body}</section>`),
      "n.xml",
    ).normative.map((n) => [n.section, n.level, n.sentence, n.anchor ?? null]);

  test("several per paragraph, split like normativeSentences", () => {
    expect(
      norm(
        `<t anchor="p1">A <bcp14>MUST</bcp14> b. C <bcp14>SHOULD NOT</bcp14> d, and <bcp14>MAY</bcp14> e. Then <bcp14>MUST</bcp14> f</t>`,
      ),
    ).toEqual([
      ["1", "MUST", "A MUST b.", "p1"],
      ["1", "SHOULD NOT", "C SHOULD NOT d, and MAY e.", "p1"],
      ["1", "MAY", "C SHOULD NOT d, and MAY e.", "p1"],
      ["1", "MUST", "Then MUST f", "p1"],
    ]);
  });

  test("the same keyword twice in one sentence is one entry", () => {
    expect(
      norm("<t>X <bcp14>MUST</bcp14> or <bcp14>MUST</bcp14>.</t>"),
    ).toEqual([["1", "MUST", "X MUST or MUST.", null]]);
  });

  test("NOT RECOMMENDED reads as SHOULD NOT; whitespace inside is collapsed", () => {
    expect(norm("<t>It is <bcp14>NOT\n  RECOMMENDED</bcp14>.</t>")).toEqual([
      ["1", "SHOULD NOT", "It is NOT RECOMMENDED.", null],
    ]);
  });

  test("in list items, table cells, blockquotes and unnumbered sections", () => {
    const d = parseV3(
      doc(
        `<section><name>S</name>
           <ul><li anchor="li">x <bcp14>MUST</bcp14> y</li></ul>
           <table><tr><td>z <bcp14>SHALL</bcp14></td></tr></table>
           <blockquote anchor="bq"><bcp14>MAY</bcp14> q</blockquote>
         </section>
         <section numbered="false"><name>U</name><t>u <bcp14>OPTIONAL</bcp14></t></section>`,
      ),
      "n.xml",
    );
    expect(
      d.normative.map((n) => [
        n.section,
        n.level,
        n.sentence,
        n.anchor ?? null,
      ]),
    ).toEqual([
      ["1", "MUST", "x MUST y", "li"],
      ["1", "SHALL", "z SHALL", null],
      ["1", "MAY", "MAY q", "bq"],
      [LOOSE_SECTION, "OPTIONAL", "u OPTIONAL", null],
    ]);
    expect(d.normative[0].loc.xmlLine).toBe(2);
  });

  test("a bcp14 that holds no keyword is refused", () => {
    expect(
      refused(
        doc("<section><name>S</name><t>\n<bcp14>MUSTN'T</bcp14></t></section>"),
      ),
    ).toBe(
      `spec.xml:2: <bcp14> holds "MUSTN'T", which is not a BCP 14 keyword`,
    );
    expect(
      refused(doc("<section><t><bcp14>DEFINITION</bcp14></t></section>")),
    ).toContain('"DEFINITION", which is not');
  });
});

describe("DOCTYPE", () => {
  const withSubset = (subset: string, use = "&nbsp;") =>
    `<?xml version="1.0"?>\n<!DOCTYPE rfc [\n${subset}\n]>\n<rfc><middle><section><t>a${use}b</t></section></middle></rfc>`;

  test("xml2rfc's and kramdown-rfc's numeric entities are accepted", () => {
    const d = parseV3(
      withSubset(
        `<!ENTITY nbsp "&#160;">\n<!ENTITY zwsp '&#8203;'>\n<!ENTITY nbhy "&#8209;">\n<!ENTITY wj "&#x2060;">\n<!ENTITY nbsp "&#65;">\n<!ENTITY amp "&#65;">`,
        "&nbsp;&zwsp;&nbhy;&wj;&amp;",
      ),
      "d.xml",
    );
    expect(d.sections.get("1")?.lines).toEqual(["a -&b"]);
    expect(parseV3("<!DOCTYPE rfc>\n<rfc/>", "d.xml").sections.size).toBe(0);
    expect(parseV3("<!DOCTYPE rfc [ ] >\n<rfc/>", "d.xml").sections.size).toBe(
      0,
    );
  });

  test("an external entity is refused", () => {
    expect(
      refused(
        withSubset(
          '<!ENTITY RFC2119 SYSTEM "https://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml">',
        ),
      ),
    ).toBe(
      "spec.xml:3: external entity &RFC2119; is refused: vector never fetches",
    );
    expect(refused(withSubset('<!ENTITY x PUBLIC "-//x" "y">'))).toBe(
      "spec.xml:3: external entity &x; is refused: vector never fetches",
    );
  });

  test("a parameter entity is refused", () => {
    expect(refused(withSubset('<!ENTITY % p "&#160;">'))).toBe(
      "spec.xml:3: a parameter entity (<!ENTITY %) is refused",
    );
  });

  test("a SYSTEM or PUBLIC id is refused", () => {
    expect(refused('<!DOCTYPE rfc SYSTEM "rfc2629.dtd">\n<rfc/>')).toBe(
      "spec.xml:1: a DOCTYPE with a SYSTEM or PUBLIC identifier is refused: vector never fetches",
    );
    expect(refused('<!DOCTYPE rfc PUBLIC "x" "y">\n<rfc/>')).toContain(
      "SYSTEM or PUBLIC",
    );
  });

  test("any other declaration is refused", () => {
    for (const decl of [
      "<!ELEMENT rfc ANY>",
      "<!ATTLIST rfc a CDATA #IMPLIED>",
      "%p;",
      "<?pi?>",
    ]) {
      expect(refused(withSubset(decl))).toBe(
        'spec.xml:3: the DOCTYPE may declare only general entities with a numeric value, such as <!ENTITY nbsp "&#160;">; other markup is refused',
      );
    }
  });

  test("an entity whose value is not one character reference is refused", () => {
    for (const v of ['"text"', '"&#160;&#160;"', '"&amp;"', '"&#160"']) {
      expect(refused(withSubset(`<!ENTITY e ${v}>`))).toBe(
        'spec.xml:3: entity &e; must be a single numeric character reference such as "&#160;"',
      );
    }
    expect(refused(withSubset('<!ENTITY e "&#0;">'))).toBe(
      "spec.xml:3: character reference &#0; names no XML character",
    );
  });

  test("an undefined entity reference is refused", () => {
    expect(refused(withSubset("", "&RFC2119;"))).toBe(
      "spec.xml:5: undefined entity &RFC2119;",
    );
    expect(refused('<rfc a="&x;"/>')).toBe("spec.xml:1: undefined entity &x;");
  });

  test("a malformed DOCTYPE is refused", () => {
    expect(refused("<!DOCTYPE rfc [")).toBe(
      "spec.xml:1: malformed XML: unterminated DOCTYPE",
    );
    expect(refused('<!DOCTYPE rfc [ <!ENTITY e "&#160;" x> ]><rfc/>')).toBe(
      'spec.xml:1: malformed XML: expected ">" to end <!ENTITY',
    );
    expect(refused("<!DOCTYPE rfc [ <!ENTITY e &#160;> ]><rfc/>")).toBe(
      "spec.xml:1: malformed XML: expected a quoted value in <!ENTITY",
    );
    expect(refused('<!DOCTYPE rfc [ <!ENTITY e "&#160;> ]><rfc/>')).toBe(
      "spec.xml:1: malformed XML: unterminated value in <!ENTITY",
    );
    expect(refused("<!DOCTYPE rfc [] x><rfc/>")).toBe(
      'spec.xml:1: malformed XML: expected ">" to end the DOCTYPE',
    );
    expect(refused("<!DOCTYPE>")).toBe(
      "spec.xml:1: malformed XML: expected a name in the DOCTYPE",
    );
    expect(refused("<!DOCTYPE rfc>\n<!DOCTYPE rfc>\n<rfc/>")).toBe(
      "spec.xml:2: malformed XML: a DOCTYPE comes once, before the root element",
    );
    expect(refused("<rfc/>\n<!DOCTYPE rfc>")).toContain("a DOCTYPE comes once");
  });
});

describe("xi:include", () => {
  test("with an href is refused", () => {
    expect(
      refused(
        '<rfc xmlns:xi="http://www.w3.org/2001/XInclude"><back><references>\n<xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml"/></references></back></rfc>',
      ),
    ).toBe(
      'spec.xml:2: <xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml"> is refused: vector never fetches; expand it first (xml2rfc --expand)',
    );
    expect(refused('<rfc><x:include href="a">x</x:include></rfc>')).toContain(
      '<x:include href="a">',
    );
    expect(refused('<rfc><include href="a"/></rfc>')).toContain(
      '<include href="a">',
    );
  });

  test("without one it is inert", () => {
    expect(
      parseV3(
        '<rfc><xi:include href=""/><xi:include/><includes href="x"/></rfc>',
        "i.xml",
      ).root.children,
    ).toHaveLength(3);
  });
});

describe("bounds", () => {
  test(`input over ${MAX_INPUT_BYTES} bytes is refused`, () => {
    const pad = `<rfc>${" ".repeat(MAX_INPUT_BYTES - "<rfc></rfc>".length)}</rfc>`;
    expect(parseV3(pad, "big.xml").root.name).toBe("rfc");
    expect(refused(`${pad} `)).toBe(
      `spec.xml:1: input is ${MAX_INPUT_BYTES + 1} bytes, over the ${MAX_INPUT_BYTES}-byte limit (MAX_INPUT_BYTES)`,
    );
    // Bytes, not characters.
    expect(refused(`${pad.slice(0, -10) + "é".repeat(5)}</rfc>`)).toContain(
      "over the",
    );
  });

  test(`elements nested over ${MAX_DEPTH} deep are refused`, () => {
    const nest = (n: number) =>
      `<rfc>${"<x>".repeat(n - 1)}${"</x>".repeat(n - 1)}</rfc>`;
    let deepest = parseV3(nest(MAX_DEPTH), "deep.xml").root;
    let depth = 1;
    while (deepest.children.length) {
      deepest = deepest.children[0] as XmlNode;
      depth++;
    }
    expect(depth).toBe(MAX_DEPTH);
    expect(refused(nest(MAX_DEPTH + 1))).toBe(
      `spec.xml:1: elements nest deeper than ${MAX_DEPTH} (MAX_DEPTH)`,
    );
  });
});

describe("well-formedness", () => {
  test("line numbers survive CRLF and a BOM", () => {
    const d = parseV3(
      "﻿<?xml version='1.0'?>\r\n<rfc>\r\n<middle><section anchor='a'>\r\n<t>x</t></section></middle></rfc>",
      "c.xml",
    );
    expect(find(d.root, "t").loc.xmlLine).toBe(4);
    expect(refused("<rfc>\r\n\r\n<x>")).toBe(
      "spec.xml:3: malformed XML: <x> is never closed",
    );
  });

  test("malformed input is refused with a line", () => {
    const cases: [string, string][] = [
      ["", "spec.xml:1: malformed XML: no root element"],
      ["text", "spec.xml:1: malformed XML: expected the root element"],
      [
        "<rfc/><rfc/>",
        "spec.xml:1: malformed XML: content after the root element",
      ],
      ["<rfc/>x", "spec.xml:1: malformed XML: content after the root element"],
      [
        "<rfc>\n</x>",
        "spec.xml:2: malformed XML: </x> closes <rfc> from line 1",
      ],
      ["<rfc></rfc", 'spec.xml:1: malformed XML: expected ">" to end </rfc>'],
      ["<rfc>", "spec.xml:1: malformed XML: <rfc> is never closed"],
      [
        "<rfc a='1' a='2'/>",
        "spec.xml:1: malformed XML: duplicate attribute a on <rfc>",
      ],
      [
        "<rfc a='1'b='2'/>",
        'spec.xml:1: malformed XML: expected whitespace, ">" or "/>" in <rfc>',
      ],
      ["<rfc a/>", 'spec.xml:1: malformed XML: expected "=" after a'],
      ["<rfc a=1/>", "spec.xml:1: malformed XML: expected a quoted value of a"],
      ["<rfc a='<'/>", 'spec.xml:1: malformed XML: "<" in the value of a'],
      ["<rfc a='1/>", "spec.xml:1: malformed XML: unterminated value of a"],
      ["< rfc/>", "spec.xml:1: malformed XML: expected a name after <"],
      ["<rfc 1/>", "spec.xml:1: malformed XML: expected a name in <rfc>"],
      [
        "<rfc>a & b</rfc>",
        'spec.xml:1: malformed XML: "&" starts no entity or character reference',
      ],
      [
        "<rfc>&#xD800;</rfc>",
        "spec.xml:1: character reference &#xD800; names no XML character",
      ],
      [
        "<rfc>&#1;</rfc>",
        "spec.xml:1: character reference &#1; names no XML character",
      ],
      [
        "<rfc><![CDATA[x</rfc>",
        "spec.xml:1: malformed XML: unterminated CDATA section",
      ],
      ["<rfc><!-- x</rfc>", "spec.xml:1: malformed XML: unterminated comment"],
      [
        "<rfc><? x</rfc>",
        "spec.xml:1: malformed XML: unterminated processing instruction",
      ],
      [
        "<rfc><!ENTITY x 'y'></rfc>",
        "spec.xml:1: malformed XML: a declaration inside an element",
      ],
      ["<rfc></ rfc>", "spec.xml:1: malformed XML: expected a name after </"],
      [
        "<other/>",
        "spec.xml:1: not RFC XML: the root element is <other>, not <rfc>",
      ],
    ];
    for (const [text, message] of cases) expect(refused(text)).toBe(message);
  });

  test("an XmlRefusal carries its Loc", () => {
    const e = refusal('<rfc>\n<?line 10?>\n\n<x a="&q;"/></rfc>');
    expect(e.name).toBe("XmlRefusal");
    expect(e.loc).toEqual({ xmlLine: 4, mdLine: 12 });
  });

  test("text, CDATA and references merge into one text node; comments split it", () => {
    const d = parseV3(
      "<rfc>a<![CDATA[b]]>&amp;c<!-- x -->d<?p?>e</rfc>",
      "m.xml",
    );
    expect(d.root.children).toEqual([
      { text: "ab&c", loc: { xmlLine: 1 } },
      { text: "d", loc: { xmlLine: 1 } },
      { text: "e", loc: { xmlLine: 1 } },
    ]);
  });

  test("attribute values are decoded and either quote works", () => {
    const d = parseV3(`<rfc a="x&amp;&#65;'" b = 'y"' />`, "a.xml");
    expect(d.root.attrs).toEqual({ a: "x&A'", b: 'y"' });
  });

  test("a literal tab or newline in an attribute value reads as a space", () => {
    const d = parseV3('<rfc a="x\ty\r\nz" b="&#10;&#9;"/>', "a.xml");
    expect(d.root.attrs).toEqual({ a: "x y z", b: "\n\t" });
  });

  test("the first element with an anchor owns it", () => {
    const d = parseV3(
      '<rfc><middle><section anchor="s"/><section anchor="s"/><t anchor="t"/><section anchor="t"/></middle></rfc>',
      "a.xml",
    );
    expect([...d.sectionByAnchor]).toEqual([["s", "1"]]);
  });
});

describe("isV3Xml", () => {
  test("accepts RFC XML with a prolog and refuses anything else", () => {
    expect(isV3Xml("<rfc/>")).toBe(true);
    expect(
      isV3Xml(
        '﻿<?xml version="1.0"?>\n<!-- c -->\n<?pi?>\n<!DOCTYPE rfc [\n<!ENTITY nbsp "&#160;">\n]>\n<!-- d -->\n<rfc version="3">',
      ),
    ).toBe(true);
    expect(isV3Xml("<rfcx/>")).toBe(false);
    expect(isV3Xml("<html><rfc/></html>")).toBe(false);
    expect(isV3Xml("# 1. Intro\n<rfc>")).toBe(false);
    expect(isV3Xml("<!DOCTYPE html>\n<rfc>")).toBe(false);
    expect(isV3Xml("<?a ? > ?><!-- a-b - -->\n<rfc>")).toBe(true);
    expect(isV3Xml('<!DOCTYPE rfc [<!ENTITY a "&#62;">]><rfc>')).toBe(true);
    expect(isV3Xml("<?a <rfc>")).toBe(false);
  });
});

describe("cost stays linear in the input", () => {
  // Each of these took seconds to minutes when a step was quadratic or the
  // prolog match backtracked; linear, each takes milliseconds.
  const fast = (f: () => unknown) => {
    const start = performance.now();
    f();
    expect(performance.now() - start).toBeLessThan(2000);
  };

  test("isV3Xml on many PIs or comments that never reach <rfc>", () => {
    fast(() => expect(isV3Xml(`${"<?a?>".repeat(40)}x`)).toBe(false));
    fast(() => expect(isV3Xml(`${"<!--a-->".repeat(40)}x`)).toBe(false));
    fast(() => expect(isV3Xml("<?".repeat(30000))).toBe(false));
  });

  test("many sibling sections", () => {
    const xml = `<rfc><middle>${"<section/>".repeat(40000)}</middle></rfc>`;
    fast(() => expect(parseV3(xml, "f.xml").sections.size).toBe(40000));
  });

  test("a table with many cells", () => {
    const xml = `<rfc><middle><section><table><tr>${"<td>a</td>".repeat(40000)}</tr></table></section></middle></rfc>`;
    fast(() =>
      expect(parseV3(xml, "f.xml").sections.get("1")?.lines).toHaveLength(
        40000,
      ),
    );
  });
});
