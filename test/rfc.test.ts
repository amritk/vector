import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import hkdfContract from "../contracts/rfc5869-hkdf-sha256.json";
import aeadContract from "../contracts/rfc8439-chacha20-poly1305.json";
import {
  type PropertyClause,
  type RfcContract,
  type VectorClause,
  validateContractShape,
} from "../src/rfc/contract.ts";
import { emitNishTest } from "../src/rfc/emit-nish.ts";
import { extractContract } from "../src/rfc/extract.ts";
import { exportedSignatures, runGates } from "../src/rfc/gates.ts";
import { hexRuns, normativeSentences, parseRfc } from "../src/rfc/rfctext.ts";
import {
  checkTranscript,
  judge,
  parseTestOutput,
  runNishTest,
} from "../src/rfc/run.ts";
import { evalPure, sampleContract } from "../src/rfc/sample.ts";

// RFC → contract → Nish test. The RFC texts in rfcs/ are rfc-editor.org's
// plain-text renderings, unmodified; the two contracts are the shipped ones.

const rfc5869 = parseRfc(readFileSync("rfcs/rfc5869.txt", "utf8"));
const rfc8439 = parseRfc(readFileSync("rfcs/rfc8439.txt", "utf8"));
const hkdf = hkdfContract as unknown as RfcContract;
const aead = aeadContract as unknown as RfcContract;
const clone = <T>(x: T): T => structuredClone(x);
const clause = <K extends RfcContract["clauses"][number]>(
  c: RfcContract,
  id: string,
) => c.clauses.find((k) => k.id === id) as K;

describe("reading the RFC text", () => {
  test("finds numbered and appendix sections, not the table of contents", () => {
    expect(rfc5869.number).toBe(5869);
    expect([...rfc5869.sections.keys()]).toContain("2.3");
    expect([...rfc5869.sections.keys()]).toContain("A.3");
    expect(rfc8439.sections.get("2.8.2")?.title).toBe(
      "Example and Test Vector for AEAD_CHACHA20_POLY1305",
    );
  });

  test("reads 0x values with continuation lines and a trailing (N octets)", () => {
    const runs = hexRuns(rfc5869.sections.get("A.1") as never);
    expect(runs).toContain(
      "077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5",
    );
  });

  test("reads hexdumps without their ASCII column", () => {
    const runs = hexRuns(rfc8439.sections.get("2.8.2") as never);
    expect(runs[1]).toBe("50515253c0c1c2c3c4c5c6c7");
  });

  test("reads inline colon hex split mid-byte across lines, and in parens", () => {
    const runs = hexRuns(rfc8439.sections.get("2.5.2") as never);
    expect(runs[0]).toBe(
      "85d6be7857556d337f4452fe42d506a80103808afb0db2fd4abff6af4149f51b",
    );
    expect(hexRuns(rfc8439.sections.get("2.3.2") as never)[1]).toBe(
      "000000090000004a00000000",
    );
  });

  test("lists every binding BCP 14 sentence, skipping the boilerplate", () => {
    expect(normativeSentences(rfc5869)).toHaveLength(0);
    const found = normativeSentences(rfc8439);
    expect(found).toHaveLength(9);
    expect(found.map((n) => n.section).sort()).toEqual(
      ["2.3", "2.5", "2.6", "2.6", "2.6", "4", "4", "4", "4"].sort(),
    );
  });
});

