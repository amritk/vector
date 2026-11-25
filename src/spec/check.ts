/**
 * `spec/check` — the pipeline every contract goes through: an ordered
 * registry of gates, each a top-level function that reads the contract and
 * returns its findings. checkContract runs them in order and collects every
 * finding, so one run names them all.
 *
 * How a stage plugs in: write the gate as a top-level function of type
 * CheckGate in its own module (`(ctx) => string[]`: it reads `ctx.contract`
 * and returns one message per finding, empty when it passes), and add one
 * `new CheckGateEntry(...)` line for it to checkGates, in the order it must
 * run. A gate that later gates
 * depend on (the shape gate: nothing after it can trust a malformed contract)
 * is `blocking`, and stops the pipeline when it finds anything. A gate that
 * chooses inputs for the generated test, such as boundary samples for a
 * property, adds them to `ctx.samples`; emit reads them from the report. Each
 * gate lives in its own module under gates/, and the domain gate samples.
 */

import { contractShapeErrors } from "./contract/shape"
import { Contract, Literal } from "./contract/types"
import { gateCompleteness } from "./gates/completeness"
import { gateCoverage } from "./gates/coverage"
import { gateDomain } from "./gates/domain"
import { gateFidelity } from "./gates/fidelity"
import { gateIds } from "./gates/ids"
import { gateProvenance } from "./gates/provenance"
import { gateRunSources } from "./gates/run"
import { gateSignatures } from "./gates/signatures"
import { gateTyping } from "./gates/typing"
import { SourceReaderKind, SourceReaders, SourceSet, sourceReadersAdd, sourceReadersDefault } from "./source/load"

/** One sampled input of a property: the values its variables take, and why. */
export class Sample {
  /** The property's clause id. */
  clause: string
  /** The values of the property's variables, in `forall` order. */
  args: Literal[]
  /** Why this input was chosen: `min of n`, `solver: x + y overflows`, ... */
  why: string
  /**
   * Makes a sample.
   *
   * @param clause the property's id
   * @param args its variables' values, in order
   * @param why why it was chosen
   */
  constructor(clause: string, args: Literal[], why: string) {
    this.clause = clause
    this.args = args
    this.why = why
  }
}

/** The samples the gates chose, which emit writes into the generated test. */
export class SampleTable {
  /** The samples, in the order the gates added them. */
  samples: Sample[]
  /** Makes an empty table. */
  constructor() {
    this.samples = []
  }
}

/**
 * Adds a sample to a table.
 *
 * @param table the table
 * @param sample the sample
 */
export const checkAddSample = (table: SampleTable, sample: Sample): void => {
  table.samples.push(sample)
}

/**
 * The samples of one property, in the order they were added.
 *
 * @param table the table
 * @param clause the property's id
 * @returns its samples; empty when it has none
 */
export const checkSamplesOf = (table: SampleTable, clause: string): Sample[] =>
  table.samples.filter((s: Sample): boolean => s.clause === clause)

/**
 * Where a gate's finding or warning is, and how severe it is: the side
 * channel a gate writes beside the messages it returns, which the report
 * reads to place each one.
 */
export class CheckNote {
  /** The gate's name. */
  gate: string
  /** The id or field it is about: a requirement, a clause, `functions`, ... */
  at: string
  /** What the gate found. */
  message: string
  /** True for a warning, which never fails the check. */
  warning: boolean
  /**
   * Makes a note.
   *
   * @param gate the gate's name
   * @param at what it is about
   * @param message what was found
   * @param warning whether it is only a warning
   */
  constructor(gate: string, at: string, message: string, warning: boolean) {
    this.gate = gate
    this.at = at
    this.message = message
    this.warning = warning
  }
}

/** What running one vector source's command found. */
export class CheckSourceRun {
  /** The vector clause's id. */
  clause: string
  /** The shell command the vector's source declares. */
  command: string
  /** "pass", "fail" or "not run". */
  outcome: string
  /** What went wrong: a mismatch, a timeout or a bad exit; "" when it passed or was not run. */
  detail: string
  /**
   * Makes a result.
   *
   * @param clause the vector's id
   * @param command the command it runs
   * @param outcome "pass", "fail" or "not run"
   * @param detail what it printed, or why it failed
   */
  constructor(clause: string, command: string, outcome: string, detail: string) {
    this.clause = clause
    this.command = command
    this.outcome = outcome
    this.detail = detail
  }
}

