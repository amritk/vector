/**
 * `spec/gates/run` — runs each vector's source command when `--run-sources`
 * is given, and records what it printed for the provenance gate, which runs
 * after it. The commands come from the contract, so they are untrusted: each
 * runs as `sh -c` from the contract's directory, under `timeout -s KILL`,
 * which puts the command in its own process group and kills the whole group
 * at the deadline, so a forked grandchild dies with it. Only the deadline
 * kills the group: a command that exits in time may leave a backgrounded
 * child running, and one that leaves the group on purpose, with `setsid`,
 * is never contained. The caller is warned before any command runs.
 */

import { splitLines, trim } from "nish/text"
import { dirname } from "../../core/fs"
import { toHex } from "../../core/hex"
import { runProcess } from "../../core/process"
import { textAsciiLower } from "../../core/text"
import { CheckContext, CheckSourceRun } from "../check"
import { Clause, ClauseKind, Contract, Literal, VectorSourceKind } from "../contract/types"
import { SampleKind, SampleValue, sampleLiteral } from "../sample/eval"
import { sampleIntText } from "../sample/ints"

/** How much longer than the command's own limit the outer limit is, for `timeout` itself to exit. */
const GATE_RUN_SLACK_MS: i32 = 5000

/**
 * The argv that runs a source command from a directory, killed with its
 * process group after `timeoutMs`.
 *
 * @param command the shell command
 * @param dir the directory it runs in
 * @param timeoutMs the most milliseconds it may run
 * @returns the argv
 */
export const gateRunArgv = (command: string, dir: string, timeoutMs: i32): string[] => {
  const ms = timeoutMs < 1 ? 1 : timeoutMs
  const frac = `${ms % 1000}`
  const secs = `${toI32(ms / 1000)}.${"000".substring(0, 3 - frac.length)}${frac}`
  return ["timeout", "-s", "KILL", secs, "sh", "-c", 'cd -- "$0" && exec sh -c "$1"', dir, command]
}

/** A text cut to 80 bytes for a message, never inside a UTF-8 sequence. */
const gateRunShort = (s: string): string => {
  if (s.length <= 80) {
    return s
  }
  let cut = 77
  while (cut > 0 && (s.charCodeAt(cut) & 0xc0) === 0x80) {
    cut--
  }
  return `${s.substring(0, cut)}...`
}

/** The last non-empty line of a text, or "". */
const gateRunLastLine = (s: string): string => {
  const lines = splitLines(trim(s))
  const n = lines.length
  return n > 0 ? trim(lines[n - 1]) : ""
}

/**
 * The one text a command must print for a value that is not bytes: a string
 * as it is, an integer in decimal (no `+`, no leading zero, `-` only when
 * negative), `true` or `false`, or `null`.
 */
const gateRunText = (lit: Literal, v: SampleValue): string => {
  if (v.kind === SampleKind.Int) {
    // A literal above i64's range is held wrapped; its text is unsigned.
    return sampleIntText(v.n, lit.text.startsWith("-") ? "i64" : "u64")
  }
  if (v.kind === SampleKind.Bool) {
    return v.flag ? "true" : "false"
  }
  return v.kind === SampleKind.Null ? "null" : v.text
}

/**
 * Judges what a source command did against the value its vector expects.
 *
 * @param k the vector clause
 * @param status the command's exit status
 * @param stdout what it printed
 * @param stderr what it wrote to standard error
 * @param timedOut whether the deadline killed it
 * @param timeoutMs its limit, for the message
 * @returns the run's outcome
 */
export const gateRunJudge = (
  k: Clause,
  status: i32,
  stdout: string,
  stderr: string,
  timedOut: boolean,
  timeoutMs: i32,
): CheckSourceRun => {
  const s = k.source
  const command = s === null ? "" : s.text
  if (timedOut) {
    return new CheckSourceRun(k.id, command, "fail", `timed out after ${timeoutMs} ms`)
  }
  if (status !== 0) {
    const why = gateRunLastLine(stderr)
    return new CheckSourceRun(k.id, command, "fail", `exited ${status}${why === "" ? "" : ` (${why})`}`)
  }
  const e = k.expect
  if (e === null) {
    return new CheckSourceRun(k.id, command, "fail", "the vector has no expected value")
  }
  const v = sampleLiteral(e)
  if (v.isErr()) {
    return new CheckSourceRun(k.id, command, "fail", `the expected value cannot be read: ${v.error}`)
  }
  const bytes = v.value.kind === SampleKind.Bytes
  const want = bytes ? toHex(v.value.bytes) : gateRunText(e, v.value)
  const printed = trim(stdout)
  // Hex is compared case-blind; nothing else is.
  const got = bytes ? textAsciiLower(printed) : printed
  if (got === want) {
    return new CheckSourceRun(k.id, command, "pass", "")
  }
  return new CheckSourceRun(
    k.id,
    command,
    "fail",
    `printed "${gateRunShort(printed)}", the vector expects "${gateRunShort(want)}"`,
  )
}

/**
 * The vector clauses whose source is a command, in contract order.
 *
 * @param c the contract
 * @returns those clauses
 */
export const gateRunCommands = (c: Contract): Clause[] =>
  c.clauses.filter((k: Clause): boolean => {
    const s = k.source
    return k.kind === ClauseKind.Vector && s !== null && s.kind === VectorSourceKind.Command
  })

/**
 * The run-sources gate: with `ctx.runSources`, runs every command source
 * (see the module comment) into `ctx.sourceRuns`; without it, records each as
 * not run. Its findings are the provenance gate's, so it returns none; a
 * command that cannot be started at all is a tool failure.
 *
 * @param ctx the check's context, holding the contract
 * @returns nothing: provenance reports what the runs found
 */
export const gateRunSources = (ctx: CheckContext): string[] => {
  const dir = dirname(ctx.contractPath)
  for (const k of gateRunCommands(ctx.contract)) {
    const s = k.source
    const command = s === null ? "" : s.text
    if (!ctx.runSources || ctx.toolFailure !== null) {
      ctx.sourceRuns.push(new CheckSourceRun(k.id, command, "not run", ""))
      continue
    }
    const limit = ctx.runTimeoutMs
    // The outer limit must fit an i32: 2147483647 less the slack.
    if (limit > 2147478647) {
      const why = `a limit of ${limit} ms is over 2147478647 ms`
      ctx.toolFailure = `${k.id}: source command: ${why}`
      ctx.sourceRuns.push(new CheckSourceRun(k.id, command, "not run", why))
      continue
    }
    const started = monotonicNanos()
    const r = runProcess(gateRunArgv(command, dir, limit), "", limit + GATE_RUN_SLACK_MS)
    if (r.isErr()) {
      ctx.toolFailure = `${k.id}: source command: ${r.error}`
      ctx.sourceRuns.push(new CheckSourceRun(k.id, command, "not run", r.error))
      continue
    }
    const p = r.value
    // `timeout` exits 137 when its KILL ended the command; so does a command
    // that died of KILL itself, so the clock decides which.
    // A clock that reads earlier than `started` shows no deadline passed.
    const now = monotonicNanos()
    const late = started >= 0 && now >= started && (now - started) / 1000000 >= toI64(limit)
    const killed = p.timedOut || (p.status === 137 && late)
    ctx.sourceRuns.push(gateRunJudge(k, p.status, p.stdout, p.stderr, killed, limit))
  }
  return []
}
