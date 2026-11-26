/**
 * `lang/names` — how each language names a contract's functions, parameters
 * and modules. Every name rule starts from one word split, so the rules agree
 * on where words break:
 *
 *   - a lowercase letter followed by a capital starts a new word
 *     (`hkdfExpand` → hkdf, Expand);
 *   - a run of capitals is one word, an acronym, and its last capital starts
 *     the next word when a lowercase letter follows it
 *     (`parseHTTPRequest` → parse, HTTP, Request);
 *   - a run of digits belongs to the word before it
 *     (`chacha20Poly1305Seal` → chacha20, Poly1305, Seal), and starts a word
 *     only at the start of a name or of a part after `_`;
 *   - `_` separates words and is dropped, as is any other character.
 *
 * A module path segment may join words with `-` (`quic-packet`). A form that
 * stays a path or a file keeps it; a segment that becomes an identifier turns
 * it into `_`, Go's package qualifier drops it, and a Pascal form breaks a
 * word at it (`QuicPacket`).
 *
 * A per-language override in the contract always wins over the rule.
 * specs/vector-lang-names.md is this module's spec; vector tests itself with
 * the test it emits from it.
 */

import { split } from "nish/text"
import { textAsciiLower, textAsciiUpper } from "../core/text"
import { NameOverride } from "../spec/contract/types"

const langIsUpper = (c: i32): boolean => c >= 65 && c <= 90
const langIsLower = (c: i32): boolean => c >= 97 && c <= 122
const langNameIsDigit = (c: i32): boolean => c >= 48 && c <= 57

/** The end of the run from `i` of capitals (kind 0), lowercase letters (1) or digits (2). */
const langRunEnd = (s: string, i: i32, kind: i32): i32 => {
  let j = i
  // Callers start at 0 or later, so `j >= 0` never stops the loop.
  while (j >= 0 && j < s.length) {
    const c = s.charCodeAt(j)
    const ok = kind === 0 ? langIsUpper(c) : kind === 1 ? langIsLower(c) : langNameIsDigit(c)
    if (!ok) {
      return j
    }
    j++
  }
  return j
}

/**
 * A contract name split into words, each as the contract writes it.
 *
 * @param contractName a function or parameter name, such as `hkdfExpandSha256`
 * @returns its words: `hkdf`, `Expand`, `Sha256`
 */
export const langWords = (contractName: string): string[] => {
  const out: string[] = []
  for (const part of split(contractName, "_")) {
    let i = 0
    let first = true
    // i only grows from 0, so `i >= 0` never stops the loop.
    while (i >= 0 && i < part.length) {
      const c = part.charCodeAt(i)
      let end = i + 1
      if (langIsUpper(c)) {
        const caps = langRunEnd(part, i, 0)
        // langRunEnd answers i or later, so `caps >= 0` always holds.
        if (caps >= 0 && caps < part.length && langIsLower(part.charCodeAt(caps))) {
          end = caps - i > 1 ? caps - 1 : langRunEnd(part, caps, 1)
        } else {
          end = caps
        }
      } else if (langIsLower(c)) {
        end = langRunEnd(part, i, 1)
      } else if (langNameIsDigit(c)) {
        end = langRunEnd(part, i, 2)
      } else {
        i++
        continue
      }
      const token = part.substring(i, end)
      // A word was pushed before whenever !first, so `out.length > 0` then always holds.
      if (!first && langNameIsDigit(c) && out.length > 0) {
        const prev = out.pop()
        out.push(prev + token)
      } else {
        out.push(token)
      }
      first = false
      i = end
    }
  }
  return out
}

/**
 * Whether a word is an acronym as the contract writes it: two or more
 * capitals, then any digits.
 *
 * @param word a word of `langWords`
 * @returns true for `HTTP` or `UTF8`, false for `Http` or `A`
 */
export const langIsAcronym = (word: string): boolean => {
  let caps = 0
  while (caps < word.length && langIsUpper(word.charCodeAt(caps))) {
    caps++
  }
  return caps >= 2 && langRunEnd(word, caps, 2) === word.length
}

