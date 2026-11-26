/**
 * `cli/spec-extract` — `vector spec extract`: extract a contract from a kramdown-rfc spec's XML.
 *
 * The contract goes to stdout, or to `-o`; with `--check` nothing is written,
 * and a diff against `-o` exits 1. Refusals exit 1, each `file:line[:col]:
 * message`, or `spec.md:line (spec.xml:line[:col]): message` when the `.md` is
 * beside the spec and only a `<?line?>` mark above the refusal names its
 * markdown line; an input or RFC that cannot be read exits 2.
 */

import { Cli, ParseResult } from "nish/cli-args"
import {
  EXIT_PASS,
  EXIT_REFUSED,
  EXIT_USAGE,
  formatDiagnostic,
  refusal,
  refusalAt,
  report,
  usageError,
} from "../core/diag"
import { utf8Bytes } from "../core/hex"
import {
  EXTRACT_SIDECAR_SUFFIX,
  extractContract,
  extractDefaultContractPath,
  extractReaders,
  extractUnifiedDiff,
} from "../spec/extract"
import { sourceInstallRoot } from "../spec/source/path"

/** The id `vector spec extract` is parsed to. */
export const SPEC_EXTRACT_ID: i32 = 3

/** `vector spec extract`, declared on a `Cli`: its handles and its handler. */
export class SpecExtractCommand {
  /** The `-o, --out <contract.json>` flag. */
  outFlag: i32
  /** The `--check` flag. */
  checkFlag: i32
  /** The `<spec.xml>` argument. */
  specXmlArg: i32

  /**
   * Declares `vector spec extract` and its flags under `parent`.
   *
   * @param cli the command tree
   * @param parent the handle to declare it under (`ROOT` or the `spec` group)
   */
  constructor(cli: Cli, parent: i32) {
    const handle = cli.command(parent, "extract", SPEC_EXTRACT_ID, "Extract a contract from a kramdown-rfc spec's XML")
    this.outFlag = cli.flag(handle, "-o, --out <contract.json>", "where to write the contract")
    this.checkFlag = cli.flag(handle, "--check", "write nothing; exit 1 with a diff if --out differs")
    this.specXmlArg = cli.argument(handle, "<spec.xml>", "the spec, RFC XML v3")
  }

  /**
   * Runs the command.
   *
   * @param r the parsed arguments
   * @returns the exit code
   */
  run(r: ParseResult): i32 {
    const xml = r.positional(this.specXmlArg) ?? ""
    const outArg = r.value(this.outFlag)
    const check = r.flag(this.checkFlag)
    // extract reads only xml2rfc's output, and never runs it.
    if (xml.endsWith(".md")) {
      return report(usageError(`spec extract: build it first: scripts/build-spec.sh ${xml}`))
    }
    if (!xml.endsWith(".xml")) {
      return report(usageError(`spec extract: reads an RFC XML v3 spec (.xml), not ${xml}`))
    }
    if (check && outArg === null) {
      return report(usageError("spec extract: --check needs -o <contract.json>"))
    }
    // -o is overwritten: never the spec, nor the sidecar extract reads.
    if (outArg !== null) {
      const outReal = realpathSync(outArg) ?? ""
      if (outArg === xml || (outReal !== "" && outReal === (realpathSync(xml) ?? ""))) {
        return report(usageError(`spec extract: -o ${outArg} is the spec extract reads`))
      }
      if (outArg.endsWith(".md")) {
        return report(usageError(`spec extract: -o ${outArg} is markdown, not a contract`))
      }
      if (outArg.endsWith(EXTRACT_SIDECAR_SUFFIX)) {
        return report(usageError(`spec extract: -o ${outArg} is an allowSurvivors sidecar, not a contract`))
      }
    }
    const readers = extractReaders()
    if (readers.isErr()) {
      return report(usageError(`spec extract: ${readers.error}`))
    }
    const contractPath = outArg ?? extractDefaultContractPath(xml)
    const got = extractContract(xml, contractPath, sourceInstallRoot(), readers.value)
    if (got.errors.length > 0) {
      for (const e of got.errors) {
        console.error(formatDiagnostic(usageError(`spec extract: ${e}`)))
      }
      return EXIT_USAGE
    }
    if (got.refusals.length > 0) {
      for (const f of got.refusals) {
        console.error(formatDiagnostic(refusalAt(f.file, f.line, f.col, f.exactFile, f.exactLine, f.message)))
      }
      return EXIT_REFUSED
    }
    if (outArg === null) {
      specExtractPrint(got.text)
      return EXIT_PASS
    }
    if (check) {
      // A contract not there yet is empty; one there that cannot be read is an error.
      const read = readFileSyncOrNull(outArg)
      if (read === null && realpathSync(outArg) !== null) {
        return report(usageError(`spec extract: cannot read ${outArg}`))
      }
      const now = read ?? ""
      const diff = extractUnifiedDiff(now, got.text, outArg, `${outArg} (extracted from ${xml})`)
      if (diff.length === 0) {
        return EXIT_PASS
      }
      specExtractPrint(diff)
      return report(refusal(outArg, 0, `is not what ${xml} states; run: vector spec extract ${xml} -o ${outArg}`))
    }
    // A target there but not readable (a directory, say) keeps its usage error and exit 2; only a
    // write that fails after this takes writeFileSync's old abort path below.
    if (readFileSyncOrNull(outArg) === null && realpathSync(outArg) !== null) {
      return report(usageError(`spec extract: cannot write ${outArg}`))
    }
    // writeFileBytesSync writes the same bytes as writeFileSync, but answers a failure with a
    // negative errno instead of aborting; this prints and exits as writeFileSync's abort did.
    if (writeFileBytesSync(outArg, utf8Bytes(got.text)) < 0) {
      console.error(`nish: cannot write ${outArg}`)
      return EXIT_REFUSED
    }
    return EXIT_PASS
  }
}

/** Prints text that ends in a newline to stdout, as it is. */
const specExtractPrint = (text: string): void => {
  console.log(text.endsWith("\n") ? text.substring(0, text.length - 1) : text)
}

/**
 * Declares `vector spec extract` on the command tree.
 *
 * @param cli the command tree
 * @param parent the handle to declare it under
 * @returns the declared command, whose `run` handles it
 */
export const registerSpecExtract = (cli: Cli, parent: i32): SpecExtractCommand => new SpecExtractCommand(cli, parent)
