// A contract's sources, read from disk: each declared source's file, found
// as sourceFile finds it and judged as sourcePathProblem judges it, then read
// by the reader its form needs — RFC XML v3 (xmlv3.ts), or an RFC's plain text
// or a markdown spec (spectext.ts). vector never touches the network: an RFC
// found nowhere is an error that says how to fetch it.

import {
  type RfcContract,
  type SourceDecl,
  declaredSources,
} from "./contract.ts";
import {
  readChecked,
  recordedProblem,
  sourceFile,
  sourceLabel,
  sourcePathProblem,
} from "./frozen.ts";
import type { RfcDocument } from "./rfctext.ts";
import { parseDocument } from "./spectext.ts";
import { type V3Document, isV3Xml, parseV3 } from "./xmlv3.ts";

/**
 * The command that fetches RFC `n` into rfcs/. The RFC Editor publishes XML
 * v3 from RFC 8650 on, and plain text before it, but RFCs 8650 to 8699 came
 * out as the format changed over, so for those both are offered and the user
 * picks the one that exists.
 */
export function fetchHint(n: number): string {
  const curl = (x: string) =>
    `curl -sSfL -o rfcs/rfc${n}.${x} https://www.rfc-editor.org/rfc/rfc${n}.${x}`;
  if (n >= 8700) return curl("xml");
  if (n < 8650) return curl("txt");
  return `${curl("xml")} (or, if it has no XML, ${curl("txt")})`;
}

/** An RFC a contract declares, found in none of the places sourceFile looks. */
export class MissingRfcFile extends Error {
  readonly rfc: number;
  readonly hint: string;
  constructor(rfc: number) {
    const hint = fetchHint(rfc);
    super(`rfc${rfc} not found; fetch it: ${hint}`);
    this.name = "MissingRfcFile";
    this.rfc = rfc;
    this.hint = hint;
  }
}

/**
 * A source a contract may not read (sourcePathProblem), or that is not a file.
 * Its own class so the CLI can say how to give the main source another way.
 */
export class SourcePathError extends Error {}

export interface LoadedSource {
  decl: SourceDecl;
  /** The file read, as an absolute path. */
  file: string;
  /** The sha256 of its bytes. */
  sha256: string;
  doc: RfcDocument | V3Document;
}

/**
 * A source's document, by its form: RFC XML v3 if the file is .xml or its
 * text opens as an <rfc> document, else an RFC's text or a markdown spec.
 * A refusal names the file.
 */
export function readDocument(
  file: string,
  text: string,
): RfcDocument | V3Document {
  if (file.endsWith(".xml") || isV3Xml(text)) return parseV3(text, file);
  try {
    return parseDocument(text);
  } catch (err) {
    throw new Error(`${file}: ${(err as Error).message}`);
  }
}

/**
 * Read one declared source. `given` is a file the user named for it (--spec),
 * which is read without judging its path; otherwise the file is sourceFile's,
 * and must be spec text. Throws MissingRfcFile for an RFC found nowhere,
 * SourcePathError for a file it may not read, and an Error for one it cannot
 * open or parse.
 */
export function loadSource(
  decl: SourceDecl,
  contractPath: string,
  given?: string,
): LoadedSource {
  const file = given ?? sourceFile(decl, contractPath);
  // sourceFile always resolves a `path`, so only an RFC can be found nowhere.
  if (!file) throw new MissingRfcFile(decl.rfc as number);
  let got: ReturnType<typeof readChecked>;
  try {
    got = readChecked(file, (f) =>
      given ? undefined : sourcePathProblem(decl, contractPath, f),
    );
  } catch {
    throw new Error(`cannot read ${file}`);
  }
  if ("problem" in got) throw new SourcePathError(got.problem);
  return {
    decl,
    file,
    sha256: got.sha256,
    doc: readDocument(file, got.text),
  };
}

/**
 * RFC `n` as a contract's `sources` entry records it: the file it was read
 * from, named as recordedProblem will name it (sourceLabel), and its sha256.
 * Throws as loadSource does.
 */
export function rfcDecl(
  n: number,
  contractPath: string,
): SourceDecl & { file: string; sha256: string } {
  const decl: SourceDecl = { id: `rfc${n}`, rfc: n };
  const got = loadSource(decl, contractPath);
  // sourceFile looks only where sourceLabel can name a file: beside the
  // contract, or in an rfcs/.
  const file = sourceLabel(got.file, contractPath) as string;
  return { ...decl, file, sha256: got.sha256 };
}

/**
 * Every source a contract declares, by id, and the fidelity problems of those
 * read from another file, or other bytes, than their entry records. `main` is
 * the main source's file when the user gave one (--spec).
 */
export function loadSources(
  c: RfcContract,
  contractPath: string,
  main?: string,
): { docs: Map<string, RfcDocument>; problems: Map<string, string> } {
  const docs = new Map<string, RfcDocument>();
  const problems = new Map<string, string>();
  const declared = declaredSources(c);
  for (const decl of declared.list) {
    const given = decl.id === declared.main ? main : undefined;
    let got: LoadedSource;
    try {
      got = loadSource(decl, contractPath, given);
    } catch (err) {
      if (!(err instanceof SourcePathError)) throw err;
      throw new SourcePathError(
        `${contractPath}: ${err.message}${decl.id === declared.main ? " (to check against another file, give it with --spec, and update its sources entry's file and sha256 if it records them)" : ""}`,
      );
    }
    const problem = recordedProblem(decl, contractPath, got.file, got.sha256);
    if (problem) problems.set(decl.id, problem);
    docs.set(decl.id, got.doc);
  }
  return { docs, problems };
}
