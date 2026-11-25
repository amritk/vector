import { Suite } from "nish/testing"
import { joinPath, makeTempDir, mkdirAll } from "../../../src/core/fs"
import { sha256Hex } from "../../../src/core/hex"
import { runProcess } from "../../../src/core/process"
import { SourceDecl } from "../../../src/spec/contract/types"
import { sourceReadConfined } from "../../../src/spec/source/path"

/** A declaration of a source at `path`, beside the contract. */
const pathReadTestDecl = (path: string): SourceDecl => {
  const d = new SourceDecl()
  d.id = "s1"
  d.path = path
  d.rfc = -1
  return d
}

/** `n` bytes of text whose every byte depends on its place, so a chunk read out of order changes it. */
const pathReadTestText = (n: i32): string => {
  const parts: string[] = []
  for (let i = 0; i < n; i++) {
    parts.push(i % 61 === 60 ? "\n" : `${(i / 7 + i) % 10}`)
  }
  return parts.join("")
}

export const main = (): i32 => {
  const t = new Suite("spec/source path reads")
  const tmp = makeTempDir("vector-source-read-").expect("temp dir")
  const root = joinPath(tmp, "repo")
  const contract = joinPath(root, "contracts/c.json")
  mkdirAll(joinPath(root, "contracts"), 0o755).expect("mkdir")

  // A source is read in 64 KiB chunks: none, one exactly, two exactly, and a
  // short last one all come back whole and in order.
  const sizes: i32[] = [0, 1, 65535, 65536, 65537, 131072, 200001]
  for (const n of sizes) {
    const name = `s${n}.txt`
    const text = pathReadTestText(n)
    writeFileSync(joinPath(root, `contracts/${name}`), text)
    const read = sourceReadConfined(pathReadTestDecl(name), joinPath(root, `contracts/${name}`), contract, root)
    t.ok(`${n} bytes are read`, read.isOk())
    if (read.isOk()) {
      t.ok(`${n} bytes keep their text`, read.value.text === text)
      t.eqStr(`${n} bytes keep their hash`, read.value.sha256, sha256Hex(text))
    }
  }

  const rm = runProcess(["rm", "-rf", tmp], "", 5000)
  t.ok("rm", rm.isOk() && rm.value.status === 0)
  return t.done()
}
