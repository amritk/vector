import { Suite } from "nish/testing"
import { RfcSection } from "../../../src/spec/source/rfc"
import { XmlDocument, xmlDocParse } from "../../../src/spec/xml/doc"
import { XML_MAX_DEPTH, XmlNode, xmlAttr, xmlChild, xmlParse } from "../../../src/spec/xml/reader"
import { XmlNormative, xmlCodeOf, xmlTrim } from "../../../src/spec/xml/text"

// Rows for the guards that prove src/spec/xml cannot panic: each is driven on
// both sides of its bound through a public function, with what the reader
// printed before the guards went in.

/** `s` `n` times. */
const xmlGuardsTestRepeat = (s: string, n: i32): string => {
  const parts: string[] = []
  for (let k = 0; k < n; k++) {
    parts.push(s)
  }
  return parts.join("")
}

/** `s` with a newline written `\\n` and a byte past ASCII `<HH>`, so that each row reads as ASCII. */
const xmlGuardsTestEscape = (s: string): string => {
  const hex = "0123456789ABCDEF"
  const parts: string[] = []
  let from = 0
  for (let k = 0; k < s.length; k++) {
    const b = s.charCodeAt(k)
    if (b === 10 || b >= 128) {
      parts.push(s.substring(from, k))
      parts.push(b === 10 ? "\\n" : `<${hex.substring(b >> 4, (b >> 4) + 1)}${hex.substring(b & 15, (b & 15) + 1)}>`)
      from = k + 1
    }
  }
  parts.push(s.substring(from, s.length))
  return parts.join("")
}

/** A refusal as `line:col md=N[@M] message`, or `ok <root>` when the text parses. */
const xmlGuardsTestErr = (text: string): string => {
  const r = xmlParse(text)
  if (r.isOk()) {
    return `ok <${r.value.name}>`
  }
  return `${r.error.line}:${r.error.col} md=${r.error.mdLine}${r.error.mdLine >= 0 ? `@${r.error.markLine}` : ""} ${r.error.message}${xmlGuardsTestSee(r.error.see)}`
}

/** ` see L:C`, the second node's place, or nothing. */
const xmlGuardsTestSee = (see: XmlNode | null): string => (see === null ? "" : ` see ${see.line}:${see.col}`)

/** The text of the root's first child, or its refusal. */
const xmlGuardsTestText = (text: string): string => {
  const r = xmlParse(text)
  if (r.isErr()) {
    return `${r.error.line}:${r.error.col} ${r.error.message}`
  }
  const c = r.value.first
  return c === null ? "<empty>" : `text ${c.text}`
}

/** An RFC with `middle` and `back`. */
const xmlGuardsTestDoc = (middle: string, back: string): string =>
  `<rfc number="1"><front><title>T</title></front><middle>${middle}</middle><back>${back}</back></rfc>`

/** A section as `id: lines | code lines`. */
const xmlGuardsTestSection = (s: RfcSection): string =>
  `${s.id}: ${s.lines.join(" / ")} | ${s.codeLines.map((n: i32): string => `${n}`).join(",")}`

/** A document's sections, or its refusal. */
const xmlGuardsTestSections = (text: string): string => {
  const r = xmlDocParse(text)
  if (r.isErr()) {
    return `${r.error.line}:${r.error.col} ${r.error.message}`
  }
  const d: XmlDocument = r.value
  return d.sections.map(xmlGuardsTestSection).join(" ;; ")
}

/** A document's BCP 14 sentences as `level @start sentence`, or its refusal. */
const xmlGuardsTestNorm = (middle: string): string => {
  const r = xmlDocParse(xmlGuardsTestDoc(middle, ""))
  if (r.isErr()) {
    return `${r.error.line}:${r.error.col} ${r.error.message}`
  }
  return r.value.normative.map((n: XmlNormative): string => `${n.level} @${n.start} ${n.sentence}`).join(" ;; ")
}

/** The doc of one section holding `t`, its lines. */
const xmlGuardsTestIn = (t: string): string =>
  xmlGuardsTestSections(xmlGuardsTestDoc(`<section anchor="s"><name>S</name>${t}</section>`, ""))

