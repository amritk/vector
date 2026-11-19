/**
 * The capacity of an out buffer: how many bytes a function that writes its
 * result into `(out, at)` may write after `at`. It is a small expression over
 * the function's `bytes` parameters, like `2 * src.length + 8`: decimal
 * numbers, `+`, `*`, parentheses and `<param>.length`.
 */

/** The largest number a capacity may spell: 2^20. */
const CAPACITY_MAX_LITERAL: i32 = 1048576

/**
 * How many tokens a capacity may have, so its tree stays shallow. Tokens, not
 * characters: every spelling of a capacity has as many or more.
 */
const CAPACITY_MAX_TOKENS: i32 = 256

/** How deep a capacity may nest parentheses. */
const CAPACITY_MAX_DEPTH: i32 = 16

/** A number. */
const CAPACITY_NUM: i32 = 0
/** `<param>.length`. */
const CAPACITY_LEN: i32 = 1
/** A sum of two capacities. */
const CAPACITY_ADD: i32 = 2
/** A product of two capacities. */
const CAPACITY_MUL: i32 = 3

/** A parsed capacity expression. */
export class CapacityExpr {
  /** What it is: a number, a length, a sum or a product. */
  kind: i32
  /** The number's digits, or the parameter whose length it is. */
  text: string
  /** The left operand of a sum or product. */
  left: CapacityExpr | null = null
  /** The right operand of a sum or product. */
  right: CapacityExpr | null = null
  /**
   * Makes a leaf.
   *
   * @param kind what the node is
   * @param text the number's digits or the parameter's name
   */
  constructor(kind: i32, text: string) {
    this.kind = kind
    this.text = text
  }
}

/** The tokens of a capacity, and how far the parser has read. */
class CapacityCursor {
  /** The tokens, in order. */
  toks: string[]
  /** The next token's index. */
  pos: i32
  /** How many parentheses are open. */
  depth: i32
  /**
   * Starts at the first token.
   *
   * @param toks the tokens
   */
  constructor(toks: string[]) {
    this.toks = toks
    this.pos = 0
    this.depth = 0
  }
}

const capacityIsDigit = (c: i32): boolean => c >= 48 && c <= 57

const capacityIsIdentStart = (c: i32): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95

/** Splits `text` into numbers, names and one-character punctuation, whitespace separating, stopping once past `max`. */
const capacityLex = (text: string, max: i32): string[] => {
  const out: string[] = []
  let i: i32 = 0
  const n: i32 = toI32(text.length)
  while (i < n && toI32(out.length) <= max) {
    const c: i32 = toI32(text.charCodeAt(i))
    if (c === 32 || c === 9 || c === 10 || c === 13) {
      i += 1
    } else if (capacityIsDigit(c) || capacityIsIdentStart(c)) {
      let j: i32 = i + 1
      while (j < n) {
        const d: i32 = toI32(text.charCodeAt(j))
        if (!(capacityIsDigit(d) || capacityIsIdentStart(d))) {
          break
        }
        j += 1
      }
      out.push(text.slice(i, j))
      i = j
    } else {
      out.push(text.slice(i, i + 1))
      i += 1
    }
  }
  return out
}

const capacityPeek = (c: CapacityCursor): string => (c.pos < c.toks.length ? c.toks[c.pos] : "")

/** Where the parser stopped, as a refusal says it: `stops at <token>` or `stops at the end`. */
const capacityStop = (c: CapacityCursor): string => {
  const t = capacityPeek(c)
  return t.length === 0 ? "stops at the end" : `stops at \`${t}\``
}

const capacityAtom = (c: CapacityCursor): Result<CapacityExpr, string> => {
  const t = capacityPeek(c)
  if (t === "(") {
    if (c.depth >= CAPACITY_MAX_DEPTH) {
      return Err(`nests parentheses deeper than ${CAPACITY_MAX_DEPTH}`)
    }
    c.pos += 1
    c.depth += 1
    const e = capacitySum(c).orReturn()
    if (capacityPeek(c) !== ")") {
      return Err(capacityStop(c))
    }
    c.pos += 1
    c.depth -= 1
    return Ok(e)
  }
  if (t.length === 0) {
    return Err(capacityStop(c))
  }
  const first: i32 = toI32(t.charCodeAt(0))
  if (capacityIsDigit(first)) {
    for (let i: i32 = 0; i < toI32(t.length); i++) {
      if (!capacityIsDigit(toI32(t.charCodeAt(i)))) {
        return Err(capacityStop(c))
      }
    }
    if ((t.length > 1 && first === 48) || t.length > 7) {
      return Err(capacityStop(c))
    }
    let v: i32 = 0
    for (let i: i32 = 0; i < toI32(t.length); i++) {
      v = v * 10 + toI32(t.charCodeAt(i)) - 48
    }
    if (v > CAPACITY_MAX_LITERAL) {
      return Err(capacityStop(c))
    }
    c.pos += 1
    return Ok(new CapacityExpr(CAPACITY_NUM, t))
  }
  if (!capacityIsIdentStart(first)) {
    return Err(capacityStop(c))
  }
  c.pos += 1
  if (capacityPeek(c) !== ".") {
    return Err(capacityStop(c))
  }
  c.pos += 1
  if (capacityPeek(c) !== "length") {
    return Err(capacityStop(c))
  }
  c.pos += 1
  return Ok(new CapacityExpr(CAPACITY_LEN, t))
}

const capacityProduct = (c: CapacityCursor): Result<CapacityExpr, string> => {
  let e = capacityAtom(c).orReturn()
  while (capacityPeek(c) === "*") {
    c.pos += 1
    const r = capacityAtom(c).orReturn()
    const m = new CapacityExpr(CAPACITY_MUL, "")
    m.left = e
    m.right = r
    e = m
  }
  return Ok(e)
}

