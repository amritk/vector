import { afterAll, describe, expect, spyOn, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rfcMain } from "../src/rfc/cli.ts";
import { type FnSig, validateContractShape } from "../src/rfc/contract.ts";
import { VECTOR_ROOT } from "../src/rfc/frozen.ts";
import {
  MAX_REPEAT,
  type RawLiteral,
  isLiteralError,
  parseCall,
  parseLiteral,
  settle,
  settleVector,
} from "../src/rfc/literals.ts";

// Labelled integers (`L = 42`) and repeated runs (`22 × 0b`) in a vector's
// Call and Expected cells. The fixture test/fixtures/literals/literals-hkdf.xml
// cites RFC 5869 A.1, which prints both: "IKM = 0x0b0b…0b (22 octets)" and
// "L = 42".

const LABELLED =
  "a labelled value is `Label = hex` (lowercase hex pairs with no spaces), `Label = 42` or `Label = 22 × 0b`";
const COUNT = `a repeat count is a whole number from 1 to ${MAX_REPEAT}`;
const RUN = "a repeated run is whole bytes: lowercase hex pairs with no spaces";

const raw = (text: string): RawLiteral => {
  const r = parseLiteral(text);
  if (isLiteralError(r)) throw new Error(`${text}: ${r.message}`);
  return r;
};

describe("a labelled integer", () => {
  test("is read with its digits, and their hex when they are hex pairs", () => {
    expect(raw("L = 42")).toEqual({
      kind: "labelled-int",
      label: "L",
      value: 42,
      hex: "42",
    });
    expect(raw("L = 7")).toEqual({
      kind: "labelled-int",
      label: "L",
      value: 7,
    });
    expect(raw("Out Len = -1")).toEqual({
      kind: "labelled-int",
      label: "Out Len",
      value: -1,
    });
    // A leading zero is never an int, so these stay labelled bytes.
    expect(raw("L = 00")).toEqual({ kind: "labelled", label: "L", hex: "00" });
    expect(raw("L = 0b0b")).toEqual({
      kind: "labelled",
      label: "L",
      hex: "0b0b",
    });
  });

  test("the parameter's type decides: an int where an int goes, hex elsewhere", () => {
    const l42 = raw("L = 42");
    expect(settle(l42, "i32")).toEqual({ int: 42, label: "L" });
    expect(settle(l42, "u32")).toEqual({ int: 42, label: "L" });
    expect(settle(l42, "bytes")).toEqual({ hex: "42", label: "L" });
    expect(settle(l42, undefined)).toEqual({ hex: "42", label: "L" });
    // Digits that are not hex pairs stay an int, for the signature to judge.
    expect(settle(raw("L = 7"), "bytes")).toEqual({ int: 7, label: "L" });
  });

  test("in a call, by each parameter's type", () => {
    const fn: FnSig = {
      name: "f",
      params: [
        { name: "key", type: "bytes" },
        { name: "n", type: "u32" },
      ],
      returns: "bytes",
    };
    const pc = parseCall("f(K = 42, L = 42)");
    if (isLiteralError(pc)) throw new Error(pc.message);
    expect(settleVector(fn, pc.args, raw("OKM = 10"))).toEqual({
      args: [
        { hex: "42", label: "K" },
        { int: 42, label: "L" },
      ],
      expect: { hex: "10", label: "OKM" },
    });
    expect(settleVector(fn, [raw("K = 7"), raw("L = -1")], raw("[]"))).toEqual([
      {
        cell: "Call",
        message: "argument 1 of f (key) is bytes, not an int 7",
      },
      {
        cell: "Call",
        message: "argument 2 of f (n) is u32, not an int -1",
      },
    ]);
  });

  test("refusals, with the 1-based column", () => {
    for (const [text, col] of [
      ["L = -0", 1],
      ["L = 4x", 1],
      ["L = ", 1],
      ["L = 42]", 1],
      ["L = 42.0", 1],
    ] as const)
      expect(parseLiteral(text)).toEqual({ message: LABELLED, col });
    expect(parseCall("f(1, L = 0A)")).toEqual({ message: LABELLED, col: 6 });
    expect(settle({ kind: "concat", parts: [raw("L = 7")] }, "bytes")).toBe(
      "a concat part is bytes, not an int",
    );
  });
});

