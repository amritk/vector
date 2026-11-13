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
 * property, adds them to `ctx.samples`; emit reads them from the report. Only
 * the shape gate is registered here; the other gates live with their stages.
 */

import { contractShapeErrors } from "./contract/shape"
import { Contract, Literal } from "./contract/types"
import { gateCompleteness } from "./gates/completeness"
import { gateCoverage } from "./gates/coverage"
import { gateFidelity } from "./gates/fidelity"
import { gateIds } from "./gates/ids"
import { gateProvenance } from "./gates/provenance"
import { gateTyping } from "./gates/typing"
import { SourceSet } from "./source/load"

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
  command: string
  /** "pass", "fail" or "not run". */
  outcome: string
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
  clause: string
  /** Samples chosen at a boundary the solver found. */
  boundary: i32
  /** Samples drawn by the seeded generator. */
  random: i32
  /** Whether some input satisfies the property's domain. */
  inhabited: boolean
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
  /** The Nish compiler's root, where a `nish/...` module is looked up; null when unknown. */
  nishRoot: string | null = null
  /** The report's format: "text", "markdown" or "json". */
  format: string
  /** Each property's sampling stats; each run starts empty. */
  sampleStats: CheckSampleStat[]
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
  }
}

/** A gate: every finding in `ctx.contract`, one message each; empty when it passes. */
export type CheckGate = (ctx: CheckContext) => string[]

/** A gate in the registry. */
export class CheckGateEntry {
  /** The name its findings are reported under. */
  name: string
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
  gate: string
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
  new CheckGateEntry("provenance", gateProvenance, false),
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
