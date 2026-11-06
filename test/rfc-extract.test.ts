import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as client from "../src/agents/client.ts";
import { MalformedOutputError } from "../src/agents/client.ts";
import { main } from "../src/cli.ts";
import { rfcMain } from "../src/rfc/cli.ts";
import type { RfcContract } from "../src/rfc/contract.ts";
import {
  EXTRACTOR_SYSTEM_PROMPT,
  type ExtractDeps,
  SPEC_ONLY_SYSTEM_PROMPT,
  compareContracts,
  extractContract,
  extractTwice,
} from "../src/rfc/extract.ts";
import {
  INTERFACE_TYPES,
  interfaceDeclarations,
  interfaceSignatures,
  parseMarkdownSpec,
} from "../src/rfc/spectext.ts";

// Spec-only and twice-run extraction, with a fake model behind the seam every
// extraction goes through. Every refusal sits next to the case that passes.

/** A markdown spec with an Interface section, two MUSTs and a timing MUST NOT. */
const SPEC = `# Hex Encoding

## 1. Introduction

The key words "MUST" and "MUST NOT" in this document are to be interpreted as
described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all
capitals, as shown here.

## 2. Interface

The module exports two functions:

    export const toHex = (b: u8[]): string
    export const fromHex = (s: string): u8[] | null

## 3. Encoding

An encoder MUST emit two lowercase digits per byte.

### 3.1. Decoding

A decoder MUST return null for a string of odd length: \`abc\` decodes
to null.

A decoder MUST NOT take time that depends on the digits.

## 4. Test Vectors

| bytes | \`toHex\` |
|-------|---------|
| [de ad be ef] | \`deadbeef\` |
`;

/** What the model never sees in spec-only mode: the implementation. */
const MODULE = `// IMPLEMENTATION-SOURCE-MARKER
export const toHex = (b: u8[]): string => b.map(hexByte).join("");
export const fromHex = (s: string): u8[] | null => null;
`;

const TIMING = "A decoder MUST NOT take time that depends on the digits.";
const ODD = "A decoder MUST return null for a string of odd length";

/** A contract every gate passes for SPEC. */
function contractA(): RfcContract {
  return {
    contract: "hex-md",
    source: { title: "Hex Encoding", main: "hex" },
    sources: [{ id: "hex", path: "hex.md" }],
    target: { module: "nish/encoding/hex" },
    functions: [
      {
        name: "toHex",
        params: [{ name: "b", type: "bytes" }],
        returns: "string",
      },
      {
        name: "fromHex",
        params: [{ name: "s", type: "string" }],
        returns: "bytes?",
      },
    ],
    requirements: [
      {
        id: "R-LOWER",
        section: "3",
        level: "MUST",
        quote: "An encoder MUST emit two lowercase digits per byte.",
      },
      { id: "R-ODD", section: "3.1", level: "MUST", quote: ODD },
    ],
    exclusions: [
      { section: "3.1", quote: TIMING, reason: "timing is not observable" },
    ],
    clauses: [
      {
        kind: "vector",
        id: "V-HEX",
        title: "the table's value",
        covers: ["R-LOWER"],
        source: { cite: { section: "4" } },
        call: "toHex",
        args: [{ hex: "deadbeef" }],
        expect: { str: "deadbeef" },
      },
      {
        kind: "vector",
        id: "V-ODD",
        title: "odd length is refused",
        covers: ["R-ODD"],
        source: { spec: "3.1" },
        section: "3.1",
        call: "fromHex",
        args: [{ str: "abc" }],
        expect: { null: true },
      },
    ],
  } as RfcContract;
}

/**
 * Also valid, but read differently: it excludes the odd-length MUST instead of
 * testing it, and states part of the encoder's MUST again as a DEFINITION.
 */
function contractB(): RfcContract {
  const c = contractA();
  c.requirements = [
    c.requirements[0],
    {
      id: "R-DIGITS",
      section: "3",
      level: "DEFINITION",
      quote: "two lowercase digits per byte",
    },
  ];
  c.clauses = [{ ...c.clauses[0], covers: ["R-LOWER", "R-DIGITS"] }];
  c.exclusions = [
    ...(c.exclusions ?? []),
    { section: "3.1", quote: ODD, reason: "left to the decoder's own tests" },
  ];
  return c;
}

/** The fake model: answers in order, and records every turn it was given. */
function fake(answers: unknown[]) {
  const calls: { turn: string; system: string }[] = [];
  const deps: ExtractDeps = {
    propose: async (turn, system) => {
      calls.push({ turn, system });
      if (answers.length === 0) throw new Error("the fake model ran out");
      const a = answers.shift();
      if (a instanceof Error) throw a;
      return structuredClone(a);
    },
  };
  return { deps, calls };
}

