import { Suite } from "nish/testing"
import { split } from "nish/text"
import { sha256Hex } from "../../../src/core/hex"
import { rfcSectionText } from "../../../src/spec/source/rfc"
import { XmlDocument, XmlRef, xmlDocParse } from "../../../src/spec/xml/doc"
import { XmlNormative } from "../../../src/spec/xml/text"

const XML_RFC8707_TEST_PATH: string = "rfcs/rfc8707.xml"

/** The numbers xml2rfc wrote on each `<section>` as `pn="section-N"`, in order. */
const xmlRfc8707TestPns = (text: string): string[] => {
  const out: string[] = []
  const tag = 'pn="section-'
  for (const piece of split(text, "<section ")) {
    const end = piece.indexOf(">")
    const at = piece.indexOf(tag)
    if (at < 0 || end < 0 || at > end) {
      continue
    }
    const from = at + tag.length
    const close = piece.indexOf('"', from)
    const pn = piece.substring(from, close)
    const c = pn.charCodeAt(0)
    if (c >= 0x30 && c <= 0x39) {
      out.push(pn)
    }
  }
  return out
}

/** The text of the section numbered `id`, whitespace collapsed; "" when there is none. */
const xmlRfc8707TestText = (d: XmlDocument, id: string): string => {
  for (const s of d.sections) {
    if (s.id === id) {
      return rfcSectionText(s)
    }
  }
  return ""
}

/** The lines of the section numbered `id`. */
const xmlRfc8707TestLines = (d: XmlDocument, id: string): string[] => {
  for (const s of d.sections) {
    if (s.id === id) {
      return s.lines
    }
  }
  return []
}

/** The title of the section numbered `id`; "<none>" when there is none. */
const xmlRfc8707TestTitle = (d: XmlDocument, id: string): string => {
  for (const s of d.sections) {
    if (s.id === id) {
      return s.title
    }
  }
  return "<none>"
}

/** The BCP 14 sentences of a section. */
const xmlRfc8707TestIn = (d: XmlDocument, id: string): XmlNormative[] =>
  d.normative.filter((n: XmlNormative): boolean => n.section === id)

/** Front matter, section numbers, references and text, as xml2rfc read them. */
const xmlRfc8707TestRead = (t: Suite, text: string, d: XmlDocument): void => {
  t.eqStr("is the published file", sha256Hex(text), "6238c0d03724c4e52aa41df1315df52d1243b6129deecdeda49acf62fcac68f2")
  t.ok("front matter: number", d.number === 8707)
  t.eqStr("front matter: title", d.title, "Resource Indicators for OAuth 2.0")
  t.eqStr("front matter: docName", d.docName ?? "<none>", "draft-ietf-oauth-resource-indicators-08")
  t.eqStr("front matter: root", d.root.name, "rfc")

  const ids = d.sections.map((s): string => s.id)
  t.eqStr("numbers the sections as xml2rfc did", ids.join(" "), "1 1.1 1.2 2 2.1 2.2 3 4 5 5.1 5.2")
  // The two references sections (6, 6.1, 6.2) are not sections here.
  t.eqStr(
    "the numbers are its pn attributes",
    xmlRfc8707TestPns(text)
      .filter((p: string): boolean => !p.startsWith("6"))
      .join(" "),
    ids.join(" "),
  )
  t.eqStr("a section by anchor: ResourceParameter", d.sectionByAnchor.get("ResourceParameter") ?? "<none>", "2")
  t.eqStr("a section by anchor: authz-req", d.sectionByAnchor.get("authz-req") ?? "<none>", "2.1")
  t.eqStr("a section's title", xmlRfc8707TestTitle(d, "2.2"), "Access Token Request")
  // Acknowledgements and Authors' Addresses are numbered="false".
  t.ok("an unnumbered section has no number", !d.sectionByAnchor.has("Acknowledgements"))

  t.eqStr(
    "references",
    d.references.map((r: XmlRef): string => `${r.anchor}=${r.rfc}`).join(" "),
    "IANA.OAuth.Parameters=-1 RFC2119=2119 RFC3986=3986 RFC6749=6749 RFC8174=8174 I-D.ietf-oauth-jwsreq=-1 RFC6750=6750 RFC7519=7519 RFC7644=7644 RFC7662=7662",
  )

  // Expected strings copied from `xml2rfc --text rfcs/rfc8707.xml` (3.35.0), whitespace collapsed.
  const s2 = xmlRfc8707TestText(d, "2")
  for (const quote of [
    "Its value MUST be an absolute URI, as specified by Section 4.3 of [RFC3986].",
    "The URI MUST NOT include a fragment component.",
    "The authorization server SHOULD audience-restrict issued access tokens to the resource(s) indicated by the resource parameter.",
  ]) {
    t.contains("text round-trips against xml2rfc --text: §2", s2, quote)
  }
  const s21 = xmlRfc8707TestText(d, "2.1")
  for (const quote of [
    "via the implicit flow (Section 4.2 of OAuth 2.0 [RFC6749]), the requested resource",
    "such as when using the JWT Secured Authorization Request [JWT-SAR], a single",
    "for use at https://api.example.com/app/ is shown in Figure 1 below",
  ]) {
    t.contains("text round-trips against xml2rfc --text: §2.1", s21, quote)
  }
  t.ok(
    "artwork keeps its lines",
    xmlRfc8707TestLines(d, "2.1").some(
      (l: string): boolean => l === "  GET /as/authorization.oauth2?response_type=token",
    ),
  )
}

