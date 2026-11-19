import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { makeTempDir } from "../../../src/core/fs"
import { sha256Hex } from "../../../src/core/hex"
import { runProcess } from "../../../src/core/process"
import {
  FROZEN_GENERATED,
  FROZEN_IMPLEMENTATION,
  FROZEN_NEUTRAL,
  FROZEN_SPEC,
  frozenCheck,
  frozenContractProblems,
  frozenContractShas,
  frozenDefaultContracts,
  frozenKindName,
  frozenPathKind,
  frozenResolve,
} from "../../../src/spec/pr/frozen"
import { gitdiffTop } from "../../../src/spec/pr/gitdiff"
import { STALE_PREFIX } from "../../../src/spec/pr/stale"
import { prTestCommit, prTestGit, prTestRemove, prTestRepo, prTestWrite } from "./repo"

/** The plain text of a one-section RFC 4648. */
const FROZEN_TEST_RFC: string = "Request for Comments: 4648\n\f\n1.  Introduction\n\n   It MUST work.\n"

/** A valid contract `id` on RFC 4648 whose main source pins `sha`. */
const frozenTestContract = (sha: string, id: string): string => `{
  "contract": "${id}",
  "source": {"title": "T", "rfc": 4648${sha.length > 0 ? `, "sha256": "${sha}"` : ""}},
  "target": {"module": "nish/hex"},
  "requirements": [{"id": "R1", "section": "1", "level": "MUST", "quote": "It MUST work."}],
  "functions": [{"name": "enc", "params": [{"name": "b", "type": "bytes"}], "returns": "string"}],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "1"}}, "call": "enc", "args": [{"hex": "00"}], "expect": {"str": "00"}}
  ]
}
`

/** A report as text: its problems, or "OK". */
const frozenTestVerdict = (dir: string, contracts: string[]): string => {
  const r = frozenCheck(dir, "main", contracts)
  if (r.isErr()) {
    return `error: ${r.error}`
  }
  return r.value.problems.length === 0 ? "OK" : r.value.problems.join(" | ")
}

/** Puts the work tree back to the last commit. */
const frozenTestReset = (dir: string): Result<boolean, string> => {
  prTestGit(dir, ["reset", "-q", "--hard"]).orReturn()
  prTestGit(dir, ["clean", "-qfd"]).orReturn()
  return Ok(true)
}

