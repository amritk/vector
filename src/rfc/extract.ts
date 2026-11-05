// RFC → contract with a model in the loop: the model proposes a contract, the
// deterministic gates (and Z3's domain check) judge it, and their failures go
// back as feedback until it passes or the retries run out. The model never
// decides whether the contract is faithful; the RFC text does.

import { readFileSync, writeFileSync } from "node:fs";
import contractJsonSchema from "../../schemas/rfc-contract.json" with {
  type: "json",
};
import { MalformedOutputError } from "../agents/client.ts";
import { type RfcContract, validateContractShape } from "./contract.ts";
import { exportedSignatures, runGates } from "./gates.ts";
import {
  type ContractReport,
  renderReport,
  reportJson,
  reportStatus,
} from "./report.ts";
import { sampleContract } from "./sample.ts";
import { parseDocument } from "./spectext.ts";

export const EXTRACTOR_SYSTEM_PROMPT = `You turn an RFC into a test contract for an implementation \
of it. The contract is JSON (the schema is enforced). It is checked mechanically against the RFC \
text before anything runs, so:

- requirements[].quote is copied VERBATIM from the cited section (line breaks may differ; nothing \
else may). Cite the most specific section that contains it. Use the BCP 14 keyword as the level \
when the sentence has one, DEFINITION when it defines what the algorithm computes.
- Every MUST / MUST NOT / SHALL / SHALL NOT / REQUIRED sentence in the RFC must sit inside a \
requirement's quote or an exclusion's quote. Exclude only what a functional test cannot observe \
(caller obligations such as nonce uniqueness, timing, key management) and say why.
- Every requirement you state must be cited by at least one clause, and clauses may only cite \
requirements you stated.
- Vector clauses use the RFC's own test vectors: every hex/ascii/int value must be printed in the \
cited section. Give each vector a source: {"cite": {"section": "A.1"}} when the section prints the \
expected value too. Use concat when the RFC prints a value in parts (ciphertext then tag; a fixed \
part then an IV). Never compute or invent a value.
- Property clauses state what the RFC defines, over a typed domain: lengths, bounds (put the bound \
in an integer comparison so the solver samples both sides of it), round trips, tamper rejection, \
and the RFC's own construction rebuilt from other functions under test (e.g. a block of output \
equals the formula that defines it). Keep 'where' free of calls.
- functions[] are the implementation's real exported signatures, mapped to bytes (u8[]), \
bytes? (u8[] | null), i32, u32, bool. A function from another module (a reference such as HMAC) \
names its module.
- The spec may be an RFC or a markdown document whose sections are numbered headings. For an RFC \
set source.rfc to its number; for anything else declare sources: [{"id": "<short name>", "path": \
"<file>"}] and source.main: "<that id>".`;

export interface ExtractInputs {
  rfcText: string;
  moduleSource: string;
  target: string;
}

export interface ExtractDeps {
  /** One model call: the user turn in, a contract-shaped object out. */
  propose: (userContent: string) => Promise<unknown>;
}

export interface ExtractOutcome {
  contract: RfcContract | null;
  report: ContractReport;
  attempts: number;
}

function userTurn(
  inputs: ExtractInputs,
  previous: unknown,
  feedback: string[],
): string {
  const sigs = [...exportedSignatures(inputs.moduleSource)]
    .map(([name, s]) => `  ${name}(${s.params.join(", ")}): ${s.returns}`)
    .join("\n");
  const parts = [
    `Target module: ${inputs.target}`,
    `Its exported functions:\n${sigs || "  (none found)"}`,
    `The RFC:\n\n${inputs.rfcText}`,
  ];
  if (previous !== undefined) {
    parts.push(
      `Your previous contract:\n${JSON.stringify(previous)}`,
      `It failed these checks. Fix exactly these, keep everything that passed:\n- ${feedback.join("\n- ")}`,
    );
  }
  return parts.join("\n\n");
}

export async function extractContract(
  inputs: ExtractInputs,
  deps: ExtractDeps,
  maxRetries = 3,
): Promise<ExtractOutcome> {
  const rfc = parseDocument(inputs.rfcText);
  let previous: unknown;
  let feedback: string[] = [];
  let report: ContractReport = {
    contract: null,
    gates: { ok: false, issues: [], warnings: [], coverage: new Map() },
  };
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    let proposed: unknown;
    try {
      proposed = await deps.propose(userTurn(inputs, previous, feedback));
    } catch (err) {
      if (!(err instanceof MalformedOutputError)) throw err;
      feedback = [err.message];
      continue;
    }
    previous = proposed;
    const gates = runGates(proposed, {
      rfc,
      moduleSource: inputs.moduleSource,
    });
    report = {
      contract: gates.issues.some((i) => i.gate === "shape")
        ? null
        : (proposed as RfcContract),
      gates,
    };
    if (gates.ok) {
      report.sampling = await sampleContract(proposed as RfcContract);
      if (report.sampling.ok)
        return { contract: proposed as RfcContract, report, attempts: attempt };
    }
    feedback = [
      ...gates.issues.map((i) => `[${i.gate}] ${i.at}: ${i.message}`),
      ...(report.sampling?.issues ?? []).map(
        (i) => `[domain] ${i.at}: ${i.message}`,
      ),
    ];
  }
  return { contract: null, report, attempts: maxRetries + 1 };
}

async function anthropicPropose(userContent: string): Promise<unknown> {
  const { structuredCall } = await import("../agents/client.ts");
  return structuredCall({
    systemPrompt: EXTRACTOR_SYSTEM_PROMPT,
    userContent,
    jsonSchema: contractJsonSchema as Record<string, unknown>,
    parse: (input: unknown) => {
      const errors = validateContractShape(input);
      if (errors.length > 0) {
        throw new MalformedOutputError(
          `contract failed shape validation:\n- ${errors.join("\n- ")}`,
        );
      }
      return input;
    },
  });
}

export async function runExtract(opts: {
  rfcPath?: string;
  modulePath?: string;
  target?: string;
  out?: string;
  maxRetries: number;
  json: boolean;
}): Promise<number> {
  if (!opts.rfcPath || !opts.modulePath || !opts.target || !opts.out) {
    console.error(
      "error: extract needs --spec <file> --module <src.ts> --target <module> -o <contract.json>",
    );
    return 2;
  }
  const outcome = await extractContract(
    {
      rfcText: readFileSync(opts.rfcPath, "utf8"),
      moduleSource: readFileSync(opts.modulePath, "utf8"),
      target: opts.target,
    },
    { propose: anthropicPropose },
    opts.maxRetries,
  );
  console.log(
    opts.json
      ? JSON.stringify(reportJson(outcome.report), null, 2)
      : renderReport(outcome.report),
  );
  if (!outcome.contract) {
    console.error(
      `no valid contract after ${outcome.attempts} attempt(s); status ${reportStatus(outcome.report)}`,
    );
    return 1;
  }
  writeFileSync(opts.out, `${JSON.stringify(outcome.contract, null, 2)}\n`);
  console.log(
    `\n(contract written to ${opts.out} after ${outcome.attempts} attempt(s); review it, then \`vector spec check --run-sources\` before relying on its command sources, then \`vector spec run\`)`,
  );
  return 0;
}
