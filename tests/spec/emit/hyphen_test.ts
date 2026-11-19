import { Suite } from "nish/testing"
import { contains, replaceAll } from "nish/text"
import { dirname, makeTempDir, mkdirAll } from "../../../src/core/fs"
import { runProcess } from "../../../src/core/process"
import { vectorRun } from "../../../src/index"
import { runDisposeScratch, runMakeScratch, runRemove } from "../../../src/spec/run/run"

/** The module example-hex's copies are moved to: a hyphen inside a segment. */
const HYPHEN_MODULE: string = "nish/net/quic-packet"

/**
 * Writes `text` to `dir/rel`, making its directory.
 *
 * @returns whether it was written
 */
const hyphenWrite = (dir: string, rel: string, text: string): boolean => {
  const path = `${dir}/${rel}`
  if (mkdirAll(dirname(path), 0o755).isErr()) {
    return false
  }
  writeFileSync(path, text)
  return (readFileSyncOrNull(path) ?? "-") === text
}

/**
 * A directory holding contracts/example-hex.json moved to nish/net/quic-packet
 * as contracts/c.json, the same contract as app/net/quic-packet as
 * contracts/a.json, the sources both quote, and an empty src/net/quic-packet
 * in each language a `--package` reads.
 *
 * @returns the directory, or why it could not be made
 */
const hyphenLayout = (): Result<string, string> => {
  const dir = makeTempDir("vector-hyphen-").orReturn()
  const contract = readFileSyncOrNull("contracts/example-hex.json")
  const spec = readFileSyncOrNull("specs/example-hex.xml")
  const rfc = readFileSyncOrNull("rfcs/rfc4648.txt")
  if (contract === null || spec === null || rfc === null) {
    return Err("cannot read contracts/example-hex.json or its sources")
  }
  const nish = replaceAll(
    replaceAll(contract, '"nish/hex"', `"${HYPHEN_MODULE}"`),
    "std/hex.ts",
    "std/net/quic-packet.ts",
  )
  const app = replaceAll(
    replaceAll(contract, '"nish/hex"', '"app/net/quic-packet"'),
    "std/hex.ts",
    "src/net/quic-packet.ts",
  )
  const files: string[][] = [
    ["contracts/c.json", nish],
    ["contracts/a.json", app],
    ["specs/example-hex.xml", spec],
    ["rfcs/rfc4648.txt", rfc],
    ["src/net/quic-packet.ts", ""],
    ["src/net/quic-packet.py", ""],
    ["src/net/quic-packet.rs", ""],
    ["src/net/quic-packet.go", ""],
  ]
  for (const f of files) {
    if (!hyphenWrite(dir, f[0], f[1])) {
      return Err(`cannot write ${dir}/${f[0]}`)
    }
  }
  return Ok(dir)
}

/**
 * Each language's emitted import of nish/net/quic-packet, and of
 * app/net/quic-packet placed by `--package app=<dir>/src`: the language, the
 * test file's extension, the line for the nish module, the line for the
 * package's.
 */
const hyphenImports = (): string[][] => [
  ["nish", "ts", 'import { hexDecode, hexEncode } from "nish/net/quic-packet";', 'from "./src/net/quic-packet";'],
  [
    "python",
    "py",
    "from nish.net.quic_packet import hex_decode, hex_encode",
    '_m0 = _load("app.net.quic_packet", "./src/net/quic-packet.py")',
  ],
  ["rust", "rs", "use nish::net::quic_packet::{hex_decode, hex_encode};", '#[path = "./src/net/quic-packet.rs"]'],
  ["go", "go", '_m0 "nish/net/quic-packet"', '_m0 "app/net/quic-packet"'],
  [
    "typescript",
    "ts",
    'import { hexDecode, hexEncode } from "nish/net/quic-packet"',
    'import { hexDecode, hexEncode } from "./src/net/quic-packet.ts"',
  ],
]