describe("a repeated run", () => {
  test("standalone, with × or x, labelled, and in a concat", () => {
    const ikm = { kind: "repeat", count: 22, hex: "0b" } as const;
    expect(raw("22 × 0b")).toEqual(ikm);
    expect(raw("22 x 0b")).toEqual(ikm);
    expect(raw("IKM = 22 × 0b")).toEqual({ ...ikm, label: "IKM" });
    expect(raw(`${MAX_REPEAT} × 00ff`)).toEqual({
      kind: "repeat",
      count: MAX_REPEAT,
      hex: "00ff",
    });
    expect(settle(raw("22 × 0b"), "bytes")).toEqual({ hex: "0b", repeat: 22 });
    expect(settle(raw("IKM = 22 x 0b"), "bytes")).toEqual({
      hex: "0b",
      repeat: 22,
      label: "IKM",
    });
    expect(settle(raw("concat(2 × 0b, K = 3 × ff, [00])"), "bytes")).toEqual({
      concat: [
        { hex: "0b", repeat: 2 },
        { hex: "ff", repeat: 3, label: "K" },
        { hex: "00" },
      ],
    });
    expect(parseCall("f(2 × 0b,1 x 00)")).toEqual({
      call: "f",
      args: [
        { kind: "repeat", count: 2, hex: "0b" },
        { kind: "repeat", count: 1, hex: "00" },
      ],
    });
  });

  test("refuses a count below 1 or too large, and a run of part bytes", () => {
    const cases: [string, string, number][] = [
      ["0 × 0b", COUNT, 1],
      ["-1 × 0b", COUNT, 1],
      ["01 × 0b", COUNT, 1],
      [`${MAX_REPEAT + 1} × 0b`, COUNT, 1],
      ["IKM = 0 × 0b", COUNT, 7],
      ["22 × 0", RUN, 6],
      ["22 × 0B", RUN, 6],
      ["22 x ", RUN, 6],
      ["IKM = 22 × 0b0", RUN, 12],
    ];
    for (const [text, message, col] of cases)
      expect([text, parseLiteral(text)]).toEqual([text, { message, col }]);
    expect(parseCall("f(22 × [0b])")).toEqual({ message: RUN, col: 8 });
    // The run ends at a space: what follows is not part of it.
    expect(parseLiteral("2 × 0b 0b")).toEqual({
      message: "unexpected text after the value",
      col: 8,
    });
  });
});

describe("spec extract", () => {
  const FIXTURE = readFileSync(
    join(VECTOR_ROOT, "test/fixtures/literals/literals-hkdf.xml"),
    "utf8",
  );
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  /** Extracts `xml` in a tree with RFC 5869: the exit code, contract and errors. */
  async function extract(xml: string) {
    const d = mkdtempSync(join(tmpdir(), "vector-literals-"));
    dirs.push(d);
    for (const sub of ["specs", "contracts", "rfcs"]) mkdirSync(join(d, sub));
    writeFileSync(join(d, "specs/literals-hkdf.xml"), xml);
    cpSync(join(VECTOR_ROOT, "rfcs/rfc5869.txt"), join(d, "rfcs/rfc5869.txt"));
    const out = join(d, "contracts/literals-hkdf.json");
    const err: string[] = [];
    const error = spyOn(console, "error").mockImplementation((...a) => {
      err.push(a.join(" "));
    });
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = await rfcMain([
        "extract",
        join(d, "specs/literals-hkdf.xml"),
        "-o",
        out,
      ]);
      return {
        code,
        err: err.join("\n"),
        contract: code === 0 ? JSON.parse(readFileSync(out, "utf8")) : null,
      };
    } finally {
      error.mockRestore();
      log.mockRestore();
    }
  }

  test("a repeated IKM and a labelled L pass the fidelity gate against RFC 5869 A.1", async () => {
    const r = await extract(FIXTURE);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(validateContractShape(r.contract)).toEqual([]);
    const [v1, v2] = r.contract.clauses;
    expect(v1.args[1]).toEqual({ hex: "0b", repeat: 22, label: "IKM" });
    expect(v2.args[2]).toEqual({ int: 42, label: "L" });
  });

  test("a run or an int the section does not print is refused", async () => {
    for (const [from, to, says] of [
      ["IKM = 22 × 0b", "IKM = 21 × 0b", '"IKM"'],
      ["L = 42", "L = 41", 'does not print "L" followed by 41'],
    ]) {
      const r = await extract(FIXTURE.replace(from, to));
      expect(r.code).not.toBe(0);
      expect(r.err).toContain("fidelity");
      expect(r.err).toContain(says);
    }
  });
});
