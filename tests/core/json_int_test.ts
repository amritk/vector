import { Suite } from "nish/testing"
import { jsonIntMember, newJsonDocument, parseJson } from "../../src/core/json"

// jsonIntMember on each side of the i64 range and on each spelling isI64 refuses.
class JsonIntRow {
  text: string
  ok: boolean
  want: string

  constructor(text: string, ok: boolean, want: string) {
    this.text = text
    this.ok = ok
    this.want = want
  }
}

export const main = (): i32 => {
  const t = new Suite("core/json int")
  const rows: JsonIntRow[] = [
    new JsonIntRow("9223372036854775807", true, "9223372036854775807"),
    new JsonIntRow("9223372036854775808", false, ""),
    new JsonIntRow("9223372036854775806", true, "9223372036854775806"),
    new JsonIntRow("-9223372036854775808", true, "-9223372036854775808"),
    new JsonIntRow("-9223372036854775809", false, ""),
    new JsonIntRow("-9223372036854775807", true, "-9223372036854775807"),
    new JsonIntRow("-0", true, "0"),
    new JsonIntRow("0", true, "0"),
    new JsonIntRow("-12", true, "-12"),
    new JsonIntRow("1000000000000000000", true, "1000000000000000000"),
    new JsonIntRow("9999999999999999999", false, ""),
    new JsonIntRow("92233720368547758070", false, ""),
    new JsonIntRow("1.5", false, ""),
    new JsonIntRow("1.0", false, ""),
    new JsonIntRow("1e2", false, ""),
    new JsonIntRow("1E2", false, ""),
    new JsonIntRow("-1e2", false, ""),
  ]
  for (const row of rows) {
    const doc = newJsonDocument()
    const root = parseJson(doc, `{"n":${row.text}}`, "inline")
    t.ok(`parse ${row.text}`, root.isOk())
    const got = jsonIntMember(doc, root.unwrapOr(0), "n")
    if (row.ok) {
      t.eqStr(`${row.text} reads`, got.isOk() ? `${got.unwrapOr(toI64(1))}` : "an error", row.want)
    } else if (got.isErr()) {
      t.eqStr(`${row.text} refused`, got.error, `"n" must be an integer, found ${row.text}`)
    } else {
      t.fail(`${row.text} refused`, "expected an error")
    }
  }
  return t.done()
}
