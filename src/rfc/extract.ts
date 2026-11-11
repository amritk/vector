// `vector spec extract`: an RFC XML v3 spec (xml2rfc's output for a
// kramdown-rfc spec) → its canonical contract. The profile (profile.ts) reads
// the contract; extract records what the profile cannot know — the bytes it
// read — runs the gates `spec check` runs, and writes the contract in one
// canonical form, so a committed contract can be checked against its spec with
// `--check`. extract never touches the network and never runs xml2rfc: an RFC
// found nowhere is an error that says how to fetch it.

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { RfcContract, SourceDecl } from "./contract.ts";
import { sha256 } from "./emit-nish.ts";
import { sourceLabel } from "./frozen.ts";
import { runGates } from "./gates.ts";
import { type Refusal, locate, profileToContract } from "./profile.ts";
import {
  type LoadedSource,
  MissingRfcFile,
  MissingRfcFiles,
  loadSource,
  loadSources,
} from "./sources.ts";
import { XmlRefusal, parseV3 } from "./xmlv3.ts";

/**
 * The key order of a contract's top level, as the committed contracts write
 * it. It is the schema's (schemas/rfc-contract.json) but for `exclusions`,
 * which comes after `requirements` here, beside the other quoted text. A key
 * not listed keeps its place after these. Below the top level the profile
 * builds each object in this order, and extract adds keys in it:
 *
 *   source        title, main, sha256
 *   sources[]     id, rfc, path, file, sha256
 *   requirements  id, source, section, level, quote
 *   exclusions    source, section, quote, reason
 *   functions     name, params, returns
 *   clauses       vector:   kind, id, title, covers, source, section, call, args, expect
 *                 property: kind, id, title, covers, forall, where, assert
 */
export const CONTRACT_KEYS = [
  "$schema",
  "contract",
  "source",
  "sources",
  "target",
  "requirements",
  "exclusions",
  "functions",
  "clauses",
  "outOfScope",
  "allowSurvivors",
] as const;

/** The widest line an array of primitives may be written on, as biome does. */
const LINE_WIDTH = 80;

const width = (s: string): number => [...s].length;

/**
 * `v` as canonical JSON, as biome formats it, so a written contract passes
 * `biome check`: 2-space indent, `\n`, a trailing newline; every non-empty
 * object expanded; an array of primitives on one line when that line, with
 * its trailing comma, is at most 80 characters, else one element per line.
 */
export function canonicalJson(v: unknown): string {
  const write = (x: unknown, indent: string, used: number): string => {
    const inner = `${indent}  `;
    if (Array.isArray(x)) {
      if (x.length === 0) return "[]";
      if (x.every((e) => e === null || typeof e !== "object")) {
        const flat = `[${x.map((e) => JSON.stringify(e)).join(", ")}]`;
        if (used + width(flat) <= LINE_WIDTH) return flat;
      }
      const items = x.map(
        (e, i) => inner + write(e, inner, width(inner) + comma(i, x.length)),
      );
      return `[\n${items.join(",\n")}\n${indent}]`;
    }
    if (x !== null && typeof x === "object") {
      const entries = Object.entries(x);
      if (entries.length === 0) return "{}";
      const items = entries.map(([k, e], i) => {
        const key = `${inner}${JSON.stringify(k)}: `;
        return key + write(e, inner, width(key) + comma(i, entries.length));
      });
      return `{\n${items.join(",\n")}\n${indent}}`;
    }
    return JSON.stringify(x);
  };
  return `${write(v, "", 0)}\n`;
}

/** The width of the comma after element `i` of `n`. */
const comma = (i: number, n: number): number => (i < n - 1 ? 1 : 0);

/** `c` with its top-level keys in CONTRACT_KEYS order. */
function ordered(c: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    ...CONTRACT_KEYS.filter((k) => Object.hasOwn(c, k)),
    ...Object.keys(c).filter(
      (k) => !(CONTRACT_KEYS as readonly string[]).includes(k),
    ),
  ];
  return Object.fromEntries(keys.map((k) => [k, c[k]]));
}

