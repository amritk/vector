// The front-end registry. A spec carries its interface and its properties in
// sourcecode blocks whose type names a language (`ts-interface`,
// `ts-property`); the profile asks this registry for the front end of that
// language, so the core never knows TypeScript and a `rust-…` front end can
// be added beside it.

import type { FnSig, PropertyClause } from "../contract.ts";
import { tsFrontEnd } from "./ts.ts";

/** Why a block was refused; line and column (1-based) count from the block's first line. */
export interface FrontRefusal {
  message: string;
  line: number;
  col: number;
}

/** What a property block says, without the fields the profile fills in. */
export interface ParsedProperty {
  id: string;
  title?: string;
  covers: string[];
  clause: Omit<PropertyClause, "id" | "title" | "covers" | "kind">;
}

export interface FrontEnd {
  parseInterface(
    text: string,
  ): { module: string; functions: FnSig[] } | { refusals: FrontRefusal[] };
  parseProperty(
    text: string,
    fns: FnSig[],
  ): ParsedProperty | { refusals: FrontRefusal[] };
}

const FRONT_ENDS: Record<string, FrontEnd> = { ts: tsFrontEnd };

/**
 * The front end for a sourcecode type, by the language prefix before its
 * first `-` ("ts-interface", "ts-property" → TypeScript); undefined for a
 * type no front end reads.
 */
export function frontEndFor(sourcecodeType: string): FrontEnd | undefined {
  const dash = sourcecodeType.indexOf("-");
  if (dash <= 0) return undefined;
  const lang = sourcecodeType.slice(0, dash);
  return Object.hasOwn(FRONT_ENDS, lang) ? FRONT_ENDS[lang] : undefined;
}