describe("the spec's Interface section", () => {
  test("reads its signatures, prose around them allowed", () => {
    const iface = interfaceSignatures(parseMarkdownSpec(SPEC));
    expect(iface).toEqual({
      section: "2",
      signatures: [
        {
          name: "toHex",
          params: [{ name: "b", type: "u8[]" }],
          returns: "string",
        },
        {
          name: "fromHex",
          params: [{ name: "s", type: "string" }],
          returns: "u8[] | null",
        },
      ],
    });
    expect(interfaceDeclarations(iface)).toBe(
      [
        "export const toHex = (b: u8[]): string => _",
        "export const fromHex = (s: string): u8[] | null => _",
      ].join("\n"),
    );
  });

  test("reads the nish/hex acceptance spec", () => {
    const iface = interfaceSignatures(
      parseMarkdownSpec(readFileSync("specs/example-hex.md", "utf8")),
    );
    expect(iface.signatures.map((s) => s.name)).toEqual([
      "hexEncode",
      "hexDecode",
    ]);
    expect(iface.signatures[1].returns).toBe("u8[] | null");
  });

  test("reads export function, fenced code, arrows and no parameters", () => {
    const iface = interfaceSignatures(
      parseMarkdownSpec(`## 1. Interfaces

\`\`\`ts
export function now(): i32;
export const add = (a: i32, b: i32): i32 => a + b
export function len(x: u8[]): i32 {
\`\`\`
`),
    );
    expect(iface.signatures).toEqual([
      { name: "now", params: [], returns: "i32" },
      {
        name: "add",
        params: [
          { name: "a", type: "i32" },
          { name: "b", type: "i32" },
        ],
        returns: "i32",
      },
      { name: "len", params: [{ name: "x", type: "u8[]" }], returns: "i32" },
    ]);
  });

  const refuses = (text: string, message: string) =>
    expect(() => interfaceSignatures(parseMarkdownSpec(text))).toThrow(message);

  test("refuses a spec with no Interface section", () => {
    refuses(
      "## 1. Encoding\n\nAn encoder MUST work.\n",
      "no Interface section",
    );
    // An unnumbered heading is not a section, so it does not count.
    refuses(
      "## Interface\n\n    export const f = (x: i32): i32\n\n## 1. Encoding\n",
      "no Interface section",
    );
  });

  test("refuses two Interface sections", () => {
    refuses(
      "## 1. Interface\n\n    export const f = (x: i32): i32\n\n## 2. Interface\n\n    export const g = (x: i32): i32\n",
      "2 Interface sections (§1, §2)",
    );
  });

  test("refuses an Interface section that declares nothing", () => {
    refuses("## 1. Interface\n\nSee the module.\n", "declares no signature");
  });

  test("refuses an export line it cannot read", () => {
    refuses(
      "## 1. Interface\n\n    export const f = (g: (x: i32) => i32): i32\n",
      "cannot read this signature",
    );
    refuses(
      "## 1. Interface\n\n    export { f, g }\n",
      "cannot read this signature",
    );
    refuses(
      "## 1. Interface\n\n    export const f = (x = 1): i32\n",
      'cannot read parameter "x = 1" of f',
    );
    refuses(
      "## 1. Interface\n\n    export const f = (x: i32,): i32\n",
      'cannot read parameter "" of f',
    );
  });

  // Every markdown form a signature line can take: each is read, and a
  // declaration in it that cannot be read refuses the spec, never skips.
  const SIG = "export const f = (x: u8[]): string";
  const BAD = "export const f = (g: (x: i32) => i32): i32";
  const FORMS: [string, (sig: string) => string][] = [
    ["a - bullet", (x) => `- \`${x}\``],
    ["a * bullet", (x) => `* ${x}`],
    ["a + bullet", (x) => `+ ${x}`],
    ["a > blockquote", (x) => `> ${x}`],
    ["a 1. item", (x) => `1. ${x}`],
    ["a 1) item", (x) => `1) \`${x}\``],
    ["a quoted bullet", (x) => `> - \`${x}\``],
    ["a nested item", (x) => `   2. - ${x}`],
    [
      "a table cell",
      (x) => `| name | signature |\n|---|---|\n| f | \`${x}\` |`,
    ],
    ["inline code", (x) => `\`${x}\``],
  ];
  const withForm = (line: string) =>
    `## 1. Interface\n\n    export const g = (x: u8[]): string\n\n${line}\n`;

  for (const [name, form] of FORMS) {
    test(`reads a signature in ${name}`, () => {
      const iface = interfaceSignatures(parseMarkdownSpec(withForm(form(SIG))));
      expect(iface.signatures.map((s) => s.name)).toEqual(["g", "f"]);
      expect(iface.signatures[1]).toEqual({
        name: "f",
        params: [{ name: "x", type: "u8[]" }],
        returns: "string",
      });
    });
    test(`refuses a signature it cannot read in ${name}, never skips it`, () => {
      refuses(withForm(form(BAD)), "cannot read this signature");
    });
  }

  test("refuses a declaration after other text on its line", () => {
    for (const line of [
      `Use ${SIG} here.`,
      `- The encoder: ${SIG}`,
      `> Note that ${SIG}`,
      `| f | see ${SIG} |`,
      `**${SIG}**`,
      "The module has export function f(x: u8[]): string too.",
      "Also export default f.",
    ]) {
      refuses(withForm(line), "a signature must be on a line of its own");
    }
  });

  test("prose that only mentions exports is not a declaration", () => {
    const iface = interfaceSignatures(
      parseMarkdownSpec(
        withForm("- Both functions are exported, and nothing else is."),
      ),
    );
    expect(iface.signatures.map((s) => s.name)).toEqual(["g"]);
  });

  test("drops a trailing // comment; refuses a /* */ comment inside", () => {
    const iface = interfaceSignatures(
      parseMarkdownSpec(withForm(`- \`${SIG} // lowercase hex\``)),
    );
    expect(iface.signatures[1].returns).toBe("string");
    refuses(
      withForm("export const f = (x: u8[]): string /* hex */"),
      "a comment is inside it",
    );
    refuses(
      withForm("export const f = (x /* bytes */: u8[]): string"),
      "a comment is inside it",
    );
  });

  test("refuses a name declared twice", () => {
    refuses(
      "## 1. Interface\n\n    export const f = (x: i32): i32\n    export function f(x: u32): u32\n",
      "f is declared twice",
    );
  });

  // B2: once the markers are gone the rest of the line is exactly one
  // signature, or the spec is refused. Each input a reviewer found, and the
  // siblings of each.
  test("refuses two signatures on one line, whatever separates them", () => {
    for (const line of [
      "- export const a = (x: string): string => x; export const b = (y: i32): i32 => y",
      "export function a(x: string): string { return x } export function b(): i32 { return 1 }",
      "export const a = (x: string): string => x export const b = (): i32",
      "| a | `export const a = (x: i32): i32; export const b = (x: i32): i32` |",
    ]) {
      refuses(
        withForm(line),
        "one signature per line; this line declares more",
      );
    }
    for (const line of [
      "export function a(x: string): string {} function b(): i32 {}",
      "export const a = (x: i32): i32 => x; const b = 1",
      "export const a = (x: i32): i32 => x; note this",
      "export function a(x: i32): i32 { const y = x; return y }",
    ]) {
      refuses(
        withForm(line),
        "the body after this one holds another statement or declaration",
      );
    }
  });

  test("refuses a note after the signature, never reads it as the type", () => {
    refuses(
      withForm("- `export const f = (x: u8[]): string` — encodes x"),
      'the return of f has type "string — encodes x", not one a contract can declare',
    );
    refuses(
      withForm("- export const f = (x: u8[]): string."),
      'the return of f has type "string."',
    );
    refuses(
      withForm("export const f = (x: u8[], y: u8[]): string,"),
      'the return of f has type "string,"',
    );
    refuses(
      withForm("export const f = (x: u8[]): string; note this"),
      "cannot read this signature (exactly one",
    );
  });

  test("refuses a type a contract cannot declare", () => {
    refuses(
      withForm("export const f = (o: {a: u8, b: u8}): string"),
      'parameter o of f has type "{a: u8"',
    );
    refuses(
      withForm("export const f = (x: u8): string"),
      'parameter x of f has type "u8", not one a contract can declare (u8[], u8[] | null',
    );
    refuses(
      withForm("export const f = (x: u8[]): Promise<string>"),
      'the return of f has type "Promise<string>"',
    );
    refuses(
      withForm("export function f(x: number): bigint"),
      'parameter x of f has type "number"',
    );
    refuses(
      withForm("export const f = (x?: u8[]): string"),
      'cannot read parameter "x?: u8[]" of f',
    );
    // The list is the signature gate's, type for type.
    expect([...INTERFACE_TYPES].sort()).toEqual(
      [
        "u8[]",
        "u8[] | null",
        "null | u8[]",
        "string",
        "string | null",
        "null | string",
        "i32",
        "u32",
        "boolean",
      ].sort(),
    );
  });

  test("reads every type on the list, spaced any way, and a `;` or body tail", () => {
    const iface = interfaceSignatures(
      parseMarkdownSpec(`## 1. Interface

    export const a = (x: u8[]|null): null | string
    export const b = (x: null|u8[]): boolean;
    export const c = (x: u8 [ ], y: u32): string|null ;
    export function d(x: i32): i32 { return x }
    export const e = (x: i32): i32 => x + 1 // the successor
`),
    );
    expect(iface.signatures).toEqual([
      {
        name: "a",
        params: [{ name: "x", type: "u8[] | null" }],
        returns: "null | string",
      },
      {
        name: "b",
        params: [{ name: "x", type: "null | u8[]" }],
        returns: "boolean",
      },
      {
        name: "c",
        params: [
          { name: "x", type: "u8[]" },
          { name: "y", type: "u32" },
        ],
        returns: "string | null",
      },
      { name: "d", params: [{ name: "x", type: "i32" }], returns: "i32" },
      { name: "e", params: [{ name: "x", type: "i32" }], returns: "i32" },
    ]);
  });

  test("refuses `export` in another letter case; prose that starts with the word is prose", () => {
    refuses(
      withForm("Export const f = (x: i32): i32"),
      "`export` must be written in lowercase",
    );
    refuses(
      withForm("- EXPORT FUNCTION f(x: i32): i32"),
      "`export` must be written in lowercase",
    );
    const iface = interfaceSignatures(
      parseMarkdownSpec(withForm("Export the bytes as lowercase hex.")),
    );
    expect(iface.signatures.map((s) => s.name)).toEqual(["g"]);
  });

  test("refuses every export that is not a function: it fails closed", () => {
    for (const line of [
      "export type T = string",
      "export interface I { a: string }",
      "export async function f(x: i32): i32",
      "export declare function f(x: i32): i32;",
      "export let f = 1",
      "export default f",
    ]) {
      refuses(withForm(line), "the Interface section declares only functions");
    }
  });
});