/** `n` appendices, the last one's id or the refusal. */
const xmlGuardsTestAppendices = (n: i32): string => {
  const r = xmlDocParse(xmlGuardsTestDoc("", xmlGuardsTestRepeat("<section><name>A</name></section>", n)))
  if (r.isErr()) {
    return `${r.error.message}`
  }
  const s = r.value.sections
  return s.length > 0 ? `${s.length} last ${s[s.length - 1].id}` : "none"
}

/**
 * A document whose xref text, `n` copies of a title of `size` bytes, comes
 * to `over` bytes past the budget (the input's length plus 64 KiB).
 */
const xmlGuardsTestBudget = (n: i32, size: i32, over: i32): string => {
  const title = xmlGuardsTestRepeat("t", size)
  const refs = xmlGuardsTestRepeat('<xref target="s" format="title"/>', n)
  const bare = xmlGuardsTestDoc(`<section anchor="s"><name>${title}</name><t>${refs}</t><t></t></section>`, "")
  // The padding raises the input's length, so the budget, by one a byte.
  const pad = n * size - (bare.length + 64 * 1024) - over
  if (pad < 0) {
    return `no room: ${pad}`
  }
  const text = xmlGuardsTestDoc(
    `<section anchor="s"><name>${title}</name><t>${refs}</t><t>${xmlGuardsTestRepeat("p", pad)}</t></section>`,
    "",
  )
  const r = xmlDocParse(text)
  return r.isOk() ? "ok" : r.error.message
}

/** Adds the row `name` with `value` to `rows`. */
const xmlGuardsTestAdd = (rows: string[][], name: string, value: string): void => {
  rows.push([name, xmlGuardsTestEscape(value)])
}

/** `n` nested elements. */
const xmlGuardsTestDeep = (n: i32): string => `${xmlGuardsTestRepeat("<a>", n)}${xmlGuardsTestRepeat("</a>", n)}`

