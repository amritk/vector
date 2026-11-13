import { Suite } from "nish/testing"
import { XmlDocument, xmlDocParse } from "../../../src/spec/xml/doc"
import { XmlNode, xmlParse } from "../../../src/spec/xml/reader"

/** A spec whose DOCTYPE holds `subset` on line 3, and whose section 1 reads `a`, `use`, `b`. */
const xmlDoctypeTestWith = (subset: string, use: string): string =>
  `<?xml version="1.0"?>\n<!DOCTYPE rfc [\n${subset}\n]>\n<rfc><middle><section><t>a${use}b</t></section></middle></rfc>`

/** A refusal as `spec.xml:line: message`, as the old reader named it; `ok` when the document reads. */
const xmlDoctypeTestRefused = (text: string): string => {
  const r = xmlDocParse(text)
  if (r.isOk()) {
    return "ok"
  }
  return `spec.xml:${r.error.line}: ${r.error.message}`
}

/** The document, or null after failing the test. */
const xmlDoctypeTestParse = (t: Suite, name: string, text: string): XmlDocument | null => {
  const r = xmlDocParse(text)
  if (r.isErr()) {
    t.fail(name, `${r.error.line}: ${r.error.message}`)
    return null
  }
  return r.value
}

/** The lines of section 1, or a note that there is none. */
const xmlDoctypeTestOne = (d: XmlDocument | null): string => {
  if (d === null) {
    return "<refused>"
  }
  for (const s of d.sections) {
    if (s.id === "1") {
      return s.lines.join(" / ")
    }
  }
  return "<no section 1>"
}

/** xml2rfc's and kramdown-rfc's numeric entities are accepted; an empty DOCTYPE is too. */
const xmlDoctypeTestAccepted = (t: Suite): void => {
  const d = xmlDoctypeTestParse(
    t,
    "numeric entities",
    xmlDoctypeTestWith(
      `<!ENTITY nbsp "&#160;">\n<!ENTITY zwsp '&#8203;'>\n<!ENTITY nbhy "&#8209;">\n<!ENTITY wj "&#x2060;">\n<!ENTITY nbsp "&#65;">\n<!ENTITY amp "&#65;">`,
      "&nbsp;&zwsp;&nbhy;&wj;&amp;",
    ),
  )
  // The first declaration of an entity binds; `&amp;` stays the predefined one.
  t.eqStr("xml2rfc's and kramdown-rfc's numeric entities are accepted", xmlDoctypeTestOne(d), "a -&b")
  const bare = xmlDoctypeTestParse(t, "<!DOCTYPE rfc>", "<!DOCTYPE rfc>\n<rfc/>")
  t.ok("a DOCTYPE with no subset", bare !== null && bare.sections.length === 0)
  const empty = xmlDoctypeTestParse(t, "<!DOCTYPE rfc [ ] >", "<!DOCTYPE rfc [ ] >\n<rfc/>")
  t.ok("a DOCTYPE with an empty subset", empty !== null && empty.sections.length === 0)
}

/** External and parameter entities, and SYSTEM or PUBLIC ids, are refused: vector never fetches. */
const xmlDoctypeTestFetches = (t: Suite): void => {
  t.eqStr(
    "an external entity is refused: SYSTEM",
    xmlDoctypeTestRefused(
      xmlDoctypeTestWith(
        '<!ENTITY RFC2119 SYSTEM "https://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml">',
        "&nbsp;",
      ),
    ),
    "spec.xml:3: external entity &RFC2119; is refused: vector never fetches",
  )
  t.eqStr(
    "an external entity is refused: PUBLIC",
    xmlDoctypeTestRefused(xmlDoctypeTestWith('<!ENTITY x PUBLIC "-//x" "y">', "&nbsp;")),
    "spec.xml:3: external entity &x; is refused: vector never fetches",
  )
  t.eqStr(
    "a parameter entity is refused",
    xmlDoctypeTestRefused(xmlDoctypeTestWith('<!ENTITY % p "&#160;">', "&nbsp;")),
    "spec.xml:3: a parameter entity (<!ENTITY %) is refused",
  )
  t.eqStr(
    "a SYSTEM id is refused",
    xmlDoctypeTestRefused('<!DOCTYPE rfc SYSTEM "rfc2629.dtd">\n<rfc/>'),
    "spec.xml:1: a DOCTYPE with a SYSTEM or PUBLIC identifier is refused: vector never fetches",
  )
  t.contains(
    "a PUBLIC id is refused",
    xmlDoctypeTestRefused('<!DOCTYPE rfc PUBLIC "x" "y">\n<rfc/>'),
    "SYSTEM or PUBLIC",
  )
}

