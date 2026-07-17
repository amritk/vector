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

  test("joins bare words into one prompt", () => {
    const args = parseArgs(["Build", "a", "converter"]);
    expect(args.prompt).toBe("Build a converter");
  });

  test("accepts a valid --max-retries", () => {
    expect(parseArgs(["--max-retries", "5"]).maxRetries).toBe(5);
  });

  test.each([["abc"], ["0"], ["-1"], ["2.5"]])(
    "rejects --max-retries %s instead of silently defaulting",
    (bad) => {
      expect(() => parseArgs(["--max-retries", bad])).toThrow(CliError);
    },
  );

  test("rejects unknown flags", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(CliError);
  });
});
