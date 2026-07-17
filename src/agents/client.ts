import Anthropic from "@anthropic-ai/sdk";

// Shared LLM plumbing for the two generative phases. Mirrors the
// review_middleware synthesize.ts conventions: lazy singleton client,
// structured outputs via output_config, frozen cached system prompt with the
// volatile payload in the user turn. Results are re-validated with the
// mjst-generated parsers plus the engine's own shape validators — the JSON
// Schema in schemas/ is the single source of truth for both.

/** Overridable per-run: `VECTOR_MODEL=<model-id> vector "<prompt>"`. */
export const VECTOR_MODEL = process.env.VECTOR_MODEL ?? "claude-opus-4-7";

const MAX_OUTPUT_TOKENS = 8192;

/**
 * The model produced output that failed parsing or shape validation.
 * Retryable: the pipeline feeds it back to the Generator; distinct from API
 * or infrastructure errors, which are not the model's to fix.
 */
export class MalformedOutputError extends Error {}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — cannot run the vector generative phases.",
    );
  }
  // The SDK already retries transient failures (429/5xx/connection) with
  // backoff; give it a little more headroom than the default 2 attempts since
  // a whole pipeline run dies with the call.
  client ??= new Anthropic({ maxRetries: 4 });
  return client;
}

export interface StructuredCallOptions<T> {
  systemPrompt: string;
  userContent: string;
  jsonSchema: Record<string, unknown>;
  parse: (input: unknown) => T;
}

export async function structuredCall<T>(
  options: StructuredCallOptions<T>,
): Promise<T> {
  const response = await getClient().messages.create({
    model: VECTOR_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
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
  if (response.stop_reason === "max_tokens") {
    // Truncated JSON is not the model's mistake to repair — feeding it back as
    // MalformedOutputError would burn generator retries on an infra limit.
    throw new Error(
      `Model output was truncated at ${MAX_OUTPUT_TOKENS} tokens — the artifact does not fit. Simplify the request or raise the token budget.`,
    );
  }
  const jsonText = response.content.find(
    (block) => block.type === "text",
  )?.text;
  if (!jsonText) {
    throw new Error(
      `Model returned no text output (stop_reason: ${response.stop_reason}).`,
    );
  }
  try {
    return options.parse(JSON.parse(jsonText));
  } catch (err) {
    if (err instanceof MalformedOutputError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new MalformedOutputError(message);
  }
}
