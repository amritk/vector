import { describe, expect, test } from "bun:test";
import { extractJsonBlock, resolveLlmBackend } from "../src/agents/client.ts";

// Backend selection (API key vs Claude subscription via the claude CLI) and
// the JSON extraction the CLI backend needs because it has no server-side
// structured-output enforcement.

describe("resolveLlmBackend", () => {
  test("VECTOR_LLM override wins over the key heuristic", () => {
    expect(
      resolveLlmBackend({ VECTOR_LLM: "claude-cli", ANTHROPIC_API_KEY: "sk" }),
    ).toBe("claude-cli");
    expect(resolveLlmBackend({ VECTOR_LLM: "api" })).toBe("api");
  });

  test("defaults to api with a key, claude-cli without", () => {
    expect(resolveLlmBackend({ ANTHROPIC_API_KEY: "sk-ant-x" })).toBe("api");
    expect(resolveLlmBackend({})).toBe("claude-cli");
  });

  test("rejects unknown VECTOR_LLM values", () => {
    expect(() => resolveLlmBackend({ VECTOR_LLM: "bedrock" })).toThrow(
      'VECTOR_LLM must be "api" or "claude-cli"',
    );
  });
});

describe("extractJsonBlock", () => {
  const obj = '{"summary": "ok", "findings": []}';

  test("passes bare JSON through", () => {
    expect(extractJsonBlock(obj)).toBe(obj);
    expect(extractJsonBlock(`  ${obj}\n`)).toBe(obj);
  });

  test("unwraps fenced blocks", () => {
    expect(extractJsonBlock(`\`\`\`json\n${obj}\n\`\`\``)).toBe(obj);
    expect(extractJsonBlock(`\`\`\`\n${obj}\n\`\`\``)).toBe(obj);
  });

  test("falls back to the outermost brace span", () => {
    expect(
      extractJsonBlock(`Here is the review:\n${obj}\nHope that helps!`),
    ).toBe(obj);
  });
});