describe("spec-only extraction", () => {
  const inputs = { rfcText: SPEC, target: "nish/encoding/hex", specOnly: true };

  test("the prompt is exactly the target, the Interface and the spec", async () => {
    const { deps, calls } = fake([contractA()]);
    const outcome = await extractContract(inputs, deps);
    expect(outcome.contract?.contract).toBe("hex-md");
    expect(calls).toHaveLength(1);
    expect(calls[0].system).toBe(SPEC_ONLY_SYSTEM_PROMPT);
    expect(calls[0].turn).toBe(
      [
        "Target module: nish/encoding/hex",
        "Its interface, as the spec's Interface section (§2) declares it:\n  toHex(b: u8[]): string\n  fromHex(s: string): u8[] | null",
        `The spec:\n\n${SPEC}`,
      ].join("\n\n"),
    );
    expect(calls[0].turn).not.toContain("exported functions");
  });

  test("the module mode's prompt does carry the module's signatures", async () => {
    const { deps, calls } = fake([contractA()]);
    await extractContract(
      { rfcText: SPEC, target: "nish/encoding/hex", moduleSource: MODULE },
      deps,
    );
    expect(calls[0].system).toBe(EXTRACTOR_SYSTEM_PROMPT);
    expect(calls[0].turn).toContain(
      "Its exported functions:\n  toHex(u8[]): string",
    );
  });

  test("the signature gate checks the contract against the Interface", async () => {
    const wrong = contractA();
    wrong.functions[0].returns = "bytes";
    const { deps, calls } = fake([wrong, contractA()]);
    const outcome = await extractContract(inputs, deps);
    expect(outcome.attempts).toBe(2);
    expect(calls[1].turn).toContain(
      "[signatures] toHex: declared (bytes) -> bytes, but nish/encoding/hex has (u8[]): string",
    );
    // The repair turn adds only the model's own contract and the gate's feedback.
    expect(
      calls[1].turn.startsWith(
        [
          calls[0].turn,
          `Your previous contract:\n${JSON.stringify(wrong)}`,
          "It failed these checks. Fix exactly these, keep everything that passed:\n- ",
        ].join("\n\n"),
      ),
    ).toBe(true);
  });

  test("refuses a contract that leaves out an Interface signature", async () => {
    const partial = contractA();
    partial.functions = [partial.functions[0]];
    partial.clauses = [partial.clauses[0]];
    partial.requirements = [partial.requirements[0]];
    partial.exclusions = [
      ...(partial.exclusions ?? []),
      { section: "3.1", quote: ODD, reason: "x" },
    ];
    const { deps, calls } = fake([partial, contractA()]);
    const outcome = await extractContract(inputs, deps);
    expect(outcome.attempts).toBe(2);
    expect(calls[1].turn).toContain(
      "[signatures] fromHex: the spec's Interface section (§2) declares fromHex, but the contract's functions[] leave it out",
    );
  });

  test("refuses a function from another module, which the Interface cannot check", async () => {
    const ref = contractA();
    ref.functions.push({
      name: "hmac",
      module: "nish/crypto/hmac",
      params: [{ name: "k", type: "bytes" }],
      returns: "bytes",
    });
    const { deps, calls } = fake([ref, ref]);
    const outcome = await extractContract(inputs, deps, 1);
    expect(outcome.contract).toBeNull();
    expect(calls[1].turn).toContain(
      "[signatures] hmac: names module nish/crypto/hmac, but spec-only extraction takes every function from the spec's Interface section (§2)",
    );
    // The module mode leaves a reference function to the signature gate.
    const { deps: d2 } = fake([ref]);
    const viaModule = await extractContract(
      { rfcText: SPEC, target: "nish/encoding/hex", moduleSource: MODULE },
      d2,
    );
    expect(viaModule.contract).not.toBeNull();
  });

  test("refuses a contract for another module, in both modes", async () => {
    const elsewhere = contractA();
    elsewhere.target.module = "nish/encoding/base64";
    const message =
      "[signatures] target.module: is nish/encoding/base64, but the extraction is for nish/encoding/hex";
    const { deps, calls } = fake([elsewhere, contractA()]);
    const outcome = await extractContract(inputs, deps);
    expect(outcome.attempts).toBe(2);
    expect(calls[1].turn).toContain(message);
    expect(outcome.contract?.target.module).toBe("nish/encoding/hex");
    const { deps: d2, calls: c2 } = fake([elsewhere, elsewhere]);
    const viaModule = await extractContract(
      { rfcText: SPEC, target: "nish/encoding/hex", moduleSource: MODULE },
      d2,
      1,
    );
    expect(viaModule.contract).toBeNull();
    expect(c2[1].turn).toContain(message);
  });

  test("refuses a module source, before any model call", async () => {
    const { deps, calls } = fake([contractA()]);
    await expect(
      extractContract({ ...inputs, moduleSource: MODULE }, deps),
    ).rejects.toThrow("spec-only extraction takes no module source");
    expect(calls).toHaveLength(0);
  });

  test("refuses a spec with no Interface section, before any model call", async () => {
    const { deps, calls } = fake([contractA()]);
    await expect(
      extractContract(
        { ...inputs, rfcText: SPEC.replace("## 2. Interface", "## 2. Shape") },
        deps,
      ),
    ).rejects.toThrow("no Interface section");
    expect(calls).toHaveLength(0);
  });

  test("the module mode still needs a module", async () => {
    const { deps } = fake([contractA()]);
    await expect(
      extractContract({ rfcText: SPEC, target: "nish/encoding/hex" }, deps),
    ).rejects.toThrow("extraction needs the module source");
  });
});

