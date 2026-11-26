/**
 * `spec/gates/signatures` — the functions a contract declares for the module
 * under test are what that module exports. It reads the module's source
 * (`--module`, or `std/<path>.ts` under `--nish-root` for a `nish/<path>`
 * module) and compares each `export const name = (a: T, ...): R =>` with the
 * declaration, mapping the Nish types onto the contract's. Without the source
 * it is skipped with a warning, never passed in silence.
 */

import { splitWhitespace } from "nish/text"
import { CheckContext } from "../check"
import { Contract, FnSig, typesIsWindow } from "../contract/types"
import { vocabBaseTypes, vocabIsWordType } from "../contract/vocab"
import { gateTargets } from "./cite"
import { gateIssue, gateWarn } from "./note"

const GATE_SIGNATURES: string = "signatures"

/** An exported arrow function's signature, as the module's source writes it. */
export class GateModuleSig {
  /** The function's name. */
  name: string
  /** Each parameter's type, whitespace collapsed. */
  params: string[]
  /** The return type, whitespace collapsed. */
  returns: string
  /**
   * Makes a signature.
   *
   * @param name the function's name
   * @param params its parameters' types
   * @param returns its return type
   */
  constructor(name: string, params: string[], returns: string) {
    this.name = name
    this.params = params
    this.returns = returns
  }
}

const gateSigIsSpace = (c: i32): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d

const gateSigIsIdent = (c: i32): boolean =>
  (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f || c === 0x24

/** A type with its whitespace collapsed to single spaces. */
const gateSigType = (t: string): string => splitWhitespace(t).join(" ")

/** The offset after the whitespace at `i`. */
const gateSigSkip = (s: string, i: i32): i32 => {
  let j = i
  while (j >= 0 && j < s.length && gateSigIsSpace(s.charCodeAt(j))) {
    j++
  }
  return j
}

/** The parameters' types between `(` at `open` and its `)`, and the offset after it; -1 when unbalanced. */
const gateSigParams = (s: string, open: i32, types: string[]): i32 => {
  // Each character moves `depth` by one at most, so it stays within s.length
  // of zero: it neither passes s.length nor drops below -s.length.
  // The caller found `(` at open, so it is an offset of s and open + 1 fits.
  if (!(open >= 0 && open < s.length)) {
    return -1
  }
  let depth = 0
  let start = open + 1
  for (let i = open + 1; i >= 0 && i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 0x28 || c === 0x3c || c === 0x5b || c === 0x7b) {
      depth = toI32(toI64(depth) + toI64(1))
    } else if (c === 0x3e && i > 0 && s.charCodeAt(i - 1) === 0x3d) {
      // `=>` inside a function-typed parameter is not a closing `>`.
    } else if (c === 0x3e || c === 0x5d || c === 0x7d) {
      depth = toI32(toI64(depth) - toI64(1))
    } else if (c === 0x29 && depth > 0) {
      depth--
    } else if ((c === 0x2c && depth === 0) || c === 0x29) {
      const p = s.substring(start, i)
      const colon = p.indexOf(":")
      if (colon >= 0 && colon < p.length) {
        types.push(gateSigType(p.substring(colon + 1)))
      }
      start = i + 1
      if (c === 0x29) {
        return i + 1
      }
    }
  }
  return -1
}

/**
 * The exported arrow functions of a Nish module's source:
 * `export const name = (a: T, b: U): R =>`. Generic functions and other
 * exports are left out.
 *
 * @param source the module's source text
 * @returns each signature, in source order
 */
export const gateModuleSignatures = (source: string): GateModuleSig[] => {
  const out: GateModuleSig[] = []
  const key = "export const "
  let at = source.indexOf(key)
  while (at >= 0) {
    // The key is in source at `at`, so the sum is at most source.length.
    let i = toI32(toI64(at) + toI64(key.length))
    const nameStart = i
    while (i >= 0 && i < source.length && gateSigIsIdent(source.charCodeAt(i))) {
      i++
    }
    const name = source.substring(nameStart, i)
    i = gateSigSkip(source, i)
    if (name.length > 0 && i >= 0 && i < source.length && source.charCodeAt(i) === 0x3d) {
      i = gateSigSkip(source, i + 1)
      if (i >= 0 && i < source.length && source.charCodeAt(i) === 0x28) {
        const params: string[] = []
        const end = gateSigParams(source, i, params)
        const j = end < 0 ? -1 : gateSigSkip(source, end)
        if (j >= 0 && j < source.length && source.charCodeAt(j) === 0x3a) {
          const arrow = source.indexOf("=>", j)
          if (arrow > j) {
            out.push(new GateModuleSig(name, params, gateSigType(source.substring(j + 1, arrow))))
          }
        }
      }
    }
    at = source.indexOf(key, nameStart)
  }
  return out
}