describe("the gates", () => {
  test("pass the shipped contracts against their RFCs", () => {
    for (const [c, rfc] of [
      [hkdf, rfc5869],
      [aead, rfc8439],
    ] as const) {
      const g = runGates(c, { rfc });
      expect(g.issues).toEqual([]);
      expect(g.ok).toBe(true);
    }
  });

  test("fidelity: a test vector one digit off is not in the RFC", () => {
    const c = clone(hkdf);
    const v = clause<VectorClause>(c, "A.1-OKM");
    (v.expect as { hex: string }).hex = (
      v.expect as { hex: string }
    ).hex.replace(/^3c/, "3d");
    const g = runGates(c, { rfc: rfc5869 });
    expect(g.ok).toBe(false);
    expect(g.issues[0]).toMatchObject({
      gate: "fidelity",
      at: "A.1-OKM.expect",
    });
  });

  test("fidelity: a value from another section is refused", () => {
    const c = clone(hkdf);
    clause<VectorClause>(c, "A.1-PRK").source = { cite: { section: "A.2" } };
    const g = runGates(c, { rfc: rfc5869 });
    expect(
      g.issues.some((i) => i.gate === "fidelity" && i.at.startsWith("A.1-PRK")),
    ).toBe(true);
  });

  test("fidelity: a paraphrased quote is refused", () => {
    const c = clone(hkdf);
    c.requirements[0].quote = "PRK = HMAC(salt, IKM)";
    const g = runGates(c, { rfc: rfc5869 });
    expect(g.issues).toEqual([
      expect.objectContaining({ gate: "fidelity", at: "R-EXTRACT" }),
    ]);
  });

  test("fidelity: `unchecked` is allowed but reported", () => {
    const c = clone(hkdf);
    const v = clause<VectorClause>(c, "A.1-OKM");
    v.expect = { hex: "00", unchecked: "for the test" };
    const g = runGates(c, { rfc: rfc5869 });
    expect(g.ok).toBe(true);
    expect(g.warnings.some((w) => w.message.includes("for the test"))).toBe(
      true,
    );
  });

  test("completeness: dropping an exclusion leaves a MUST unaccounted for", () => {
    const c = clone(aead);
    c.exclusions = (c.exclusions ?? []).filter(
      (x) => !x.quote.includes("constant-time"),
    );
    const g = runGates(c, { rfc: rfc8439 });
    expect(g.issues).toEqual([
      expect.objectContaining({
        gate: "completeness",
        at: "§4",
        message: expect.stringContaining("constant-time comparison"),
      }),
    ]);
  });

  test("coverage: a requirement no clause checks, and a citation of nothing", () => {
    const c = clone(hkdf);
    c.clauses = c.clauses.filter((k) => k.id !== "P-EXPAND-LENGTH");
    c.clauses[0].covers.push("R-MADE-UP");
    const g = runGates(c, { rfc: rfc5869 });
    const coverage = g.issues.filter((i) => i.gate === "coverage");
    expect(coverage.map((i) => i.at).sort()).toEqual(["A.1-PRK", "R-L"]);
  });

  test("typing: a nullable result passed on needs unwrap; where may not call", () => {
    const c = clone(aead);
    const p = clause<PropertyClause>(c, "P-ROUNDTRIP");
    const sealed = (p.assert as { args: { args: unknown[] }[] }).args[0]
      .args[3] as {
      args: unknown[];
    };
    p.assert = {
      op: "==",
      args: [
        {
          call: "chacha20Poly1305Open",
          args: [
            { var: "key" },
            { var: "nonce" },
            { var: "aad" },
            sealed.args[0] as never,
          ],
        },
        { var: "pt" },
      ],
    };
    p.where = {
      op: "notNull",
      args: [
        {
          call: "chacha20Poly1305Seal",
          args: [
            { var: "key" },
            { var: "nonce" },
            { var: "aad" },
            { var: "pt" },
          ],
        },
      ],
    };
    const g = runGates(c, { rfc: rfc8439 });
    const typing = g.issues
      .filter((i) => i.gate === "typing")
      .map((i) => i.message);
    expect(typing.some((m) => m.includes("unwrap"))).toBe(true);
    expect(typing.some((m) => m.includes('"where" may not call'))).toBe(true);
  });

  test("signatures: read from the module source and compared", () => {
    const src = `export const hkdfExtractSha256 = (salt: u8[], ikm: u8[]): u8[] => x
export const hkdfExpandSha256 = (prk: u8[], info: u8[], length: i32): u8[] => {`;
    expect(exportedSignatures(src).get("hkdfExpandSha256")).toEqual({
      params: ["u8[]", "u8[]", "i32"],
      returns: "u8[]",
    });
    const g = runGates(hkdf, { rfc: rfc5869, moduleSource: src });
    expect(g.issues).toEqual([
      expect.objectContaining({ gate: "signatures", at: "hkdfExpandSha256" }),
    ]);
  });
});

