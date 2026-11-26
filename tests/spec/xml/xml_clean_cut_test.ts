import { Suite } from "nish/testing"
import { XmlNode } from "../../../src/spec/xml/reader"
import { XmlText, xmlPlainText } from "../../../src/spec/xml/text"

// A document the reader accepts is UTF-8, so its text never ends inside a
// sequence; a node built by hand can. These rows drive the collapse's reads
// of a sequence's second and third bytes on both sides of the text's end.

/** The plain text of a character-data node holding `text`. */
const xmlCleanCutTestText = (text: string): string => {
  const n = new XmlNode("", 1, -1, 0, 1)
  n.text = text
  return xmlPlainText(new XmlText(), n)
}

export const main = (): i32 => {
  const t = new Suite("spec/xml clean cut")
  const nbsp = "a "
  const enQuad = "a "
  // A lead byte of two last: no second byte to read, so it is kept as text.
  t.eqStr("a lead byte last", xmlCleanCutTestText(nbsp.substring(0, 2)), nbsp.substring(0, 2))
  // The whole no-break space last: read, and trimmed.
  t.eqStr("a no-break space last", xmlCleanCutTestText(nbsp), "a")
  t.eqStr("a no-break space between", xmlCleanCutTestText("a b"), "a b")
  // Two bytes of three last: no third byte to read, so they are kept as text.
  t.eqStr("two bytes of three last", xmlCleanCutTestText(enQuad.substring(0, 3)), enQuad.substring(0, 3))
  // The whole U+2000 last: read, and trimmed.
  t.eqStr("an en quad last", xmlCleanCutTestText(enQuad), "a")
  t.eqStr("an en quad between", xmlCleanCutTestText("a b"), "a b")
  return t.done()
}