/**
 * The contract a spec's XML is extracted to when no `-o` names one:
 * contracts/<name>.json beside the spec's specs/.
 */
export function defaultContractPath(xmlPath: string): string {
  return join(
    dirname(xmlPath),
    "..",
    "contracts",
    `${basename(xmlPath, ".xml")}.json`,
  );
}

/**
 * The sidecar that holds the allowSurvivors of a spec's contract, beside the
 * spec: specs/<name>.survivors.json. Not in contracts/, where `spec frozen`
 * reads every .json as a contract.
 */
export function survivorsPath(xmlPath: string): string {
  return join(dirname(xmlPath), `${basename(xmlPath, ".xml")}.survivors.json`);
}

/** The sidecar's allowSurvivors, or undefined when there is no sidecar. */
function readSurvivors(xmlPath: string): unknown[] | undefined {
  const file = survivorsPath(xmlPath);
  if (!existsSync(file)) return undefined;
  let got: unknown;
  try {
    got = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`cannot read ${file}: ${(err as Error).message}`);
  }
  const list = (got as { allowSurvivors?: unknown } | null)?.allowSurvivors;
  if (!Array.isArray(list))
    throw new Error(`${file}: expected {"allowSurvivors": [...]}`);
  return list;
}

/**
 * RFC `got` as the contract's `sources` entry records it: `path` when the
 * file is in one of the contract's own places (beside it, or in the rfcs/
 * beside its directory) — one in vector's rfcs/ has none, so the contract
 * names no install — then `file` (sourceLabel) and `sha256`.
 */
function rfcEntry(
  n: number,
  got: LoadedSource,
  contractPath: string,
): SourceDecl {
  const here = dirname(resolve(contractPath));
  const file = resolve(got.file);
  const local = [here, join(here, "..", "rfcs")].includes(dirname(file));
  return {
    id: `rfc${n}`,
    rfc: n,
    ...(local ? { path: relative(here, file).split(sep).join("/") } : {}),
    // sourceFile looks only where sourceLabel can name a file.
    file: sourceLabel(got.file, contractPath) as string,
    sha256: got.sha256,
  };
}

/** A refusal as extract prints it: `file:line: message`. */
const refusalLine = (r: Refusal): string => `${r.file}:${r.line}: ${r.message}`;

/**
 * An XmlRefusal as `file:line: reason`, at the markdown line when the XML
 * carries one, as the profile's refusals are.
 */
function xmlRefusalLine(err: XmlRefusal): string {
  const { xmlLine, mdLine } = err.loc;
  return mdLine === undefined
    ? err.message
    : err.message.replace(`:${xmlLine}: `, `:${mdLine}: `);
}

export type ExtractResult = { text: string } | { refusals: string[] };

/**
 * The canonical contract for the spec at `xmlPath`, to be written at
 * `contractPath`, or every refusal: the XML's, the profile's and the gates',
 * each `file:line: message`. Throws MissingRfcFiles naming every RFC it cites
 * that is found nowhere, and an Error for a file it cannot read.
 */