describe("sampling", () => {
  test("Z3 puts samples on both sides of the RFC's bound", async () => {
    const s = await sampleContract(hkdf);
    expect(s.ok).toBe(true);
    const ns = (s.properties.get("P-EXPAND-LENGTH")?.samples ?? []).map(
      (x) => x.n,
    );
    expect(ns).toContain(8159);
    expect(ns).toContain(8160);
    expect(ns).toContain(8161);
    expect(ns).toContain(0);
    expect(ns).toContain(8300);
  });

  test("Z3 finds the last bit of the tag as a boundary of `where`", async () => {
    const s = await sampleContract(aead);
    const samples = s.properties.get("P-TAMPER-SEALED")?.samples ?? [];
    const last = samples.filter(
      (x) => x.bit === 8 * ((x.pt as Uint8Array).length + 16) - 1,
    );
    expect(last.length).toBeGreaterThan(0);
    for (const x of samples) {
      expect(x.bit as number).toBeLessThan(
        8 * ((x.pt as Uint8Array).length + 16),
      );
    }
  });

  test("is deterministic", async () => {
    const a = await sampleContract(hkdf);
    const b = await sampleContract(hkdf);
    expect(JSON.stringify([...a.properties])).toBe(
      JSON.stringify([...b.properties]),
    );
  });

  test("refuses a vacuous domain", async () => {
    const c = clone(hkdf);
    const p = clause<PropertyClause>(c, "P-EXPAND-LENGTH");
    p.where = { op: "<", args: [{ var: "n" }, { int: 0 }] };
    const s = await sampleContract(c);
    expect(s.ok).toBe(false);
    expect(s.issues[0].message).toContain("vacuously");
  });

  test("the pure evaluator matches the emitted helpers' semantics", () => {
    const b = Uint8Array.from([1, 2, 3]);
    expect(
      evalPure(
        { op: "slice", args: [{ var: "b" }, { int: -5 }, { int: 2 }] },
        { b },
      ),
    ).toEqual(Uint8Array.from([1, 2]));
    expect(
      evalPure({ op: "flipBit", args: [{ var: "b" }, { int: 25 }] }, { b }),
    ).toEqual(Uint8Array.from([3, 2, 3]));
    expect(evalPure({ op: "le64", args: [{ int: 300 }] }, {})).toEqual(
      Uint8Array.from([44, 1, 0, 0, 0, 0, 0, 0]),
    );
    expect(evalPure({ op: "%", args: [{ int: 34 }, { int: 16 }] }, {})).toBe(2);
    // Strings: ASCII-only case mapping, charAt "" out of range, ascii null on
    // any byte >= 0x80 (shiftCase, charAtStr and asciiOrNull in the test).
    const s = "aZ-9";
    const str = (op: string, ...args: object[]) =>
      evalPure({ op, args: [{ var: "s" }, ...args] } as never, { s });
    expect(str("strLen")).toBe(4);
    expect(str("strConcat", { str: "!" })).toBe("aZ-9!");
    expect(str("lower")).toBe("az-9");
    expect(str("upper")).toBe("AZ-9");
    expect(str("utf8")).toEqual(Uint8Array.from([97, 90, 45, 57]));
    expect(str("charAt", { int: 1 })).toBe("Z");
    expect(str("charAt", { int: 4 })).toBe("");
    expect(evalPure({ op: "ascii", args: [{ hex: "7f41" }] }, {})).toBe(
      "\x7fA",
    );
    expect(evalPure({ op: "ascii", args: [{ hex: "4180" }] }, {})).toBeNull();
  });
});

describe("the emitted Nish test", () => {
  test("imports by module, converts to u32, names clauses in brackets", async () => {
    const s = await sampleContract(aead);
    const src = emitNishTest(aead, s.properties);
    expect(src).toContain(
      `import { chacha20, chacha20Block, chacha20Poly1305Open, chacha20Poly1305Seal, poly1305, poly1305KeyGen } from "nish/crypto/chacha20poly1305";`,
    );
    expect(src).toContain("chacha20Block(v_key, toU32(v_counter), v_nonce)");
    expect(src).toContain(
      `"[A.5-OPEN] RFC 8439 A.5: AEAD decryption of the Internet-Drafts message (R-DECRYPT, R-AUTH)"`,
    );
    expect(src).toContain("R-NO-TRUNCATION — RFC 8439 §4, MUST NOT:");
  });

  test("emits only the helpers it uses", async () => {
    const s = await sampleContract(hkdf);
    const src = emitNishTest(hkdf, s.properties);
    expect(src).toContain(`import { hmacSha256 } from "nish/crypto/hmac";`);
    expect(src).not.toContain("const le64");
    expect(src).not.toContain("const flipBit");
    expect(src).toContain("class Unwrap");
  });
});

