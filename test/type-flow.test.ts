import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import hkdfContract from "../contracts/rfc5869-hkdf-sha256.json";
import {
  type Expr,
  type FnSig,
  INT_RANGE,
  INT_TYPES,
  type IntType,
  type Literal,
  type PropertyClause,
  type RfcContract,
  type SigTy,
  type VectorClause,
  f64Bits,
  f64FromBits,
  f64Value,
  intJson,
  parseF64,
  typeOfLiteral,
  validateContractShape,
} from "../src/rfc/contract.ts";
import {
  NishRefusal,
  emitNishTest,
  f64Lit,
  intLit,
} from "../src/rfc/emit-nish.ts";
import { type FrontEnd, frontEndFor } from "../src/rfc/front/index.ts";
import { runGates } from "../src/rfc/gates.ts";
import {
  type RawLiteral,
  isLiteralError,
  parseLiteral,
  settle,
  settleVector,
} from "../src/rfc/literals.ts";
import { parseRfc } from "../src/rfc/rfctext.ts";
import { evalPure, sampleContract, wrapInt } from "../src/rfc/sample.ts";

// The integer widths i8 … u64 and f64 carried from a literal through the
// gates, the sampler, the evaluator and the Nish emitter. Ranges are ISO C11
// §7.20.2.1's; a 64-bit value past ±(2^53−1) is a decimal string (RFC 7493
// §2.2); an f64 is an IEEE 754-2019 binary64 (§3.4), read with
// roundTiesToEven (§5.12.2).

const hkdf = hkdfContract as unknown as RfcContract;
const R = hkdf.requirements[0].id;
const v = (name: string): Expr => ({ var: name });
const op = (o: string, ...args: Expr[]) => ({ op: o, args }) as Expr;
const call = (fn: string, ...args: Expr[]): Expr => ({ call: fn, args });
const at = { section: "2.2" };

const raw = (text: string): RawLiteral => {
  const r = parseLiteral(text);
  if (isLiteralError(r)) throw new Error(`${text}: ${r.message}`);
  return r;
};

const fn = (ty: SigTy): FnSig => ({
  name: "id",
  params: [{ name: "x", type: ty }],
  returns: ty,
});

describe("int literals per width", () => {
  for (const ty of INT_TYPES) {
    const { min, max } = INT_RANGE[ty];
    test(`${ty} takes ${min} and ${max}`, () => {
      for (const n of [min, max]) {
        const r = settleVector(fn(ty), [raw(String(n))], raw(String(n)));
        expect(r).toEqual({
          args: [{ int: intJson(n) }],
          expect: { int: intJson(n) },
        });
      }
    });
    test(`${ty} refuses ${min - 1n} and ${max + 1n}`, () => {
      for (const n of [min - 1n, max + 1n]) {
        const r = settleVector(fn(ty), [raw(String(n))], raw("0"));
        expect(Array.isArray(r)).toBe(true);
        expect((r as { message: string }[])[0].message).toBe(
          `argument 1 of id (x) is ${ty}, not an int ${intJson(n)}`,
        );
        const e = settleVector(fn(ty), [raw("0")], raw(String(n)));
        expect((e as { message: string }[])[0].message).toBe(
          `id returns ${ty}, not an int ${intJson(n)}`,
        );
      }
    });
  }

  test("a 64-bit value past 2^53 is read exactly, as a decimal string", () => {
    expect(raw("18446744073709551615")).toEqual({
      kind: "int",
      value: "18446744073709551615",
    });
    expect(raw("-9223372036854775808")).toEqual({
      kind: "int",
      value: "-9223372036854775808",
    });
    expect(raw("9007199254740993")).toEqual({
      kind: "int",
      value: "9007199254740993",
    });
    expect(raw("9007199254740991")).toEqual({
      kind: "int",
      value: 9007199254740991,
    });
  });

  test("an int literal is typed as the first of i32, i64, u64 it fits", () => {
    expect(typeOfLiteral({ int: 2147483647 })).toBe("i32");
    expect(typeOfLiteral({ int: 2147483648 })).toBe("i64");
    expect(typeOfLiteral({ int: "9223372036854775808" })).toBe("u64");
  });

  test("a decimal string within ±(2^53−1) is refused (RFC 7493 §2.2)", () => {
    const c = structuredClone(hkdf);
    const k = c.clauses.find((x) => x.kind === "vector") as VectorClause;
    k.args = [{ int: "9007199254740991" } as Literal, ...k.args.slice(1)];
    expect(validateContractShape(c).join("\n")).toContain(
      `"9007199254740991" fits in ±(2^53−1), so it is written as a JSON integer, not a string (RFC 7493 §2.2)`,
    );
  });
});