/** The rows: a name and what the code under test gives. */
const xmlGuardsTestRows = (): string[][] => {
  const rows: string[][] = []
  // xmlPlaceOf: the line and the byte column, on the first line, a middle one and the last.
  xmlGuardsTestAdd(rows, "place: first line", xmlGuardsTestErr("<a></b>"))
  xmlGuardsTestAdd(rows, "place: a middle line", xmlGuardsTestErr("<a>\n<b></c>\n</a>"))
  xmlGuardsTestAdd(rows, "place: the last line", xmlGuardsTestErr("<a>\n<b>\n</a>"))
  xmlGuardsTestAdd(rows, "place: columns count bytes", xmlGuardsTestErr("<a>\néé<b></a>"))
  xmlGuardsTestAdd(rows, "place: just after a newline", xmlGuardsTestErr("<a>\n</b>"))
  xmlGuardsTestAdd(rows, "place: an empty line", xmlGuardsTestErr("<a>\n\n\n</b>"))
  // The never-closed element: the start of its own line.
  xmlGuardsTestAdd(rows, "never closed: line 1", xmlGuardsTestErr("<a>"))
  xmlGuardsTestAdd(rows, "never closed: line 3", xmlGuardsTestErr("\n\n  <a>"))
  xmlGuardsTestAdd(rows, "never closed: the inner one", xmlGuardsTestErr("<a>\n x <b>\n"))
  // A child's line and column.
  const tree = xmlParse("<a>\n  <b/>\n\t<c/></a>")
  if (tree.isOk()) {
    const b = xmlChild(tree.value, "b")
    const c = xmlChild(tree.value, "c")
    xmlGuardsTestAdd(rows, "node: line and column", b === null ? "none" : `${b.line}:${b.col}`)
    xmlGuardsTestAdd(rows, "node: after a tab", c === null ? "none" : `${c.line}:${c.col}`)
  } else {
    xmlGuardsTestAdd(rows, "node: line and column", tree.error.message)
    xmlGuardsTestAdd(rows, "node: after a tab", tree.error.message)
  }
  // <?line N?> and its corrections.
  xmlGuardsTestAdd(rows, "line: N", xmlGuardsTestErr("<?line 7?>\n<a>\n<b></a>"))
  xmlGuardsTestAdd(rows, "line: a correction before N", xmlGuardsTestErr("<?line -3?><?line 7?>\n<a></b>"))
  xmlGuardsTestAdd(rows, "line: a positive correction", xmlGuardsTestErr("<?line +5?><?line 7?>\n<a></b>"))
  xmlGuardsTestAdd(rows, "line: corrected below 1", xmlGuardsTestErr("<?line -9?><?line 3?><a></b>"))
  xmlGuardsTestAdd(rows, "line: nine digits", xmlGuardsTestErr("<?line 999999999?><a></b>"))
  xmlGuardsTestAdd(rows, "line: ten digits", xmlGuardsTestErr("<?line 1000000000?><a></b>"))
  xmlGuardsTestAdd(rows, "line: corrections at the cap", xmlGuardsTestErr("<?line +999999999?><?line 1?><a></b>"))
  xmlGuardsTestAdd(rows, "line: corrections past the cap", xmlGuardsTestErr("<?line +999999999?><?line +1?><a/>"))
  xmlGuardsTestAdd(
    rows,
    "line: back from the cap",
    xmlGuardsTestErr("<?line +999999999?><?line -999999999?><?line 4?><a></b>"),
  )
  xmlGuardsTestAdd(rows, "line: below the cap", xmlGuardsTestErr("<?line -999999999?><?line 999999999?><a></b>"))
  xmlGuardsTestAdd(rows, "line: past the negative cap", xmlGuardsTestErr("<?line -999999999?><?line -1?><a/>"))
  // Character references at and past the last code point.
  xmlGuardsTestAdd(rows, "ref: the last code point", xmlGuardsTestText("<a>&#x10FFFF;</a>"))
  xmlGuardsTestAdd(rows, "ref: past the last code point", xmlGuardsTestText("<a>&#x110000;</a>"))
  xmlGuardsTestAdd(rows, "ref: the last, in decimal", xmlGuardsTestText("<a>&#1114111;</a>"))
  xmlGuardsTestAdd(rows, "ref: past it, in decimal", xmlGuardsTestText("<a>&#1114112;</a>"))
  xmlGuardsTestAdd(rows, "ref: eleven digits", xmlGuardsTestText("<a>&#99999999999;</a>"))
  xmlGuardsTestAdd(rows, "ref: many hex digits", xmlGuardsTestText("<a>&#xFFFFFFFFFFFF41;</a>"))
  xmlGuardsTestAdd(rows, "ref: leading zeros", xmlGuardsTestText("<a>&#x000000000041;</a>"))
  xmlGuardsTestAdd(rows, "ref: no digits", xmlGuardsTestText("<a>&#;</a>"))
  xmlGuardsTestAdd(rows, "ref: no hex digits", xmlGuardsTestText("<a>&#x;</a>"))
  xmlGuardsTestAdd(rows, "ref: not a hex digit", xmlGuardsTestText("<a>&#xG;</a>"))
  xmlGuardsTestAdd(rows, "ref: upper and lower hex", xmlGuardsTestText("<a>&#x4a;&#x4A;&#x4F;&#x4f;</a>"))
  xmlGuardsTestAdd(rows, "ref: no semicolon", xmlGuardsTestText("<a>x &#65</a>"))
  xmlGuardsTestAdd(rows, "ref: an & last", xmlGuardsTestText("<a>x &</a>"))
  xmlGuardsTestAdd(rows, "ref: after a multibyte character", xmlGuardsTestErr("<a>\né&#0;</a>"))
  // An entity's value: one numeric character reference.
  xmlGuardsTestAdd(rows, "entity: one character", xmlGuardsTestText('<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>'))
  xmlGuardsTestAdd(rows, "entity: three", xmlGuardsTestText('<!DOCTYPE a [<!ENTITY e "&#;">]><a>&e;</a>'))
  xmlGuardsTestAdd(rows, "entity: a named reference", xmlGuardsTestText('<!DOCTYPE a [<!ENTITY e "&ab;">]><a>&e;</a>'))
  xmlGuardsTestAdd(rows, "entity: a numeric one", xmlGuardsTestText('<!DOCTYPE a [<!ENTITY e "&#65;">]><a>&e;</a>'))
  xmlGuardsTestAdd(rows, "entity: empty", xmlGuardsTestText('<!DOCTYPE a [<!ENTITY e "">]><a>&e;</a>'))
  xmlGuardsTestAdd(rows, "entity: the input ends", xmlGuardsTestErr('<!DOCTYPE a [<!ENTITY e "'))
  // The input ending inside markup.
  xmlGuardsTestAdd(rows, "end: after =", xmlGuardsTestErr("<a b="))
  xmlGuardsTestAdd(rows, "end: after a name", xmlGuardsTestErr("<a b"))
  xmlGuardsTestAdd(rows, "end: in a value", xmlGuardsTestErr('<a b="x'))
  xmlGuardsTestAdd(rows, "end: in an end tag", xmlGuardsTestErr("<a></a"))
  xmlGuardsTestAdd(rows, "end: after <", xmlGuardsTestErr("<a><"))
  xmlGuardsTestAdd(rows, "end: after </", xmlGuardsTestErr("<a></"))
  xmlGuardsTestAdd(rows, "end: in a name", xmlGuardsTestErr("<a"))
  xmlGuardsTestAdd(rows, "end: in a PI", xmlGuardsTestErr("<a><?x"))
  xmlGuardsTestAdd(rows, "end: in a comment", xmlGuardsTestErr("<a><!--"))
  xmlGuardsTestAdd(rows, "end: in a CDATA section", xmlGuardsTestErr("<a><![CDATA["))
  xmlGuardsTestAdd(rows, "end: after white space", xmlGuardsTestErr("<a \n "))
  // Nesting at and past the cap.
  xmlGuardsTestAdd(rows, "depth: at the cap", xmlGuardsTestErr(xmlGuardsTestDeep(XML_MAX_DEPTH)))
  xmlGuardsTestAdd(rows, "depth: past the cap", xmlGuardsTestErr(xmlGuardsTestDeep(XML_MAX_DEPTH + 1)))
  // xmlAttr on a node whose names outnumber its values, which the reader never makes.
  const odd = new XmlNode("a", 1, -1, 0, 1)
  odd.attrNames.push("k")
  xmlGuardsTestAdd(rows, "attr: a name with no value", xmlAttr(odd, "k") ?? "<none>")
  odd.attrValues.push("v")
  xmlGuardsTestAdd(rows, "attr: a name with a value", xmlAttr(odd, "k") ?? "<none>")
  xmlGuardsTestAdd(rows, "attr: no such name", xmlAttr(odd, "j") ?? "<none>")
  // Appendix letters, A to Z.
  xmlGuardsTestAdd(rows, "appendix: one", xmlGuardsTestAppendices(1))
  xmlGuardsTestAdd(rows, "appendix: Z", xmlGuardsTestAppendices(26))
  xmlGuardsTestAdd(rows, "appendix: past Z", xmlGuardsTestAppendices(27))
  xmlGuardsTestAdd(
    rows,
    "appendix: under a lettered one",
    xmlGuardsTestSections(
      xmlGuardsTestDoc("", "<section><name>A</name><section><name>B</name><t>x</t></section></section>"),
    ),
  )
  // Figure and table counters.
  xmlGuardsTestAdd(
    rows,
    "counters",
    xmlGuardsTestIn(
      '<figure anchor="f1"><artwork>a</artwork></figure><table anchor="t1"><tr><td>c</td></tr></table><figure anchor="f2"><artwork>b</artwork></figure><table anchor="t2"><tr><td>d</td></tr></table><t><xref target="f2"/> <xref target="t2" format="counter"/> <xref target="f1" format="counter"/> <xref target="t1"/></t>',
    ),
  )
  // The xref budget, at it and one past.
  xmlGuardsTestAdd(rows, "budget: at it", xmlGuardsTestBudget(100, 1000, 0))
  xmlGuardsTestAdd(rows, "budget: one past", xmlGuardsTestBudget(100, 1000, 1))
  // A section's code lines, each counted from the section's first line.
  xmlGuardsTestAdd(
    rows,
    "code lines",
    xmlGuardsTestSections(
      xmlGuardsTestDoc(
        "<section><name>P</name><t>p</t><sourcecode>a\nb</sourcecode><section><name>C</name><t>c</t><sourcecode>x</sourcecode><t>d</t><sourcecode>y\nz</sourcecode></section></section><section><name>Q</name><sourcecode>q</sourcecode></section>",
        "",
      ),
    ),
  )
  xmlGuardsTestAdd(rows, "code lines: none", xmlGuardsTestIn("<t>p</t>"))
  xmlGuardsTestAdd(rows, "code lines: the first line", xmlGuardsTestIn("<sourcecode>a</sourcecode><t>p</t>"))
  xmlGuardsTestAdd(rows, "code lines: the last line", xmlGuardsTestIn("<t>p</t><sourcecode>a</sourcecode>"))
  xmlGuardsTestAdd(rows, "code lines: an empty section", xmlGuardsTestIn(""))
  // xmlCodeOf: the line its text starts on, after the blank line it drops.
  const code = xmlParse("<a>\n<sourcecode>\n\nx\n</sourcecode></a>")
  if (code.isOk()) {
    const sc = xmlChild(code.value, "sourcecode")
    xmlGuardsTestAdd(rows, "code: its line", sc === null ? "none" : `${xmlCodeOf(sc).line} ${xmlCodeOf(sc).text}`)
  } else {
    xmlGuardsTestAdd(rows, "code: its line", code.error.message)
  }
  // xmlTrim, as JS trim.
  xmlGuardsTestAdd(rows, "trim: NBSP", `[${xmlTrim(" a ")}]`)
  xmlGuardsTestAdd(rows, "trim: U+3000", `[${xmlTrim("　a　")}]`)
  xmlGuardsTestAdd(rows, "trim: U+FEFF", `[${xmlTrim("﻿a﻿")}]`)
  xmlGuardsTestAdd(rows, "trim: U+1680 and U+205F", `[${xmlTrim(" a ")}]`)
  xmlGuardsTestAdd(rows, "trim: U+2000 to U+200A", `[${xmlTrim("  a   ")}]`)
  xmlGuardsTestAdd(rows, "trim: U+200B is not space", `[${xmlTrim("​a​")}]`)
  xmlGuardsTestAdd(rows, "trim: all white space", `[${xmlTrim("  \t　\n")}]`)
  xmlGuardsTestAdd(rows, "trim: empty", `[${xmlTrim("")}]`)
  xmlGuardsTestAdd(rows, "trim: one space", `[${xmlTrim(" ")}]`)
  xmlGuardsTestAdd(rows, "trim: one letter", `[${xmlTrim("a")}]`)
  xmlGuardsTestAdd(rows, "trim: a cut sequence", `[${xmlTrim("a ".substring(0, 2))}]`)
  xmlGuardsTestAdd(rows, "trim: VT and FF", `[${xmlTrim("\u000ba\u000c")}]`)
  // An <xref>'s and an <eref>'s content trimmed, and left empty.
  xmlGuardsTestAdd(rows, "xref: trimmed content", xmlGuardsTestIn('<t>See <xref target="s">  here  </xref>.</t>'))
  xmlGuardsTestAdd(rows, "xref: blank content", xmlGuardsTestIn('<t>See <xref target="s"> 　 </xref>.</t>'))
  xmlGuardsTestAdd(
    rows,
    "xref: nested markup",
    xmlGuardsTestIn('<t>See <xref target="s"> <em> a </em> <em> </em> </xref>.</t>'),
  )
  xmlGuardsTestAdd(rows, "eref: trimmed content", xmlGuardsTestIn('<t>See <eref target="http://e"> e </eref>.</t>'))
  xmlGuardsTestAdd(rows, "eref: empty", xmlGuardsTestIn('<t>See <eref target="http://e"></eref>.</t>'))
  xmlGuardsTestAdd(
    rows,
    "eref: no brackets",
    xmlGuardsTestIn('<t>See <eref target="http://e" brackets="none"> </eref>.</t>'),
  )
  xmlGuardsTestAdd(rows, "eref: first in its block", xmlGuardsTestIn('<t><eref target="http://e">e</eref> x</t>'))
  // A section's label in a cross-reference.
  xmlGuardsTestAdd(rows, "label: a number", xmlGuardsTestIn('<t>See <xref target="s" section="2"/>.</t>'))
  xmlGuardsTestAdd(rows, "label: an appendix", xmlGuardsTestIn('<t>See <xref target="s" section="A"/>.</t>'))
  xmlGuardsTestAdd(rows, "label: under an appendix", xmlGuardsTestIn('<t>See <xref target="s" section="A.1"/>.</t>'))
  xmlGuardsTestAdd(rows, "label: two letters", xmlGuardsTestIn('<t>See <xref target="s" section="AB"/>.</t>'))
  xmlGuardsTestAdd(rows, "label: a lowercase letter", xmlGuardsTestIn('<t>See <xref target="s" section="a"/>.</t>'))
  xmlGuardsTestAdd(rows, "label: empty", xmlGuardsTestIn('<t>See <xref target="s" section=""/>.</t>'))
  // BCP 14 keywords.
  xmlGuardsTestAdd(
    rows,
    "bcp14: a trailing space",
    xmlGuardsTestNorm("<section><name>S</name><t>It <bcp14>MUST </bcp14>go.</t></section>"),
  )
  xmlGuardsTestAdd(
    rows,
    "bcp14: a leading space",
    xmlGuardsTestNorm("<section><name>S</name><t>It<bcp14> MUST</bcp14> go.</t></section>"),
  )
  xmlGuardsTestAdd(
    rows,
    "bcp14: first",
    xmlGuardsTestNorm("<section><name>S</name><t><bcp14>MUST</bcp14> go.</t></section>"),
  )
  xmlGuardsTestAdd(
    rows,
    "bcp14: last",
    xmlGuardsTestNorm("<section><name>S</name><t>You <bcp14>MUST</bcp14></t></section>"),
  )
  xmlGuardsTestAdd(
    rows,
    "bcp14: alone",
    xmlGuardsTestNorm("<section><name>S</name><t><bcp14>MAY</bcp14></t></section>"),
  )
  xmlGuardsTestAdd(
    rows,
    "bcp14: quoted",
    xmlGuardsTestNorm('<section><name>S</name><t>The word "<bcp14>MUST</bcp14>" is named.</t></section>'),
  )
  xmlGuardsTestAdd(
    rows,
    "bcp14: a quote before",
    xmlGuardsTestNorm('<section><name>S</name><t>The word "<bcp14>MUST</bcp14> is named.</t></section>'),
  )
  xmlGuardsTestAdd(
    rows,
    "bcp14: a quote after",
    xmlGuardsTestNorm('<section><name>S</name><t>The word <bcp14>MUST</bcp14>" is named.</t></section>'),
  )
  xmlGuardsTestAdd(
    rows,
    "bcp14: not a keyword",
    xmlGuardsTestNorm("<section><name>S</name><t>It <bcp14>MAYBE</bcp14>.</t></section>"),
  )
  xmlGuardsTestAdd(
    rows,
    "bcp14: a long non-keyword",
    xmlGuardsTestNorm(
      "<section><name>S</name><t>It <bcp14>MUST NOT EVER HAPPEN AT ALL</bcp14> in any of the cases we know of.</t></section>",
    ),
  )
  xmlGuardsTestAdd(
    rows,
    "bcp14: fifteen bytes",
    xmlGuardsTestNorm("<section><name>S</name><t>It is <bcp14>NOT RECOMMENDED</bcp14>.</t></section>"),
  )
  xmlGuardsTestAdd(
    rows,
    "bcp14: twice in a sentence",
    xmlGuardsTestNorm("<section><name>S</name><t>It <bcp14>MUST</bcp14> a and <bcp14>MUST</bcp14> b.</t></section>"),
  )
  xmlGuardsTestAdd(
    rows,
    "bcp14: two in a sentence",
    xmlGuardsTestNorm("<section><name>S</name><t>It <bcp14>MUST</bcp14> a and <bcp14>MAY</bcp14> b.</t></section>"),
  )
  xmlGuardsTestAdd(
    rows,
    "bcp14: one a sentence",
    xmlGuardsTestNorm(
      "<section><name>S</name><t>A. It <bcp14>MUST</bcp14> a. Then <bcp14>MUST</bcp14> b. Z.</t></section>",
    ),
  )
  xmlGuardsTestAdd(
    rows,
    "bcp14: right after a stop",
    xmlGuardsTestNorm("<section><name>S</name><t>A. <bcp14>MUST</bcp14> b.</t></section>"),
  )
  xmlGuardsTestAdd(
    rows,
    "bcp14: empty",
    xmlGuardsTestNorm("<section><name>S</name><t>It <bcp14></bcp14>.</t></section>"),
  )
  xmlGuardsTestAdd(
    rows,
    "bcp14: nested",
    xmlGuardsTestNorm("<section><name>S</name><t>It <bcp14><bcp14>MUST</bcp14></bcp14> go.</t></section>"),
  )
  // Blocks: the blank line between two, and none before the first.
  xmlGuardsTestAdd(rows, "blocks: two", xmlGuardsTestIn("<t>a</t><t>b</t>"))
  xmlGuardsTestAdd(rows, "blocks: an empty one first", xmlGuardsTestIn("<t></t><t>b</t>"))
  xmlGuardsTestAdd(rows, "blocks: lines in one", xmlGuardsTestIn("<artwork>a\nb\n</artwork><t>c</t>"))
  return rows
}

