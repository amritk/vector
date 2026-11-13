/**
 * `lang/tables` — the fourteen language tables, one for each language of
 * `vocabLanguages`, in its order.
 */

import { langTableC } from "./c"
import { langTableCpp } from "./cpp"
import { langTableCsharp } from "./csharp"
import { langTableDart } from "./dart"
import { langTableGo } from "./go"
import { langTableJava } from "./java"
import { langTableKotlin } from "./kotlin"
import { langTablePhp } from "./php"
import { langTablePython } from "./python"
import { langTableRuby } from "./ruby"
import { langTableRust } from "./rust"
import { langTableSwift } from "./swift"
import { LangTable } from "./table"
import { langTableTypescript } from "./typescript"
import { langTableZig } from "./zig"

/**
 * Every language's table.
 *
 * @returns the tables, in the order `vocabLanguages` lists their ids
 */
export const langTables = (): LangTable[] => [
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

/**
 * The table of one language.
 *
 * @param id a language id
 * @returns its table, or null when vector has none for it
 */
export const langFind = (id: string): LangTable | null => {
  for (const t of langTables()) {
    if (t.id === id) {
      return t
    }
  }
  return null
}