/**
 * A word with its first letter a capital and the rest lowercase.
 *
 * @param word a word
 * @returns `Sha256` for `sha256`, `Http` for `HTTP`
 */
export const langCapitalize = (word: string): string =>
  word.length === 0 ? "" : textAsciiUpper(word.substring(0, 1)) + textAsciiLower(word.substring(1, word.length))

/** `word` with only its first letter made a capital. */
const langUpperFirst = (word: string): string =>
  word.length === 0 ? "" : textAsciiUpper(word.substring(0, 1)) + word.substring(1, word.length)

/**
 * A contract name in lower snake_case: every word lowercase, joined by `_`.
 *
 * @param contractName a function or parameter name
 * @returns `parse_http_request` for `parseHTTPRequest`
 */
export const langSnake = (contractName: string): string => {
  const ws = langWords(contractName)
  const out: string[] = []
  for (const w of ws) {
    out.push(textAsciiLower(w))
  }
  return out.join("_")
}

/** How a camel- or Pascal-case rule writes a word after the first. */
export enum LangCase {
  /** As the contract writes it: `HTTP` stays `HTTP`. */
  AsWritten = 0,
  /** Every word capitalized, acronyms too: `HTTP` → `Http`. */
  Word = 1,
  /** A two-letter acronym stays in capitals (`IO`); a longer one is capitalized like a word (`Http`). */
  ShortCaps = 2,
}

const langCaseWord = (word: string, rule: LangCase): string => {
  if (rule === LangCase.AsWritten) {
    return langUpperFirst(word)
  }
  if (rule === LangCase.ShortCaps && langIsAcronym(word) && langRunEnd(word, 0, 0) === 2) {
    return word
  }
  return langCapitalize(word)
}

/**
 * A contract name in lowerCamelCase: the first word all lowercase, the rest
 * by `rule`.
 *
 * @param contractName a function or parameter name
 * @param rule how a word after the first is cased
 * @returns `parseHttpRequest` for `parseHTTPRequest` by `LangCase.Word`
 */
export const langCamel = (contractName: string, rule: LangCase): string => {
  const ws = langWords(contractName)
  let out = ""
  for (let i = 0; i < ws.length; i++) {
    out = out + (i === 0 ? textAsciiLower(ws[i]) : langCaseWord(ws[i], rule))
  }
  return out
}

/**
 * A contract name in UpperCamelCase (PascalCase): every word by `rule`.
 *
 * @param contractName a function or parameter name
 * @param rule how each word is cased
 * @returns `ParseHTTPRequest` for `parseHTTPRequest` by `LangCase.AsWritten`
 */
export const langPascal = (contractName: string, rule: LangCase): string => {
  let out = ""
  for (const w of langWords(contractName)) {
    out = out + langCaseWord(w, rule)
  }
  return out
}

/**
 * A module path segment in UpperCamelCase, a word starting at each `_` or
 * `-`, which are dropped.
 *
 * @param segment one segment of a module path
 * @returns `Chacha20poly1305` for `chacha20poly1305`, `BigInt` for `big_int`,
 *   `QuicPacket` for `quic-packet`
 */
export const langPascalSegment = (segment: string): string => {
  let out = ""
  for (const p of split(langUnderscored(segment), "_")) {
    out = out + langUpperFirst(p)
  }
  return out
}

/**
 * A module path, or part of one, with each `-` turned into `_`, so a segment
 * that joins words with `-` becomes an identifier. Two siblings that differ
 * only there, `a-b` and `a_b`, so name the same identifier; no gate refuses
 * the pair.
 *
 * @param path a module path, segment or file
 * @returns `nish/net/quic_packet` for `nish/net/quic-packet`
 */
export const langUnderscored = (path: string): string => split(path, "-").join("_")

/** The index of the last `ch` in `s`, or -1. */
const langLastIndex = (s: string, ch: i32): i32 => {
  for (let i = s.length - 1; i >= 0; i--) {
    if (s.charCodeAt(i) === ch) {
      return i
    }
  }
  return -1
}

/**
 * The last `/`-separated part of a path, without a lowercase extension: the
 * binding an import of it gets.
 *
 * @param path a module path or file, such as `package:nish/crypto/hkdf.dart`
 * @returns `hkdf`
 */
