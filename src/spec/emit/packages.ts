/**
 * `spec/emit/packages` — `--package <name>=<dir>`: where the modules of your
 * own project live, so a test can import a module outside nish/.
 *
 * A contract names a module `<name>/<path>`; mapping the package `<name>` to
 * `<dir>` makes that the file `<dir>/<path>.ts`, which the test imports by its
 * relative path from the directory the test is written in.
 */

import { joinPath, relativePath } from "../../core/fs"
import { Contract } from "../contract/types"
import { EmitOptions } from "./emit"

/** Package names and the directories they map to, in the order given. */
export class EmitPackages {
  /** Each package's name, such as `vector`. */
  names: string[]
  /** The directory each package's modules live in, such as `src`. */
  dirs: string[]

  /** Makes an empty map: every module must be a nish/ one. */
  constructor() {
    this.names = []
    this.dirs = []
  }
}

/** Whether `path` is parts joined by `/`, none empty, `.` or `..`, and no `\`. */
const emitPathPartsOk = (path: string): boolean => {
  if (path.length === 0 || path.indexOf("\\") >= 0) {
    return false
  }
  let start = 0
  for (let i = 0; i <= toI32(path.length); i++) {
    if (i === toI32(path.length) || path.charCodeAt(i) === 47) {
      const p = path.substring(start, i)
      if (p.length === 0 || p === "." || p === "..") {
        return false
      }
      start = i + 1
    }
  }
  return true
}

/**
 * Reads the `--package` flags, each `<name>=<dir>`. A name is a module path's
 * leading parts (`vector`, `acme/util`); `nish` is nish's own and cannot be
 * mapped, and no name may be given twice.
 *
 * @param flags the flags' values, in order
 * @returns the map, or why a flag is malformed
 */
export const emitParsePackages = (flags: string[]): Result<EmitPackages, string> => {
  const m = new EmitPackages()
  for (const f of flags) {
    const eq = f.indexOf("=")
    if (eq <= 0 || eq === f.length - 1) {
      return Err(`--package ${f}: expected <name>=<dir>`)
    }
    const name = f.substring(0, eq)
    const dir = f.substring(eq + 1, f.length)
    if (!emitPathPartsOk(name)) {
      return Err(`--package ${f}: ${name} is not a package name (parts joined by /, none empty, . or ..)`)
    }
    if (name === "nish" || name.startsWith("nish/")) {
      return Err(`--package ${f}: nish/ modules are nish's own; give --nish-root to test them`)
    }
    if (m.names.indexOf(name) >= 0) {
      return Err(`--package ${f}: ${name} is mapped twice`)
    }
    m.names.push(name)
    m.dirs.push(dir)
  }
  return Ok(m)
}

/**
 * The file a module of your own project lives in: `<dir>/<path>.ts` for the
 * longest mapped package `<name>` that the module `<name>/<path>` starts with.
 *
 * @param m the map
 * @param module a contract's module path
 * @returns its file, or null when no package maps it or its path is malformed
 */
export const emitModuleFile = (m: EmitPackages, module: string): string | null => {
  let best = -1
  for (let i = 0; i < m.names.length; i++) {
    const n = m.names[i]
    if (module.startsWith(`${n}/`) && (best < 0 || n.length > m.names[best].length)) {
      best = i
    }
  }
  if (best < 0) {
    return null
  }
  const rest = module.substring(m.names[best].length + 1, module.length)
  if (!emitPathPartsOk(rest)) {
    return null
  }
  return joinPath(m.dirs[best], `${rest}.ts`)
}

/**
 * The modules a contract names, its target's first, each once.
 *
 * @param c the contract
 * @returns the module paths
 */
export const emitContractModules = (c: Contract): string[] => {
  const out: string[] = [c.target.module]
  for (const f of c.functions) {
    const m = f.module
    if (m !== null && out.indexOf(m) < 0) {
      out.push(m)
    }
  }
  return out
}

/**
 * Fills in how the test imports each of the contract's modules that a
 * package places: the relative path from `fromDir` to its file, without
 * `.ts`. A module no package places is left for `emitRefusals` to refuse.
 *
 * @param m the map
 * @param c the contract
 * @param fromDir the directory the test is written in; it must exist
 * @param opts where the imports go: `localModules` and `localImports`
 * @returns true, or why a placed module's file or `fromDir` does not resolve
 */
export const emitResolveModules = (
  m: EmitPackages,
  c: Contract,
  fromDir: string,
  opts: EmitOptions,
): Result<boolean, string> => {
  if (m.names.length === 0) {
    return Ok(true)
  }
  const from = realpathSync(fromDir)
  if (from === null) {
    return Err(`${fromDir}: the test's directory does not exist`)
  }
  for (const mod of emitContractModules(c)) {
    const file = emitModuleFile(m, mod)
    if (file === null) {
      continue
    }
    const real = realpathSync(file)
    if (real === null || !real.endsWith(".ts")) {
      return Err(`${mod}: --package places it at ${file}, which does not exist`)
    }
    opts.localModules.push(mod)
    opts.localImports.push(relativePath(from, real.substring(0, real.length - 3)))
  }
  return Ok(true)
}

/**
 * The `--package` flags that rebuild a map, for a regenerate command.
 *
 * @param m the map
 * @returns ` --package <name>=<dir>` per package, joined; empty for none
 */
export const emitPackageFlags = (m: EmitPackages): string => {
  let out = ""
  for (let i = 0; i < m.names.length; i++) {
    out = `${out} --package ${m.names[i]}=${m.dirs[i]}`
  }
  return out
}
