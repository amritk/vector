// The README's "## Languages" section, rendered from the tables so the two
// cannot drift: test/languages.test.ts checks README.md holds exactly this.

import { BASE_TYPES, LANGUAGES, LITERAL_KINDS, OUTCOMES } from "../vocab.ts";
import { LANGUAGE_TABLES } from "./index.ts";
import type { LanguageTable, Mapping } from "./table.ts";

/** A spelling as a table cell: code, with `|` escaped for GFM. */
const code = (s: string): string => `\`${s.replace(/\|/g, "\\|")}\``;

/** Prose for GFM: `<` would open raw HTML and `*` emphasis. */
const prose = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\*/g, "\\*");

/** A matrix of language rows over `keys`, unsupported cells footnoted. */
const matrix = <K extends string>(
  keys: readonly K[],
  row: (t: LanguageTable) => Record<K, Mapping>,
): string => {
  const footnotes: string[] = [];
  const lines = [
    `| | ${keys.map((k) => code(k)).join(" | ")} |`,
    `|---|${keys.map(() => "---").join("|")}|`,
  ];
  for (const id of LANGUAGES) {
    const t = LANGUAGE_TABLES[id];
    const cells = keys.map((k) => {
      const m = row(t)[k];
      if ("spelling" in m) return code(m.spelling);
      footnotes.push(
        `${footnotes.length + 1}. ${t.title} \`${k}\`: ${prose(m.unsupported)}`,
      );
      return `unsupported (${footnotes.length})`;
    });
    lines.push(`| ${t.title} | ${cells.join(" | ")} |`);
  }
  return [
    lines.join("\n"),
    ...(footnotes.length ? [footnotes.join("\n")] : []),
  ].join("\n\n");
};

const EXAMPLE_FUNCTION = "hkdfExpandSha256";
const EXAMPLE_ACRONYM = "parseHTTPRequest";
const EXAMPLE_PARAM = "userId";
const EXAMPLE_MODULE = "nish/crypto/hkdf";

const names = (): string =>
  [
    `| | \`${EXAMPLE_FUNCTION}\` | \`${EXAMPLE_ACRONYM}\` | param \`${EXAMPLE_PARAM}\` | \`${EXAMPLE_MODULE}\` | called as | name standard |`,
    "|---|---|---|---|---|---|---|",
    ...LANGUAGES.map((id) => {
      const t = LANGUAGE_TABLES[id];
      const m = t.module.apply(EXAMPLE_MODULE);
      const f = t.name(EXAMPLE_FUNCTION, "function");
      return `| ${t.title} | ${[
        f,
        t.name(EXAMPLE_ACRONYM, "function"),
        t.name(EXAMPLE_PARAM, "param"),
        m,
        t.module.qualify(m, f),
      ]
        .map(code)
        .join(" | ")} | ${prose(t.nameStandard)} |`;
    }),
  ].join("\n");

const notes = (title: string, map: Record<string, Mapping>): string[] =>
  Object.entries(map).flatMap(([k, m]) =>
    "spelling" in m && m.note ? [`- ${title} \`${k}\`: ${prose(m.note)}`] : [],
  );

const details = (t: LanguageTable): string =>
  [
    `<details><summary>${t.title}</summary>`,
    "",
    `Types: ${prose(t.typeStandard)}.`,
    "",
    `Names: ${prose(t.nameRule)}`,
    "",
    `Modules (${t.module.form}): ${prose(t.module.note)}.`,
    "",
    "Choices:",
    "",
    ...t.choices.map((c) => `- ${prose(c)}`),
    "",
    "Notes:",
    "",
    ...notes("type", t.types),
    ...notes("outcome", t.outcomes),
    ...notes("literal", t.literals),
    "",
    "</details>",
  ].join("\n");

/** The whole section, from its heading to the blank line before the next rule. */
export const renderLanguagesSection = (): string =>
  [
    "## Languages",
    "",
    "A contract is language-neutral: one schema, checked against an implementation in any of fourteen languages. Each language has a mapping table in [`src/rfc/languages/`](src/rfc/languages/) that writes every construct of the vocabulary ([`src/rfc/vocab.ts`](src/rfc/vocab.ts)) in that language: every base type, both outcomes of `B?`, every literal form, the module path and the name rule. The tables are typed over the vocabulary, so a construct added there without a mapping fails `bun run typecheck`. [`test/languages.test.ts`](test/languages.test.ts) names every function of the three contracts in every language and checks this section is the tables' rendering.",
    "",
    "The contract keeps all the data: an exact width, which outcome a `?` means, secrecy, the bits of an f64. A language that cannot express one of those says what it drops, in a note or a choice below. A construct it cannot express at all is marked unsupported, with the reason. `{T}` stands for the mapped base type. A contract's `names` or `modules` override for a language always wins over these rules.",
    "",
    "### Base types",
    "",
    matrix(BASE_TYPES, (t) => t.types),
    "",
    "### Outcomes of `B?`",
    "",
    "`refusing-return` is a return of `B?`: the function refuses its input. `optional-input` is a parameter of `B?`: the argument may be absent.",
    "",
    matrix(OUTCOMES, (t) => t.outcomes),
    "",
    "### Literals",
    "",
    matrix(LITERAL_KINDS, (t) => t.literals),
    "",
    "### Names and modules",
    "",
    "Every rule starts from one word split: a capital starts a word, a run of capitals is one acronym (`parseHTTPRequest` → parse, HTTP, Request), a digit run stays on the word before it (`chacha20Poly1305Seal` → chacha20, Poly1305, Seal), and `_` separates words.",
    "",
    names(),
    "",
    "### Per language",
    "",
    LANGUAGES.map((id) => details(LANGUAGE_TABLES[id])).join("\n\n"),
    "",
  ].join("\n");