describe("f64 literals", () => {
  test("decimal text past binary64's largest finite value is refused (IEEE 754-2019 §7.4)", () => {
    const c = structuredClone(hkdf);
    const k = c.clauses.find((x) => x.kind === "vector") as VectorClause;
    k.args = [{ f64: "-1e400" } as Literal, ...k.args.slice(1)];
    expect(validateContractShape(c).join("\n")).toContain(
      `.f64: "-1e400" is past binary64's largest finite value and rounds to an infinity (IEEE 754-2019 §7.4)`,
    );
    k.args = [{ f64: "1.7976931348623157e308" } as Literal, ...k.args.slice(1)];
    expect(validateContractShape(c).join("\n")).not.toContain("largest finite");
  });

  test("decimal text, NaN and the infinities are read as f64", () => {
    for (const t of ["1.5", "-2e-3", "NaN", "Infinity", "-Infinity", "1E10"])
      expect(raw(t)).toEqual({ kind: "f64", text: t });
  });

  test("an int where an f64 goes is that f64's text", () => {
    expect(settle(raw("3"), "f64")).toEqual({ f64: "3" });
    expect(settle(raw("3"), "f64?")).toEqual({ f64: "3" });
    expect(settle(raw("3"), "i64")).toEqual({ int: 3 });
    expect(settleVector(fn("f64"), [raw("2")], raw("0.5"))).toEqual({
      args: [{ f64: "2" }],
      expect: { f64: "0.5" },
    });
  });

  test("decimal text rounds ties to even (IEEE 754-2019 §5.12.2)", () => {
    // 2^53 + 1 is halfway between 2^53 and 2^53 + 2; the tie goes to 2^53.
    expect(parseF64("9007199254740993")).toBe(9007199254740992);
    expect(parseF64("0.1")).toBe(0.1);
    expect(f64Bits(parseF64("0.1"))).toBe("3fb999999999999a");
  });

  test("bits tell -0 from 0 and state a NaN's payload (§3.4)", () => {
    expect(f64Bits(-0)).toBe("8000000000000000");
    expect(f64Bits(0)).toBe("0000000000000000");
    expect(Object.is(f64FromBits("8000000000000000"), -0)).toBe(true);
    expect(Number.isNaN(f64FromBits("7ff8000000000001"))).toBe(true);
    expect(f64Value({ f64: "NaN", bits: "7ff8000000000001" })).toBeNaN();
    expect(f64Value({ f64: "1.5" })).toBe(1.5);
  });
});