/** How a property's samples were chosen: counts and notes for the report. */
export class CheckSampleStat {
  /** The property's id. */
  clause: string
  /** Samples chosen at a boundary the solver found. */
  boundary: i32
  /** Samples drawn by the seeded generator. */
  random: i32
  /** Whether some input satisfies the property's domain. */
  inhabited: boolean
  /** What the sampler says about the choice, for the report. */
  notes: string[]
  /**
   * Makes empty stats.
   *
   * @param clause the property's id
   */
  constructor(clause: string) {
    this.clause = clause
    this.boundary = 0
    this.random = 0
    this.inhabited = false
    this.notes = []
  }
}

/** What a check runs with: where the contract is, and what the gates produce. */
export class CheckContext {
  /** The contract's own path. */
  contractPath: string
  /** The repository root, which sources are read from inside. */
  root: string
  /** The contract being checked; checkContract sets it before the first gate. */
  contract: Contract
  /** The samples gates choose for the generated test; each run starts a new table. */
  samples: SampleTable
  /** Where each finding is, and every warning; each run starts empty. */
  notes: CheckNote[]
  /** The contract's sources, read by the first gate that needs them; null until then. */
  sources: SourceSet | null = null
  /** Which clauses cover each requirement id; each run starts empty. */
  coverage: Map<string, string[]>
  /** Whether vector sources' commands are run (`--run-sources`). */
  runSources: boolean
  /** What each command printed; each run starts empty. */
  sourceRuns: CheckSourceRun[]
  /** How long a source command may run, in milliseconds. */
  runTimeoutMs: i32
  /** The module under test's file, for the signatures gate; null skips it. */
  moduleFile: string | null = null
  /** The file `--spec` names, which must be the main source the contract records; null when none. */
  specPath: string | null = null
  /** The Nish compiler's root, where a `nish/...` module is looked up; null when unknown. */
  nishRoot: string | null = null
  /** The report's format: "text", "markdown" or "json". */
  format: string
  /** Each property's sampling stats; each run starts empty. */
  sampleStats: CheckSampleStat[]
  /** Why a tool the gates need (z3) failed, which exits 2; null when none did. Each run starts null. */
  toolFailure: string | null = null
  /** The readers sources are read with, by extension; sourceReadersDefault until checkAddReader adds one. */
  readers: SourceReaders
  /**
   * Makes a context.
   *
   * @param contractPath the contract's path
   * @param root the repository root
   */
  constructor(contractPath: string, root: string) {
    this.contractPath = contractPath
    this.root = root
    this.contract = new Contract()
    this.samples = new SampleTable()
    this.notes = []
    this.coverage = new Map<string, string[]>()
    this.runSources = false
    this.sourceRuns = []
    this.runTimeoutMs = 30000
    this.format = "text"
    this.sampleStats = []
    this.readers = sourceReadersDefault()
  }
}

/**
 * Adds a source reader to a check's readers, so the gates read sources with
 * that extension (`.xml`) with it; it replaces one already there.
 *
 * @param ctx the check's context
 * @param ext the extension, with its leading dot: ".xml"
 * @param kind the format files with that extension are read as
 * @returns `Ok(true)` when added, `Err` (as sourceReadersAdd) when `ext` is
 *   not a leading dot and a name; nothing is added then
 */
export const checkAddReader = (ctx: CheckContext, ext: string, kind: SourceReaderKind): Result<boolean, string> =>
  sourceReadersAdd(ctx.readers, ext, kind)

/** A gate: every finding in `ctx.contract`, one message each; empty when it passes. */
export type CheckGate = (ctx: CheckContext) => string[]

/** A gate in the registry. */
export class CheckGateEntry {
  /** The name its findings are reported under. */
  name: string
  /** The gate: it returns one message per finding. */
  run: CheckGate
  /** Whether a finding stops the gates after it. */
  blocking: boolean
  /**
   * Makes a registry entry.
   *
   * @param name the gate's name
   * @param run the gate
   * @param blocking whether a finding stops the gates after it
   */
  constructor(name: string, run: CheckGate, blocking: boolean) {
    this.name = name
    this.run = run
    this.blocking = blocking
  }
}

/** One finding of one gate. */
export class CheckFinding {
  /** The name of the gate that found it. */
  gate: string
  /** What the gate found. */
  message: string
  /**
   * Makes a finding.
   *
   * @param gate the gate's name
   * @param message what it found
   */
  constructor(gate: string, message: string) {
    this.gate = gate
    this.message = message
  }
}

