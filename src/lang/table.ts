/**
 * `lang/table` — the shape of a language table: how each construct of the
 * contract vocabulary (`spec/contract/vocab`) is written in one language, and
 * what that language drops.
 *
 * The contract keeps all the data: an exact width, which of the two outcomes a
 * `?` means, secrecy, f64 bits. A table maps each construct down to what its
 * language can express, and says in a mapping's `note` (per construct) or in
 * `choices` (per language) what is lost. A construct the language cannot
 * express at all is an unsupported mapping with its reason, never a missing
 * entry: tests/lang/tables_test.ts holds every table to every construct.
 */

/** How one construct is written in a language, or why it cannot be. */
export class LangMapping {
  /** The construct as the language writes it; "" when it is unsupported. */
  spelling: string
  /** What the spelling drops or how it reads, or "". */
  note: string
  /** Why the language cannot express the construct, or "" when it can. */
  unsupported: string
  /**
   * Makes a mapping.
   *
   * @param spelling the construct as the language writes it, or ""
   * @param note what the spelling drops, or ""
   * @param unsupported why it cannot be written, or ""
   */
  constructor(spelling: string, note: string, unsupported: string) {
    this.spelling = spelling
    this.note = note
    this.unsupported = unsupported
  }
}

/**
 * A construct the language writes.
 *
 * @param spelling the construct as the language writes it; an outcome's is a template over `{T}`
 * @param note what the spelling drops or how it reads, or ""
 * @returns the mapping
 */
export const langSpell = (spelling: string, note: string): LangMapping => new LangMapping(spelling, note, "")

/**
 * A construct the language cannot express.
 *
 * @param reason why, in a sentence
 * @returns the mapping
 */
export const langUnsupported = (reason: string): LangMapping => new LangMapping("", "", reason)

/**
 * One language's table. Each construct is keyed by its vocabulary name: a base
 * type (`vocabBaseTypes`), an outcome of `B?` (`refusing-return`,
 * `optional-input`) or a literal kind (`vocabLiteralKinds`).
 */
export class LangTable {
  /** The language's vocabulary id, as `vocabLanguages` lists it. */
  id: string
  /** The language's display name. */
  title: string
  /** The specification its type names come from, by name and section. */
  typeStandard: string
  /** The style standard its name rule follows, by name and section. */
  nameStandard: string
  /** The base types, in the order they were set. */
  typeKeys: string[]
  /** How each of `typeKeys` is written. */
  types: LangMapping[]
  /** The outcomes of `B?`, in the order they were set. */
  outcomeKeys: string[]
  /** How each of `outcomeKeys` is written, as a template over `{T}`. */
  outcomes: LangMapping[]
  /** The literal kinds, in the order they were set. */
  literalKeys: string[]
  /** How each of `literalKeys` is written in source. */
  literals: LangMapping[]
  /** The module form: crate-path, package, class, namespace, header-prefix, file or module. */
  moduleForm: string
  /** The module rule in words, with the standard it follows. */
  moduleNote: string
  /** The default name rule in words: case, and how acronyms and digits split. */
  nameRule: string
  /** The hard-case decisions, in words, each with what it drops. */
  choices: string[]
  /**
   * Makes a table with no constructs yet.
   *
   * @param id the language's vocabulary id
   * @param title its display name
   * @param typeStandard where its type names come from
   * @param nameStandard the style standard its names follow
   */
  constructor(id: string, title: string, typeStandard: string, nameStandard: string) {
    this.id = id
    this.title = title
    this.typeStandard = typeStandard
    this.nameStandard = nameStandard
    this.typeKeys = []
    this.types = []
    this.outcomeKeys = []
    this.outcomes = []
    this.literalKeys = []
    this.literals = []
    this.moduleForm = ""
    this.moduleNote = ""
    this.nameRule = ""
    this.choices = []
  }

  /**
   * Sets how a base type is written.
   *
   * @param key the base type
   * @param m its mapping
   */
  type(key: string, m: LangMapping): void {
    this.typeKeys.push(key)
    this.types.push(m)
  }

  /**
   * Sets how an outcome of `B?` is written.
   *
   * @param key `refusing-return` or `optional-input`
   * @param m its mapping, a template over `{T}`
   */
  outcome(key: string, m: LangMapping): void {
    this.outcomeKeys.push(key)
    this.outcomes.push(m)
  }

  /**
   * Sets how a literal kind is written.
   *
   * @param key the literal kind
   * @param m its mapping
   */
  literal(key: string, m: LangMapping): void {
    this.literalKeys.push(key)
    this.literals.push(m)
  }
}

/**
 * The mapping a table gives a construct.
 *
 * @param keys the table's keys of one kind (`typeKeys`, `outcomeKeys` or `literalKeys`)
 * @param maps the matching mappings
 * @param key the construct
 * @returns its mapping, or null when the table has none
 */
export const langLookup = (keys: string[], maps: LangMapping[], key: string): LangMapping | null => {
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === key && i < maps.length) {
      return maps[i]
    }
  }
  return null
}