/** A repository whose main branch holds a pinned contract, changed in each way the gate judges. */
const frozenTestRepo = (t: Suite, dir: string): Result<boolean, string> => {
  const contract = frozenTestContract(sha256Hex(FROZEN_TEST_RFC), "c1")
  prTestWrite(dir, "rfcs/rfc4648.txt", FROZEN_TEST_RFC).orReturn()
  prTestWrite(dir, "contracts/c.json", contract).orReturn()
  prTestWrite(dir, "contracts/c.survivors.json", "{}\n").orReturn()
  prTestWrite(dir, "src/x.ts", "x\n").orReturn()
  prTestCommit(dir, "base").orReturn()
  prTestGit(dir, ["checkout", "-q", "-b", "work"]).orReturn()
  const top = gitdiffTop(dir).orReturn()
  const path = `${top}/contracts/c.json`

  t.eqStr("the default contracts skip sidecars", frozenDefaultContracts(top).join(","), path)
  t.eqStr("no change", frozenTestVerdict(dir, []), "OK")

  prTestWrite(dir, "src/x.ts", "y\n").orReturn()
  prTestWrite(dir, "docs/guide.md", "g\n").orReturn()
  const impl = frozenCheck(dir, "main", [])
  t.ok("an implementation change passes", impl.isOk() && impl.value.problems.length === 0)
  t.eqStr(
    "its items",
    impl.isOk() ? impl.value.items.join(" | ") : "",
    "✓ contract contracts/c.json | neutral docs/guide.md | implementation src/x.ts",
  )

  prTestWrite(dir, "specs/s.md", "s\n").orReturn()
  t.eqStr(
    "both sides fail",
    frozenTestVerdict(dir, []),
    "the change touches the spec side (specs/s.md) and the implementation (src/x.ts): change them in separate PRs",
  )
  frozenTestReset(dir).orReturn()

  prTestWrite(dir, "specs/s.md", "s\n").orReturn()
  prTestWrite(dir, "README.md", "r\n").orReturn()
  t.eqStr("a spec change passes", frozenTestVerdict(dir, []), "OK")
  frozenTestReset(dir).orReturn()

  const generated = `${STALE_PREFIX}${sha256Hex(contract)}\n`
  prTestWrite(dir, "test/spec/c_test.ts", generated).orReturn()
  prTestWrite(dir, "specs/s.md", "s\n").orReturn()
  const gen = frozenCheck(dir, "main", [])
  t.ok("a generated test is spec side", gen.isOk() && gen.value.problems.length === 0)
  t.ok("and is listed as generated", gen.isOk() && gen.value.items.indexOf("generated test/spec/c_test.ts") >= 0)
  prTestWrite(dir, "test/spec/c_test.ts", `${STALE_PREFIX}${sha256Hex("other")}\n`).orReturn()
  t.eqStr(
    "a test naming another contract is implementation",
    frozenTestVerdict(dir, []),
    "the change touches the spec side (specs/s.md) and the implementation (test/spec/c_test.ts): change them in separate PRs",
  )
  frozenTestReset(dir).orReturn()

  prTestWrite(dir, "rfcs/rfc4648.txt", replaceAll(FROZEN_TEST_RFC, "work", "fail")).orReturn()
  const moved = frozenTestVerdict(dir, [])
  t.contains("a changed source fails", moved, "contracts/c.json: source rfc4648 (rfcs/rfc4648.txt) has SHA-256")
  t.contains("naming the change", moved, "the source changed")
  frozenTestReset(dir).orReturn()

  prTestWrite(dir, "contracts/c.json", frozenTestContract("", "c1")).orReturn()
  t.eqStr(
    "an unpinned contract fails",
    frozenContractProblems(path, top).join(" | "),
    "contracts/c.json: its main source is not pinned: record its SHA-256 in source.sha256",
  )
  prTestWrite(dir, "contracts/c.json", "{\n").orReturn()
  t.contains("an unreadable contract fails", frozenTestVerdict(dir, []), "contracts/c.json: not a contract: ")
  frozenTestReset(dir).orReturn()

  t.eqStr(
    "a given sidecar alone is no contract",
    frozenTestVerdict(dir, [`${top}/contracts/c.survivors.json`]),
    "no contracts to check: give them, or keep them in contracts/",
  )
  prTestGit(dir, ["rm", "-q", "-r", "contracts"]).orReturn()
  t.eqStr("no contracts", frozenTestVerdict(dir, []), "no contracts to check: give them, or keep them in contracts/")
  frozenTestReset(dir).orReturn()

  t.eqStr("a relative contract is read from the top", frozenTestVerdict(`${dir}/src`, ["contracts/c.json"]), "OK")
  t.eqStr("an absolute one inside the top is read", frozenTestVerdict(dir, [path]), "OK")
  t.eqStr(
    "a contract climbing out is refused",
    frozenTestVerdict(dir, ["contracts/../../c.json"]),
    "contracts/../../c.json: a contract path may not climb with ..: give it from the repository's top",
  )
  t.eqStr(
    "an absolute contract elsewhere is refused",
    frozenTestVerdict(dir, ["/etc/c.json"]),
    `/etc/c.json: outside the repository at ${top}: the gate checks only its own contracts`,
  )

  runProcess(["ln", "-s", "c.json", `${dir}/contracts/link.json`], "", 10000).orReturn()
  t.eqStr(
    "a symbolic link to a contract is refused",
    frozenTestVerdict(dir, ["contracts/link.json"]),
    "contracts/link.json: contracts/link.json is a symbolic link: the gate reads only the repository's own files",
  )
  frozenTestReset(dir).orReturn()
  runProcess(["ln", "-s", ".", `${dir}/contracts/here`], "", 10000).orReturn()
  t.eqStr(
    "a contract under a linked directory is refused",
    frozenTestVerdict(dir, [`${top}/contracts/here/c.json`]),
    "contracts/here/c.json: contracts/here is a symbolic link: the gate reads only the repository's own files",
  )
  frozenTestReset(dir).orReturn()

  prTestGit(dir, ["mv", "src/x.ts", "src/y.ts"]).orReturn()
  prTestWrite(dir, "specs/s.md", "s\n").orReturn()
  t.eqStr(
    "a rename counts both of its paths",
    frozenTestVerdict(dir, []),
    "the change touches the spec side (specs/s.md) and the implementation (src/x.ts, src/y.ts): change them in separate PRs",
  )
  frozenTestReset(dir).orReturn()
  prTestGit(dir, ["rm", "-q", "rfcs/rfc4648.txt"]).orReturn()
  t.contains("a deleted source fails", frozenTestVerdict(dir, []), "contracts/c.json: ")
  frozenTestReset(dir).orReturn()
  prTestGit(dir, ["rm", "-q", "src/x.ts"]).orReturn()
  prTestWrite(dir, "specs/s.md", "s\n").orReturn()
  t.eqStr(
    "a deleted implementation file is implementation",
    frozenTestVerdict(dir, []),
    "the change touches the spec side (specs/s.md) and the implementation (src/x.ts): change them in separate PRs",
  )
  frozenTestReset(dir).orReturn()

  t.eqStr("the tree is back", frozenTestVerdict(dir, []), "OK")
  const bad = frozenCheck(dir, "-x", [])
  t.ok("a base starting with - is refused", bad.isErr())
  const unknown = frozenCheck(dir, "nope", [])
  t.ok("an unknown base is a git error", unknown.isErr())
  return Ok(true)
}

