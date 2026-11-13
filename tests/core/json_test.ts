import { JSON_VALUE_ARRAY } from "nish/json-value"
import { Suite } from "nish/testing"
import { joinPath, makeTempDir } from "../../src/core/fs"
import {
  jsonBoolMember,
  jsonIntMember,
  jsonMember,
  jsonStringMember,
  newJsonDocument,
  parseJson,
  readJsonFile,
  writeJsonFile,
} from "../../src/core/json"

export const main = (): i32 => {
  const t = new Suite("core/json")
  const doc = newJsonDocument()
  const parsed = parseJson(doc, '{"name":"vector","n":18446744073,"ok":true,"xs":[1,2],"f":1.5}', "inline")
  t.ok("parseJson ok", parsed.isOk())
  const root = parsed.unwrapOr(0)
  t.eqStr("jsonStringMember", jsonStringMember(doc, root, "name").unwrapOr(""), "vector")
  t.ok("jsonIntMember", jsonIntMember(doc, root, "n").unwrapOr(toI64(0)) === 18446744073)
  t.ok("jsonIntMember not an integer", jsonIntMember(doc, root, "f").isErr())
  t.ok("jsonBoolMember", jsonBoolMember(doc, root, "ok").unwrapOr(false))
  t.ok("jsonMember array", jsonMember(doc, root, "xs", JSON_VALUE_ARRAY).isOk())
  const missing = jsonStringMember(doc, root, "absent")
  t.ok("missing member", missing.isErr())
  if (missing.isErr()) {
    t.eqStr("missing message", missing.error, 'missing "absent"')
  }
  const wrong = jsonStringMember(doc, root, "ok")
  if (wrong.isErr()) {
    t.eqStr("wrong kind message", wrong.error, '"ok" must be a string, found a boolean')
  } else {
    t.fail("wrong kind message", "expected an error")
  }
  t.ok(
    "member of a non-object",
    jsonStringMember(doc, jsonMember(doc, root, "xs", JSON_VALUE_ARRAY).unwrapOr(0), "a").isErr(),
  )
  const bad = parseJson(doc, "{", "inline")
  t.ok("parseJson refuses", bad.isErr())

  const dir = makeTempDir("vector-json-").unwrapOr("/tmp")
  const path = joinPath(dir, "out.json")
  const out = newJsonDocument()
  const o = out.newObject()
  out.set(o, "k", out.newString("v"))
  t.ok("writeJsonFile", writeJsonFile(out, o, path).isOk())
  t.eqStr("written text", readFileSync(path), '{"k":"v"}\n')
  const again = readJsonFile(doc, path)
  t.eqStr("readJsonFile", jsonStringMember(doc, again.unwrapOr(0), "k").unwrapOr(""), "v")
  t.ok("readJsonFile missing", readJsonFile(doc, joinPath(dir, "none.json")).isErr())
  spawnSync(["rm", "-rf", dir])
  return t.done()
}