describe("twice-run extraction", () => {
  const doc = parseMarkdownSpec(SPEC);
  const inputs = { rfcText: SPEC, target: "nish/encoding/hex", specOnly: true };

  test("two runs that agree report no disagreement", async () => {
    const { deps, calls } = fake([contractA(), contractA()]);
    const t = await extractTwice(inputs, deps);
    expect(t.disagreements).toEqual([]);
    // Independent: the second run starts from the spec, as the first did.
    expect(calls).toHaveLength(2);
    expect(calls[1].turn).toBe(calls[0].turn);
  });

  test("ids and quote whitespace do not count as disagreement", () => {
    const b = contractA();
    b.requirements[1].id = "R-ODD-LENGTH";
    b.requirements[1].quote = ODD.replace(/ /g, "\n  ");
    b.clauses[1].covers = ["R-ODD-LENGTH"];
    expect(compareContracts(contractA(), b, doc)).toEqual([]);
  });

  test("two runs that disagree list each difference", async () => {
    const { deps } = fake([contractA(), contractB()]);
    const t = await extractTwice(inputs, deps);
    expect(t.disagreements).toEqual([
      {
        kind: "requirement",
        at: "§3.1",
        message: `run 1 states requirement R-ODD (MUST) "${ODD}"; run 2 excludes it: "left to the decoder's own tests"`,
      },
      {
        kind: "requirement",
        at: "§3",
        message:
          'run 2 states R-DIGITS as DEFINITION, run 1 as MUST (R-LOWER): "two lowercase digits per byte"',
      },
      {
        kind: "coverage",
        at: "§3.1",
        message: `MUST sentence "Decoding A decoder MUST return null for a string of odd length: abc decodes to null." is tested (R-ODD) in run 1, excluded: "left to the decoder's own tests" in run 2`,
      },
    ]);
  });

  test("a stated requirement no clause tests differs from a tested one", () => {
    const b = contractA();
    b.clauses = [b.clauses[0]];
    expect(compareContracts(contractA(), b, doc)).toEqual([
      {
        kind: "coverage",
        at: "§3.1",
        message: `MUST sentence "Decoding A decoder MUST return null for a string of odd length: abc decodes to null." is tested (R-ODD) in run 1, stated but untested (R-ODD) in run 2`,
      },
    ]);
  });

  test("a binding sentence one run leaves out is listed", () => {
    const b = contractA();
    b.exclusions = [];
    const ds = compareContracts(contractA(), b, doc);
    expect(ds).toHaveLength(1);
    expect(ds[0].message).toContain(
      'is excluded: "timing is not observable" in run 1, not covered in run 2',
    );
  });

  test("two spans of one sentence are the same requirement", () => {
    const b = contractA();
    b.requirements[1].quote = `${ODD}: abc decodes to null.`;
    expect(compareContracts(contractA(), b, doc)).toEqual([]);
    // Spans that overlap without either holding the other agree too.
    const a = contractA();
    a.requirements[1].quote = "A decoder MUST return null for a string";
    b.requirements[1].quote = "MUST return null for a string of odd length";
    expect(compareContracts(a, b, doc)).toEqual([]);
  });

  test("a quote that holds a second sentence the other run's does not is a partial match", () => {
    const b = contractA();
    b.requirements[1].quote = `${ODD}: abc decodes to null. ${TIMING}`;
    b.exclusions = [];
    expect(
      compareContracts(contractA(), b, doc).filter(
        (d) => d.kind === "requirement",
      ),
    ).toEqual([
      {
        kind: "requirement",
        at: "§3.1",
        message: expect.stringMatching(
          /^run 1 states R-ODD as 1 sentence\(s\) "A decoder MUST return null[^"]*", run 2 states R-ODD as 2 "A decoder MUST return null[^"]*": a partial match$/,
        ),
      },
    ]);
    // One sentence against a span of it is no partial match (above).
  });

  test("spans of one section that do not overlap are different requirements", () => {
    const b = contractA();
    b.requirements[1].quote = TIMING;
    b.exclusions = [
      { section: "3.1", quote: ODD, reason: "left to the decoder's own tests" },
    ];
    expect(
      compareContracts(contractA(), b, doc).filter(
        (d) => d.kind === "requirement",
      ),
    ).toEqual([
      {
        kind: "requirement",
        at: "§3.1",
        message: `run 1 states requirement R-ODD (MUST) "${ODD}"; run 2 excludes it: "left to the decoder's own tests"`,
      },
      {
        kind: "requirement",
        at: "§3.1",
        message: `run 2 states requirement R-ODD (MUST) "${TIMING}"; run 1 excludes it: "timing is not observable"`,
      },
    ]);
  });

  test("the same quote at a different level is listed", () => {
    const b = contractA();
    b.requirements[0].level = "SHOULD";
    expect(compareContracts(contractA(), b, doc)).toEqual([
      {
        kind: "requirement",
        at: "§3",
        message:
          'run 1 states R-LOWER as MUST, run 2 as SHOULD (R-LOWER): "An encoder MUST emit two lowercase digits per byte."',
      },
    ]);
  });

  test("a non-binding requirement tested in one run only is listed", () => {
    const digits = {
      id: "R-DIGITS",
      section: "3",
      level: "DEFINITION" as const,
      quote: "two lowercase digits per byte",
    };
    const a = contractA();
    a.requirements.push(digits);
    a.clauses[0].covers = ["R-LOWER", "R-DIGITS"];
    const b = contractA();
    b.requirements.push({ ...digits });
    expect(compareContracts(a, b, doc)).toEqual([
      {
        kind: "coverage",
        at: "§3",
        message:
          'requirement "two lowercase digits per byte" is tested (R-DIGITS) in run 1, stated but untested (R-DIGITS) in run 2',
      },
    ]);
    // Both tested, or both untested: no disagreement.
    b.clauses[0].covers = ["R-LOWER", "R-DIGITS"];
    expect(compareContracts(a, b, doc)).toEqual([]);
  });

  test("a requirement from another source is compared for coverage too", () => {
    const ref = {
      id: "R-REF",
      source: "ref",
      section: "2",
      level: "MUST" as const,
      quote: "The reference MUST be used.",
    };
    const withRef = (tested: boolean) => {
      const c = contractA();
      c.sources = [...(c.sources ?? []), { id: "ref", path: "ref.md" }];
      c.requirements.push({ ...ref });
      if (tested) c.clauses[0].covers = ["R-LOWER", "R-REF"];
      return c;
    };
    expect(compareContracts(withRef(true), withRef(false), doc)).toEqual([
      {
        kind: "coverage",
        at: "ref §2",
        message:
          'requirement "The reference MUST be used." is tested (R-REF) in run 1, stated but untested (R-REF) in run 2',
      },
    ]);
    expect(compareContracts(withRef(true), withRef(true), doc)).toEqual([]);
    // One run citing it and the other not is a different requirement set.
    expect(compareContracts(withRef(true), contractA(), doc)).toEqual([
      {
        kind: "requirement",
        at: "ref §2",
        message:
          'run 1 states requirement R-REF (MUST) "The reference MUST be used."; run 2 does not state it',
      },
    ]);
  });

  test("two requirements with one quote in a run are each compared", () => {
    const a = contractA();
    a.requirements.push({ ...a.requirements[1], id: "R-ODD-2" });
    a.clauses[1].covers = ["R-ODD", "R-ODD-2"];
    const b = contractA();
    b.requirements = [b.requirements[0]];
    b.clauses = [b.clauses[0]];
    b.exclusions = [
      ...(b.exclusions ?? []),
      { section: "3.1", quote: ODD, reason: "left to the decoder's own tests" },
    ];
    const ids = compareContracts(a, b, doc)
      .filter((d) => d.kind === "requirement")
      .map((d) => d.message.split(" ")[4]);
    expect(ids).toEqual(["R-ODD", "R-ODD-2"]);
  });

  test("the second run starts fresh even when the first needed a repair", async () => {
    const wrong = contractA();
    wrong.functions[0].returns = "bytes";
    const { deps, calls } = fake([wrong, contractA(), contractA()]);
    const t = await extractTwice(inputs, deps);
    expect(t.first.attempts).toBe(2);
    expect(t.second.attempts).toBe(1);
    expect(calls).toHaveLength(3);
    expect(calls[1].turn).toContain("Your previous contract");
    expect(calls[2].turn).toBe(calls[0].turn);
    expect(calls[2].turn).not.toContain("Your previous contract");
    expect(calls[2].turn).not.toContain("[signatures]");
  });

  test("a run with no valid contract leaves nothing to compare", async () => {
    const { deps } = fake([contractA(), {}, {}]);
    const t = await extractTwice(inputs, deps, 1);
    expect(t.first.contract).not.toBeNull();
    expect(t.second.contract).toBeNull();
    expect(t.disagreements).toBeNull();
  });
});

