#!/usr/bin/env node
// The panic ratchet: counts the sites under src/ that the next Nish compiler
// (`.nish-next-version`, fetched into .nish-next/) cannot prove panic-free,
// per module, and refuses any module over its count in
// scripts/panic-baseline/*.json, or with a site and no count there.
//
// A site counts when its module is under src/, it is not an out-of-memory
// site, it is neither proven nor allowed, and it is not a call into a src/
// function (that function's own sites already count). Lowering a count once
// a module improves is the ratchet: a module under its count warns.
//
// Usage: node scripts/panics.mjs [--report <json>] [--nish <bin>]
//        [--entry <file>] [--baseline-dir <dir>] [--root <dir>]
// --report reads an existing --emit-panics report instead of compiling.
// Exit: 0 at or under every baseline, 1 a module over its baseline or
// missing from every baseline, 2 a tool failure or an unreadable input.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

/** Thrown for exit 2: a usage, tool or input failure. */
class PanicsError extends Error {}

const panicsOptions = (argv) => {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        report: { type: 'string' },
        nish: { type: 'string' },
        entry: { type: 'string', default: 'src/main.ts' },
        'baseline-dir': { type: 'string', default: 'scripts/panic-baseline' },
        root: { type: 'string', default: process.cwd() },
      },
      strict: true,
      allowPositionals: false,
    })
    return values
  } catch (e) {
    throw new PanicsError(e.message)
  }
}

const panicsReadJson = (file, what) => {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (e) {
    throw new PanicsError(`cannot read ${what} ${file}: ${e.message}`)
  }
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new PanicsError(`${what} ${file} is not JSON: ${e.message}`)
  }
}

/** Runs nish with --emit-panics and returns the parsed report. */
const panicsCompile = (root, nish, entry) => {
  const dir = mkdtempSync(join(tmpdir(), 'vector-panics-'))
  try {
    const report = join(dir, 'panics.json')
    const args = [entry, '--allow-panics', '--emit-panics', report, '--link', join(dir, 'v'), '--profile', 'debug']
    const run = spawnSync(nish, args, { cwd: root, encoding: 'utf8' })
    if (run.error) throw new PanicsError(`cannot run ${nish}: ${run.error.message}`)
    if (run.status !== 0) {
      throw new PanicsError(`${nish} ${args.join(' ')} exited ${run.status}\n${run.stdout}${run.stderr}`)
    }
    return panicsReadJson(report, 'panic report')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * The counted sites of a report, as {module, line, column, kind, callee}.
 * Exported for the tests.
 */
export const panicsCounted = (report) => {
  if (!report || !Array.isArray(report.functions)) throw new PanicsError('panic report has no functions array')
  const own = new Set(report.functions.filter((f) => f.module.startsWith('src/')).map((f) => f.name))
  const sites = []
  for (const f of report.functions) {
    if (!f.module.startsWith('src/')) continue
    for (const p of f.panics) {
      if (p.kind === 'oom' || p.proven === true || p.allowed === true) continue
      if (p.kind === 'call' && own.has(p.callee)) continue
      sites.push({ module: f.module, line: p.line, column: p.column, kind: p.kind, callee: p.callee })
    }
  }
  return sites
}

/** Every baseline file's modules merged, refusing a module named twice. */
const panicsBaseline = (dir) => {
  let files
  try {
    files = readdirSync(dir).filter((n) => n.endsWith('.json')).sort()
  } catch (e) {
    throw new PanicsError(`cannot read baseline directory ${dir}: ${e.message}`)
  }
  const counts = new Map()
  const owner = new Map()
  for (const name of files) {
    const file = join(dir, name)
    const json = panicsReadJson(file, 'baseline')
    if (!json || typeof json.modules !== 'object' || json.modules === null || Array.isArray(json.modules)) {
      throw new PanicsError(`baseline ${file} has no modules object`)
    }
    for (const [module, n] of Object.entries(json.modules)) {
      if (!Number.isInteger(n) || n < 0) throw new PanicsError(`baseline ${file}: ${module} is not a count: ${n}`)
      if (owner.has(module)) throw new PanicsError(`${module} is in both ${owner.get(module)} and ${name}`)
      owner.set(module, name)
      counts.set(module, n)
    }
  }
  return { counts, owner }
}

const panicsSiteText = (s) => `  ${s.module}:${s.line}:${s.column} ${s.kind}${s.kind === 'call' ? ` ${s.callee}` : ''}`

const panicsMain = (argv) => {
  const o = panicsOptions(argv)
  const root = resolve(o.root)
  let report
  if (o.report !== undefined) {
    report = panicsReadJson(resolve(root, o.report), 'panic report')
  } else {
    let nish = o.nish
    if (nish === undefined) {
      const fetch = spawnSync('bash', [join(root, 'scripts/fetch-nish-next.sh')], { cwd: root, stdio: 'inherit' })
      if (fetch.status !== 0) throw new PanicsError('scripts/fetch-nish-next.sh failed')
      nish = join(root, '.nish-next/bin/nish')
    }
    report = panicsCompile(root, nish, o.entry)
  }
  const sites = panicsCounted(report)
  const { counts, owner } = panicsBaseline(resolve(root, o['baseline-dir']))
  const byModule = new Map()
  for (const s of sites) {
    if (!byModule.has(s.module)) byModule.set(s.module, [])
    byModule.get(s.module).push(s)
  }
  let refused = 0
  for (const [module, list] of [...byModule].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const limit = counts.get(module)
    if (limit === undefined) {
      console.error(`${module}: ${list.length} unproven sites, and no baseline names it`)
    } else if (list.length > limit) {
      console.error(`${module}: ${list.length} unproven sites, over its baseline of ${limit} (${owner.get(module)})`)
    } else continue
    for (const s of list) console.error(panicsSiteText(s))
    refused++
  }
  for (const [module, limit] of [...counts].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const n = byModule.get(module)?.length ?? 0
    if (n < limit) {
      console.error(`warning: ${module}: ${n} unproven sites, under its baseline of ${limit}; lower it in ${owner.get(module)}`)
    }
  }
  if (refused > 0) {
    console.error(`panics: ${refused} module(s) refused`)
    return 1
  }
  console.log(`panics: ${sites.length} unproven sites, every module at or under its baseline`)
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = panicsMain(process.argv.slice(2))
  } catch (e) {
    if (!(e instanceof PanicsError)) throw e
    console.error(`panics: ${e.message}`)
    process.exitCode = 2
  }
}