describe("contract free text cannot become code (#23)", () => {
  const titleInjection = "x */\nconst injectedByTitle = (): i32 => 7\n/** y";
  const headerInjection = 'Spec 0001\nconsole.log("INJECTED")\n//';

  test("the shape gate refuses control characters in free text", () => {
    const c = clone(hkdf);
    c.source.title = headerInjection;
    c.clauses[0].title = titleInjection;
    c.requirements[0].quote = `${c.requirements[0].quote}\u2028`;
    const errors = validateContractShape(c).join("\n");
    expect(errors).toContain(
      "contract.source.title: one line of text, without control characters (found U+000A)",
    );
    expect(errors).toContain("clauses[0].title: one line of text");
    expect(errors).toContain("(found U+2028)");
    expect(validateContractShape(hkdf)).toEqual([]);
  });

  test("tab, LF and CR in a string alphabet are values, not free text", () => {
    const hex = JSON.parse(readFileSync("contracts/example-hex.json", "utf8"));
    expect(JSON.stringify(hex)).toContain('"\\n"');
    expect(validateContractShape(hex)).toEqual([]);
  });

  test("the emitter keeps titles and the regenerate command in comments", () => {
    const c = clone(hkdf);
    c.source.title = headerInjection;
    c.clauses[0].title = titleInjection;
    const src = emitNishTest(c, new Map(), {
      regenerate: 'vector spec emit a.json -o "x\nconsole.log(1)"',
    });
    const lines = src.split("\n");
    expect(lines.some((l) => l.startsWith("const injectedByTitle"))).toBe(
      false,
    );
    expect(lines.some((l) => l.startsWith("console.log"))).toBe(false);
    expect(src).toContain(
      " * x * / const injectedByTitle = (): i32 => 7 /** y",
    );
    expect(src).toContain('// Spec 0001 console.log("INJECTED") //).');
    // Every comment opened before the first import is closed by a "*/" of its own.
    const head = src.slice(0, src.indexOf("import "));
    expect(head.split("\n").every((l) => l === "" || l.startsWith("//"))).toBe(
      true,
    );
    // In the test name the title is a JSON string, its line break escaped.
    for (const l of lines.filter((l) => l.includes("injectedByTitle")))
      expect(
        l.startsWith(" * x * / ") ||
          l.includes("] x */\\nconst injectedByTitle"),
      ).toBe(true);
  });
});

describe("reading the run back", () => {
  test("maps PASS/FAIL lines to clauses and requirements", () => {
    const out = [
      "PASS  [A.1-PRK] x (R-EXTRACT, R-PRK-LEN)",
      "FAIL  [P-EXPAND-LENGTH] y (R-L, R-OKM-LEN)",
      "      sample 3 of 39 (n = 8161): the assertion is false",
    ].join("\n");
    const clauses = parseTestOutput(hkdf, out);
    expect(clauses.get("P-EXPAND-LENGTH")).toMatchObject({
      outcome: "fail",
      detail: "sample 3 of 39 (n = 8161): the assertion is false",
    });
    const j = judge(hkdf, clauses, 1);
    expect(j.status).toBe("VIOLATED");
    expect(j.requirements.get("R-L")).toBe("fail");
    expect(j.requirements.get("R-T")).toBe("not-run");
  });

  test("a run that stops early is an ERROR, not a pass", () => {
    const out = hkdf.clauses
      .slice(0, 3)
      .map((k) => `PASS  [${k.id}] t`)
      .join("\n");
    expect(judge(hkdf, parseTestOutput(hkdf, out), 134).status).toBe("ERROR");
  });
});