/** The expected values, in the rows' order. */
const xmlGuardsTestExpected = (): string[] => [
  "1:7 md=-1 malformed XML: </b> closes <a>, opened at see 1:1",
  "2:7 md=-1 malformed XML: </c> closes <b>, opened at see 2:1",
  "3:4 md=-1 malformed XML: </a> closes <b>, opened at see 2:1",
  "2:11 md=-1 malformed XML: </a> closes <b>, opened at see 2:5",
  "2:4 md=-1 malformed XML: </b> closes <a>, opened at see 1:1",
  "4:4 md=-1 malformed XML: </b> closes <a>, opened at see 1:1",
  "1:1 md=-1 malformed XML: <a> is never closed",
  "3:1 md=-1 malformed XML: <a> is never closed",
  "2:1 md=-1 malformed XML: <b> is never closed",
  "2:3",
  "3:2",
  "3:7 md=7@1 malformed XML: </a> closes <b>, opened at see 3:1",
  "2:7 md=4@1 malformed XML: </b> closes <a>, opened at see 2:1",
  "2:7 md=12@1 malformed XML: </b> closes <a>, opened at see 2:1",
  "1:28 md=1@1 malformed XML: </b> closes <a>, opened at see 1:22",
  "1:25 md=999999999@1 malformed XML: </b> closes <a>, opened at see 1:19",
  "1:1 md=-1 <?line 1000000000?> names a line past 999999999",
  "1:36 md=1000000000@1 malformed XML: </b> closes <a>, opened at see 1:30",
  "1:20 md=-1 <?line +1?> corrects lines by more than 999999999 in all",
  "1:55 md=4@1 malformed XML: </b> closes <a>, opened at see 1:49",
  "1:44 md=1@1 malformed XML: </b> closes <a>, opened at see 1:38",
  "1:20 md=-1 <?line -1?> corrects lines by more than 999999999 in all",
  "text <F4><8F><BF><BF>",
  "1:4 character reference &#x110000; names no XML character",
  "text <F4><8F><BF><BF>",
  "1:4 character reference &#1114112; names no XML character",
  "1:4 character reference &#99999999999; names no XML character",
  "1:4 character reference &#xFFFFFFFFFFFF41; names no XML character",
  "text A",
  "1:4 character reference &#; names no XML character",
  "1:4 character reference &#x; names no XML character",
  "1:4 character reference &#xG; names no XML character",
  "text JJOO",
  '1:6 malformed XML: "&" starts no entity or character reference',
  '1:6 malformed XML: "&" starts no entity or character reference',
  "2:3 md=-1 character reference &#0; names no XML character",
  '1:14 entity &e; must be a single numeric character reference such as "&#160;"',
  '1:14 entity &e; must be a single numeric character reference such as "&#160;"',
  '1:14 entity &e; must be a single numeric character reference such as "&#160;"',
  "text A",
  '1:14 entity &e; must be a single numeric character reference such as "&#160;"',
  "1:26 md=-1 malformed XML: unterminated value in <!ENTITY",
  "1:6 md=-1 malformed XML: expected a quoted value of b",
  '1:5 md=-1 malformed XML: expected "=" after b',
  "1:7 md=-1 malformed XML: unterminated value of b",
  '1:7 md=-1 malformed XML: expected ">" to end </a>',
  "1:5 md=-1 malformed XML: expected a name after <",
  "1:6 md=-1 malformed XML: expected a name after </",
  "1:1 md=-1 malformed XML: <a> is never closed",
  "1:6 md=-1 malformed XML: unterminated processing instruction",
  "1:8 md=-1 malformed XML: unterminated comment",
  "1:13 md=-1 malformed XML: unterminated CDATA section",
  "1:1 md=-1 malformed XML: <a> is never closed",
  "ok <a>",
  "1:769 md=-1 elements nest deeper than 256 (XML_MAX_DEPTH)",
  "<none>",
  "v",
  "<none>",
  "1 last A",
  "26 last Z",
  "<back> has more than 26 sections; appendix letters run out at Z",
  "A: x |  ;; A.1: x | ",
  "1: a /  / c /  / b /  / d /  / Figure 2 2 1 Table 1 | 0,4",
  "ok",
  "the xref text worked out runs past 99999 characters, the input's length and XML_MAX_XREF_TEXT",
  "1: p /  / a / b /  / c /  / x /  / d /  / y / z | 2,3,7,11,12 ;; 1.1: c /  / x /  / d /  / y / z | 2,6,7 ;; 2: q | 0",
  "1: p | ",
  "1: a /  / p | 0",
  "1: p /  / a | 2",
  "1:  | ",
  "3 \\nx",
  "[a]",
  "[a]",
  "[a]",
  "[a]",
  "[a]",
  "[<E2><80><8B>a<E2><80><8B>]",
  "[]",
  "[]",
  "[]",
  "[a]",
  "[a<C2>]",
  "[a]",
  "1: See here (Section 1). | ",
  "1: See Section 1. | ",
  "1: See a (Section 1). | ",
  "1: See e <http://e>. | ",
  "1: See <http://e>. | ",
  "1: See http://e. | ",
  "1: e <http://e> x | ",
  "1: See Section 2 of [Section 1]. | ",
  "1: See Appendix A of [Section 1]. | ",
  "1: See Appendix A.1 of [Section 1]. | ",
  "1: See Part AB of [Section 1]. | ",
  "1: See Part a of [Section 1]. | ",
  "1: See Part of [Section 1]. | ",
  "MUST @0 It MUSTgo.",
  "MUST @0 ItMUST go.",
  "MUST @0 MUST go.",
  "MUST @0 You MUST",
  "MAY @0 MAY",
  "",
  "",
  "",
  '1:0 <bcp14> holds "MAYBE", which is not a BCP 14 keyword',
  '1:0 <bcp14> holds "MUST NOT EVER HAPPEN AT ALL in any of th...", which is not a BCP 14 keyword',
  "SHOULD NOT @0 It is NOT RECOMMENDED.",
  "MUST @0 It MUST a and MUST b.",
  "MUST @0 It MUST a and MAY b. ;; MAY @0 It MUST a and MAY b.",
  "MUST @3 It MUST a. ;; MUST @14 Then MUST b.",
  "MUST @3 MUST b.",
  '1:0 <bcp14> holds "", which is not a BCP 14 keyword',
  "MUST @0 It MUST go.",
  "1: a /  / b | ",
  "1: b | ",
  "1: a / b /  / c | 0,1",
]

export const main = (): i32 => {
  const t = new Suite("spec/xml guards")
  const rows = xmlGuardsTestRows()
  const expected = xmlGuardsTestExpected()
  t.ok("one expected value a row", rows.length === expected.length)
  let k = 0
  for (const r of rows) {
    if (k < expected.length) {
      t.eqStr(r[0], r[1], expected[k])
    }
    k = k + 1
  }
  return t.done()
}
