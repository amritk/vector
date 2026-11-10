import { describe, expect, test } from "bun:test";
import { CliError, parseArgs } from "../src/cli.ts";

// cli.ts guards its entrypoint on import.meta.main, so importing it here is
// side-effect free and parseArgs can be unit-tested directly.

describe("parseArgs", () => {
  test("collects the two --verify positional paths", () => {
    const args = parseArgs(["--verify", "spec.json", "prog.json", "--json"]);
    expect(args.spec).toBe("spec.json");
    expect(args.program).toBe("prog.json");
    expect(args.json).toBe(true);
  });

  test("rejects a bare prompt: vector never calls a model", () => {
    expect(() => parseArgs(["Build", "a", "converter"])).toThrow(
      /does not call a model/,
    );
  });

  test("--max-retries is gone with the model loop", () => {
    expect(() => parseArgs(["--max-retries", "5"])).toThrow(CliError);
  });

  test("rejects unknown flags", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(CliError);
  });
});
