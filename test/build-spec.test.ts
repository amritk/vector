import { describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// scripts/build-spec.sh needs kramdown-rfc 1.7.43 (Ruby) and xml2rfc 3.35.0
// (Python). CI has neither, so the build tests run only where both pinned
// versions are on PATH; elsewhere they skip and say so. The argument and
// tool-refusal checks need no Ruby or Python and always run.

// Each build runs kramdown-rfc and xml2rfc three times: about 2s.
setDefaultTimeout(60_000);

const root = join(import.meta.dir, "..");
const script = join(root, "scripts/build-spec.sh");
const fixture = join(root, "test/fixtures/kramdown/profile.md");
const fixtureXml = join(root, "test/fixtures/kramdown/profile.xml");

function run(args: string[], env: Record<string, string | undefined> = {}) {
  const proc = Bun.spawnSync(["bash", script, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
  });
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function version(tool: string): string | null {
  if (!Bun.which(tool)) return null;
  const out = Bun.spawnSync([tool, "--version"]).stdout.toString();
  return out.trim().split(/\s+/)[1] ?? null;
}

const pinned =
  version("kramdown-rfc") === "1.7.43" && version("xml2rfc") === "3.35.0";
if (!pinned) {
  console.log(
    "build-spec.test.ts: kramdown-rfc 1.7.43 and xml2rfc 3.35.0 are not both on PATH; skipping the build and --check tests",
  );
}

// A scratch copy of the fixture, so a build writes its .xml beside the copy.
function withCopy(edit: (md: string) => string, body: (md: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "build-spec-"));
  try {
    const md = join(dir, "spec.md");
    writeFileSync(md, edit(readFileSync(fixture, "utf8")));
    body(md);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("build-spec.sh arguments", () => {
  test("no spec is a usage error", () => {
    const r = run([]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("usage: scripts/build-spec.sh");
  });

  test("a non-.md input is refused", () => {
    const r = run(["spec.txt"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("is not a .md file");
  });

  test("missing tools are refused with the pinned install commands", () => {
    // /usr/bin:/bin has bash and coreutils but not kramdown-rfc.
    if (Bun.which("kramdown-rfc", { PATH: "/usr/bin:/bin" })) return;
    const r = run([fixture], { PATH: "/usr/bin:/bin" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("kramdown-rfc is not installed");
    expect(r.stderr).toContain(
      "gem install kramdown-rfc -v 1.7.43 --no-document",
    );
    expect(r.stderr).toContain("pip install xml2rfc==3.35.0");
  });
});

describe.skipIf(!pinned)("build-spec.sh with the pinned tools", () => {
  test("the committed profile.xml is up to date with profile.md", () => {
    const r = run(["--check", fixture]);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });

  test("a rebuild reproduces profile.xml byte for byte", () => {
    withCopy(
      (md) => md,
      (md) => {
        expect(run([md]).code).toBe(0);
        expect(readFileSync(md.replace(/\.md$/, ".xml"), "utf8")).toBe(
          readFileSync(fixtureXml, "utf8"),
        );
      },
    );
  });

  test("--check prints a unified diff and exits 1 on drift", () => {
    withCopy(
      (md) => md.replace("two characters per input byte", "2 chars per byte"),
      (md) => {
        copyFileSync(fixtureXml, md.replace(/\.md$/, ".xml"));
        const r = run(["--check", md]);
        expect(r.code).toBe(1);
        expect(r.stdout).toContain(
          '-        <t anchor="R-ENC-LEN">hexEncode <bcp14>MUST</bcp14> return exactly two characters per input byte.</t>',
        );
        expect(r.stdout).toContain(
          '+        <t anchor="R-ENC-LEN">hexEncode <bcp14>MUST</bcp14> return exactly 2 chars per byte.</t>',
        );
        expect(r.stderr).toContain("is out of date with");
      },
    );
  });

  test("--check ignores comments and processing instructions only", () => {
    withCopy(
      (md) => md,
      (md) => {
        const xml = md.replace(/\.md$/, ".xml");
        const committed = readFileSync(fixtureXml, "utf8")
          .replace(/<!--.*?-->/gs, "<!-- changed -->")
          .replace(/<\?line -?\d+\?>/g, "<?line 1?>\n<!-- extra -->");
        writeFileSync(xml, committed);
        expect(run(["--check", md]).code).toBe(0);
        writeFileSync(xml, committed.replace("<t anchor=", "<t  anchor="));
        expect(run(["--check", md]).code).toBe(1);
      },
    );
  });

  test("an unknown front-matter key fails the build instead of vanishing", () => {
    withCopy(
      (md) =>
        md.replace("date: 2026-11-11", "date: 2026-11-11\nvector-contract: x"),
      (md) => {
        const r = run([md]);
        expect(r.code).toBe(1);
        expect(r.stderr).toContain(
          '*** attributes left {"vector-contract"=>"x"}!',
        );
      },
    );
  });

  test("a reference missing from .refcache fails offline with a --fetch hint", () => {
    withCopy(
      (md) => md.replace("  RFC4648:", "  RFC4648:\n  RFC9999:"),
      (md) => {
        const r = run([md]);
        expect(r.code).toBe(1);
        expect(r.stderr).toContain("run once with --fetch");
      },
    );
  });

  test("a spec without a pinned date is refused", () => {
    withCopy(
      (md) => md.replace("date: 2026-11-11\n", ""),
      (md) => {
        const r = run([md]);
        expect(r.code).toBe(1);
        expect(r.stderr).toContain("front matter has no date: line");
      },
    );
  });
});