/** `vector spec emit` of each language, from a nish module and from a package, with a hyphenated segment. */
const hyphenTestEmit = (t: Suite, dir: string): void => {
  for (const l of hyphenImports()) {
    const out = `${dir}/out-${l[0]}.${l[1]}`
    const code = vectorRun(["spec", "emit", `${dir}/contracts/c.json`, "--lang", l[0], "-o", out])
    t.ok(`${l[0]}: spec emit exits 0`, code === 0)
    const text = readFileSyncOrNull(out) ?? ""
    t.ok(`${l[0]}: imports ${l[2]}`, contains(text, l[2]))
    const pout = `${dir}/pout-${l[0]}.${l[1]}`
    const pcode = vectorRun([
      "spec",
      "emit",
      `${dir}/contracts/a.json`,
      "--lang",
      l[0],
      "--package",
      `app=${dir}/src`,
      "-o",
      pout,
    ])
    t.ok(`${l[0]}: spec emit --package exits 0`, pcode === 0)
    const ptext = readFileSyncOrNull(pout) ?? ""
    t.ok(`${l[0]}: --package app=src places it at ${l[3]}`, contains(ptext, l[3]))
  }
}

/** Runs `dist/vector` with `args`: its exit status and standard output, or why it could not run. */
const hyphenVector = (args: string[]): string => {
  const argv: string[] = ["dist/vector"]
  for (const a of args) {
    argv.push(a)
  }
  const r = runProcess(argv, "", 120000)
  if (r.isErr()) {
    return r.error
  }
  return `exit ${r.value.status}\n${r.value.stdout}`
}

/**
 * `vector spec check --nish-root`: it reads nish/net/quic-packet's source
 * from <root>/std/net/quic-packet.ts, refusing when it is missing and
 * passing when the hex implementation is there.
 */
const hyphenTestCheck = (t: Suite, dir: string): void => {
  const empty = `${dir}/root-empty`
  t.ok("an empty nish root is made", mkdirAll(empty, 0o755).isOk())
  const missing = hyphenVector(["spec", "check", `${dir}/contracts/c.json`, "--nish-root", empty])
  t.ok("spec check refuses a nish root without the module", missing.startsWith("exit 1\n"))
  t.ok(
    "and names the file the module maps to",
    contains(missing, `cannot read ${empty}/std/net/quic-packet.ts, the source of ${HYPHEN_MODULE}`),
  )
  const hexText = readFileSyncOrNull("tests/fixtures/nish-hex/hex.ts") ?? ""
  const root = `${dir}/root`
  t.ok("the hex fixture is placed there", hyphenWrite(root, "std/net/quic-packet.ts", hexText))
  const found = hyphenVector(["spec", "check", `${dir}/contracts/c.json`, "--nish-root", root])
  t.ok("spec check passes with the module at std/net/quic-packet.ts", found.startsWith("exit 0\n"))
  t.ok("and names the module", contains(found, HYPHEN_MODULE))
}

/**
 * `vector spec run --nish-root`: the emitted test imports
 * nish/net/quic-packet and compiles against a scratch install holding the
 * hex implementation at std/net/quic-packet.ts.
 */
const hyphenTestRun = (t: Suite, dir: string): void => {
  const hexText = readFileSyncOrNull("tests/fixtures/nish-hex/hex.ts")
  if (!isExecutableSync(".nish/libexec/nish") || hexText === null) {
    t.skip("spec run is SATISFIED", "no .nish/ install or no fixture: run bash scripts/fetch-nish.sh")
    return
  }
  const made = runMakeScratch(".nish", ["std/net/quic-packet.ts"], [hexText])
  t.ok("a scratch install with std/net/quic-packet.ts is made", made.isOk())
  if (!made.isOk()) {
    console.log(made.error)
    return
  }
  const s = made.value
  const code = vectorRun(["spec", "run", `${dir}/contracts/c.json`, "--nish-root", s.dir])
  t.ok("spec run of nish/net/quic-packet is SATISFIED", code === 0)
  t.ok("the scratch install is removed", runDisposeScratch(s).isOk())
}

/** A module path with a hyphen in a segment, mapped to files and imports end to end. */
export const main = (): i32 => {
  const t = new Suite("spec/emit hyphenated module paths")
  const made = hyphenLayout()
  if (made.isErr()) {
    t.fail("the layout is made", made.error)
    return t.done()
  }
  const dir = made.value
  hyphenTestEmit(t, dir)
  hyphenTestCheck(t, dir)
  hyphenTestRun(t, dir)
  t.ok("the layout is removed", runRemove(dir).isOk())
  return t.done()
}
