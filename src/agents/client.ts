import Anthropic from "@anthropic-ai/sdk";

// Shared LLM plumbing for the two generative phases. Mirrors the
// review_middleware synthesize.ts conventions: lazy singleton client,
// structured outputs via output_config, frozen cached system prompt with the
// volatile payload in the user turn. Results are re-validated with the
// mjst-generated parsers plus the engine's own shape validators — the JSON
// Schema in schemas/ is the single source of truth for both.

export const EWD_MODEL = "claude-opus-4-7";

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
      "ANTHROPIC_API_KEY is not set — cannot run the EWD-1 generative phases.",
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

export async function structuredCall<T>(
  options: StructuredCallOptions<T>,
): Promise<T> {
  const response = await getClient().messages.create({
    model: EWD_MODEL,
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
    throw new Error("Model refused the EWD-1 request.");
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