/** What a check found. */
export class CheckReport {
  /** Every finding, in the order the gates ran. */
  findings: CheckFinding[]
  /** The gates that ran, in order. */
  ran: string[]
  /** The gates a blocking finding stopped. */
  skipped: string[]
  /** The samples the gates chose, for emit. */
  samples: SampleTable
  /**
   * Makes an empty report.
   *
   * @param samples the table the gates add samples to
   */
  constructor(samples: SampleTable) {
    this.findings = []
    this.ran = []
    this.skipped = []
    this.samples = samples
  }
}

/**
 * The shape gate: every value the schema and the generated test constrain.
 *
 * @param ctx the check's context, holding the contract
 * @returns each error
 */
export const checkShapeGate = (ctx: CheckContext): string[] => contractShapeErrors(ctx.contract)

/**
 * The registered gates, in the order they run.
 *
 * @returns the registry
 */
export const checkGates = (): CheckGateEntry[] => [
  new CheckGateEntry("shape", checkShapeGate, true),
  new CheckGateEntry("ids", gateIds, true),
  new CheckGateEntry("typing", gateTyping, false),
  new CheckGateEntry("coverage", gateCoverage, false),
  new CheckGateEntry("fidelity", gateFidelity, false),
  new CheckGateEntry("completeness", gateCompleteness, false),
  new CheckGateEntry("run-sources", gateRunSources, false),
  new CheckGateEntry("provenance", gateProvenance, false),
  new CheckGateEntry("signatures", gateSignatures, false),
  new CheckGateEntry("domain", gateDomain, false),
]

/**
 * Runs the given gates over a contract, in order, collecting every finding.
 * A blocking gate that finds anything stops the gates after it, which the
 * report lists as skipped. Each run starts with an empty sample table, so a
 * context reused across contracts never carries one's samples into another.
 *
 * @param ctx the check's context
 * @param contract the contract
 * @param gates the gates to run
 * @returns what they found
 */
export const checkContractWith = (ctx: CheckContext, contract: Contract, gates: CheckGateEntry[]): CheckReport => {
  ctx.contract = contract
  ctx.samples = new SampleTable()
  ctx.notes = []
  ctx.sources = null
  ctx.coverage = new Map<string, string[]>()
  ctx.sourceRuns = []
  ctx.sampleStats = []
  ctx.toolFailure = null
  const report = new CheckReport(ctx.samples)
  let stopped = false
  for (const g of gates) {
    if (stopped) {
      report.skipped.push(g.name)
      continue
    }
    const run = g.run
    const found = run(ctx)
    report.ran.push(g.name)
    for (const m of found) {
      report.findings.push(new CheckFinding(g.name, m))
    }
    if (g.blocking && found.length > 0) {
      stopped = true
    }
  }
  return report
}

/**
 * The report of a contract its structure refused, before any gate could run:
 * the reader's errors as the given gate's findings, the gates after it
 * skipped. The context is reset as checkContractWith resets it, holding an
 * empty contract, so the report renders without a model to read.
 *
 * @param ctx the check's context
 * @param gate the gate the errors are reported under
 * @param errors each structural error
 * @param gates the registered gates, which name the skipped ones
 * @returns the refused report
 */
export const checkRefused = (
  ctx: CheckContext,
  gate: string,
  errors: string[],
  gates: CheckGateEntry[],
): CheckReport => {
  const report = checkContractWith(ctx, new Contract(), [])
  report.ran.push(gate)
  for (const m of errors) {
    report.findings.push(new CheckFinding(gate, m))
  }
  for (const g of gates) {
    if (g.name !== gate) {
      report.skipped.push(g.name)
    }
  }
  return report
}

/**
 * Runs every registered gate over a contract.
 *
 * @param ctx the check's context
 * @param contract the contract
 * @returns what the gates found
 */
export const checkContract = (ctx: CheckContext, contract: Contract): CheckReport =>
  checkContractWith(ctx, contract, checkGates())

/**
 * Whether a check passed: no gate found anything.
 *
 * @param report the report
 * @returns true when there is no finding
 */
export const checkPassed = (report: CheckReport): boolean => report.findings.length === 0

/**
 * A report's findings as lines, `<gate>: <message>`.
 *
 * @param report the report
 * @returns one line per finding
 */
export const checkLines = (report: CheckReport): string[] =>
  report.findings.map((f: CheckFinding): string => `${f.gate}: ${f.message}`)