describe("evaluation wraps per width", () => {
  const arith = (
    o: "+" | "-" | "*",
    ty: IntType,
    x: number | bigint,
    y: number | bigint,
  ) =>
    evalPure(
      op(o, v("x"), v("y")),
      { x, y },
      new Map([
        ["x", ty],
        ["y", ty],
      ]),
    );
  const add = (ty: IntType, x: number | bigint, y: number | bigint) =>
    arith("+", ty, x, y);

  test("wrapInt reduces modulo 2^N, two's complement for iN", () => {
    for (const ty of INT_TYPES) {
      const { min, max } = INT_RANGE[ty];
      expect(wrapInt(max + 1n, ty)).toBe(min);
      expect(wrapInt(min - 1n, ty)).toBe(max);
      expect(wrapInt(max, ty)).toBe(max);
    }
  });

  test("+ - * wrap at each width, 64-bit values as bigint", () => {
    expect(add("i8", 127, 1)).toBe(-128);
    expect(add("u8", 255, 1)).toBe(0);
    expect(add("i16", -32768, -1)).toBe(32767);
    expect(add("u16", 65535, 2)).toBe(1);
    expect(add("u32", 4294967295, 1)).toBe(0);
    expect(add("i32", 2147483647, 1)).toBe(-2147483648);
    expect(add("i64", 9223372036854775807n, 1n)).toBe(-9223372036854775808n);
    expect(add("u64", 18446744073709551615n, 1n)).toBe(0n);
    expect(arith("-", "i64", -9223372036854775808n, 1n)).toBe(
      9223372036854775807n,
    );
    expect(arith("-", "u64", 0n, 1n)).toBe(18446744073709551615n);
    expect(arith("*", "i64", 4294967296n, 2147483648n)).toBe(
      -9223372036854775808n,
    );
    expect(arith("*", "i64", 9223372036854775807n, 2n)).toBe(-2n);
    expect(arith("*", "u64", 4294967296n, 4294967296n)).toBe(0n);
    expect(arith("*", "u64", 18446744073709551615n, 3n)).toBe(
      18446744073709551613n,
    );
    const types = new Map<string, IntType>([
      ["x", "u8"],
      ["y", "u8"],
    ]);
    expect(evalPure(op("-", v("x"), v("y")), { x: 0, y: 1 }, types)).toBe(255);
    expect(evalPure(op("*", v("x"), v("y")), { x: 16, y: 16 }, types)).toBe(0);
    const i64 = new Map<string, IntType>([
      ["x", "i64"],
      ["y", "i64"],
    ]);
    expect(
      evalPure(
        op("%", v("x"), v("y")),
        { x: -9223372036854775808n, y: -1n },
        i64,
      ),
    ).toBe(0n);
  });
});

/** A contract over the new types, on HKDF's spec and requirements. */
function numContract(): RfcContract {
  const c = structuredClone(hkdf);
  c.target = { module: "nish/num" };
  c.functions = [
    { name: "inc64", params: [{ name: "x", type: "i64" }], returns: "i64" },
    { name: "incU64", params: [{ name: "x", type: "u64" }], returns: "u64" },
    { name: "half", params: [{ name: "x", type: "f64" }], returns: "f64" },
    { name: "lo8", params: [{ name: "x", type: "u16" }], returns: "u8" },
  ];
  const vec = (
    id: string,
    fnName: string,
    arg: Literal,
    expect: Literal,
    tolerance?: VectorClause["tolerance"],
  ): VectorClause => ({
    kind: "vector",
    id,
    title: id,
    covers: [R],
    source: { cite: at },
    call: fnName,
    args: [arg],
    expect,
    ...(tolerance ? { tolerance } : {}),
  });
  const quote = hkdf.requirements[0].quote;
  c.clauses = [
    vec(
      "V-I64",
      "inc64",
      { int: "-9223372036854775808" },
      { int: "-9223372036854775807" },
    ),
    vec(
      "V-U64",
      "incU64",
      { int: "18446744073709551614" },
      { int: "18446744073709551615" },
    ),
    vec("V-F", "half", { f64: "-0" }, { f64: "-0" }),
    vec(
      "V-FA",
      "half",
      { f64: "1.5" },
      { f64: "0.75" },
      {
        abs: "1e-12",
        ...at,
        quote,
      },
    ),
    vec(
      "V-FN",
      "half",
      { f64: "Infinity" },
      { f64: "Infinity" },
      {
        abs: "1e-12",
        ...at,
        quote,
      },
    ),
    vec(
      "V-FU",
      "half",
      { f64: "NaN" },
      { f64: "NaN" },
      {
        ulps: 2,
        ...at,
        quote,
      },
    ),
    vec(
      "V-FU2",
      "half",
      { f64: "3" },
      { f64: "1.5" },
      {
        ulps: 2,
        ...at,
        quote,
      },
    ),
    vec("V-U8", "lo8", { int: 65535 }, { int: 255 }),
    {
      kind: "property",
      id: "P-I64",
      title: "inc",
      covers: [R],
      forall: [
        {
          name: "x",
          type: "i64",
          min: "-9223372036854775808",
          max: "9223372036854775807",
        },
        { name: "y", type: "u64", min: 0, max: "18446744073709551615" },
        { name: "z", type: "u8", min: 0, max: 255 },
      ],
      assert: op(
        "and",
        op("==", call("inc64", v("x")), op("+", v("x"), { int: 1 })),
        op(">=", call("incU64", v("y")), { int: 0 }),
        op("==", op("%", v("z"), { int: 7 }), op("%", v("z"), { int: 7 })),
      ),
      samples: 8,
    },
  ];
  return c;
}

