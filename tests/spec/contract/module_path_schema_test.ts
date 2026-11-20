import { JSON_VALUE_OBJECT, JSON_VALUE_STRING } from "nish/json-value"
import { Suite } from "nish/testing"
import { split } from "nish/text"
import { jsonMember, jsonStringMember, newJsonDocument, readJsonFile } from "../../../src/core/json"
import { runProcess } from "../../../src/core/process"
import { charsIsModule } from "../../../src/spec/contract/chars"
import { modulePathsAccepted, modulePathsRefused } from "./module_paths"

/**
 * Matches each line after the first against the first line as an ECMAScript
 * `RegExp`, JSON Schema's pattern semantics, printing `1` or `0` per line.
 */
const MODULE_PATH_SCHEMA_NODE: string = `const [p, ...paths] = require("fs").readFileSync(0, "utf8").split("\\n")
const re = new RegExp(p, "u")
process.stdout.write(paths.map((s) => (re.test(s) ? "1" : "0")).join(""))`

/**
 * The pattern `target.module` names in `schemas/rfc-contract.json`, found by
 * following its `$ref`, so a renamed def fails rather than passing silently.
 */
const modulePathSchemaPattern = (): Result<string, string> => {
  const doc = newJsonDocument()
  const root = readJsonFile(doc, "schemas/rfc-contract.json").orReturn()
  const props = jsonMember(doc, root, "properties", JSON_VALUE_OBJECT).orReturn()
  const target = jsonMember(doc, props, "target", JSON_VALUE_OBJECT).orReturn()
  const targetProps = jsonMember(doc, target, "properties", JSON_VALUE_OBJECT).orReturn()
  const module = jsonMember(doc, targetProps, "module", JSON_VALUE_OBJECT).orReturn()
  const ref = jsonStringMember(doc, module, "$ref").orReturn()
  if (!ref.startsWith("#/")) {
    return Err(`target.module's $ref is not local: ${ref}`)
  }
  let at = root
  for (const key of split(ref.slice(2), "/")) {
    at = jsonMember(doc, at, key, JSON_VALUE_OBJECT).orReturn()
  }
  return Ok(doc.string(jsonMember(doc, at, "pattern", JSON_VALUE_STRING).orReturn()))
}

/**
 * Whether the schema's module pattern matches each of `paths`, evaluated by
 * `node`: JSON Schema patterns are ECMAScript regular expressions, and a
 * translation into another engine would test the translation.
 */
const modulePathSchemaMatches = (pattern: string, paths: string[]): Result<boolean[], string> => {
  const r = runProcess(["node", "-e", MODULE_PATH_SCHEMA_NODE], `${pattern}\n${paths.join("\n")}`, 30000).orReturn()
  if (r.status !== 0 || r.stdout.length !== paths.length) {
    return Err(`node exited ${r.status}: ${r.stdout}${r.stderr}`)
  }
  const out: boolean[] = []
  for (let i = 0; i < paths.length; i++) {
    out.push(r.stdout.charCodeAt(i) === 49)
  }
  return Ok(out)
}

/**
 * The contract schema's `modulePath` pattern, run by `node` as JSON Schema
 * runs it, accepts every path `charsIsModule` accepts and refuses the rest.
 */
export const main = (): i32 => {
  const t = new Suite("spec/contract module path schema pattern")
  const pattern = modulePathSchemaPattern()
  t.eqStr("schema: target.module's pattern is read", pattern.isErr() ? pattern.error : "read", "read")
  const paths: string[] = []
  const want: boolean[] = []
  for (const m of modulePathsAccepted()) {
    paths.push(m)
    want.push(true)
  }
  for (const m of modulePathsRefused()) {
    paths.push(m)
    want.push(false)
  }
  const got = modulePathSchemaMatches(pattern.isErr() ? "" : pattern.value, paths)
  t.eqStr("schema: node matches the pattern", got.isErr() ? got.error : "matched", "matched")
  if (got.isErr()) {
    return t.done()
  }
  for (let i = 0; i < paths.length; i++) {
    const m = paths[i]
    t.eqBool(`schema ${want[i] ? "accepts" : "refuses"} ${m}`, got.value[i], want[i])
    t.eqBool(`schema agrees with charsIsModule on ${m}`, got.value[i], charsIsModule(m))
  }
  return t.done()
}