/** Any declaration but a numeric general entity is refused, and so is an entity that is not one. */
const xmlDoctypeTestDeclarations = (t: Suite): void => {
  for (const decl of ["<!ELEMENT rfc ANY>", "<!ATTLIST rfc a CDATA #IMPLIED>", "%p;", "<?pi?>"]) {
    t.eqStr(
      `any other declaration is refused: ${decl}`,
      xmlDoctypeTestRefused(xmlDoctypeTestWith(decl, "&nbsp;")),
      'spec.xml:3: the DOCTYPE may declare only general entities with a numeric value, such as <!ENTITY nbsp "&#160;">; other markup is refused',
    )
  }
  for (const v of ['"text"', '"&#160;&#160;"', '"&amp;"', '"&#160"']) {
    t.eqStr(
      `an entity whose value is not one character reference is refused: ${v}`,
      xmlDoctypeTestRefused(xmlDoctypeTestWith(`<!ENTITY e ${v}>`, "&e;")),
      'spec.xml:3: entity &e; must be a single numeric character reference such as "&#160;"',
    )
  }
  t.eqStr(
    "an entity naming no XML character is refused",
    xmlDoctypeTestRefused(xmlDoctypeTestWith('<!ENTITY e "&#0;">', "&e;")),
    "spec.xml:3: character reference &#0; names no XML character",
  )
  t.eqStr(
    "an undefined entity reference is refused, in text",
    xmlDoctypeTestRefused(xmlDoctypeTestWith("", "&RFC2119;")),
    "spec.xml:5: undefined entity &RFC2119;",
  )
  t.eqStr(
    "an undefined entity reference is refused, in an attribute",
    xmlDoctypeTestRefused('<rfc a="&x;"/>'),
    "spec.xml:1: undefined entity &x;",
  )
}

/** A malformed DOCTYPE is refused, each way it can be, at its line. */
const xmlDoctypeTestMalformed = (t: Suite): void => {
  t.eqStr(
    "a malformed DOCTYPE: unterminated",
    xmlDoctypeTestRefused("<!DOCTYPE rfc ["),
    "spec.xml:1: malformed XML: unterminated DOCTYPE",
  )
  t.eqStr(
    "a malformed DOCTYPE: an <!ENTITY with more after its value",
    xmlDoctypeTestRefused('<!DOCTYPE rfc [ <!ENTITY e "&#160;" x> ]><rfc/>'),
    'spec.xml:1: malformed XML: expected ">" to end <!ENTITY',
  )
  t.eqStr(
    "a malformed DOCTYPE: an <!ENTITY whose value is not quoted",
    xmlDoctypeTestRefused("<!DOCTYPE rfc [ <!ENTITY e &#160;> ]><rfc/>"),
    "spec.xml:1: malformed XML: expected a quoted value in <!ENTITY",
  )
  t.eqStr(
    "a malformed DOCTYPE: an <!ENTITY whose value is not closed",
    xmlDoctypeTestRefused('<!DOCTYPE rfc [ <!ENTITY e "&#160;> ]><rfc/>'),
    "spec.xml:1: malformed XML: unterminated value in <!ENTITY",
  )
  t.eqStr(
    "a malformed DOCTYPE: more after the subset",
    xmlDoctypeTestRefused("<!DOCTYPE rfc [] x><rfc/>"),
    'spec.xml:1: malformed XML: expected ">" to end the DOCTYPE',
  )
  t.eqStr(
    "a malformed DOCTYPE: no name",
    xmlDoctypeTestRefused("<!DOCTYPE>"),
    "spec.xml:1: malformed XML: expected a name in the DOCTYPE",
  )
  t.eqStr(
    "a malformed DOCTYPE: a second one",
    xmlDoctypeTestRefused("<!DOCTYPE rfc>\n<!DOCTYPE rfc>\n<rfc/>"),
    "spec.xml:2: malformed XML: a DOCTYPE comes once, before the root element",
  )
  t.contains(
    "a malformed DOCTYPE: one after the root",
    xmlDoctypeTestRefused("<rfc/>\n<!DOCTYPE rfc>"),
    "a DOCTYPE comes once",
  )
}

/** An include with an href is refused; one without is inert. */
const xmlDoctypeTestInclude = (t: Suite): void => {
  t.eqStr(
    "xi:include with an href is refused",
    xmlDoctypeTestRefused(
      '<rfc xmlns:xi="http://www.w3.org/2001/XInclude"><back><references>\n<xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml"/></references></back></rfc>',
    ),
    'spec.xml:2: <xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml"> is refused: vector never fetches; expand it first (xml2rfc --expand)',
  )
  t.contains(
    "any prefix's include with an href is refused",
    xmlDoctypeTestRefused('<rfc><x:include href="a">x</x:include></rfc>'),
    '<x:include href="a">',
  )
  t.contains(
    "an unprefixed include with an href is refused",
    xmlDoctypeTestRefused('<rfc><include href="a"/></rfc>'),
    '<include href="a">',
  )
  const r = xmlParse('<rfc><xi:include href=""/><xi:include/><includes href="x"/></rfc>')
  if (r.isErr()) {
    t.fail("xi:include without an href is inert", r.error.message)
    return
  }
  let n = 0
  let k: XmlNode | null = r.value.first
  while (k !== null) {
    n = n + 1
    k = k.next
  }
  t.ok("xi:include without an href is inert", n === 3)
}

/** The DOCTYPE vector reads (numeric entities only) and xi:include, each refusal at its line. */
export const main = (): i32 => {
  const t = new Suite("spec/extract xml doctype")
  xmlDoctypeTestAccepted(t)
  xmlDoctypeTestFetches(t)
  xmlDoctypeTestDeclarations(t)
  xmlDoctypeTestMalformed(t)
  xmlDoctypeTestInclude(t)
  return t.done()
}
