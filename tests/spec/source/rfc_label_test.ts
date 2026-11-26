import { Suite } from "nish/testing"
import {
  HexValue,
  RfcSection,
  rfcHexValues,
  rfcParse,
  rfcSection,
  rfcUnvaluedLabels,
} from "../../../src/spec/source/rfc"

/** Section 1 of a one-section RFC whose body is `body`, three-space indented; empty when it is missing. */
const rfcLabelSection = (body: string): RfcSection => {
  const sec = rfcSection(rfcParse(`Request for Comments: 1\n\f\n1.  Intro\n\n   ${body}\n`), "1")
  return sec === null ? new RfcSection("1", "missing", [], []) : sec
}

/** The values `body` prints, as `label=hex`, space-separated. */
const rfcLabelValues = (body: string): string =>
  rfcHexValues(rfcLabelSection(body))
    .map((v: HexValue): string => `${v.label ?? "-"}=${v.hex}`)
    .join(" ")

/** The labels `body` prints with no value below them, joined by `|`. */
const rfcLabelUnvalued = (body: string): string => rfcUnvaluedLabels(rfcLabelSection(body)).join("|")

/** Runs the suite. */
export const main = (): i32 => {
  const t = new Suite("spec/source rfc labels")
  // A name ends in no sentence punctuation; inside it, punctuation is fine.
  t.eqStr("a bare name labels the value below it", rfcLabelValues("The Key\n   0101"), "The Key=0101")
  t.eqStr("a name ending in . is a sentence", rfcLabelValues("The Key.\n   0101"), "")
  t.eqStr("a name ending in ? is a sentence", rfcLabelValues("The Key?\n   0101"), "")
  t.eqStr("a . inside a name is kept", rfcLabelValues("Key. Value\n   0101"), "Key. Value=0101")
  t.eqStr("an unvalued bare name is listed", rfcLabelUnvalued("Plain Name"), "Plain Name")
  t.eqStr("an unvalued sentence is not", rfcLabelUnvalued("Plain Name."), "")
  // A hexdump line whose last byte is cut short is not a dump.
  t.eqStr("a whole dump line is read", rfcLabelValues("Data:\n   0000  65 6d"), "Data=656d")
  t.eqStr("a dump line ending in half a byte is not", rfcLabelValues("Data:\n   0000  65 6"), "")
  // A 0x value may end the line.
  t.eqStr("a one-digit 0x value at the end of a line", rfcLabelValues("Flag = 0xa"), "Flag=a")
  t.eqStr("a two-digit 0x value at the end of a line", rfcLabelValues("Flag = 0xab"), "Flag=ab")
  // A colon run's groups are one or two digits.
  t.eqStr("two-digit groups make a colon run", rfcLabelValues("Id: ab:cd:ef"), "Id=abcdef")
  t.eqStr("a three-digit group is no colon run", rfcLabelValues("Id: abc:de:f0"), "")
  return t.done()
}
