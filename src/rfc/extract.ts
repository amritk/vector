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
import { SIDECAR_SUFFIX, VECTOR_ROOT, sourceLabel } from "./frozen.ts";
import { type GateIssue, runGates } from "./gates.ts";
import {
  type Locator,
  type Refusal,
  locate,
  profileToContract,
  whereOf,
} from "./profile.ts";
import type { RfcDocument } from "./rfctext.ts";
import {
  type LoadedSource,
  MissingRfcFile,
  MissingRfcFiles,
  loadSource,
} from "./sources.ts";
import { type V3Document, XmlRefusal } from "./xmlv3.ts";

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
 * object expanded; an array that holds no object on one line when that line, with
 * its trailing comma, is at most 80 characters, else expanded: an array of
 * numbers filled, as many to a line as fit, any other one element per line.
 */
export function canonicalJson(v: unknown): string {
  const write = (x: unknown, indent: string, used: number): string => {
    const inner = `${indent}  `;
    if (Array.isArray(x)) {
      if (x.length === 0) return "[]";
      const flat = inline(x);
      if (flat !== undefined && used + width(flat) <= LINE_WIDTH) return flat;
      if (x.every((e) => typeof e === "number")) return fill(x, inner, indent);
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

/** `x` on one line, or undefined when it holds an object. */
function inline(x: unknown): string | undefined {
  if (!Array.isArray(x))
    return x !== null && typeof x === "object" ? undefined : JSON.stringify(x);
  const items = x.map(inline);
  return items.every((e) => e !== undefined)
    ? `[${items.join(", ")}]`
    : undefined;
}

/**
 * An array of numbers expanded as biome fills it: each line holds as many
 * elements, each with its comma, as fit in 80 characters.
 */
function fill(x: number[], inner: string, indent: string): string {
  const lines: string[] = [];
  let line = "";
  x.forEach((e, i) => {
    const item = JSON.stringify(e) + (i < x.length - 1 ? "," : "");
    if (line !== "" && width(`${line} ${item}`) <= LINE_WIDTH) {
      line = `${line} ${item}`;
    } else {
      if (line !== "") lines.push(line);
      line = inner + item;
    }
  });
  lines.push(line);
  return `[\n${lines.join("\n")}\n${indent}]`;
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
 * The sidecar that holds the allowSurvivors of a contract, beside it:
 * contracts/<name>.survivors.json. `spec frozen` skips it (SIDECAR_SUFFIX).
 */
export function survivorsPath(contractPath: string): string {
  return join(
    dirname(contractPath),
    `${basename(contractPath, ".json")}${SIDECAR_SUFFIX}`,
  );
}

/** The sidecar's allowSurvivors, or undefined when there is no sidecar. */
function readSurvivors(contractPath: string): unknown[] | undefined {
  const file = survivorsPath(contractPath);
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
function rfcEntry(got: LoadedSource, contractPath: string): SourceDecl {
  const n = got.decl.rfc as number;
  const here = dirname(resolve(contractPath));
  const file = resolve(got.file);
  const local = [here, join(here, "..", "rfcs")].includes(dirname(file));
  // sourceFile looks only where sourceLabel can name a file, so this is a
  // guard: a contract never records `"file": undefined`.
  const label = sourceLabel(got.file, contractPath);
  if (label === undefined)
    throw new Error(
      `${got.file} is in no place a contract at ${contractPath} can name it from`,
    );
  return {
    id: `rfc${n}`,
    rfc: n,
    ...(local ? { path: posix(relative(here, file)) } : {}),
    file: label,
    sha256: got.sha256,
  };
}

/** The contract schema, named from the contract as `$schema`. */
const SCHEMA = "schemas/rfc-contract.json";

/** A relative path with `/` separators, as a contract records one. */
const posix = (p: string): string => p.split(sep).join("/");

/** A refusal as extract prints it: `file:line: message`. */
const refusalLine = (r: Refusal): string => `${r.file}:${r.line}: ${r.message}`;

/**
 * The markdown the spec at `xmlPath` is built from, as scripts/build-spec.sh
 * reads it: the `.md` beside it with its base name, written in the form
 * `xmlPath` is. Undefined when that file is not on disk, so a refusal never
 * names a file that is not there: it names the XML at its XML line instead.
 */
function mdBeside(xmlPath: string): string | undefined {
  if (!xmlPath.endsWith(".xml")) return undefined;
  const md = `${xmlPath.slice(0, -".xml".length)}.md`;
  return existsSync(md) ? md : undefined;
}

/**
 * An XmlRefusal as `file:line: reason`, where the profile's refusals are:
 * in the markdown `md` at the markdown line when both are known, else in the
 * XML `file` at the XML line.
 */
function xmlRefusalLine(err: XmlRefusal, file: string, md?: string): string {
  const at = `${file}:${err.loc.xmlLine}: `;
  const w = whereOf(err.loc, file, md);
  return w.file === file || !err.message.startsWith(at)
    ? err.message
    : `${w.file}:${w.line}: ${err.message.slice(at.length)}`;
}

/**
 * The gates' issues as refusals, sorted by line, each once: two clauses'
 * fields can break one rule on one line. An issue with the sidecar's
 * allowSurvivors is the sidecar's, so it names that file, after the rest.
 */
export function gateRefusals(
  issues: GateIssue[],
  locator: Locator,
  sidecar: string,
): string[] {
  const rows = issues.map((i) => {
    const what = `${i.gate}: ${i.message}`;
    if (i.message.startsWith("allowSurvivors"))
      return { line: Number.MAX_SAFE_INTEGER, text: `${sidecar}: ${what}` };
    const { file, line } = locate(locator, i.at);
    return { line, text: `${file}:${line}: ${what}` };
  });
  return [...new Set(rows.sort((a, b) => a.line - b.line).map((r) => r.text))];
}

export type ExtractResult = { text: string } | { refusals: string[] };

/**
 * The canonical contract for the spec at `xmlPath`, to be written at
 * `contractPath`, or every refusal: the XML's, the profile's and the gates',
 * each `file:line: message`. Throws MissingRfcFiles naming every RFC it cites
 * that is found nowhere, and an Error for a file it cannot read.
 */
export function extract(xmlPath: string, contractPath: string): ExtractResult {
  const rfcs = new Map<number, LoadedSource>();
  const missing: MissingRfcFile[] = [];
  let spec: LoadedSource;
  let read: ReturnType<typeof profileToContract>;
  const md = mdBeside(xmlPath);
  try {
    // Read, hashed and parsed as `spec check --spec` reads it.
    spec = loadSource({ id: "spec", path: xmlPath }, contractPath, xmlPath);
    read = profileToContract(
      spec.doc as V3Document,
      xmlPath,
      (n) => {
        try {
          const got = loadSource({ id: `rfc${n}`, rfc: n }, contractPath);
          rfcs.set(n, got);
          return got.doc;
        } catch (err) {
          // A cited RFC's XML is an input extract cannot read, not the spec's
          // refusal: an error (exit 2) that names the RFC's file.
          if (err instanceof XmlRefusal) throw new Error(err.message);
          if (!(err instanceof MissingRfcFile)) throw err;
          missing.push(err);
          // Read as an RFC with no sections; its refusals are not printed.
          return { number: n, sections: new Map() };
        }
      },
      md,
    );
  } catch (err) {
    if (err instanceof XmlRefusal)
      return { refusals: [xmlRefusalLine(err, xmlPath, md)] };
    throw err;
  }
  if (missing.length > 0) throw new MissingRfcFiles(missing);
  if ("refusals" in read) return { refusals: read.refusals.map(refusalLine) };

  const { contract, locator } = read;
  const survivors = readSurvivors(contractPath);
  const here = dirname(contractPath);
  // The gates read each source as it was read here: the spec and every RFC.
  const docs = new Map<string, RfcDocument>();
  const full = ordered({
    $schema: posix(relative(here, join(VECTOR_ROOT, SCHEMA))),
    ...contract,
    source: { ...contract.source, sha256: spec.sha256 },
    sources: contract.sources?.map((d) => {
      if (d.rfc === undefined) {
        // The spec itself, by its path from where the contract is written.
        docs.set(d.id, spec.doc);
        return { ...d, path: posix(relative(here, xmlPath)) };
      }
      const got = rfcs.get(d.rfc) as LoadedSource;
      docs.set(d.id, got.doc);
      return rfcEntry(got, contractPath);
    }),
    ...(survivors ? { allowSurvivors: survivors } : {}),
  }) as unknown as RfcContract;

  // The gates `spec check` runs, but the source commands' and the module's.
  const { issues } = runGates(full, { docs });
  if (issues.length > 0)
    return {
      refusals: gateRefusals(issues, locator, survivorsPath(contractPath)),
    };
  return { text: canonicalJson(full) };
}

/** Marks a last line that has no newline; JSON text holds no NUL. */
const NO_EOL = "\u0000";

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
  // A last line with no newline is marked, so it differs from one with one.
  const split = (s: string) => {
    if (s === "") return [];
    const lines = s.replace(/\n$/, "").split("\n");
    if (!s.endsWith("\n")) lines[lines.length - 1] += NO_EOL;
    return lines;
  };
  const x = split(a);
  const y = split(b);
  // The lines both share at the start and the end need no LCS.
  let pre = 0;
  while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre++;
  let suf = 0;
  while (
    suf < x.length - pre &&
    suf < y.length - pre &&
    x[x.length - 1 - suf] === y[y.length - 1 - suf]
  )
    suf++;
  const xm = x.length - suf;
  const ym = y.length - suf;
  // L(i, j): the longest common subsequence of x[i..xm] and y[j..ym].
  const lcs = Array.from({ length: xm - pre + 1 }, () =>
    new Array<number>(ym - pre + 1).fill(0),
  );
  const L = (i: number, j: number) => lcs[i - pre][j - pre];
  for (let i = xm - 1; i >= pre; i--)
    for (let j = ym - 1; j >= pre; j--)
      lcs[i - pre][j - pre] =
        x[i] === y[j]
          ? L(i + 1, j + 1) + 1
          : Math.max(L(i + 1, j), L(i, j + 1));
  // The edit script: " ", "-" or "+" and the line, with each side's index.
  const ops: { op: string; line: string; i: number; j: number }[] = [];
  for (let k = 0; k < pre; k++) ops.push({ op: " ", line: x[k], i: k, j: k });
  let i = pre;
  let j = pre;
  while (i < xm || j < ym) {
    if (i < xm && j < ym && x[i] === y[j]) {
      ops.push({ op: " ", line: x[i], i: i++, j: j++ });
    } else if (i < xm && (j === ym || L(i + 1, j) >= L(i, j + 1))) {
      // A deletion before an insertion, as diff -u prints them.
      ops.push({ op: "-", line: x[i], i: i++, j });
    } else {
      ops.push({ op: "+", line: y[j], i, j: j++ });
    }
  }
  for (let k = 0; k < suf; k++)
    ops.push({ op: " ", line: x[xm + k], i: xm + k, j: ym + k });
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
    // Each side's lines: the context and its own changes.
    const aCount = hunk.filter((o) => o.op !== "+").length;
    const bCount = hunk.filter((o) => o.op !== "-").length;
    const from = (n: number, at: number) => (n === 0 ? at : at + 1);
    out.push(
      `@@ -${from(aCount, hunk[0].i)},${aCount} +${from(bCount, hunk[0].j)},${bCount} @@`,
      ...hunk.map((o) =>
        (o.op + o.line).replace(NO_EOL, "\n\\ No newline at end of file"),
      ),
    );
    k = stop;
  }
  return `${out.join("\n")}\n`;
}