describe("vector spec extract (the command)", () => {
  let dir: string;
  let out: string[];
  let err: string[];
  let logSpy: ReturnType<typeof spyOn>;
  let errSpy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vector-extract-"));
    writeFileSync(join(dir, "hex.md"), SPEC);
    writeFileSync(join(dir, "hex.ts"), MODULE);
    out = [];
    err = [];
    logSpy = spyOn(console, "log").mockImplementation((...a) => {
      out.push(a.join(" "));
    });
    errSpy = spyOn(console, "error").mockImplementation((...a) => {
      err.push(a.join(" "));
    });
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });
  const spec = () => join(dir, "hex.md");
  const written = () => join(dir, "contract.json");
  const specOnly = (...more: string[]) => [
    "extract",
    "--spec-only",
    "--spec",
    spec(),
    "--target",
    "nish/encoding/hex",
    "-o",
    written(),
    ...more,
  ];

  test("--spec-only writes the contract; it reads only the spec, though the module sits next to it", async () => {
    const { deps, calls } = fake([contractA()]);
    const reads = spyOn(fs, "readFileSync");
    try {
      expect(await rfcMain(specOnly(), deps)).toBe(0);
      // hex.ts, with its marker, is in the same directory and never opened.
      expect(reads.mock.calls.map((c) => String(c[0]))).not.toContain(
        join(dir, "hex.ts"),
      );
      expect(reads.mock.calls.map((c) => String(c[0]))).toContain(spec());
    } finally {
      reads.mockRestore();
    }
    expect(JSON.parse(readFileSync(written(), "utf8")).contract).toBe("hex-md");
    expect(calls).toHaveLength(1);
    expect(calls[0].turn).toContain(SPEC);
    expect(out.join("\n")).toContain(`contract written to ${written()}`);
  });

  test("--spec-only refuses --module and --nish-root, before any model call", async () => {
    const { deps, calls } = fake([contractA()]);
    expect(await rfcMain(specOnly("--module", join(dir, "hex.ts")), deps)).toBe(
      2,
    );
    expect(err.join("\n")).toContain(
      "--spec-only takes signatures from the spec",
    );
    expect(err.join("\n")).toContain("drop --module");
    expect(await rfcMain(specOnly("--nish-root", dir), deps)).toBe(2);
    expect(err.join("\n")).toContain("drop --nish-root");
    expect(calls).toHaveLength(0);
    expect(existsSync(written())).toBe(false);
  });

  test("--spec-only refuses a spec with no Interface, or one it cannot read", async () => {
    const { deps, calls } = fake([contractA()]);
    writeFileSync(spec(), SPEC.replace("## 2. Interface", "## 2. Shape"));
    expect(await rfcMain(specOnly(), deps)).toBe(2);
    expect(err.join("\n")).toContain(
      `${spec()}: the spec has no Interface section`,
    );
    writeFileSync(
      spec(),
      SPEC.replace("export const toHex = (b: u8[]): string", "export toHex"),
    );
    expect(await rfcMain(specOnly(), deps)).toBe(2);
    expect(err.join("\n")).toMatch(
      /cannot read this signature[^\n]*: "export toHex"/,
    );
    writeFileSync(spec(), "no headings at all\n");
    expect(await rfcMain(specOnly(), deps)).toBe(2);
    expect(err.join("\n")).toContain("not a specification");
    expect(calls).toHaveLength(0);
  });

  test("--spec-only still needs --spec, --target and -o", async () => {
    expect(await rfcMain(["extract", "--spec-only", "--spec", spec()])).toBe(2);
    expect(err.join("\n")).toContain(
      "error: extract --spec-only needs --spec <file> --target <module> -o <contract.json>",
    );
  });

  test("an unreadable spec is a usage error", async () => {
    const { deps, calls } = fake([contractA()]);
    const argv = specOnly();
    argv[3] = join(dir, "missing.md");
    expect(await rfcMain(argv, deps)).toBe(2);
    expect(err.join("\n")).toContain("missing.md");
    expect(calls).toHaveLength(0);
  });

  test("the module mode still runs, with the module's signatures", async () => {
    const { deps, calls } = fake([contractA()]);
    const argv = [
      "extract",
      "--spec",
      spec(),
      "--module",
      join(dir, "hex.ts"),
      "--target",
      "nish/encoding/hex",
      "-o",
      written(),
    ];
    expect(await rfcMain(argv, deps)).toBe(0);
    expect(calls[0].system).toBe(EXTRACTOR_SYSTEM_PROMPT);
    expect(calls[0].turn).toContain("toHex(u8[]): string");
  });

  test("a run with no valid contract exits 1 and writes nothing", async () => {
    const malformed = new MalformedOutputError("not a contract");
    const { deps } = fake([malformed, {}]);
    expect(await rfcMain(specOnly("--max-retries", "1"), deps)).toBe(1);
    expect(err.join("\n")).toContain("no valid contract after 2 attempt(s)");
    expect(existsSync(written())).toBe(false);
  });

  test("--twice runs in the module mode too", async () => {
    const { deps, calls } = fake([contractA(), contractB()]);
    const argv = [
      "extract",
      "--twice",
      "--spec",
      spec(),
      "--module",
      join(dir, "hex.ts"),
      "--target",
      "nish/encoding/hex",
      "-o",
      written(),
    ];
    expect(await rfcMain(argv, deps)).toBe(0);
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.system).toBe(EXTRACTOR_SYSTEM_PROMPT);
      expect(c.turn).toContain(
        "Its exported functions:\n  toHex(u8[]): string",
      );
    }
    expect(out.join("\n")).toContain("disagree in 3 place(s)");
    expect(existsSync(written())).toBe(true);
  });

  test("--twice, agreeing: no warnings, and it says so", async () => {
    const { deps } = fake([contractA(), contractA()]);
    expect(await rfcMain(specOnly("--twice"), deps)).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Two independent extractions agree");
    expect(text).not.toContain("twice requirement");
    expect(existsSync(written())).toBe(true);
  });

  test("--twice, disagreeing: warnings for the reviewer, run 1 written", async () => {
    const { deps } = fake([contractA(), contractB()]);
    expect(await rfcMain(specOnly("--twice"), deps)).toBe(0);
    const text = out.join("\n");
    expect(text).toContain(" Warnings");
    expect(text).toContain(
      "! twice requirement §3.1: run 1 states requirement R-ODD (MUST)",
    );
    expect(text).toContain("! twice coverage §3.1: MUST sentence");
    expect(text).toContain("disagree in 3 place(s), listed under Warnings");
    expect(
      JSON.parse(readFileSync(written(), "utf8")).requirements.map(
        (r: { id: string }) => r.id,
      ),
    ).toEqual(["R-LOWER", "R-ODD"]);
  });

  test("--twice --format markdown lists the disagreements in the PR comment", async () => {
    const { deps } = fake([contractA(), contractB()]);
    expect(
      await rfcMain(specOnly("--twice", "--format", "markdown"), deps),
    ).toBe(0);
    const md = out.join("\n");
    expect(md).toContain("### Warnings");
    expect(md).toContain(
      "- twice requirement §3: run 2 states R-DIGITS as DEFINITION, run 1 as MUST",
    );
    expect(md).toContain("### Two extractions");
    expect(md).toContain("disagree in 3 place(s)");
  });

  test("--twice --format markdown, agreeing, says so", async () => {
    const { deps } = fake([contractA(), contractA()]);
    expect(
      await rfcMain(specOnly("--twice", "--format", "markdown"), deps),
    ).toBe(0);
    const md = out.join("\n");
    expect(md).toContain("### Two extractions");
    expect(md).toContain("Two independent extractions agree");
    expect(md).not.toContain("twice requirement");
  });

  test("--twice --json carries the disagreements and the second run", async () => {
    const { deps } = fake([contractA(), contractB()]);
    expect(await rfcMain(specOnly("--twice", "--json"), deps)).toBe(0);
    const r = JSON.parse(out.join("\n"));
    expect(r.status).toBe("CONTRACT_VALID");
    expect(r.twice.agree).toBe(false);
    expect(r.twice.disagreements.map((d: { kind: string }) => d.kind)).toEqual([
      "requirement",
      "requirement",
      "coverage",
    ]);
    expect(r.twice.second.status).toBe("CONTRACT_VALID");
  });

  test("--twice fails closed when either run finds no valid contract", async () => {
    const { deps } = fake([contractA(), {}, {}]);
    expect(await rfcMain(specOnly("--twice", "--max-retries", "1"), deps)).toBe(
      1,
    );
    expect(err.join("\n")).toContain(
      "--twice: run 2 found no valid contract; nothing written",
    );
    expect(out.join("\n")).toContain("Run 2:");
    expect(existsSync(written())).toBe(false);
  });

  test("--twice --format markdown fails closed and says which run failed", async () => {
    const { deps } = fake([contractA(), {}, {}]);
    expect(
      await rfcMain(
        specOnly("--twice", "--max-retries", "1", "--format", "markdown"),
        deps,
      ),
    ).toBe(1);
    expect(err.join("\n")).toContain(
      "--twice: run 2 found no valid contract; nothing written",
    );
    expect(out.join("\n")).not.toContain("Two independent extractions agree");
    expect(existsSync(written())).toBe(false);
  });

  test("--twice --json, agreeing: no disagreements, both runs valid", async () => {
    const { deps } = fake([contractA(), contractA()]);
    expect(await rfcMain(specOnly("--twice", "--json"), deps)).toBe(0);
    const r = JSON.parse(out.join("\n"));
    expect(r.twice.agree).toBe(true);
    expect(r.twice.disagreements).toEqual([]);
    expect(r.twice.second.status).toBe("CONTRACT_VALID");
    expect(existsSync(written())).toBe(true);
  });

  test("--twice --json fails closed as one JSON document", async () => {
    const { deps } = fake([{}, {}, contractA()]);
    expect(
      await rfcMain(specOnly("--twice", "--max-retries", "1", "--json"), deps),
    ).toBe(1);
    const r = JSON.parse(out.join("\n"));
    expect(r.runs.map((x: { status: string }) => x.status)).toEqual([
      "INVALID",
      "CONTRACT_VALID",
    ]);
    expect(err.join("\n")).toContain("run 1 found no valid contract");
  });

  test("--spec-only and --twice are refused outside extract", async () => {
    expect(await rfcMain(["check", "x.json", "--spec-only"])).toBe(2);
    expect(err.join("\n")).toContain("--spec-only is for extract");
    expect(await rfcMain(["run", "x.json", "--twice"])).toBe(2);
    expect(err.join("\n")).toContain("--twice is for extract");
    expect(
      await rfcMain(["frozen", "--base", "main", "--format", "markdown"]),
    ).toBe(2);
    expect(err.join("\n")).toContain(
      "--format markdown is for check, emit, run, mutate and extract",
    );
  });

  test("vector rfc extract is the same command as vector spec extract", async () => {
    const argv = specOnly("--module", join(dir, "hex.ts"));
    expect(await main(["spec", ...argv])).toBe(2);
    const viaSpec = err.splice(0);
    expect(await main(["rfc", ...argv])).toBe(2);
    expect(err).toEqual(viaSpec);
    expect(await main(["rfc", ...specOnly().slice(0, 2)])).toBe(2);
    expect(err.join("\n")).toContain("extract --spec-only needs --spec");
  });

  test("vector rfc extract and vector spec extract run the same extraction", async () => {
    // The model behind src/cli.ts, with no seam: its one API call is faked.
    const turns: string[] = [];
    const call = spyOn(client, "structuredCall").mockImplementation((async (o: {
      userContent: string;
      parse: (x: unknown) => unknown;
    }) => {
      turns.push(o.userContent);
      return o.parse(contractA());
    }) as typeof client.structuredCall);
    try {
      expect(await main(["spec", ...specOnly()])).toBe(0);
      const viaSpec = {
        out: out.splice(0),
        err: err.splice(0),
        file: readFileSync(written(), "utf8"),
      };
      fs.rmSync(written());
      expect(await main(["rfc", ...specOnly()])).toBe(0);
      expect({
        out: out.splice(0),
        err: err.splice(0),
        file: readFileSync(written(), "utf8"),
      }).toEqual(viaSpec);
      expect(turns).toHaveLength(2);
      expect(turns[1]).toBe(turns[0]);
      expect(JSON.parse(viaSpec.file).contract).toBe("hex-md");
    } finally {
      call.mockRestore();
    }
  });
});