/** A one-section spec in RFC XML v3. */
const FROZEN_TEST_XML: string =
  '<rfc><front><title>S</title></front><middle><section anchor="a" numbered="true"><name>A</name><t>It MUST work.</t></section></middle></rfc>\n'

/** A valid contract whose only source is specs/s.xml, pinned to `sha`. */
const frozenTestXmlContract = (sha: string): string => `{
  "contract": "x1",
  "source": {"title": "S", "main": "s", "sha256": "${sha}"},
  "sources": [{"id": "s", "path": "../specs/s.xml"}],
  "target": {"module": "nish/hex"},
  "requirements": [{"id": "R1", "section": "1", "level": "MUST", "quote": "It MUST work."}],
  "functions": [{"name": "enc", "params": [{"name": "b", "type": "bytes"}], "returns": "string"}],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "1"}}, "call": "enc", "args": [{"hex": "00"}], "expect": {"str": "00"}}
  ]
}
`

/** A repository whose only contract reads an .xml source: the gate reads it, and holds it to its pin. */
const frozenTestXmlRepo = (t: Suite): Result<boolean, string> => {
  const dir = prTestRepo("vector-frozen-xml-").orReturn()
  prTestWrite(dir, "specs/s.xml", FROZEN_TEST_XML).orReturn()
  prTestWrite(dir, "contracts/x.json", frozenTestXmlContract(sha256Hex(FROZEN_TEST_XML))).orReturn()
  prTestCommit(dir, "base").orReturn()
  prTestGit(dir, ["checkout", "-q", "-b", "work"]).orReturn()
  prTestWrite(dir, "src/x.ts", "x\n").orReturn()
  t.eqStr("a contract whose only source is .xml passes", frozenTestVerdict(dir, []), "OK")
  prTestGit(dir, ["reset", "-q", "--hard"]).orReturn()
  prTestWrite(dir, "specs/s.xml", "<rfc/>\n").orReturn()
  prTestCommit(dir, "spec changed").orReturn()
  const changed = frozenTestVerdict(dir, [])
  t.ok(
    "and the .xml source is held to its pin",
    changed.indexOf("source s (specs/s.xml) has SHA-256 ") >= 0 && changed.indexOf("the source changed") >= 0,
  )
  prTestRemove(dir)
  return Ok(true)
}

/** One change to the two-contract repository, and what the gate must say of it. */
class FrozenTestRow {
  /** What the row checks. */
  name: string
  /** The files the change writes, as path, text, path, text, ... */
  writes: string[]
  /** The contracts given on the command line. */
  given: string[]
  /** The verdict: "OK", or the problems joined with " | ". */
  verdict: string
  /** Items the report must list. */
  listed: string[]
  /** Items the report must not list. */
  unlisted: string[]

  constructor(name: string, writes: string[], given: string[], verdict: string, listed: string[], unlisted: string[]) {
    this.name = name
    this.writes = writes
    this.given = given
    this.verdict = verdict
    this.listed = listed
    this.unlisted = unlisted
  }
}

/** The refusal for a change touching both sides. */
const frozenTestBoth = (spec: string, impl: string): string =>
  `the change touches the spec side (${spec}) and the implementation (${impl}): change them in separate PRs`

