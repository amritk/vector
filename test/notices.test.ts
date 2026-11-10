import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { licensesText } from "../src/licenses.ts";

const root = join(import.meta.dir, "..");
const notices = readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8");

// The npm packages THIRD_PARTY_NOTICES.md has a section for.
function noticedPackages(): string[] {
  return [...notices.matchAll(/^### npm: `([^`]+)`$/gm)]
    .map((m) => m[1] as string)
    .sort();
}

// The npm packages `bun build` puts into the CLI bundle: Bun marks each module
// it inlines with a `// node_modules/<pkg>/…` comment.
async function bundledPackages(): Promise<string[]> {
  const result = await Bun.build({
    entrypoints: [join(root, "src/cli.ts")],
    target: "bun",
  });
  expect(result.success).toBe(true);
  const found = new Set<string>();
  let ownModules = 0;
  for (const output of result.outputs) {
    const code = await output.text();
    // Bun marks vector's own modules the same way (`// src/cli.ts`); seeing
    // those proves the marker format still holds, so an empty set is real.
    ownModules += code.match(/^\/\/ src\/\S+\.ts$/gm)?.length ?? 0;
    for (const m of code.matchAll(
      /^\/\/ (?:.*\/)?node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\//gm,
    )) {
      found.add(m[1] as string);
    }
  }
  expect(ownModules).toBeGreaterThan(0);
  return [...found].sort();
}

describe("third-party notices", () => {
  test("cover exactly the npm packages bundled into the binary", async () => {
    const bundled = await bundledPackages();
    expect(noticedPackages()).toEqual(bundled);
  });

  test("vector --licenses prints vector's license, then the notices", () => {
    const text = licensesText();
    const license = readFileSync(join(root, "LICENSE"), "utf8").trimEnd();
    expect(text.startsWith(license)).toBe(true);
    expect(text).toContain(notices.trimEnd());
    expect(text).toContain(
      `https://github.com/oven-sh/bun/blob/bun-v${Bun.version}/LICENSE.md`,
    );
  });
});