export function extract(xmlPath: string, contractPath: string): ExtractResult {
  let text: string;
  try {
    text = readFileSync(xmlPath, "utf8");
  } catch (err) {
    throw new Error(`cannot read ${xmlPath}: ${(err as Error).message}`);
  }
  const rfcs = new Map<number, LoadedSource>();
  const missing: MissingRfcFile[] = [];
  let read: ReturnType<typeof profileToContract>;
  try {
    const doc = parseV3(text, xmlPath);
    read = profileToContract(doc, xmlPath, (n) => {
      try {
        const got = loadSource({ id: `rfc${n}`, rfc: n }, contractPath);
        rfcs.set(n, got);
        return got.doc;
      } catch (err) {
        if (!(err instanceof MissingRfcFile)) throw err;
        missing.push(err);
        // Read as an RFC with no sections; its refusals are not printed.
        return { number: n, sections: new Map() };
      }
    });
  } catch (err) {
    if (err instanceof XmlRefusal) return { refusals: [xmlRefusalLine(err)] };
    throw err;
  }
  if (missing.length > 0) throw new MissingRfcFiles(missing);
  if ("refusals" in read) return { refusals: read.refusals.map(refusalLine) };

  const { contract, locator } = read;
  const survivors = readSurvivors(xmlPath);
  const full = ordered({
    $schema: "../schemas/rfc-contract.json",
    ...contract,
    source: { ...contract.source, sha256: sha256(Buffer.from(text, "utf8")) },
    sources: contract.sources?.map((d) => {
      const got = d.rfc === undefined ? undefined : rfcs.get(d.rfc);
      return got ? rfcEntry(d.rfc as number, got, contractPath) : d;
    }),
    ...(survivors ? { allowSurvivors: survivors } : {}),
  }) as unknown as RfcContract;

  // The gates `spec check` runs, but the source commands' and the module's.
  // Each source's file and sha256 were just recorded from what was read, so
  // loadSources has no fidelity problem to report.
  const { issues } = runGates(full, {
    docs: loadSources(full, contractPath, xmlPath).docs,
  });
  if (issues.length > 0) {
    const lines = issues
      .map((i) => ({ ...locate(locator, i.at), i }))
      .sort((a, b) => a.line - b.line)
      .map(({ file, line, i }) => `${file}:${line}: ${i.gate}: ${i.message}`);
    // Two clauses' fields can break one rule on one line: print it once.
    return { refusals: [...new Set(lines)] };
  }
  return { text: canonicalJson(full) };
}

/**
 * A unified diff of `a` (the file `aName`) against `b` (`bName`), with three
 * lines of context, or "" when they are equal. Lines are matched by their
 * longest common subsequence.
 */
export function unifiedDiff(
  a: string,
  b: string,
  aName: string,
  bName: string,
): string {
  if (a === b) return "";
  const split = (s: string) =>
    s === "" ? [] : s.replace(/\n$/, "").split("\n");
  const x = split(a);
  const y = split(b);
  // lcs[i][j]: the longest common subsequence of x[i..] and y[j..].
  const lcs = Array.from({ length: x.length + 1 }, () =>
    new Array<number>(y.length + 1).fill(0),
  );
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      lcs[i][j] =
        x[i] === y[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  // The edit script: " ", "-" or "+" and the line, with each side's index.
  const ops: { op: string; line: string; i: number; j: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      ops.push({ op: " ", line: x[i], i: i++, j: j++ });
    } else if (
      i < x.length &&
      (j === y.length || lcs[i + 1][j] >= lcs[i][j + 1])
    ) {
      // A deletion before an insertion, as diff -u prints them.
      ops.push({ op: "-", line: x[i], i: i++, j });
    } else {
      ops.push({ op: "+", line: y[j], i, j: j++ });
    }
  }
  const CONTEXT = 3;
  const out = [`--- ${aName}`, `+++ ${bName}`];
  for (let k = 0; k < ops.length; ) {
    if (ops[k].op === " ") {
      k++;
      continue;
    }
    // A hunk: from CONTEXT lines before this change to CONTEXT after the
    // last change that is within 2 * CONTEXT unchanged lines of the next.
    const start = Math.max(0, k - CONTEXT);
    let end = k;
    for (let m = k, quiet = 0; m < ops.length; m++) {
      if (ops[m].op === " ") {
        if (++quiet > 2 * CONTEXT) break;
      } else {
        quiet = 0;
        end = m;
      }
    }
    const stop = Math.min(ops.length, end + 1 + CONTEXT);
    const hunk = ops.slice(start, stop);
    const count = (side: string) => hunk.filter((o) => o.op !== side).length;
    const from = (n: number, at: number) => (n === 0 ? at : at + 1);
    const aCount = count("+");
    const bCount = count("-");
    out.push(
      `@@ -${from(aCount, hunk[0].i)},${aCount} +${from(bCount, hunk[0].j)},${bCount} @@`,
      ...hunk.map((o) => o.op + o.line),
    );
    k = stop;
  }
  return `${out.join("\n")}\n`;
}
