/**
 * `core/json` — reading and writing JSON through `nish/json-value`: parse a
 * file into a document, read typed members with a clear error when one is
 * missing or of the wrong kind, and write a document back with a final newline.
 */

import { JsonLimits } from "nish/json-tokenizer"
import {
  JSON_VALUE_ARRAY,
  JSON_VALUE_BOOLEAN,
  JSON_VALUE_NUMBER,
  JSON_VALUE_OBJECT,
  JSON_VALUE_STRING,
  JsonDocument,
  JsonValue,
} from "nish/json-value"

/**
 * Makes an empty document with the default limits.
 *
 * @returns a document to parse into or build in
 */
export const newJsonDocument = (): JsonDocument => new JsonDocument(new JsonLimits())

/**
 * Parses JSON text into `doc`.
 *
 * @param doc the document to parse into; its earlier values are forgotten
 * @param text the JSON text
 * @param source where the text came from, for the error message
 * @returns `Ok` with the root value, or `Err` naming the byte offset of the problem
 */
export const parseJson = (doc: JsonDocument, text: string, source: string): Result<JsonValue, string> => {
  const root = doc.parseText(text)
  if (root < 0) {
    return Err(`${source}: invalid JSON at byte ${doc.errorAt} (code ${root})`)
  }
  return Ok(root)
}

/**
 * Reads a file and parses it as JSON into `doc`.
 *
 * @param doc the document to parse into
 * @param path the file to read
 * @returns `Ok` with the root value, or `Err` when the file cannot be read or is not JSON
 */
export const readJsonFile = (doc: JsonDocument, path: string): Result<JsonValue, string> => {
  const text = readFileSyncOrNull(path)
  if (text === null) {
    return Err(`${path}: cannot read file`)
  }
  return parseJson(doc, text, path)
}

/**
 * Writes a value to a file as JSON text with a final newline.
 *
 * @param doc the document the value belongs to
 * @param v the value to write
 * @param path the file to write
 * @returns `Ok(true)`, or `Err` when the file cannot be written
 */
export const writeJsonFile = (doc: JsonDocument, v: JsonValue, path: string): Result<boolean, string> => {
  const text = `${doc.stringify(v)}\n`
  const written = writeFileSyncMode(path, text, 0o644)
  if (written < 0) {
    return Err(`${path}: cannot write file (errno ${-toI64(written)})`)
  }
  return Ok(true)
}

const jsonKindName = (kind: i32): string => {
  if (kind === JSON_VALUE_STRING) {
    return "a string"
  }
  if (kind === JSON_VALUE_NUMBER) {
    return "a number"
  }
  if (kind === JSON_VALUE_BOOLEAN) {
    return "a boolean"
  }
  if (kind === JSON_VALUE_ARRAY) {
    return "an array"
  }
  if (kind === JSON_VALUE_OBJECT) {
    return "an object"
  }
  return "null"
}

/**
 * Reads member `key` of object `o`, which must be of kind `kind`.
 *
 * @param doc the document `o` belongs to
 * @param o an object value
 * @param key the member's name
 * @param kind the `JSON_VALUE_*` kind the member must have
 * @returns `Ok` with the member, or `Err` when it is missing or of another kind
 */
export const jsonMember = (doc: JsonDocument, o: JsonValue, key: string, kind: i32): Result<JsonValue, string> => {
  if (doc.kind(o) !== JSON_VALUE_OBJECT) {
    return Err(`expected an object holding "${key}", found ${jsonKindName(doc.kind(o))}`)
  }
  const v = doc.get(o, key)
  if (doc.kind(v) === 0) {
    return Err(`missing "${key}"`)
  }
  if (doc.kind(v) !== kind) {
    return Err(`"${key}" must be ${jsonKindName(kind)}, found ${jsonKindName(doc.kind(v))}`)
  }
  return Ok(v)
}

/**
 * Reads string member `key` of object `o`.
 *
 * @param doc the document `o` belongs to
 * @param o an object value
 * @param key the member's name
 * @returns `Ok` with the string, or `Err` when it is missing or not a string
 */
export const jsonStringMember = (doc: JsonDocument, o: JsonValue, key: string): Result<string, string> => {
  const v = jsonMember(doc, o, key, JSON_VALUE_STRING).orReturn()
  return Ok(doc.string(v))
}

/**
 * Reads integer member `key` of object `o`, which must fit an `i64`.
 *
 * @param doc the document `o` belongs to
 * @param o an object value
 * @param key the member's name
 * @returns `Ok` with the integer, or `Err` when it is missing, not a number or not an integer
 */
export const jsonIntMember = (doc: JsonDocument, o: JsonValue, key: string): Result<i64, string> => {
  const v = jsonMember(doc, o, key, JSON_VALUE_NUMBER).orReturn()
  if (!doc.isI64(v)) {
    return Err(`"${key}" must be an integer, found ${doc.numberText(v)}`)
  }
  return Ok(doc.i64(v))
}

/**
 * Reads boolean member `key` of object `o`.
 *
 * @param doc the document `o` belongs to
 * @param o an object value
 * @param key the member's name
 * @returns `Ok` with the boolean, or `Err` when it is missing or not a boolean
 */
export const jsonBoolMember = (doc: JsonDocument, o: JsonValue, key: string): Result<boolean, string> => {
  const v = jsonMember(doc, o, key, JSON_VALUE_BOOLEAN).orReturn()
  return Ok(doc.boolean(v))
}