/** Normative sentences come from bcp14 markup, several per paragraph, at their lines. */
const xmlRfc8707TestNormative = (t: Suite, text: string, d: XmlDocument): void => {
  const in2 = xmlRfc8707TestIn(d, "2")
  t.eqLines(
    "normative sentences come from bcp14 markup, several per paragraph",
    in2.slice(1, 4).map((n: XmlNormative): string => `${n.level}: ${n.sentence}`),
    [
      "MUST: Its value MUST be an absolute URI, as specified by Section 4.3 of [RFC3986].",
      "MUST NOT: The URI MUST NOT include a fragment component.",
      "SHOULD NOT: It SHOULD NOT include a query component, but it is recognized that there are cases that make a query component a useful and necessary part of the resource parameter, such as when one or more query parameters are used to scope requests to an application.",
    ],
  )
  const lines = split(text, "\n")
  let want = -1
  for (let i = 0; i < lines.length; i++) {
    if (want < 0 && lines[i].indexOf("Its value <bcp14>MUST</bcp14>") >= 0) {
      want = i + 1
    }
  }
  t.eqStr("a sentence is at its XML line", in2.length > 1 ? `${in2[1].node.line}` : "none", `${want}`)
  t.eqStr(
    "§2.1's sentences",
    xmlRfc8707TestIn(d, "2.1")
      .map((n: XmlNormative): string => n.level)
      .join(" "),
    "MAY MAY",
  )
  // The BCP 14 boilerplate names each keyword in quotes ("MUST"): it defines
  // them, it does not use them.
  t.contains("the boilerplate quotes the keywords", xmlRfc8707TestText(d, "1.1"), '"MUST", "MUST NOT"')
  t.ok("the boilerplate is not normative", xmlRfc8707TestIn(d, "1.1").length === 0)
}

/** RFC 8707, unmodified from rfc-editor.org, read as xml2rfc reads it. */
export const main = (): i32 => {
  const t = new Suite("spec/extract xml rfc8707")
  const text = readFileSyncOrNull(XML_RFC8707_TEST_PATH)
  if (text === null) {
    t.fail("reads", `cannot read ${XML_RFC8707_TEST_PATH}`)
    return t.done()
  }
  const r = xmlDocParse(text)
  if (r.isErr()) {
    t.fail("parses", `${r.error.line}: ${r.error.message}`)
    return t.done()
  }
  xmlRfc8707TestRead(t, text, r.value)
  xmlRfc8707TestNormative(t, text, r.value)
  return t.done()
}
