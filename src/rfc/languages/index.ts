// The fourteen mapping tables, one per language of src/rfc/vocab.ts.

import type { Language } from "../vocab.ts";
import { c } from "./c.ts";
import { cpp } from "./cpp.ts";
import { csharp } from "./csharp.ts";
import { dart } from "./dart.ts";
import { go } from "./go.ts";
import { java } from "./java.ts";
import { kotlin } from "./kotlin.ts";
import { php } from "./php.ts";
import { python } from "./python.ts";
import { ruby } from "./ruby.ts";
import { rust } from "./rust.ts";
import { swift } from "./swift.ts";
import type { LanguageTable } from "./table.ts";
import { typescript } from "./typescript.ts";
import { zig } from "./zig.ts";

export type {
  LanguageTable,
  Mapping,
  ModuleForm,
  ModuleRule,
  NameKind,
} from "./table.ts";
export { moduleIn, nameIn, words } from "./table.ts";

/** Every language's table, keyed by its vocab id. */
export const LANGUAGE_TABLES: Record<Language, LanguageTable> = {
  rust,
  ruby,
  zig,
  go,
  cpp,
  csharp,
  c,
  java,
  kotlin,
  python,
  typescript,
  php,
  swift,
  dart,
};
