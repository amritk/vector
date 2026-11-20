import { replaceAll } from "nish/text"

/**
 * The module paths every reader of one must agree on: `charsIsModule`, the
 * contract's shape check, the schema's `modulePath` pattern and the
 * ts-interface module lines each accept the first list and refuse the second.
 */

/**
 * One place in a path a single character fills (`#`), with the characters the
 * grammar accepts there and the neighbours it refuses. Each range is probed at
 * both ends and at two characters inside, so a range narrowed, widened or
 * rewritten by one character moves a path from one list to the other.
 */
class ModulePathSlot {
  path: string
  accepted: string[]
  refused: string[]
  constructor(path: string, accepted: string[], refused: string[]) {
    this.path = path
    this.accepted = accepted
    this.refused = refused
  }
}

/** Every character slot of the grammar: a segment's first, later-word first and continuation characters, in the root and a later segment. */
const modulePathSlots = (): ModulePathSlot[] => {
  const outside = ["`", "{", "/", ":", "@", "A", "Z", "[", ".", "-"]
  const first = ["a", "b", "m", "z"]
  const later = ["a", "b", "m", "z", "0", "1", "5", "9"]
  const rest = ["a", "b", "m", "z", "0", "1", "5", "9", "_"]
  const notFirst = ["`", "{", "/", ":", "@", "A", "Z", "[", ".", "-", "0", "5", "9", "_"]
  const notLater = ["`", "{", "/", ":", "@", "A", "Z", "[", ".", "-", "_"]
  return [
    new ModulePathSlot("#/a", first, notFirst),
    new ModulePathSlot("x/#", first, notFirst),
    new ModulePathSlot("n-#/a", later, notLater),
    new ModulePathSlot("x/n-#", later, notLater),
    new ModulePathSlot("n#/a", rest, outside),
    new ModulePathSlot("n-x#/a", rest, outside),
    new ModulePathSlot("x/n#", rest, outside),
    new ModulePathSlot("x/n-x#", rest, outside),
  ]
}

/** `literal`, then each slot's path with `#` replaced by each of its accepted (or refused) characters. */
const modulePathsFilled = (accepted: boolean, literal: string[]): string[] => {
  const out = literal.slice(0)
  for (const slot of modulePathSlots()) {
    for (const c of accepted ? slot.accepted : slot.refused) {
      out.push(replaceAll(slot.path, "#", c))
    }
  }
  return out
}

/** Module paths the segment grammar accepts, hyphenated and not. */
export const modulePathsAccepted = (): string[] =>
  modulePathsFilled(true, [
    "nish-a-b/c",
    "n-abc/a",
    "nish/a-b",
    "nish/net/quic-packet",
    "nish/net/http1-codec",
    "nish/crypto/x509-random",
    "nish/a-1",
    "nish/a_b-c",
    "nish/a-b-c",
    "nish-x/a",
    "nish/crypto/hkdf",
    "nish/a1_",
    "nish/a-0",
    "nish/a-b_",
    "nish/a0-b",
    "nish/a_-b",
  ])

/**
 * Module paths the segment grammar refuses: a hyphen at a word's edge,
 * doubled, before `_` or beside a capital, or a character outside a class.
 */
export const modulePathsRefused = (): string[] =>
  modulePathsFilled(false, [
    "n.a/b",
    "nish/n.a",
    "nish/-a",
    "nish/a-",
    "nish/a--b",
    "nish/A-b",
    "nish/a-_b",
    "nish/a-B",
    "-nish/a",
    "nish-/a",
    "nish/a/-",
    "nish/-",
    "nish/a-/b",
    "nish",
    "nish-a",
    "Nish/a",
    "nish//a",
    "nish/1a",
    "nish/_a",
  ])