describe("the transcript must be the test's own (#22)", () => {
  const N = "0123abcd";
  const all = hkdf.clauses.map((k) => `PASS  [${k.id}] t`);
  const bits = "1".repeat(hkdf.clauses.length);
  const verdict = (out: string, exitCode = 0) => {
    const clauses = parseTestOutput(hkdf, out);
    const integrity = checkTranscript(hkdf, out, N, clauses);
    return { integrity, ...judge(hkdf, clauses, exitCode, integrity) };
  };

  test("an honest run with its end line is SATISFIED", () => {
    const v = verdict([...all, `vector-done ${N} ${bits}`].join("\n"));
    expect(v.integrity).toEqual([]);
    expect(v.status).toBe("SATISFIED");
  });

  test("every clause PASS but no end line (early exit) is an ERROR", () => {
    const v = verdict(all.join("\n"));
    expect(v.status).toBe("ERROR");
    expect(v.integrity[0]).toContain("never reached the end of main");
  });

  test("an end line with another nonce does not count", () => {
    const v = verdict([...all, `vector-done ffff ${bits}`].join("\n"));
    expect(v.status).toBe("ERROR");
    expect(v.integrity.join("\n")).toContain("wrong nonce");
  });

  test("a forged PASS ahead of the real FAIL is an ERROR, not last-wins", () => {
    const id = hkdf.clauses[1].id;
    const out = [
      `PASS  [${id}] forged`,
      ...all.map((l) =>
        l.startsWith(`PASS  [${id}]`) ? `FAIL  [${id}] t` : l,
      ),
      `vector-done ${N} 1${"0"}${"1".repeat(hkdf.clauses.length - 2)}`,
    ].join("\n");
    const v = verdict(out, 1);
    expect(v.status).toBe("ERROR");
    expect(v.integrity.join("\n")).toContain(`[${id}] reported 2 times`);
  });

  test("a PASS line that contradicts what the clause returned is an ERROR", () => {
    const id = hkdf.clauses[0].id;
    const v = verdict(
      [...all, `vector-done ${N} 0${"1".repeat(hkdf.clauses.length - 1)}`].join(
        "\n",
      ),
    );
    expect(v.status).toBe("ERROR");
    expect(v.integrity.join("\n")).toContain(
      `[${id}] returned false to main, but its line says pass`,
    );
  });

  test("clause lines after the end line are an ERROR", () => {
    const id = hkdf.clauses[0].id;
    const v = verdict(
      [...all.slice(1), `vector-done ${N} ${bits}`, `PASS  [${id}] late`].join(
        "\n",
      ),
    );
    expect(v.status).toBe("ERROR");
    expect(v.integrity.join("\n")).toContain("after the test's main");
  });

  test("the emitted main prints the end line from its first argument", () => {
    const src = emitNishTest(hkdf, new Map());
    expect(src).toContain("process.argv[1]");
    expect(src).toContain("console.log(`vector-done ${nonce} ${ran}`);");
    expect(src).not.toContain("  return t.done();");
  });
});

describe("extraction with a model in the loop", () => {
  test("gate failures go back as feedback until the contract passes", async () => {
    const wrong = clone(hkdf);
    wrong.requirements[2].quote = "PRK is HashLen octets";
    const turns: string[] = [];
    const answers = [wrong, hkdf];
    const outcome = await extractContract(
      {
        rfcText: readFileSync("rfcs/rfc5869.txt", "utf8"),
        moduleSource: [
          "export const hkdfExtractSha256 = (salt: u8[], ikm: u8[]): u8[] => x",
          "export const hkdfExpandSha256 = (prk: u8[], info: u8[], length: i32): u8[] | null => {",
        ].join("\n"),
        target: "nish/crypto/hkdf",
      },
      {
        propose: async (turn) => {
          turns.push(turn);
          return answers.shift();
        },
      },
    );
    expect(outcome.attempts).toBe(2);
    expect(outcome.contract?.contract).toBe("rfc5869-hkdf-sha256");
    expect(turns[1]).toContain(
      "[fidelity] R-PRK-LEN: quote not found in RFC §2.2",
    );
  });
});

// Against a real nish (VECTOR_NISH=<path to a nish binary>): both contracts hold.
// They skip without one, unless VECTOR_REQUIRE_NISH=1 makes that a failure.
const nish = process.env.VECTOR_NISH;
if (process.env.VECTOR_REQUIRE_NISH === "1" && !nish)
  test("VECTOR_NISH is set (VECTOR_REQUIRE_NISH=1)", () => {
    throw new Error(
      "VECTOR_REQUIRE_NISH=1 but VECTOR_NISH is unset: the live nish tests would skip",
    );
  });
describe.skipIf(!nish)("against nish", () => {
  for (const c of [hkdf, aead]) {
    test(`${c.contract} is SATISFIED`, async () => {
      const s = await sampleContract(c);
      const run = await runNishTest(
        c,
        emitNishTest(c, s.properties),
        nish as string,
      );
      expect(run.stderr).toBe("");
      expect(run.status).toBe("SATISFIED");
    }, 600_000);
  }
});
