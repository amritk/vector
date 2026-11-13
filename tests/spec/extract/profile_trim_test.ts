import { Suite } from "nish/testing"
import { profileTrim } from "../../../src/spec/profile/profile"

// profileTrim strips what JavaScript's String.prototype.trim strips: the
// ASCII blanks U+0009 to U+000D and U+0020, and the Unicode spaces U+00A0,
// U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and
// U+FEFF, as UTF-8.

/** `s` trimmed, shown with its edges marked. */
const profileTrimTestShow = (s: string): string => `[${profileTrim(s)}]`

export const main = (): i32 => {
  const t = new Suite("spec/extract profile trim")
  t.eqStr("ASCII blanks", profileTrimTestShow(" \t\n\r\u000b\u000cx \t\n\r\u000b\u000c"), "[x]")
  t.eqStr("NBSP", profileTrimTestShow(" x "), "[x]")
  t.eqStr("ideographic space", profileTrimTestShow("　x　"), "[x]")
  t.eqStr("BOM", profileTrimTestShow("﻿x﻿"), "[x]")
  t.eqStr("ogham space", profileTrimTestShow(" x "), "[x]")
  t.eqStr("en quad and hair space", profileTrimTestShow(" x "), "[x]")
  t.eqStr("line and paragraph separators", profileTrimTestShow(" x "), "[x]")
  t.eqStr("narrow NBSP and medium math space", profileTrimTestShow(" x "), "[x]")
  t.eqStr("mixed, at both ends", profileTrimTestShow("  　﻿\tx y﻿   "), "[x y]")
  t.eqStr("interior spaces are kept", profileTrimTestShow(" a 　b "), "[a 　b]")
  t.eqStr("all spaces trim to empty", profileTrimTestShow(" 　﻿  "), "[]")
  t.eqStr("empty stays empty", profileTrimTestShow(""), "[]")
  t.eqStr("no space is untouched", profileTrimTestShow("abc"), "[abc]")
  t.eqStr("zero width space is not a space", profileTrimTestShow("​x​"), "[​x​]")
  t.eqStr("U+200B's neighbour U+200A is", profileTrimTestShow(" x"), "[x]")
  t.eqStr("NEL is not a space", profileTrimTestShow("\u0085x"), "[\u0085x]")
  t.eqStr("other non-ASCII is kept", profileTrimTestShow("éx¡"), "[éx¡]")
  return t.done()
}