/**
 * A Nish type as the contract writes it: `u8[]` is `bytes`, `u16[]`,
 * `u32[]` and `u64[]` are `words16`, `words32` and `words64`, `boolean` is
 * `bool`, `T | null` is `T?`; a type the contract has no name for is `?T`
 * (`bytes` is the contract's word, not Nish's, so it is unknown here).
 *
 * @param t the Nish type, as gateModuleSignatures gives it
 * @returns the contract's type
 */
export const gateNishType = (t: string): string => {
  let base = t
  let opt = ""
  if (t.endsWith(" | null")) {
    base = t.substring(0, t.length - 7)
    opt = "?"
  } else if (t.startsWith("null | ")) {
    base = t.substring(7)
    opt = "?"
  }
  // The contract's own words for these are not Nish types.
  let name = base === "bytes" || base === "bool" || base === "secret-bytes" || vocabIsWordType(base) ? "" : base
  if (base === "u8[]") {
    name = "bytes"
  } else if (base === "Secret<u8[]>") {
    name = "secret-bytes"
  } else if (base === "boolean") {
    name = "bool"
  } else if (base === "u16[]" || base === "u32[]" || base === "u64[]") {
    name = `words${base.substring(1, 3)}`
  }
  return vocabBaseTypes().indexOf(name) >= 0 ? `${name}${opt}` : `?${t}`
}

/** The source file of the module under test: `--module`, else under `--nish-root`. */
const gateModuleFile = (ctx: CheckContext, c: Contract): string | null => {
  const file = ctx.moduleFile
  if (file !== null) {
    return file
  }
  const root = ctx.nishRoot
  const m = c.target.module
  if (root === null || !m.startsWith("nish/")) {
    return null
  }
  return `${root}/std/${m.substring(5)}.ts`
}

/**
 * The signatures gate (see the module comment).
 *
 * @param ctx the check's context, holding the contract
 * @returns each finding
 */
export const gateSignatures = (ctx: CheckContext): string[] => {
  const out: string[] = []
  const g = GATE_SIGNATURES
  const c = ctx.contract
  const file = gateModuleFile(ctx, c)
  if (file === null) {
    gateWarn(ctx, g, g, "no module source: signatures were not checked (pass --module or --nish-root)")
    return out
  }
  const text = readFileSyncOrNull(file)
  if (text === null) {
    gateIssue(ctx, out, g, g, `cannot read ${file}, the source of ${c.target.module}`)
    return out
  }
  const sigs = gateModuleSignatures(text)
  const module = c.target.module
  for (const name of gateTargets(c)) {
    const ri = sigs.findIndex((s: GateModuleSig): boolean => s.name === name)
    if (!(ri >= 0 && ri < sigs.length)) {
      gateIssue(ctx, out, g, name, `${module} does not export ${name}`)
      continue
    }
    const real = sigs[ri]
    const fns = c.functions
    const fi = fns.findIndex((d: FnSig): boolean => d.name === name)
    if (!(fi >= 0 && fi < fns.length)) {
      gateIssue(ctx, out, g, name, `${name} is not a function the contract declares`)
      continue
    }
    const f = fns[fi]
    // A window is one bytes parameter the real function takes as (buf, off, len).
    // An out buffer is an (out, at) pair the real function writes into, returning end.
    const o = f.out
    const types: string[] = []
    const params = f.params
    for (let i: i32 = 0; i < params.length; i++) {
      const p = params[i]
      if (o !== null && o.at === i) {
        types.push("bytes, i32")
      }
      types.push(typesIsWindow(p) ? "bytes, i32, i32" : p.type)
    }
    if (o !== null && o.at === params.length) {
      types.push("bytes, i32")
    }
    const want = `(${types.join(", ")}) -> ${o === null ? f.returns : "i32"}`
    const got = `(${real.params.map((p: string): string => gateNishType(p)).join(", ")}) -> ${gateNishType(real.returns)}`
    if (want !== got) {
      const why = o === null ? "" : ` (its /* out */ is the (bytes, i32) pair at ${o.at}, returning end)`
      gateIssue(
        ctx,
        out,
        g,
        name,
        `declared ${want}${why}, but ${module} has (${real.params.join(", ")}): ${real.returns}`,
      )
    }
  }
  return out
}
