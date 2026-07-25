import Anthropic from "@anthropic-ai/sdk";

// Shared LLM plumbing for the generative phases (Architect, Generator,
// Adversary). Two interchangeable backends:
//
//   "api"        — the Anthropic SDK with ANTHROPIC_API_KEY (pay-per-token).
//                  Structured output is enforced server-side via output_config.
//   "claude-cli" — headless Claude Code (`claude -p`), which bills a Claude
//                  Pro/Max subscription instead of an API key. Locally it uses
//                  your `claude` login; in CI use a token from
//                  `claude setup-token` (CLAUDE_CODE_OAUTH_TOKEN). Structured
//                  output is requested in the prompt and enforced by the same
//                  deterministic parsers — malformed output is a
//                  MalformedOutputError either way, which the repair loops
//                  already handle.
//
// Selection: VECTOR_LLM=api|claude-cli wins; otherwise "api" iff
// ANTHROPIC_API_KEY is set, else "claude-cli". Results are always re-validated
// with the mjst-generated parsers plus the engine's own shape validators — the
// JSON Schema in schemas/ is the single source of truth for both backends.

export const VECTOR_MODEL = "claude-opus-4-7";

/**
 * The model produced output that failed parsing or shape validation.
 * Retryable: the pipeline feeds it back to the Generator; distinct from API
 * or infrastructure errors, which are not the model's to fix.
 */
export class MalformedOutputError extends Error {}

export type LlmBackend = "api" | "claude-cli";

export function resolveLlmBackend(
  env: Record<string, string | undefined> = process.env,
): LlmBackend {
  const forced = env.VECTOR_LLM;
  if (forced === "api" || forced === "claude-cli") return forced;
  if (forced) {
    throw new Error(
      `VECTOR_LLM must be "api" or "claude-cli", got "${forced}"`,
    );
  }
  return env.ANTHROPIC_API_KEY ? "api" : "claude-cli";
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — cannot run the vector generative phases.",
    );
  }
  client ??= new Anthropic();
  return client;
}

export interface StructuredCallOptions<T> {
  systemPrompt: string;
  userContent: string;
  jsonSchema: Record<string, unknown>;
  parse: (input: unknown) => T;
}

async function apiCall<T>(options: StructuredCallOptions<T>): Promise<T> {
  const response = await getClient().messages.create({
    model: VECTOR_MODEL,
    max_tokens: 8192,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: options.systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    output_config: {
      format: { type: "json_schema", schema: options.jsonSchema },
      effort: "high",
    },
    messages: [{ role: "user", content: options.userContent }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Model refused the vector request.");
  }
  const jsonText = response.content.find(
    (block) => block.type === "text",
  )?.text;
  if (!jsonText) {
    throw new Error(
      `Model returned no text output (stop_reason: ${response.stop_reason}).`,
    );
  }
  return parseOrMalformed(options, jsonText);
}

/**
 * Pull the JSON object out of free text: exact JSON, a ```fenced``` block, or
 * the outermost brace span. The CLI backend has no server-side output_config,
 * so the model may wrap its JSON despite instructions.
 */
export function extractJsonBlock(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    const lastBrace = trimmed.lastIndexOf("}");
    if (lastBrace >= 0) return trimmed.slice(0, lastBrace + 1);
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) return fence[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

function parseOrMalformed<T>(
  options: StructuredCallOptions<T>,
  jsonText: string,
): T {
  try {
    return options.parse(JSON.parse(jsonText));
  } catch (err) {
    if (err instanceof MalformedOutputError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new MalformedOutputError(message);
  }
}

async function claudeCliCall<T>(options: StructuredCallOptions<T>): Promise<T> {
  const bin = Bun.which("claude");
  if (!bin) {
    throw new Error(
      "No LLM backend available: set ANTHROPIC_API_KEY (API billing), or install " +
        "and log in the `claude` CLI to bill a Claude Pro/Max subscription " +
        "(in CI: `claude setup-token` → CLAUDE_CODE_OAUTH_TOKEN).",
    );
  }
  const prompt = `${options.systemPrompt}

${options.userContent}

Respond with ONLY a single JSON object — no markdown fences, no prose before or after — that conforms to this JSON Schema:
${JSON.stringify(options.jsonSchema)}`;

  // Strip ANTHROPIC_API_KEY so the CLI bills the subscription login, which is
  // the whole point of this backend being selected.
  const env: Record<string, string | undefined> = {
    ...process.env,
    ANTHROPIC_API_KEY: undefined,
  };

  const proc = Bun.spawnSync(
    [bin, "-p", "--output-format", "json", "--model", VECTOR_MODEL],
    {
      stdin: Buffer.from(prompt, "utf8"),
      stdout: "pipe",
      stderr: "pipe",
      env,
      timeout: 300_000,
    },
  );
  if (proc.exitCode !== 0) {
    const stderr = proc.stderr.toString().trim().slice(0, 500);
    throw new Error(
      `claude CLI exited ${proc.exitCode}${stderr ? `: ${stderr}` : ""}`,
    );
  }
  let resultText: string;
  try {
    const wrapper = JSON.parse(proc.stdout.toString()) as {
      is_error?: boolean;
      result?: string;
    };
    if (wrapper.is_error) {
      throw new Error(`claude CLI reported an error: ${wrapper.result}`);
    }
    if (typeof wrapper.result !== "string") {
      throw new Error("claude CLI returned no result text");
    }
    resultText = wrapper.result;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("claude CLI")) throw err;
    throw new Error(
      `could not parse claude CLI output: ${err instanceof Error ? err.message : err}`,
    );
  }
  return parseOrMalformed(options, extractJsonBlock(resultText));
}

export async function structuredCall<T>(
  options: StructuredCallOptions<T>,
): Promise<T> {
  return resolveLlmBackend() === "api"
    ? apiCall(options)
    : claudeCliCall(options);
}
