/**
 * `verify/emit/outjson` — a small JSON tree for vector's `--json` output,
 * rendered the way `JSON.stringify(v, null, 2)` renders it: two-space
 * indentation, keys in insertion order, `[]` and `{}` for empty containers.
 */

const OUT_STRING: i32 = 1
const OUT_RAW: i32 = 2
const OUT_ARRAY: i32 = 3
const OUT_OBJECT: i32 = 4

/** One JSON value: a string, a literal (number, boolean, null), an array or an object. */
export class OutJson {
  /** What it is. */
  kind: i32
  /** A string's text, or a literal's source. */
  text: string
  /** An object's keys, in order. */
  keys: string[]
  /** An array's items, or an object's values at the same index as `keys`. */
  kids: OutJson[]

  /**
   * Makes a value; `outJsonString` and the others are the usual way.
   *
   * @param kind what it is
   * @param text its text
   */
  constructor(kind: i32, text: string) {
    this.kind = kind
    this.text = text
    this.keys = []
    this.kids = []
  }

  /**
   * Adds a member to an object.
   *
   * @param key the member's name
   * @param v its value
   * @returns this object, to chain
   */
  put(key: string, v: OutJson): OutJson {
    this.keys.push(key)
    this.kids.push(v)
    return this
  }

  /**
   * Adds an item to an array.
   *
   * @param v the item
   * @returns this array, to chain
   */
  add(v: OutJson): OutJson {
    this.kids.push(v)
    return this
  }
}

/**
 * A JSON string.
 *
 * @param s its text
 * @returns the value
 */
export const outJsonString = (s: string): OutJson => new OutJson(OUT_STRING, s)

/**
 * A JSON boolean.
 *
 * @param b the boolean
 * @returns the value
 */
export const outJsonBool = (b: boolean): OutJson => new OutJson(OUT_RAW, b ? "true" : "false")

/**
 * A JSON integer.
 *
 * @param n the integer
 * @returns the value
 */
export const outJsonInt = (n: i32): OutJson => new OutJson(OUT_RAW, `${n}`)

/**
 * An empty JSON array, to `add` to.
 *
 * @returns the array
 */
export const outJsonArray = (): OutJson => new OutJson(OUT_ARRAY, "")

/**
 * An empty JSON object, to `put` into.
 *
 * @returns the object
 */
export const outJsonObject = (): OutJson => new OutJson(OUT_OBJECT, "")

/**
 * A JSON array of strings.
 *
 * @param items the strings
 * @returns the array
 */
export const outJsonStrings = (items: string[]): OutJson => {
  const out = outJsonArray()
  for (const s of items) {
    out.add(outJsonString(s))
  }
  return out
}

const OUT_HEX: string = "0123456789abcdef"

/**
 * Quotes a string as JSON does: `"` and `\` escaped, control characters as
 * `\n`-style escapes or `\u00XX`, everything else as is.
 *
 * @param s the text
 * @returns the quoted text
 */
export const outJsonQuote = (s: string): string => {
  let out = '"'
  let start = 0
  const n = toI32(s.length)
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i)
    let esc = ""
    if (c === 34) {
      esc = '\\"'
    } else if (c === 92) {
      esc = "\\\\"
    } else if (c === 10) {
      esc = "\\n"
    } else if (c === 13) {
      esc = "\\r"
    } else if (c === 9) {
      esc = "\\t"
    } else if (c === 8) {
      esc = "\\b"
    } else if (c === 12) {
      esc = "\\f"
    } else if (c < 32) {
      esc = `\\u00${OUT_HEX.slice(c >> 4, (c >> 4) + 1)}${OUT_HEX.slice(c & 15, (c & 15) + 1)}`
    }
    if (esc !== "") {
      out = out + s.slice(start, i) + esc
      start = i + 1
    }
  }
  return `${out}${s.slice(start, n)}"`
}

const outJsonIndent = (depth: i32): string => {
  let out = ""
  for (let i = 0; i < depth; i++) {
    out = `${out}  `
  }
  return out
}

const outJsonWrite = (v: OutJson, depth: i32, parts: string[]): void => {
  if (v.kind === OUT_STRING) {
    parts.push(outJsonQuote(v.text))
    return
  }
  if (v.kind === OUT_RAW) {
    parts.push(v.text)
    return
  }
  const isObject = v.kind === OUT_OBJECT
  if (v.kids.length === 0) {
    parts.push(isObject ? "{}" : "[]")
    return
  }
  const inner = outJsonIndent(depth + 1)
  parts.push(isObject ? "{\n" : "[\n")
  for (let i = 0; i < toI32(v.kids.length); i++) {
    parts.push(inner)
    if (isObject) {
      parts.push(`${outJsonQuote(v.keys[i])}: `)
    }
    outJsonWrite(v.kids[i], depth + 1, parts)
    parts.push(i + 1 < toI32(v.kids.length) ? ",\n" : "\n")
  }
  parts.push(outJsonIndent(depth))
  parts.push(isObject ? "}" : "]")
}

/**
 * Renders a value as `JSON.stringify(v, null, 2)` would.
 *
 * @param v the value
 * @returns the text, without a final newline
 */
export const outJsonRender = (v: OutJson): string => {
  const parts: string[] = []
  outJsonWrite(v, 0, parts)
  return parts.join("")
}
