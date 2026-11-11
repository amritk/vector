import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "../src/rfc/emit-nish.ts";
import { readChecked } from "../src/rfc/frozen.ts";

// A contract's source is judged by where it leads, and then read. Whatever is
// judged must be what is read, even if a symlink is swapped in between (#29).

/** What is read comes with the sha256 of its bytes. */
const SPEC_SHA = sha256(Buffer.from("spec text"));

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** specs/hex.md (spec text), secret (not), and link -> specs/hex.md. */
function layout() {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "read-checked-")));
  dirs.push(top);
  mkdirSync(join(top, "specs"));
  writeFileSync(join(top, "specs/hex.md"), "spec text");
  writeFileSync(join(top, "secret"), "deadbeef");
  const link = join(top, "link");
  symlinkSync(join(top, "specs/hex.md"), link);
  /** Point the link somewhere else, atomically. */
  const swap = (to: string) => {
    symlinkSync(join(top, to), `${link}.new`);
    renameSync(`${link}.new`, link);
  };
  const allowed = (f: string) =>
    f.startsWith(`${top}/specs/`) ? undefined : `${f} is not spec text`;
  return { top, link, swap, allowed };
}

describe("reading a source checks the file it opened", () => {
  test("an ordinary source is read", () => {
    const { link, allowed } = layout();
    expect(readChecked(link, allowed)).toEqual({ text: "spec text", sha256: SPEC_SHA });
  });

  test("a link swapped after the check, before the open, is refused", () => {
    const { top, link, swap, allowed } = layout();
    let calls = 0;
    const r = readChecked(link, (f) => {
      if (calls++ === 0) swap("secret");
      return allowed(f);
    });
    expect(r).toEqual({ problem: `${top}/secret is not spec text` });
    expect(JSON.stringify(r)).not.toContain("deadbeef");
  });

  test("a link swapped after the open does not change what is read", () => {
    const { link, swap, allowed } = layout();
    let calls = 0;
    const r = readChecked(link, (f) => {
      if (calls++ === 1) swap("secret");
      return allowed(f);
    });
    expect(r).toEqual({ text: "spec text", sha256: SPEC_SHA });
  });

  test("a FIFO is refused at once, not waited on", () => {
    const { top, allowed } = layout();
    const fifo = join(top, "specs/fifo.md");
    expect(spawnSync("mkfifo", [fifo]).status).toBe(0);
    expect(readChecked(fifo, allowed)).toEqual({
      problem: `${fifo} is not a regular file`,
    });
  });
});