/** A generated test whose sha lines name each of `contracts`, with `body` after them. */
const frozenTestGenerated = (contracts: string[], body: string): string => {
  let out = ""
  for (const c of contracts) {
    out = `${out}${STALE_PREFIX}${sha256Hex(c)}\n`
  }
  return `${out}${body}\n`
}

/**
 * A repository holding contracts a and b (and a's sidecar), with a generated
 * test for each, changed one row at a time: a test is generated when its one
 * sha line names any contract in contracts/ or one given, and only the given
 * contracts are checked and listed.
 */
const frozenTestTwoRepo = (t: Suite): Result<boolean, string> => {
  const dir = prTestRepo("vector-frozen-two-").orReturn()
  const pin = sha256Hex(FROZEN_TEST_RFC)
  const a0 = frozenTestContract(pin, "a")
  const b0 = frozenTestContract(pin, "b")
  const a1 = frozenTestContract(pin, "a2")
  const b1 = frozenTestContract(pin, "b2")
  const sidecar = "{}\n"
  const extra = frozenTestContract(pin, "extra")
  prTestWrite(dir, "rfcs/rfc4648.txt", FROZEN_TEST_RFC).orReturn()
  prTestWrite(dir, "contracts/a.json", a0).orReturn()
  prTestWrite(dir, "contracts/b.json", b0).orReturn()
  prTestWrite(dir, "contracts/a.survivors.json", sidecar).orReturn()
  prTestWrite(dir, "test/spec/a.ts", frozenTestGenerated([a0], "a")).orReturn()
  prTestWrite(dir, "test/spec/b.ts", frozenTestGenerated([b0], "b")).orReturn()
  prTestWrite(dir, "src/x.ts", "x\n").orReturn()
  prTestCommit(dir, "base").orReturn()
  prTestGit(dir, ["checkout", "-q", "-b", "work"]).orReturn()
  const top = gitdiffTop(dir).orReturn()

  const shas = frozenContractShas(top, [`${top}/contracts/a.json`])
  t.ok("the classifying set holds contract a", shas.has(sha256Hex(a0)))
  t.ok("and contract b in contracts/, not given", shas.has(sha256Hex(b0)))
  t.ok("but no sidecar", !shas.has(sha256Hex(sidecar)))
  t.ok("and each contract once", shas.size === 2)
  t.ok(
    "a given contract that cannot be read adds nothing",
    frozenContractShas(top, [`${top}/contracts/a.json`, `${top}/contracts/gone.json`]).size === 2,
  )
  const bare = makeTempDir("vector-frozen-bare-").orReturn()
  t.ok("a repository with no contracts/ holds only the given contracts", frozenContractShas(bare, []).size === 0)
  writeFileSync(`${bare}/c.json`, a0)
  t.ok("and those it is given", frozenContractShas(bare, [`${bare}/c.json`]).size === 1)
  prTestRemove(bare)
  t.ok("and a given contract outside contracts/", frozenContractShas(top, [`${top}/rfcs/rfc4648.txt`]).size === 3)
  runProcess(["ln", "-s", "../src/x.ts", `${dir}/contracts/l.json`], "", 10000).orReturn()
  t.ok(
    "but not a symbolic link in contracts/",
    !frozenContractShas(top, [`${top}/contracts/a.json`]).has(sha256Hex("x\n")),
  )
  prTestWrite(dir, "test/spec/n.ts", frozenTestGenerated(["x\n"], "n")).orReturn()
  prTestWrite(dir, "specs/s.md", "s\n").orReturn()
  const linked = frozenCheck(dir, "main", ["contracts/a.json"])
  t.eqStr(
    "so a test naming a linked file is implementation",
    linked.isOk() ? linked.value.problems.join(" | ") : linked.error,
    frozenTestBoth("contracts/l.json, specs/s.md", "test/spec/n.ts"),
  )
  frozenTestReset(dir).orReturn()

  const onlyA = ["contracts/a.json"]
  const both = [
    "contracts/a.json",
    a1,
    "contracts/b.json",
    b1,
    "test/spec/a.ts",
    frozenTestGenerated([a1], "a"),
    "test/spec/b.ts",
    frozenTestGenerated([b1], "b"),
  ]
  const bad = frozenTestContract(sha256Hex("not the RFC"), "b")
  const rows: FrozenTestRow[] = [
    new FrozenTestRow(
      "both contracts and both tests change, a given",
      both,
      onlyA,
      "OK",
      ["✓ contract contracts/a.json", "generated test/spec/a.ts", "generated test/spec/b.ts"],
      ["✓ contract contracts/b.json"],
    ),
    new FrozenTestRow(
      "both contracts and both tests change, none given",
      both,
      [],
      "OK",
      ["✓ contract contracts/a.json", "✓ contract contracts/b.json", "generated test/spec/b.ts"],
      [],
    ),
    new FrozenTestRow(
      "a test regenerated against an unchanged contract not given",
      ["test/spec/b.ts", frozenTestGenerated([b0], "b regenerated")],
      onlyA,
      "OK",
      ["generated test/spec/b.ts"],
      [],
    ),
    new FrozenTestRow(
      "an edited generated test of a contract not given, with the code",
      ["test/spec/b.ts", frozenTestGenerated([b0], "b loosened"), "src/x.ts", "y\n"],
      onlyA,
      frozenTestBoth("test/spec/b.ts", "src/x.ts"),
      ["generated test/spec/b.ts", "implementation src/x.ts"],
      [],
    ),
    new FrozenTestRow(
      "a contract not given, its test and the code",
      ["contracts/b.json", b1, "test/spec/b.ts", frozenTestGenerated([b1], "b"), "src/x.ts", "y\n"],
      onlyA,
      frozenTestBoth("contracts/b.json, test/spec/b.ts", "src/x.ts"),
      ["generated test/spec/b.ts"],
      [],
    ),
    new FrozenTestRow(
      "a test with no sha line is implementation",
      ["contracts/b.json", b1, "test/spec/n.ts", "n\n"],
      onlyA,
      frozenTestBoth("contracts/b.json", "test/spec/n.ts"),
      ["implementation test/spec/n.ts"],
      [],
    ),
    new FrozenTestRow(
      "a test with two sha lines is implementation",
      ["specs/s.md", "s\n", "test/spec/n.ts", frozenTestGenerated([a0, b0], "n")],
      onlyA,
      frozenTestBoth("specs/s.md", "test/spec/n.ts"),
      ["implementation test/spec/n.ts"],
      [],
    ),
    new FrozenTestRow(
      "a test whose sha names no contract is implementation",
      ["specs/s.md", "s\n", "test/spec/n.ts", frozenTestGenerated(["no contract"], "n")],
      onlyA,
      frozenTestBoth("specs/s.md", "test/spec/n.ts"),
      ["implementation test/spec/n.ts"],
      [],
    ),
    new FrozenTestRow(
      "a test whose sha names a sidecar is implementation",
      ["specs/s.md", "s\n", "test/spec/n.ts", frozenTestGenerated([sidecar], "n")],
      onlyA,
      frozenTestBoth("specs/s.md", "test/spec/n.ts"),
      ["implementation test/spec/n.ts"],
      [],
    ),
    new FrozenTestRow(
      "a test naming a given contract outside contracts/ is generated",
      ["specs/extra.json", extra, "test/spec/n.ts", frozenTestGenerated([extra], "n")],
      ["contracts/a.json", "specs/extra.json"],
      "OK",
      ["✓ contract specs/extra.json", "generated test/spec/n.ts"],
      [],
    ),
    new FrozenTestRow(
      "a broken contract not given is not reported",
      ["contracts/b.json", bad],
      onlyA,
      "OK",
      ["✓ contract contracts/a.json", "spec contracts/b.json"],
      ["✓ contract contracts/b.json", "✗ contract contracts/b.json"],
    ),
    new FrozenTestRow(
      "a broken contract is reported when none are given",
      ["contracts/b.json", bad],
      [],
      `contracts/b.json: source rfc4648 (rfcs/rfc4648.txt) has SHA-256 ${pin}, but the contract pins ${sha256Hex("not the RFC")}: the source changed`,
      ["✗ contract contracts/b.json"],
      [],
    ),
  ]
  for (const row of rows) {
    for (let i = 0; i + 1 < row.writes.length; i += 2) {
      prTestWrite(dir, row.writes[i], row.writes[i + 1]).orReturn()
    }
    const r = frozenCheck(dir, "main", row.given)
    if (r.isErr()) {
      t.fail(row.name, r.error)
    } else {
      t.eqStr(row.name, r.value.problems.length === 0 ? "OK" : r.value.problems.join(" | "), row.verdict)
      for (const item of row.listed) {
        t.ok(`${row.name}: lists ${item}`, r.value.items.indexOf(item) >= 0)
      }
      for (const item of row.unlisted) {
        t.ok(`${row.name}: does not list ${item}`, r.value.items.indexOf(item) < 0)
      }
    }
    frozenTestReset(dir).orReturn()
  }
  prTestRemove(dir)
  return Ok(true)
}

