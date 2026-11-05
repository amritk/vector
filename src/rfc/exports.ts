// `vector spec exports`: every export a diff adds to or changes in the target
// module must be a function the contract tests or one it lists in
// `outOfScope` with a reason, so a PR can't add untested surface. Deleting a
// tested function fails; deleting an untested export is reported only.
//
// Added and changed exports come from the diff (a change anywhere in an
// export's body changes it). Deletions come from comparing the module's
// export names at the base with those in the working tree, which also sees an
// export commented out or indented away. Fails closed: a git error, an export
// it cannot name, or a name the two readings disagree on is a failure.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type RfcContract,
  targetFunctions,
  validateContractShape,
} from "./contract.ts";
import {
  type ExportChange,
  type FileDiff,
  exportedNames,
  forkPoint,
  git,
  gitDiff,
} from "./gitdiff.ts";

/** `nish/crypto/hkdf` → `std/crypto/hkdf.ts`; any other module is an error. */
export function targetModulePath(c: RfcContract): string {
  const m = c.target.module.match(/^nish\/([\w./-]+)$/);
  if (!m || m[1].split("/").some((p) => p === "" || p === "." || p === ".."))
    throw new Error(
      `target.module ${c.target.module} is not a nish/… module: cannot find its file`,
    );
  return `std/${m[1]}.ts`;
}

export interface ExportsReport {
  /** The module's path from the nish checkout's top. */
  file: string;
  base: string;
  changes: ExportChange[];
  problems: string[];
  notes: string[];
}

/** The target module in a nish checkout and its diff against `base`. */
export interface ModuleDiff {
  /** The checkout's git top. */
  top: string;
  /** The module's path from nishRoot (`std/crypto/hkdf.ts`). */
  modulePath: string;
  /** Its path from the top, as git names it. */
  file: string;
  /** The commit the diff is against: the fork point from the base. */
  at: string;
  /** Its diff; undefined when the diff does not touch it. */
  diff?: FileDiff;
}

/** Runs the diff inside the nish checkout, for the target module only. */
export function moduleDiff(
  c: RfcContract,
  nishRoot: string,
  base: string,
): ModuleDiff {
  const modulePath = targetModulePath(c);
  const at = forkPoint(nishRoot, base);
  const top = git(
    nishRoot,
    ["rev-parse", "--show-toplevel"],
    "git rev-parse",
  ).replace(/\n$/, "");
  const prefix = git(
    nishRoot,
    ["rev-parse", "--show-prefix"],
    "git rev-parse",
  ).replace(/\n$/, "");
  const file = `${prefix}${modulePath}`;
  const diffs = gitDiff(nishRoot, at, [modulePath]);
  if (diffs.some((d) => d.file !== file))
    throw new Error(
      `git diff for ${file} returned other files: ${diffs.map((d) => d.file).join(", ")}`,
    );
  return { top, modulePath, file, at, diff: diffs[0] };
}

export function exportsCheck(o: {
  contract: unknown;
  nishRoot: string;
  base: string;
}): ExportsReport {
  const shape = validateContractShape(o.contract);
  if (shape.length > 0) throw new Error(`not a contract: ${shape.join("; ")}`);
  const c = o.contract as RfcContract;
  const { top, file, at, diff: fd } = moduleDiff(c, o.nishRoot, o.base);

  // The module at the fork point, empty when it did not exist there.
  const listed = git(
    top,
    ["ls-tree", "--name-only", "--end-of-options", at, "--", file],
    `git ls-tree ${o.base}`,
  );
  const before = listed.trim()
    ? git(top, ["show", `${at}:${file}`], `git show ${o.base}:${file}`)
    : "";
  const headPath = join(top, file);
  const after = existsSync(headPath) ? readFileSync(headPath, "utf8") : "";
  const was = exportedNames(before, `${o.base}:${file}`);
  const now = exportedNames(after, file);

  const changes = (fd?.exports ?? []).filter((e) => e.kind !== "deleted");
  for (const name of [...was].filter((n) => !now.has(n)).sort())
    changes.push({ name, kind: "deleted" });
  const problems: string[] = [];
  const notes: string[] = [];
  // Both readings must agree on what is new: a name exported now and not at
  // the base that the diff did not report is a file this reader misreads.
  const seen = new Set(changes.map((e) => e.name));
  for (const name of now)
    if (!was.has(name) && !seen.has(name))
      problems.push(
        `export ${name} is new since ${o.base} but the diff does not show it added`,
      );

  const tested = targetFunctions(c);
  const outOfScope = new Map(
    (c.outOfScope ?? []).map((x) => [x.name, x.reason]),
  );
  for (const e of changes) {
    if (e.kind === "deleted") {
      if (tested.has(e.name))
        problems.push(
          `export ${e.name} is deleted, but the contract tests it: its test can no longer build`,
        );
      else
        notes.push(
          `export ${e.name} is deleted; the contract does not test it${outOfScope.has(e.name) ? ", so its outOfScope entry can go" : ""}`,
        );
    } else if (tested.has(e.name)) continue;
    else if (outOfScope.has(e.name))
      notes.push(
        `export ${e.name} is ${e.kind}, out of scope: ${outOfScope.get(e.name)}`,
      );
    else
      problems.push(
        `export ${e.name} is ${e.kind}, but the contract neither tests it nor lists it in outOfScope with a reason`,
      );
  }
  return { file, base: o.base, changes, problems, notes };
}

export function renderExports(r: ExportsReport): string {
  const out = [
    `spec exports of ${r.file} against ${r.base}: ${r.problems.length === 0 ? "OK" : "FAILED"}`,
    "",
    r.changes.length === 0
      ? "no exports added, changed or deleted"
      : `${r.changes.length} export(s):`,
    ...r.changes.map((e) => `  ${e.kind.padEnd(8)} ${e.name}`),
  ];
  if (r.notes.length > 0)
    out.push("", "notes:", ...r.notes.map((n) => `  - ${n}`));
  if (r.problems.length > 0)
    out.push("", "problems:", ...r.problems.map((p) => `  ✗ ${p}`));
  return out.join("\n");
}
