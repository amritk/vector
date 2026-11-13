import { Suite } from "nish/testing"
import { langTableC } from "../../src/lang/c"
import { langTableCpp } from "../../src/lang/cpp"
import { langTableCsharp } from "../../src/lang/csharp"
import { langTableDart } from "../../src/lang/dart"
import { langTableGo } from "../../src/lang/go"
import { langTableJava } from "../../src/lang/java"
import { langTableKotlin } from "../../src/lang/kotlin"
import { langTablePhp } from "../../src/lang/php"
import { langTablePython } from "../../src/lang/python"
import { langTableRuby } from "../../src/lang/ruby"
import { langTableRust } from "../../src/lang/rust"
import { langTableSwift } from "../../src/lang/swift"
import { LangMapping, LangTable, langLookup, langSpell, langUnsupported } from "../../src/lang/table"
import { langFind, langTables } from "../../src/lang/tables"
import { langTableTypescript } from "../../src/lang/typescript"
import { langTableZig } from "../../src/lang/zig"
import { vocabBaseTypes, vocabLanguages, vocabLiteralKinds } from "../../src/spec/contract/vocab"

/** The keys of `want` that `keys` does not hold exactly once, then the keys `want` does not name, joined. */
const tablesKeyGaps = (keys: string[], want: string[]): string => {
  const gaps: string[] = []
  for (const w of want) {
    let n = 0
    for (const k of keys) {
      if (k === w) {
        n++
      }
    }
    if (n !== 1) {
      gaps.push(`${w} x${n}`)
    }
  }
  for (const k of keys) {
    if (want.indexOf(k) < 0) {
      gaps.push(`extra ${k}`)
    }
  }
  return gaps.join(",")
}

/** The field `f` (spelling, note or unsupported) of a mapping, or "<none>". */
const tablesField = (m: LangMapping | null, f: string): string => {
  if (m === null) {
    return "<none>"
  }
  if (f === "note") {
    return m.note
  }
  if (f === "unsupported") {
    return m.unsupported
  }
  return m.spelling
}

/** Checks one kind of construct of table `t`: every key mapped once, each mapping well formed. */
const tablesKind = (
  s: Suite,
  t: LangTable,
  kind: string,
  want: string[],
  keys: string[],
  maps: LangMapping[],
): void => {
  s.eqStr(`${t.id}: every ${kind}, once`, tablesKeyGaps(keys, want), "")
  s.eqStr(`${t.id}: a mapping for each ${kind}`, `${maps.length}`, `${keys.length}`)
  for (const k of want) {
    const m = langLookup(keys, maps, k)
    if (m === null) {
      s.ok(`${t.id}: ${kind} ${k} is mapped`, false)
    } else {
      const spelled = m.spelling !== "" && m.unsupported === ""
      const refused = m.spelling === "" && m.unsupported !== ""
      s.ok(`${t.id}: ${kind} ${k} is spelled or refused with a reason`, spelled || refused)
      if (kind === "outcome" && spelled) {
        s.ok(`${t.id}: outcome ${k} is a template over {T}`, m.spelling.indexOf("{T}") >= 0)
      }
    }
  }
}

/** Holds every language table to every construct of the contract vocabulary. */
export const main = (): i32 => {
  const s = new Suite("lang/tables")

  const one = new LangTable("x", "X", "", "")
  one.type("u8", langSpell("byte", ""))
  one.outcome("refusing-return", langSpell("Maybe {T}", "drops why"))
  one.literal("hex", langUnsupported("no hex"))
  s.eqStr("a type is looked up", tablesField(langLookup(one.typeKeys, one.types, "u8"), "spelling"), "byte")
  s.eqStr(
    "an outcome keeps its note",
    tablesField(langLookup(one.outcomeKeys, one.outcomes, "refusing-return"), "note"),
    "drops why",
  )
  s.eqStr(
    "an unsupported literal has its reason",
    tablesField(langLookup(one.literalKeys, one.literals, "hex"), "unsupported"),
    "no hex",
  )
  s.ok("a construct not set is null", langLookup(one.typeKeys, one.types, "u16") === null)
  s.eqStr("an unsupported mapping has no spelling", langUnsupported("r").spelling, "")

  const tables = langTables()
  const ids: string[] = []
  for (const t of tables) {
    ids.push(t.id)
  }
  s.eqStr("one table per language, in vocabulary order", ids.join(","), vocabLanguages().join(","))
  const each = [
    langTableRust(),
    langTableRuby(),
    langTableZig(),
    langTableGo(),
    langTableCpp(),
    langTableCsharp(),
    langTableC(),
    langTableJava(),
    langTableKotlin(),
    langTablePython(),
    langTableTypescript(),
    langTablePhp(),
    langTableSwift(),
    langTableDart(),
  ]
  for (let i = 0; i < each.length; i++) {
    s.eqStr(`table ${i} is ${each[i].id}`, each[i].id, ids[i])
  }

  const unsupported: string[] = []
  for (const t of tables) {
    s.ok(`${t.id}: has a title`, t.title !== "")
    s.ok(`${t.id}: names its type standard`, t.typeStandard !== "")
    s.ok(`${t.id}: names its style standard`, t.nameStandard !== "")
    s.ok(`${t.id}: has a module form`, t.moduleForm !== "" && t.moduleNote !== "")
    s.ok(`${t.id}: has a name rule`, t.nameRule !== "")
    s.ok(`${t.id}: says what it drops`, t.choices.length > 0)
    tablesKind(s, t, "type", vocabBaseTypes(), t.typeKeys, t.types)
    tablesKind(s, t, "outcome", ["refusing-return", "optional-input"], t.outcomeKeys, t.outcomes)
    tablesKind(s, t, "literal", vocabLiteralKinds(), t.literalKeys, t.literals)
    for (let i = 0; i < t.types.length; i++) {
      if (t.types[i].unsupported !== "") {
        unsupported.push(`${t.id}:${t.typeKeys[i]}`)
      }
    }
    for (let i = 0; i < t.outcomes.length; i++) {
      if (t.outcomes[i].unsupported !== "") {
        unsupported.push(`${t.id}:${t.outcomeKeys[i]}`)
      }
    }
    for (let i = 0; i < t.literals.length; i++) {
      if (t.literals[i].unsupported !== "") {
        unsupported.push(`${t.id}:${t.literalKeys[i]}`)
      }
    }
  }
  s.eqStr("the only construct a language cannot express is PHP's u64", unsupported.join(","), "php:u64")

  const rust = langFind("rust")
  s.eqStr("rust is found", rust === null ? "<none>" : rust.title, "Rust")
  s.ok("an unknown language is not", langFind("cobol") === null)
  return s.done()
}