/** A path resolved against the top "/r", or "ERR". */
const frozenTestInTop = (given: string): string => {
  const r = frozenResolve("/r", given)
  return r.isOk() ? r.value : "ERR"
}

/** The PR gate that keeps the spec side and the implementation in separate PRs. */
export const main = (): i32 => {
  const t = new Suite("spec/pr frozen")
  t.eqStr("a relative contract resolves against the top", frozenTestInTop("contracts/a.json"), "/r/contracts/a.json")
  t.eqStr("an absolute one inside stays", frozenTestInTop("/r/contracts/a.json"), "/r/contracts/a.json")
  t.eqStr("a sibling of the top is outside", frozenTestInTop("/rx/a.json"), "ERR")
  t.eqStr("a .. segment is refused", frozenTestInTop("contracts/../a.json"), "ERR")
  t.eqStr("dots in a name are not a ..", frozenTestInTop("contracts/a..json"), "/r/contracts/a..json")
  t.ok("specs", frozenPathKind("specs/a.md") === FROZEN_SPEC && frozenPathKind("contracts/a.json") === FROZEN_SPEC)
  t.ok("rfcs", frozenPathKind("rfcs/rfc1.txt") === FROZEN_SPEC)
  const refPaths: string[] = [
    ".refcache/reference.RFC.4648.xml",
    ".refcache/sub/dir/x.xml",
    ".refcache",
    ".refcachex/a.xml",
    "refcache/a.xml",
    "src/.refcache/a.xml",
    "docs/.refcache/a.xml",
  ]
  const refKinds: i32[] = [
    FROZEN_SPEC,
    FROZEN_SPEC,
    FROZEN_IMPLEMENTATION,
    FROZEN_IMPLEMENTATION,
    FROZEN_IMPLEMENTATION,
    FROZEN_IMPLEMENTATION,
    FROZEN_NEUTRAL,
  ]
  for (let i = 0; i < refPaths.length; i++) {
    t.ok(`refcache path ${refPaths[i]}`, frozenPathKind(refPaths[i]) === refKinds[i])
  }
  t.ok("neutral", frozenPathKind("docs/a/b.md") === FROZEN_NEUTRAL && frozenPathKind("README.md") === FROZEN_NEUTRAL)
  t.ok("nested markdown is implementation", frozenPathKind("src/README.md") === FROZEN_IMPLEMENTATION)
  t.ok("a spec-named file elsewhere is implementation", frozenPathKind("src/specs/a.ts") === FROZEN_IMPLEMENTATION)
  t.eqStr(
    "kind names",
    `${frozenKindName(FROZEN_SPEC)} ${frozenKindName(FROZEN_GENERATED)} ${frozenKindName(FROZEN_NEUTRAL)} ${frozenKindName(FROZEN_IMPLEMENTATION)}`,
    "spec generated neutral implementation",
  )
  const dir = prTestRepo("vector-frozen-")
  if (dir.isErr()) {
    t.fail("a repository", dir.error)
    return t.done()
  }
  const top = gitdiffTop(dir.value)
  const link = `${dir.value}-link`
  const linked = runProcess(["ln", "-s", "--", dir.value, link], "", 10000)
  if (top.isOk() && linked.isOk() && linked.value.status === 0) {
    const via = frozenResolve(top.value, `${link}/contracts/c.json`)
    t.eqStr(
      "a path through a link to the top resolves",
      via.isOk() ? via.value : via.error,
      `${top.value}/contracts/c.json`,
    )
    const unlinked = runProcess(["rm", "-f", "--", link], "", 10000)
    t.ok("the link is removed", unlinked.isOk())
  } else {
    t.fail("a link to the repository", top.isErr() ? top.error : "ln -s failed")
  }
  const ran = frozenTestRepo(t, dir.value)
  if (ran.isErr()) {
    t.fail("the repository steps", ran.error)
  }
  prTestRemove(dir.value)
  const xml = frozenTestXmlRepo(t)
  if (xml.isErr()) {
    t.fail("the .xml repository steps", xml.error)
  }
  const two = frozenTestTwoRepo(t)
  if (two.isErr()) {
    t.fail("the two-contract repository steps", two.error)
  }
  return t.done()
}