describe("a contract over the new types", () => {
  test("validates and passes the typing gate", () => {
    const c = numContract();
    expect(validateContractShape(c)).toEqual([]);
    expect(runGates(c).issues.filter((i) => i.gate === "typing")).toEqual([]);
  });

  test("the fidelity gate checks tolerance quotes and labelled f64 values", () => {
    const rfc = parseRfc(readFileSync("rfcs/rfc5869.txt", "utf8"));
    const fid = (c: RfcContract) => {
      const r = runGates(c, { rfc });
      return {
        issues: r.issues.filter((i) => i.gate === "fidelity"),
        warnings: r.warnings.map((w) => `${w.at}: ${w.message}`),
      };
    };
    const base = fid(numContract());
    expect(base.issues).toEqual([]);
    // An f64 with no label is said to be unchecked, never passed silently.
    expect(base.warnings).toContain(
      'V-FA.args[0]: not checked against the RFC: the f64 1.5 has no "label" to find it by',
    );

    const c = numContract();
    const fa = c.clauses.find((k) => k.id === "V-FA") as VectorClause;
    (fa.tolerance as { quote: string }).quote = "within one part in a trillion";
    expect(fid(c).issues).toEqual([
      {
        gate: "fidelity",
        at: "V-FA.tolerance",
        message:
          'quote not found in RFC §2.2 ("Step 1: Extract"): "within one part in a trillion"',
      },
    ]);

    // Appendix A.1 prints "L    = 42": a labelled f64 is found by value.
    const labelled = (n: string) => {
      const d = numContract();
      d.clauses = [
        {
          kind: "vector",
          id: "V-L",
          title: "L",
          covers: [R],
          source: { cite: { section: "A.1" } },
          call: "half",
          args: [{ f64: "84", unchecked: "twice L" }],
          expect: { f64: n, label: "L" },
        },
      ];
      return fid(d).issues.map((i) => i.message);
    };
    expect(labelled("42")).toEqual([]);
    expect(labelled("4.2e1")).toEqual([]);
    expect(labelled("43")).toEqual([
      'RFC §A.1 does not print "L" followed by 43',
    ]);
  });

  test("a tolerance on a non-f64 result and an int out of range are typing errors", () => {
    const c = numContract();
    const v64 = c.clauses.find((k) => k.id === "V-I64") as VectorClause;
    v64.tolerance = { ulps: 1, ...at, quote: hkdf.requirements[0].quote };
    const u8 = c.clauses.find((k) => k.id === "V-U8") as VectorClause;
    u8.expect = { int: 256 };
    expect(
      runGates(c)
        .issues.filter((i) => i.gate === "typing")
        .map((i) => `${i.at}: ${i.message}`),
    ).toEqual([
      "V-I64: tolerance: inc64 returns i64, and only an f64 result is compared within a tolerance",
      "V-U8: expect: lo8 returns u8, got 256, outside u8's 0..255",
    ]);
  });

  test("samples each integer width at its min and max", async () => {
    const s = await sampleContract(numContract());
    expect(s.ok).toBe(true);
    const rows = s.properties.get("P-I64")?.samples ?? [];
    const col = (k: string) => rows.map((r) => BigInt(r[k] as number | bigint));
    expect(col("x")).toContain(-9223372036854775808n);
    expect(col("x")).toContain(9223372036854775807n);
    expect(col("y")).toContain(0n);
    expect(col("y")).toContain(18446744073709551615n);
    expect(col("z")).toContain(0n);
    expect(col("z")).toContain(255n);
    for (const r of rows) {
      expect(typeof r.x).toBe("bigint");
      expect(typeof r.z).toBe("number");
    }
  });

  test("samples i8, i16 and u16 at their min and max", async () => {
    const c = numContract();
    const p = c.clauses.at(-1) as PropertyClause;
    p.forall = (["i8", "i16", "u16"] as const).map((type, i) => ({
      name: `w${i}`,
      type,
      min: intJson(INT_RANGE[type].min),
      max: intJson(INT_RANGE[type].max),
    }));
    p.assert = op(
      "and",
      ...p.forall.map((f) => op("==", v(f.name), v(f.name))),
    );
    const s = await sampleContract(c);
    expect(s.ok).toBe(true);
    const rows = s.properties.get("P-I64")?.samples ?? [];
    for (const f of p.forall) {
      const col = rows.map((r) => r[f.name]);
      const ty = f.type as IntType;
      expect(col).toContain(Number(INT_RANGE[ty].min));
      expect(col).toContain(Number(INT_RANGE[ty].max));
    }
  });

  test("an f64 forall bound cannot be NaN", () => {
    const c = numContract();
    const p = c.clauses.at(-1) as PropertyClause;
    p.forall = [{ name: "f", type: "f64", min: "NaN", max: "1" }];
    expect(validateContractShape(c).join("\n")).toContain(
      "a bound cannot be NaN",
    );
  });

  test("an f64 forall bound cannot overflow binary64", () => {
    const c = numContract();
    const p = c.clauses.at(-1) as PropertyClause;
    p.forall = [{ name: "f", type: "f64", min: "0", max: "2e308" }];
    expect(validateContractShape(c).join("\n")).toContain(
      `.max: "2e308" is past binary64's largest finite value`,
    );
  });
});

