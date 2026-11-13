import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { sha256Hex } from "../../../src/core/hex"
import { runProcess } from "../../../src/core/process"
import {
  FROZEN_GENERATED,
  FROZEN_IMPLEMENTATION,
  FROZEN_NEUTRAL,
  FROZEN_SPEC,
  frozenCheck,
  frozenContractProblems,
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

/** A valid contract on RFC 4648 whose main source pins `sha`. */
const frozenTestContract = (sha: string): string => `{
  "contract": "c1",
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
  const contract = frozenTestContract(sha256Hex(FROZEN_TEST_RFC))
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

  prTestWrite(dir, "contracts/c.json", frozenTestContract("")).orReturn()
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
  return t.done()
}