const capacitySum = (c: CapacityCursor): Result<CapacityExpr, string> => {
  let e = capacityProduct(c).orReturn()
  while (capacityPeek(c) === "+") {
    c.pos += 1
    const r = capacityProduct(c).orReturn()
    const a = new CapacityExpr(CAPACITY_ADD, "")
    a.left = e
    a.right = r
    e = a
  }
  return Ok(e)
}

/** What `e` is with every length 0, in f64 so no product overflows. */
const capacityFloor = (e: CapacityExpr): f64 => {
  const l = e.left
  const r = e.right
  if (e.kind === CAPACITY_NUM) {
    return capacityDigits(e.text)
  }
  if (e.kind === CAPACITY_LEN || l === null || r === null) {
    return 0.0
  }
  if (e.kind === CAPACITY_ADD) {
    return capacityFloor(l) + capacityFloor(r)
  }
  return capacityFloor(l) * capacityFloor(r)
}

const capacityDigits = (t: string): f64 => {
  let v: f64 = 0.0
  for (let i: i32 = 0; i < toI32(t.length); i++) {
    v = v * 10.0 + toF64(toI32(t.charCodeAt(i)) - 48)
  }
  return v
}

/**
 * Parses a capacity of at most 256 tokens: decimal numbers up to 2^20
 * with no leading zero, `+`, `*`, parentheses nested at most 16 deep and
 * `<param>.length`, `*` binding tighter than `+`. A capacity not at most 2^20
 * with every length 0 is refused: no input could give it a buffer the test
 * can allocate.
 *
 * @param text the capacity as written
 * @returns the expression, or why not: `has more than 256 tokens (…)`,
 *   `stops at <token>` (`` `-` ``, or `the end`), `nests parentheses deeper
 *   than 16`, `multiplies 0 by a product past what an f64 holds`, or `is
 *   over 1048576 (2^20) even with every length 0`
 */
export const capacityParse = (text: string): Result<CapacityExpr, string> => {
  const toks = capacityLex(text, CAPACITY_MAX_TOKENS)
  if (toI32(toks.length) > CAPACITY_MAX_TOKENS) {
    return Err(`has more than ${CAPACITY_MAX_TOKENS} tokens (numbers, names and punctuation)`)
  }
  const c = new CapacityCursor(toks)
  const e = capacitySum(c).orReturn()
  if (c.pos < c.toks.length) {
    return Err(capacityStop(c))
  }
  const floor = capacityFloor(e)
  // Infinity times a 0 is NaN, which no comparison holds for, so a NaN floor is refused by name.
  if (!(floor <= toF64(CAPACITY_MAX_LITERAL)) && !(floor > toF64(CAPACITY_MAX_LITERAL))) {
    return Err("multiplies 0 by a product past what an f64 holds")
  }
  if (!(floor <= toF64(CAPACITY_MAX_LITERAL))) {
    return Err(`is over ${CAPACITY_MAX_LITERAL} (2^20) even with every length 0`)
  }
  return Ok(e)
}

const capacityShowIn = (e: CapacityExpr, len: (name: string) => string, num: (text: string) => string): string => {
  const l = e.left
  const r = e.right
  if (e.kind === CAPACITY_NUM) {
    return num(e.text)
  }
  if (e.kind === CAPACITY_LEN || l === null || r === null) {
    return len(e.text)
  }
  if (e.kind === CAPACITY_ADD) {
    return `${capacityShowIn(l, len, num)} + ${capacityShowIn(r, len, num)}`
  }
  const ls = l.kind === CAPACITY_ADD ? `(${capacityShowIn(l, len, num)})` : capacityShowIn(l, len, num)
  const rs =
    r.kind === CAPACITY_ADD || r.kind === CAPACITY_MUL
      ? `(${capacityShowIn(r, len, num)})`
      : capacityShowIn(r, len, num)
  return `${ls} * ${rs}`
}

/**
 * A capacity in its one spelling: single spaces around `+` and `*`, and
 * parentheses only where they change what it means.
 *
 * @param e the expression
 * @returns the text the contract records
 */
export const capacityShow = (e: CapacityExpr): string =>
  capacityShowIn(
    e,
    (name: string): string => `${name}.length`,
    (text: string): string => text,
  )

/**
 * A capacity as a Nish f64 expression, each `<param>.length` read from
 * `<prefix><param>`. It is f64 so a long sample cannot overflow it: the test
 * compares it with 2^20 before it allocates.
 *
 * @param e the expression
 * @param prefix what the generated test names a parameter's local with
 * @returns the Nish expression
 */
export const capacityNish = (e: CapacityExpr, prefix: string): string =>
  capacityShowIn(
    e,
    (name: string): string => `toF64(${prefix}${name}.length)`,
    (text: string): string => `toF64(${text})`,
  )

const capacityNamesIn = (e: CapacityExpr, out: string[]): void => {
  if (e.kind === CAPACITY_LEN) {
    if (out.indexOf(e.text) < 0) {
      out.push(e.text)
    }
    return
  }
  const l = e.left
  const r = e.right
  if (l !== null) {
    capacityNamesIn(l, out)
  }
  if (r !== null) {
    capacityNamesIn(r, out)
  }
}

/**
 * The parameters whose length a capacity reads, each once, in the order they
 * first appear.
 *
 * @param e the expression
 * @returns the parameter names
 */
export const capacityNames = (e: CapacityExpr): string[] => {
  const out: string[] = []
  capacityNamesIn(e, out)
  return out
}
