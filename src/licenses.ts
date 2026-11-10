// `vector --licenses`: vector's own license, then the third-party notices for
// everything the compiled binary embeds. The texts are imported, not read from
// disk, so a standalone `dist/vector` carries them inside itself.
import license from "../LICENSE" with { type: "text" };
import notices from "../THIRD_PARTY_NOTICES.md" with { type: "text" };

export function licensesText(): string {
  const bun = typeof Bun === "undefined" ? undefined : Bun.version;
  const runtime = bun
    ? `Runtime: Bun ${bun}. Its license and the licenses of the libraries it ` +
      `statically links:\nhttps://github.com/oven-sh/bun/blob/bun-v${bun}/LICENSE.md\n`
    : "";
  return `${license.trimEnd()}\n\n${"=".repeat(78)}\n\n${runtime}\n${notices.trimEnd()}\n`;
}
