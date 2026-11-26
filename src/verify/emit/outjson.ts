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

// One lowercase hex digit, for `n` from 0 to 15.
const outJsonHexDigit = (n: i32): string => {
  if (n < 10) {
    return `${n}`
  }
  if (n === 10) {
    return "a"
  }
  if (n === 11) {
    return "b"
  }
  if (n === 12) {
    return "c"
  }
  if (n === 13) {
    return "d"
  }
  return n === 14 ? "e" : "f"
}

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
      esc = `\\u00${outJsonHexDigit(c >> 4)}${outJsonHexDigit(c & 15)}`
    }
    if (esc !== "") {
      // `start` is a previous `i + 1`, so `start <= i`: the guard always holds.
      if (start >= 0 && start <= i) {
        out = out + s.slice(start, i) + esc
      }
      start = i + 1
    }
  }
  // `start` is at most the last `i + 1`, so at most `n`.
  if (start >= 0 && start <= n) {
    out = out + s.slice(start, n)
  }
  return `${out}"`
}

// Writes `v` at the indentation `indent`, two spaces per level.
const outJsonWrite = (v: OutJson, indent: string, parts: string[]): void => {
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
  const inner = `${indent}  `
  parts.push(isObject ? "{\n" : "[\n")
  for (let i = 0; i < toI32(v.kids.length); i++) {
    const kid = v.kids[i]
    if (i > 0) {
      parts.push(",\n")
    }
    parts.push(inner)
    // Unreachable: an object's value without a key comes only from `add` on
    // an object, which no caller does. It is written bare, so the text is not
    // JSON and every reader refuses it: loud, with no made-up key.
    if (isObject && i < toI32(v.keys.length)) {
      parts.push(`${outJsonQuote(v.keys[i])}: `)
    }
    outJsonWrite(kid, inner, parts)
  }
  parts.push("\n")
  parts.push(indent)
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
  outJsonWrite(v, "", parts)
  return parts.join("")
}
