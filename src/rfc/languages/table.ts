// The shape of a language's mapping table: how each construct of the contract
// vocabulary (src/rfc/vocab.ts) is written in one language, and what that
// language drops. The tables are Records over the vocab unions, so a construct
// added there without a mapping here fails `bun run typecheck`.
//
// The contract keeps all the data: an exact width, which of the two outcomes a
// `?` means, secrecy, f64 bits. A table maps each construct down to what its
// language can express, and says in `note` (per construct) or `choices` (per
// language) what is lost. A construct the language cannot express at all is
// `{ unsupported: "<reason>" }`, never a missing entry.

import type {
  BaseType,
  Language,
  LiteralKind,
  ModuleOverrides,
  NameOverrides,
  Outcome,
} from "../vocab.ts";

/** How one construct is written, or why it cannot be. */
export type Mapping =
  | { spelling: string; note?: string }
  | { unsupported: string };

/**
 * The module forms: a Rust crate path, a Go package, a class of static
 * methods, a C++ namespace, a C header plus symbol prefix, a source file, or a
 * module.
 */
export type ModuleForm =
  | "crate-path"
  | "package"
  | "class"
  | "namespace"
  | "header-prefix"
  | "file"
  | "module";

export type NameKind = "function" | "param";

export interface ModuleRule {
  form: ModuleForm;
  /** The language's form of a neutral module path such as `nish/crypto/hkdf`. */
  apply(module: string): string;
  /**
   * How a caller names function `name` of module `module`, both already in
   * this language's form (`apply`'s result and `name`'s, or their overrides).
   */
  qualify(module: string, name: string): string;
  /** The rule in words, with the standard it follows. */
  note: string;
}

export interface LanguageTable {
  id: Language;
  /** Display name. */
  title: string;
  /** The specification its type names come from, by number and section. */
  typeStandard: string;
  /** The style standard its name rule follows, by name and section. */
  nameStandard: string;
  /** Every base type, `secret-bytes` included. */
  types: Record<BaseType, Mapping>;
  /** Each outcome of `B?`; its spelling is a template over `{T}`. */
  outcomes: Record<Outcome, Mapping>;
  /** How each literal form is written in source. */
  literals: Record<LiteralKind, Mapping>;
  module: ModuleRule;
  /** The default name rule, in words: case, and how acronyms and digits split. */
  nameRule: string;
  /** The default name of a contract name (`hkdfExpandSha256`) of `kind`. */
  name(contractName: string, kind: NameKind): string;
  /** The hard-case decisions, in words, each with what it drops. */
  choices: string[];
}

/** The name `table` gives `contractName`: an override for its language wins. */
export const nameIn = (
  table: LanguageTable,
  contractName: string,
  kind: NameKind,
  overrides?: NameOverrides,
): string => overrides?.[table.id] ?? table.name(contractName, kind);

/** The module form `table` gives `module`: an override for its language wins. */
export const moduleIn = (
  table: LanguageTable,
  module: string,
  overrides?: ModuleOverrides,
): string => overrides?.[table.id] ?? table.module.apply(module);

// ---------------------------------------------------------------------------
// The shared word split. Every name rule starts from it, so they agree on
// where words break:
//
//   - a lowercase letter followed by a capital starts a new word
//     (`hkdfExpand` → hkdf, Expand);
//   - a run of capitals is one word, an acronym, and the last capital starts
//     the next word when a lowercase letter follows it
//     (`parseHTTPRequest` → parse, HTTP, Request);
//   - a run of digits belongs to the word before it
//     (`hkdfExpandSha256` → hkdf, Expand, Sha256;
//     `chacha20Poly1305Seal` → chacha20, Poly1305, Seal), and starts a word
//     only at the start of the name;
//   - `_` separates words and is dropped.
// ---------------------------------------------------------------------------

/** `contractName` split into words, each as the contract writes it. */
export const words = (contractName: string): string[] => {
  const out: string[] = [];
  for (const part of contractName.split("_")) {
    const tokens = part.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? [];
    tokens.forEach((token, i) => {
      if (i > 0 && /^\d/.test(token)) out[out.length - 1] += token;
      else out.push(token);
    });
  }
  return out;
};

/** Whether a word is an acronym as written: two or more letters, all capitals. */
export const isAcronym = (word: string): boolean => /^[A-Z]{2,}\d*$/.test(word);

/** `word` with its first letter capital and the rest lowercase: `Sha256`. */
export const capitalize = (word: string): string =>
  word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

/** lower_snake_case: every word lowercase, joined by `_`. */
export const snake = (contractName: string): string =>
  words(contractName)
    .map((w) => w.toLowerCase())
    .join("_");

/**
 * How a camel- or Pascal-case rule writes a word after the first:
 *
 *   as-written  as the contract writes it (`HTTP` stays `HTTP`)
 *   word        every word capitalized, acronyms too (`HTTP` → `Http`)
 *   short-caps  an acronym of two letters stays capitals (`IO`), a longer one
 *               is capitalized like a word (`HTTP` → `Http`)
 */
export type WordCase = "as-written" | "word" | "short-caps";

const caseWord = (word: string, rule: WordCase): string =>
  rule === "as-written"
    ? word.charAt(0).toUpperCase() + word.slice(1)
    : rule === "short-caps" && /^[A-Z]{2}\d*$/.test(word)
      ? word
      : capitalize(word);

/** lowerCamelCase: the first word all lowercase, the rest by `rule`. */
export const camel = (contractName: string, rule: WordCase): string =>
  words(contractName)
    .map((w, i) => (i === 0 ? w.toLowerCase() : caseWord(w, rule)))
    .join("");

/** UpperCamelCase (PascalCase): every word by `rule`. */
export const pascal = (contractName: string, rule: WordCase): string =>
  words(contractName)
    .map((w) => caseWord(w, rule))
    .join("");

/** A neutral module path's segments: `nish/crypto/hkdf` → nish, crypto, hkdf. */
export const segments = (module: string): string[] => module.split("/");

/** A segment in UpperCamelCase, `_` dropped: `chacha20poly1305` → `Chacha20poly1305`, `big_int` → `BigInt`. */
export const pascalSegment = (segment: string): string =>
  segment
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");

/** The last `/`-separated part of `path`, without an extension: the binding an import of it gets. */
export const basename = (path: string): string =>
  (path.split("/").pop() as string).replace(/\.[a-z]+$/, "");
