import { describe, expect, test } from "bun:test";
import hkdfContract from "../contracts/rfc5869-hkdf-sha256.json";
import type { Expr, PropertyClause, RfcContract } from "../src/rfc/contract.ts";
import { emitNishTest } from "../src/rfc/emit-nish.ts";
import { runGates } from "../src/rfc/gates.ts";
import { parseTestOutput, runNishTest } from "../src/rfc/run.ts";
import { evalPure, sampleContract } from "../src/rfc/sample.ts";

// Byte xor/and/or (#30): HMAC is `H((K ^ opad) || H((K ^ ipad) || m))`, and a
// contract could not say so. The shorter operand reads as zeros past its end,
// so `xor(key, fill(0x36, 64))` is RFC 2104's padded key XOR ipad.

const hkdf = hkdfContract as unknown as RfcContract;
const v = (name: string): Expr => ({ var: name });
const op = (o: string, ...args: Expr[]) => ({ op: o, args }) as Expr;
const int = (n: number): Expr => ({ int: n });
const hex = (h: string): Expr => ({ hex: h });
const bytes = (...b: number[]) => Uint8Array.from(b);

/** HKDF with its clauses replaced by one property over bytes `a` and `b`. */
function bitsContract(assert: Expr, where?: Expr): RfcContract {
  const c = structuredClone(hkdf);
  const p: PropertyClause = {
    kind: "property",
    id: "P-BITS",
    title: "byte xor, and, or",
    covers: ["R-EXTRACT"],
    forall: [
      { name: "a", type: "bytes", minLen: 0, maxLen: 6 },
      { name: "b", type: "bytes", minLen: 0, maxLen: 9 },
    ],
    assert,
    samples: 16,
  };
  if (where) p.where = where;
  c.clauses = [p];
  return c;
}

const typingIssues = (c: RfcContract) =>
  runGates(c)
    .issues.filter((i) => i.gate === "typing")
    .map((i) => i.message);

const eq = (x: Expr, y: Expr) => op("==", x, y);
const len = (x: Expr) => op("len", x);

/** Laws every sample must hold, plus fixed values the RFC 2104 pads rely on. */
const laws = op(
  "and",
  eq(op("xor", v("a"), v("a")), op("zeros", len(v("a")))),
  eq(op("bitAnd", v("a"), op("fill", int(255), len(v("a")))), v("a")),
  eq(op("bitOr", v("a"), op("zeros", len(v("a")))), v("a")),
  op(
    "or",
    eq(len(op("xor", v("a"), v("b"))), len(v("a"))),
    eq(len(op("xor", v("a"), v("b"))), len(v("b"))),
  ),
  op(">=", len(op("bitOr", v("a"), v("b"))), len(v("a"))),
  op(">=", len(op("bitAnd", v("a"), v("b"))), len(v("b"))),
  op(
    "implies",
    op(">=", len(v("a")), len(v("b"))),
    eq(op("xor", op("xor", v("a"), v("b")), v("b")), v("a")),
  ),
  eq(op("xor", hex("0f0f"), hex("ff")), hex("f00f")),
  eq(op("bitAnd", hex("0f0f"), hex("ff")), hex("0f00")),
  eq(op("bitOr", hex("f0"), hex("0f0f")), hex("ff0f")),
  eq(op("xor", hex(""), hex("3636")), hex("3636")),
);

describe("byte xor, and, or", () => {
  test("take two bytes and give bytes; anything else is refused", () => {
    expect(typingIssues(bitsContract(laws))).toEqual([]);
    const bad = typingIssues(
      bitsContract(eq(op("xor", v("a"), int(54)), v("a"))),
    ).join("\n");
    expect(bad).not.toBe("");
    expect(
      typingIssues(bitsContract(eq(op("bitAnd", v("a")), v("a")))).join("\n"),
    ).not.toBe("");
  });

  test("the evaluator combines byte by byte, the shorter read as zeros", () => {
    const env = { a: bytes(0x0f, 0xf0, 0xaa), b: bytes(0xff) };
    const ev = (o: string, x = v("a"), y = v("b")) =>
      evalPure(op(o, x, y), env);
    expect(ev("xor")).toEqual(bytes(0xf0, 0xf0, 0xaa));
    expect(ev("bitAnd")).toEqual(bytes(0x0f, 0x00, 0x00));
    expect(ev("bitOr")).toEqual(bytes(0xff, 0xf0, 0xaa));
    // Either side may be the shorter.
    expect(ev("xor", v("b"), v("a"))).toEqual(bytes(0xf0, 0xf0, 0xaa));
    expect(ev("bitAnd", v("b"), v("a"))).toEqual(bytes(0x0f, 0x00, 0x00));
    // RFC 2104's K XOR ipad, K shorter than the block.
    expect(
      evalPure(op("xor", hex("01"), op("fill", int(0x36), int(3))), {}),
    ).toEqual(bytes(0x37, 0x36, 0x36));
    expect(evalPure(op("xor", hex(""), hex("")), {})).toEqual(bytes());
  });

  test("every sample holds the laws in the evaluator", async () => {
    const c = bitsContract(laws);
    const s = await sampleContract(c);
    expect(s.ok).toBe(true);
    const samples = s.properties.get("P-BITS")?.samples ?? [];
    expect(samples.length).toBeGreaterThan(0);
    for (const env of samples) expect(evalPure(laws, env)).toBe(true);
  });

  test("the solver knows the length is the longer one's", async () => {
    // Only b reaches 8 bytes, so every sample must take it from b.
    const c = bitsContract(
      op(">=", len(v("b")), int(8)),
      op(">=", len(op("xor", v("a"), v("b"))), int(8)),
    );
    const s = await sampleContract(c);
    expect(s.ok).toBe(true);
    const samples = s.properties.get("P-BITS")?.samples ?? [];
    expect(samples.length).toBeGreaterThan(0);
    for (const env of samples) {
      expect((env.b as Uint8Array).length).toBeGreaterThanOrEqual(8);
    }
  });

  test("emit one helper, selecting the op by 0, 1, 2", async () => {
    const c = bitsContract(
      op(
        "and",
        eq(op("xor", v("a"), v("b")), v("a")),
        eq(op("bitAnd", v("a"), v("b")), v("a")),
        eq(op("bitOr", v("a"), v("b")), v("a")),
      ),
    );
    const s = await sampleContract(c);
    const src = emitNishTest(c, s.properties);
    expect(src.match(/const bitwiseBytes = /g)?.length).toBe(1);
    expect(src).toContain("bitwiseBytes(v_a, v_b, 0)");
    expect(src).toContain("bitwiseBytes(v_a, v_b, 1)");
    expect(src).toContain("bitwiseBytes(v_a, v_b, 2)");
    const none = bitsContract(eq(v("a"), v("a")));
    expect(
      emitNishTest(none, (await sampleContract(none)).properties),
    ).not.toContain("bitwiseBytes");
  });
});

// Against a real nish (VECTOR_NISH=<path to a nish binary>): the emitted
// helper compiles and holds the same laws as the evaluator.
const nish = process.env.VECTOR_NISH;
describe.skipIf(!nish)("byte xor, and, or against nish", () => {
  test("the emitted helper holds the evaluator's laws", async () => {
    const c = bitsContract(laws);
    const s = await sampleContract(c);
    expect(s.ok).toBe(true);
    const run = await runNishTest(
      c,
      emitNishTest(c, s.properties),
      nish as string,
    );
    expect(run.stderr).toBe("");
    expect(parseTestOutput(c, run.stdout).get("P-BITS")?.outcome).toBe("pass");
  }, 600_000);
});