export const langBasename = (path: string): string => {
  const slash = langLastIndex(path, 47)
  // langLastIndex answers -1 or an index below the length, so the length
  // tests never change the answer.
  const last = slash < 0 || slash >= path.length ? path : path.substring(slash + 1, path.length)
  const dot = langLastIndex(last, 46)
  if (dot < 0 || dot >= last.length - 1) {
    return last
  }
  for (let i = dot + 1; i < last.length; i++) {
    if (!langIsLower(last.charCodeAt(i))) {
      return last
    }
  }
  return last.substring(0, dot)
}

/**
 * A dotted package of a module path's leading segments, and a class for its
 * last.
 *
 * @param module a module path, such as `nish/crypto/hkdf`
 * @returns `nish.crypto.Hkdf`; `nish.net_io.QuicPacket` for `nish/net-io/quic-packet`
 */
export const langPackageClass = (module: string): string => {
  // Each segment is underscored once the next is seen; the last is a class.
  const out: string[] = []
  let last: string | null = null
  for (const seg of split(module, "/")) {
    if (last !== null) {
      out.push(langUnderscored(last))
    }
    last = seg
  }
  if (last !== null) {
    out.push(langPascalSegment(last))
  }
  return out.join(".")
}

/**
 * golint's commonInitialisms, the list Go Code Review Comments § Initialisms
 * points to.
 *
 * @returns ACL … XSS, in capitals
 */
export const langGoInitialisms = (): string[] => [
  "ACL",
  "API",
  "ASCII",
  "CPU",
  "CSS",
  "DNS",
  "EOF",
  "GUID",
  "HTML",
  "HTTP",
  "HTTPS",
  "ID",
  "IP",
  "JSON",
  "LHS",
  "QPS",
  "RAM",
  "RHS",
  "RPC",
  "SLA",
  "SMTP",
  "SQL",
  "SSH",
  "TCP",
  "TLS",
  "TTL",
  "UDP",
  "UI",
  "UID",
  "UUID",
  "URI",
  "URL",
  "UTF8",
  "VM",
  "XML",
  "XMPP",
  "XSRF",
  "XSS",
]

/** Go's MixedCaps with initialisms in capitals; `exported` capitalizes the first word too. */
const langGoName = (contractName: string, exported: boolean): string => {
  const initialisms = langGoInitialisms()
  const ws = langWords(contractName)
  let out = ""
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]
    if (i === 0 && !exported) {
      out = out + textAsciiLower(w)
    } else if (langIsAcronym(w) || initialisms.indexOf(textAsciiUpper(w)) >= 0) {
      out = out + textAsciiUpper(w)
    } else {
      out = out + langCapitalize(w)
    }
  }
  return out
}

/**
 * The name a language gives a contract's function or parameter by its rule.
 * The rules, with the standards they follow, are each table's `nameRule`.
 *
 * @param lang a language id of `vocabLanguages`
 * @param contractName the name as the contract writes it
 * @param isFunction true for a function's name, false for a parameter's
 * @returns the name in that language; the contract's own for a language vector does not know
 */
export const langName = (lang: string, contractName: string, isFunction: boolean): string => {
  if (lang === "rust" || lang === "ruby" || lang === "cpp" || lang === "c" || lang === "python") {
    return langSnake(contractName)
  }
  if (lang === "zig") {
    return isFunction ? langCamel(contractName, LangCase.Word) : langSnake(contractName)
  }
  if (lang === "go") {
    return langGoName(contractName, isFunction)
  }
  if (lang === "csharp") {
    return isFunction ? langPascal(contractName, LangCase.ShortCaps) : langCamel(contractName, LangCase.ShortCaps)
  }
  if (lang === "java" || lang === "typescript") {
    return langCamel(contractName, LangCase.Word)
  }
  if (lang === "kotlin" || lang === "dart") {
    return langCamel(contractName, LangCase.ShortCaps)
  }
  if (lang === "php" || lang === "swift") {
    return langCamel(contractName, LangCase.AsWritten)
  }
  return contractName
}

