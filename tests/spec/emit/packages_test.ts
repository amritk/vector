import { Suite } from "nish/testing"
import { contractLoadFile } from "../../../src/spec/contract/contract"
import { EmitOptions } from "../../../src/spec/emit/emit"
import {
  EmitPackages,
  emitContractModules,
  emitModuleFile,
  emitPackageFlags,
  emitParsePackages,
  emitResolveModules,
} from "../../../src/spec/emit/packages"

/** The error a parse gives, or "" when it parsed. */
const packagesErrorOf = (flags: string[]): string => {
  const m = emitParsePackages(flags, "nish")
  return m.isErr() ? m.error : ""
}

/** Checks `--package <name>=<dir>`: parsing it, placing modules, and the imports it gives a test. */
export const main = (): i32 => {
  const t = new Suite("spec/emit packages")

  const m = emitParsePackages(["vector=src", "acme/util=lib/util"], "nish").expect("parse")
  t.eqStr("names in order", m.names.join(","), "vector,acme/util")
  t.eqStr("dirs in order", m.dirs.join(","), "src,lib/util")
  t.eqStr("a dir may hold =", emitParsePackages(["v=a=b"], "nish").expect("parse").dirs[0], "a=b")
  t.eqStr("no flags, no packages", `${emitParsePackages([], "nish").expect("parse").names.length}`, "0")
  t.eqStr("no =", packagesErrorOf(["vector"]), "--package vector: expected <name>=<dir>")
  t.eqStr("no name", packagesErrorOf(["=src"]), "--package =src: expected <name>=<dir>")
  t.eqStr("no dir", packagesErrorOf(["vector="]), "--package vector=: expected <name>=<dir>")
  t.ok("an empty part", packagesErrorOf(["a//b=src"]).indexOf("is not a package name") > 0)
  t.ok("a .. part", packagesErrorOf(["../x=src"]).indexOf("is not a package name") > 0)
  t.ok("a backslash", packagesErrorOf(["a\\b=src"]).indexOf("is not a package name") > 0)
  t.ok("nish is nish's own", packagesErrorOf(["nish=src"]).indexOf("nish/ modules are nish's own") > 0)
  t.ok("so is nish/x", packagesErrorOf(["nish/x=src"]).indexOf("nish/ modules are nish's own") > 0)
  t.eqStr("a name twice", packagesErrorOf(["v=a", "v=b"]), "--package v=b: v is mapped twice")
  const py = emitParsePackages(["nish=tests/fixtures/python/nish"], "python").expect("parse")
  t.eqStr("another language maps nish like any package", py.names.join(","), "nish")
  t.eqStr(
    "to its port's files",
    emitModuleFile(py, "nish/crypto/hkdf", ".py") ?? "",
    "tests/fixtures/python/nish/crypto/hkdf.py",
  )

  const both = emitParsePackages(["acme=a", "acme/util=u"], "nish").expect("parse")
  t.eqStr("a module in a package", emitModuleFile(m, "vector/core/hex", ".ts") ?? "", "src/core/hex.ts")
  t.eqStr("the longest package wins", emitModuleFile(both, "acme/util/str", ".ts") ?? "", "u/str.ts")
  t.eqStr("whichever order it was given", emitModuleFile(both, "acme/other", ".ts") ?? "", "a/other.ts")
  t.ok("a name is whole parts", emitModuleFile(m, "vectorx/hex", ".ts") === null)
  t.ok("no package places it", emitModuleFile(m, "nish/hex", ".ts") === null)
  t.ok("the package itself is no module", emitModuleFile(m, "vector", ".ts") === null)
  t.ok("a .. in the rest", emitModuleFile(m, "vector/../etc/x", ".ts") === null)

  t.eqStr("no packages, no flags", emitPackageFlags(new EmitPackages()), "")
  t.eqStr("each flag rebuilds the map", emitPackageFlags(m), " --package vector=src --package acme/util=lib/util")

  const c = contractLoadFile("contracts/vector-core-hex.json").expect("load")
  t.eqStr("the contract's modules", emitContractModules(c).join(","), "vector/core/hex")
  const hex = contractLoadFile("contracts/example-hex.json").expect("load")
  t.eqStr("a nish module is a module too", emitContractModules(hex).join(","), "nish/hex")

  const opts = new EmitOptions("ab")
  t.ok("resolves from the test's directory", emitResolveModules(m, c, "tests/dogfood", opts, ".ts").isOk())
  t.eqStr("the module is placed", opts.localModules.join(","), "vector/core/hex")
  t.eqStr("and imported by its relative path", opts.localImports.join(","), "../../src/core/hex")
  const none = new EmitOptions("ab")
  t.ok("no packages resolve nothing", emitResolveModules(new EmitPackages(), c, "nowhere", none, ".ts").isOk())
  t.eqStr("and place nothing", `${none.localModules.length}`, "0")
  const away = new EmitOptions("ab")
  t.ok("a module no package places is left alone", emitResolveModules(m, hex, "tests", away, ".ts").isOk())
  t.eqStr("for the refusals to name", `${away.localModules.length}`, "0")
  const gone = emitResolveModules(m, c, "tests/no-such-dir", new EmitOptions("ab"), ".ts")
  t.eqStr(
    "a test directory that does not exist",
    gone.isErr() ? gone.error : "",
    "tests/no-such-dir: the test's directory does not exist",
  )
  const wrong = emitParsePackages(["vector=lib"], "nish").expect("parse")
  const missing = emitResolveModules(wrong, c, "tests", new EmitOptions("ab"), ".ts")
  t.eqStr(
    "a module file that does not exist",
    missing.isErr() ? missing.error : "",
    "vector/core/hex: --package places it at lib/core/hex.ts, which does not exist",
  )
  return t.done()
}