describe("the Nish emitter", () => {
  test("intLit types a literal by its width and builds one past 2^53", () => {
    expect(intLit(-5n, "i32")).toBe("(-5)");
    expect(intLit(7n, "i32")).toBe("7");
    expect(intLit(7n, "u8")).toBe("toU8(7)");
    expect(intLit(2n ** 53n, "u64")).toBe("(toU64(0) + 9007199254740992)");
    expect(intLit(-(2n ** 53n), "i64")).toBe(
      "(toI64(0) + (-9007199254740992))",
    );
    expect(intLit(2n ** 53n + 1n, "i64")).toBe(
      "(toI64(2097152) * 4294967296 + 1)",
    );
    expect(intLit(INT_RANGE.i64.min, "i64")).toBe(
      "(toI64(-2147483648) * 4294967296 + 0)",
    );
    expect(intLit(INT_RANGE.i64.max, "i64")).toBe(
      "(toI64(2147483647) * 4294967296 + 4294967295)",
    );
    expect(intLit(INT_RANGE.u64.max, "u64")).toBe(
      "((toU64(0) + 4294967295) * 4294967296 + 4294967295)",
    );
    expect(() => intLit(1n, "i8")).toThrow(NishRefusal);
    expect(() => intLit(1n, "i16")).toThrow("Nish has no i8 or i16");
  });

  test("intLit's hi * 2^32 + lo is the value", () => {
    for (const n of [
      INT_RANGE.i64.min,
      INT_RANGE.i64.max,
      2n ** 53n + 1n,
      -(2n ** 53n) - 1n,
    ]) {
      const m = /^\((.*) \* 4294967296 \+ (\d+)\)$/.exec(intLit(n, "i64"));
      const hi = BigInt(/(-?\d+)\)$/.exec(m?.[1] ?? "")?.[1] ?? "x");
      expect(hi * 4294967296n + BigInt(m?.[2] ?? "x")).toBe(n);
    }
  });

  test("f64Lit gives the shortest decimal, and bits where none spells it", () => {
    expect(f64Lit(1.5)).toBe("toF64(1.5)");
    expect(f64Lit(1e21)).toBe("toF64(1e21)");
    expect(f64Lit(-1e-7)).toBe("toF64(-1e-7)");
    expect(f64Lit(-0)).toBe("bitsToF64((toI64(-2147483648) * 4294967296 + 0))");
    expect(f64Lit(Number.NaN)).toBe(
      "bitsToF64((toI64(2146959360) * 4294967296 + 0))",
    );
    expect(f64Lit(Number.POSITIVE_INFINITY)).toBe(
      "bitsToF64((toI64(2146435072) * 4294967296 + 0))",
    );
  });

  test("emits a vector per type and a property table per width", async () => {
    const c = numContract();
    const src = emitNishTest(c, (await sampleContract(c)).properties);
    expect(src).toContain(
      't.eqI64("[V-I64] V-I64 (R-EXTRACT)", inc64((toI64(-2147483648) * 4294967296 + 0)), (toI64(-2147483648) * 4294967296 + 1));',
    );
    expect(src).toContain(
      't.eqStr("[V-U64] V-U64 (R-EXTRACT)", `${incU64(((toU64(0) + 4294967295) * 4294967296 + 4294967294))}`, "18446744073709551615");',
    );
    expect(src).toContain(
      'eqF64Bits(t, "[V-F] V-F (R-EXTRACT)", half(bitsToF64((toI64(-2147483648) * 4294967296 + 0))), bitsToF64((toI64(-2147483648) * 4294967296 + 0)));',
    );
    expect(src).toContain(
      't.nearF64("[V-FA] V-FA (R-EXTRACT)", half(toF64(1.5)), toF64(0.75), toF64(1e-12));',
    );
    // nearF64 fails equal infinities, so a non-finite expect is checked by bits.
    expect(src).toContain(
      'eqF64Bits(t, "[V-FN] V-FN (R-EXTRACT)", half(bitsToF64((toI64(2146435072) * 4294967296 + 0))), bitsToF64((toI64(2146435072) * 4294967296 + 0)));',
    );
    // nearUlpsF64 fails every NaN, so a NaN expect with ulps is also by bits.
    expect(src).toContain(
      'eqF64Bits(t, "[V-FU] V-FU (R-EXTRACT)", half(bitsToF64((toI64(2146959360) * 4294967296 + 0))), bitsToF64((toI64(2146959360) * 4294967296 + 0)));',
    );
    expect(src).toContain(
      'nearUlpsF64(t, "[V-FU2] V-FU2 (R-EXTRACT)", half(toF64(3)), toF64(1.5), toI64(2));',
    );
    expect(src).toContain(
      't.eqStr("[V-U8] V-U8 (R-EXTRACT)", `${lo8(toU16(65535))}`, "255");',
    );
    expect(src).toContain("const table_x: i64[] = [");
    expect(src).toContain("(toI64(-2147483648) * 4294967296 + 0)");
    expect(src).toMatch(/const table_y: u64\[\] = \[/);
    expect(src).toMatch(/const table_z: u8\[\] = \[/);
    expect(src).toContain("(inc64(v_x) === wrappingAdd(v_x, toI64(1)))");
    expect(src).toContain('import { wrappingAdd } from "nish:unsafe";');
    expect(src).toContain("(incU64(v_y) >= toU64(0))");
    expect(src).toContain("remU8(v_z, toU8(7))");
    expect(src).toContain("const remU8 = (a: u8, b: u8): u8 => {");
    expect(src).not.toContain("const remI64");
    for (const h of ["eqF64Bits", "nearUlpsF64"])
      expect(src.match(new RegExp(`const ${h} =`, "g"))?.length).toBe(1);
  });

  test("the emitted f64 checks pass a NaN only by bits, and ulps by distance", () => {
    const src = emitNishTest(numContract(), new Map());
    // Run the emitted helpers as JavaScript: i64 is a bigint, as in evalPure.
    const helper = (h: string) => {
      const m = src.match(new RegExp(`const ${h} = [\\s\\S]*?\\n};`));
      if (!m) throw new Error(`no ${h}`);
      const js = new Bun.Transpiler({ loader: "ts" })
        .transformSync(
          m[0].replace(/-9007199254740992/, "$&n").replace("<< 10", "<< 10n"),
        )
        .replace(/^const \w+ = /, "return ");
      const f64ToBits = (x: number) => {
        const d = new DataView(new ArrayBuffer(8));
        d.setFloat64(0, x);
        return d.getBigInt64(0);
      };
      return new Function("f64ToBits", "toI64", js)(f64ToBits, BigInt);
    };
    const t = { pass: () => true, fail: () => false };
    const eq = helper("eqF64Bits");
    const near = helper("nearUlpsF64");
    expect(eq(t, "n", Number.NaN, Number.NaN)).toBe(true);
    expect(near(t, "n", Number.NaN, Number.NaN, 2n)).toBe(false);
    expect(eq(t, "n", 0, -0)).toBe(false);
    const up = (x: number, k: number) => {
      const d = new DataView(new ArrayBuffer(8));
      d.setFloat64(0, x);
      d.setBigInt64(0, d.getBigInt64(0) + BigInt(k));
      return d.getFloat64(0);
    };
    expect(near(t, "n", up(1.5, 2), 1.5, 2n)).toBe(true);
    expect(near(t, "n", up(1.5, 3), 1.5, 2n)).toBe(false);
    expect(near(t, "n", up(1.5, -2), 1.5, 2n)).toBe(true);
    expect(near(t, "n", 0, -0, 0n)).toBe(true);
    expect(near(t, "n", Number.MIN_VALUE, -Number.MIN_VALUE, 2n)).toBe(true);
    expect(near(t, "n", Number.MIN_VALUE, -Number.MIN_VALUE, 1n)).toBe(false);
  });

  test("i64 + - * wrap through nish:unsafe, as the contract does", async () => {
    const c = numContract();
    const p = c.clauses.at(-1) as PropertyClause;
    p.assert = op(
      "and",
      op("==", op("-", v("x"), { int: 1 }), op("*", v("x"), { int: 2 })),
      op("==", op("+", v("y"), { int: 1 }), op("*", v("y"), { int: 2 })),
    );
    const src = emitNishTest(c, (await sampleContract(c)).properties);
    expect(src).toContain(
      'import { wrappingMul, wrappingSub } from "nish:unsafe";',
    );
    expect(src).toContain(
      "(wrappingSub(v_x, toI64(1)) === wrappingMul(v_x, toI64(2)))",
    );
    // u64 already wraps in Nish.
    expect(src).toContain("((v_y + toU64(1)) === (v_y * toU64(2)))");
  });

  test("a contract without i64 arithmetic imports nothing from nish:unsafe", () => {
    const c = numContract();
    c.clauses = c.clauses.filter((k) => k.kind === "vector");
    expect(emitNishTest(c, new Map())).not.toContain("nish:unsafe");
  });

  test("a signed remainder helper guards b = 0 and b = -1", async () => {
    const c = numContract();
    const p = c.clauses.at(-1) as PropertyClause;
    p.assert = op("==", op("%", v("x"), v("x")), { int: 0 });
    const src = emitNishTest(c, (await sampleContract(c)).properties);
    expect(src).toContain("const remI64 = (a: i64, b: i64): i64 => {");
    expect(src).toContain("if (b === toI64(0) || b === toI64(-1)) {");
  });

  describe("refuses what Nish cannot express", () => {
    const refusal = (edit: (c: RfcContract) => void) => {
      const c = numContract();
      edit(c);
      try {
        emitNishTest(c, new Map());
      } catch (e) {
        expect(e).toBeInstanceOf(NishRefusal);
        return (e as Error).message;
      }
      throw new Error("not refused");
    };
    test("a module outside nish/", () =>
      expect(
        refusal((c) => {
          c.target = { module: "std/num" };
        }),
      ).toBe("Nish is the only emitter, and std/num is not a nish/ module"));
    test("an i8 or i16 in a signature", () => {
      expect(
        refusal((c) => {
          c.functions[0].params[0].type = "i8";
        }),
      ).toBe(
        "inc64(x) is i8: Nish has no i8 or i16: write the parameter as i32",
      );
      expect(
        refusal((c) => {
          c.functions[0].returns = "i16?";
        }),
      ).toBe(
        "inc64's result is i16?: Nish has no i8 or i16: write the parameter as i32",
      );
    });
    test("a nullable scalar", () => {
      for (const t of ["bool?", "f64?", "u64?"] as const)
        expect(
          refusal((c) => {
            c.functions[0].params[0].type = t;
          }),
        ).toBe(
          `inc64(x) is ${t}: Nish has \`T | null\` only on a reference type`,
        );
    });
    test("an f64 or small-int forall variable", () => {
      expect(
        refusal((c) => {
          (c.clauses.at(-1) as PropertyClause).forall = [
            { name: "f", type: "f64", min: "0", max: "1" },
          ];
        }),
      ).toBe(
        "P-I64: f is f64: the sampler has no f64 forall variable yet, so Nish has no samples to check",
      );
      expect(
        refusal((c) => {
          (c.clauses.at(-1) as PropertyClause).forall = [
            { name: "s", type: "i16", min: 0, max: 1 },
          ];
        }),
      ).toBe(
        "P-I64: s is i16: Nish has no i8 or i16: write the parameter as i32",
      );
    });
  });
});

describe("the ts-interface and ts-property front end", () => {
  const ts = frontEndFor("ts-property") as FrontEnd;

  test("reads every new type, `| null` on each, and a non-nish module", () => {
    expect(
      ts.parseInterface(
        "// module: std/num\nexport function f(a: i64, b: u8 | null, c: f64, d: boolean | null, e: Secret<u8[]> | null): u64 | null\nexport function g(x: i16): f64 | null\n",
      ),
    ).toEqual({
      module: "std/num",
      functions: [
        {
          name: "f",
          params: [
            { name: "a", type: "i64" },
            { name: "b", type: "u8?" },
            { name: "c", type: "f64" },
            { name: "d", type: "bool?" },
            { name: "e", type: "secret-bytes?" },
          ],
          returns: "u64?",
        },
        { name: "g", params: [{ name: "x", type: "i16" }], returns: "f64?" },
      ],
      lines: [2, 3],
    });
  });

  test("reads a 64-bit forall's bounds exactly", () => {
    const fns: FnSig[] = [
      { name: "f", params: [{ name: "a", type: "i64" }], returns: "i64" },
    ];
    const r = ts.parseProperty(
      "// P-X covers R-X — t\nforall (x: i64 /* -9223372036854775808..9223372036854775807 */, y: u8 /* 0..255 */) => f(x) === x + 1",
      fns,
    );
    expect("clause" in r && r.clause.forall).toEqual([
      {
        name: "x",
        type: "i64",
        min: "-9223372036854775808",
        max: "9223372036854775807",
      },
      { name: "y", type: "u8", min: 0, max: 255 },
    ]);
  });
});