/** The segments of a module path, each in UpperCamelCase, joined by `sep`. */
const langPascalPath = (module: string, sep: string): string => {
  const out: string[] = []
  for (const s of split(module, "/")) {
    out.push(langPascalSegment(s))
  }
  return out.join(sep)
}

/**
 * The form a language gives a neutral module path, such as `nish/crypto/hkdf`.
 * The forms, with the standards they follow, are each table's `moduleNote`.
 *
 * @param lang a language id of `vocabLanguages`
 * @param module the module path as the contract writes it
 * @returns the module in that language; the path itself for a language vector does not know
 */
export const langModule = (lang: string, module: string): string => {
  if (lang === "rust" || lang === "cpp") {
    return split(langUnderscored(module), "/").join("::")
  }
  if (lang === "ruby") {
    return langPascalPath(module, "::")
  }
  if (lang === "zig") {
    return `${module}.zig`
  }
  if (lang === "c") {
    return `${module}.h`
  }
  if (lang === "csharp") {
    return langPascalPath(module, ".")
  }
  if (lang === "java" || lang === "kotlin") {
    return langPackageClass(module)
  }
  if (lang === "python") {
    return split(langUnderscored(module), "/").join(".")
  }
  if (lang === "php") {
    return langPascalPath(module, "\\")
  }
  if (lang === "swift") {
    return langPascalPath(module, "")
  }
  if (lang === "dart") {
    const slash = module.indexOf("/")
    const pkg = slash < 0 ? module : module.substring(0, slash)
    // indexOf answers -1 or an index below the length, so the length test never fails.
    const rest = slash < 0 || slash >= module.length ? module : module.substring(slash + 1, module.length)
    return `package:${langUnderscored(pkg)}/${rest}.dart`
  }
  return module
}

/**
 * How a caller names a function of a module, both already in the language's
 * form (`langModule`'s and `langName`'s results, or their overrides).
 *
 * @param lang a language id of `vocabLanguages`
 * @param module the module in the language's form
 * @param name the function's name in the language's form
 * @returns the qualified name, such as `nish::crypto::hkdf::hkdf_expand`
 */
export const langQualify = (lang: string, module: string, name: string): string => {
  if (lang === "rust" || lang === "cpp") {
    return `${module}::${name}`
  }
  if (lang === "php") {
    return `\\${module}::${name}`
  }
  if (lang === "c") {
    const stem = module.endsWith(".h") ? module.substring(0, module.length - 2) : module
    return `${split(langUnderscored(stem), "/").join("_")}_${name}`
  }
  if (lang === "go") {
    return `${split(langUnderscored(langBasename(module)), "_").join("")}.${name}`
  }
  if (lang === "zig" || lang === "typescript" || lang === "dart") {
    return `${langUnderscored(langBasename(module))}.${name}`
  }
  return `${module}.${name}`
}

/** The override for `lang`, or null. */
const langOverrideFor = (lang: string, overrides: NameOverride[] | null): string | null => {
  if (overrides === null) {
    return null
  }
  for (const o of overrides) {
    if (o.language === lang) {
      return o.value
    }
  }
  return null
}

/**
 * The name a language gives a contract's function or parameter: the
 * contract's override for that language, or else the rule's.
 *
 * @param lang a language id
 * @param contractName the name as the contract writes it
 * @param isFunction true for a function's name, false for a parameter's
 * @param overrides the contract's `names` for it, or null
 * @returns the name in that language
 */
export const langNameIn = (
  lang: string,
  contractName: string,
  isFunction: boolean,
  overrides: NameOverride[] | null,
): string => langOverrideFor(lang, overrides) ?? langName(lang, contractName, isFunction)

/**
 * The form a language gives a module: the contract's override for that
 * language, or else the rule's.
 *
 * @param lang a language id
 * @param module the module path as the contract writes it
 * @param overrides the contract's `modules` for it, or null
 * @returns the module in that language
 */
export const langModuleIn = (lang: string, module: string, overrides: NameOverride[] | null): string =>
  langOverrideFor(lang, overrides) ?? langModule(lang, module)
