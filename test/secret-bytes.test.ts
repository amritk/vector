import { describe, expect, test } from "bun:test";
import type { RfcContract } from "../src/rfc/contract.ts";
import { validateContractShape } from "../src/rfc/contract.ts";
import { emitNishTest } from "../src/rfc/emit-nish.ts";
import { runGates } from "../src/rfc/gates.ts";
import {
  type ContractReport,
  SATISFIED_MEANING,
  renderMarkdown,
  renderReport,
} from "../src/rfc/report.ts";
import { runNishTest } from "../src/rfc/run.ts";

// A nish function that takes or returns a `Secret<u8[]>` (std/crypto/x25519)
// can be the target of a contract (#30): its signature says `secret-bytes`,
// vectors give the secret as plain bytes, and the generated test does the
// secret/expose/wipe under nish's ownership rules.

const contract = (): RfcContract =>
  ({
    contract: "x25519-secret",
    source: { rfc: 7748, title: "Elliptic Curves for Security" },
    target: { module: "nish/crypto/x25519" },
    requirements: [
      {
        id: "R-X25519",
        section: "5",
        level: "DEFINITION",
        quote:
          "The functions take a scalar and a u-coordinate as inputs and produce a u-coordinate as output.",
      },
    ],
    functions: [
      {
        name: "x25519",
        params: [
          { name: "scalar", type: "secret-bytes" },
          { name: "u", type: "bytes" },
        ],
        returns: "secret-bytes?",
      },
      {
        name: "x25519Base",
        params: [{ name: "scalar", type: "secret-bytes" }],
        returns: "bytes?",
      },
    ],
    clauses: [
      {
        kind: "vector",
        id: "V5.2-1",
        title: "RFC 7748 5.2, first vector",
        covers: ["R-X25519"],
        source: { cite: { section: "5.2" } },
        call: "x25519",
        args: [
          {
            hex: "a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4",
          },
          {
            hex: "e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c",
          },
        ],
        expect: {
          hex: "c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552",
        },
      },
      {
        kind: "vector",
        id: "V6.1-ALICE",
        title: "RFC 7748 6.1, Alice's public key",
        covers: ["R-X25519"],
        source: { cite: { section: "6.1" } },
        call: "x25519Base",
        args: [
          {
            hex: "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a",
          },
        ],
        expect: {
          hex: "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a",
        },
      },
    ],
  }) as unknown as RfcContract;

const MODULE = `
export const x25519 = (scalar: Secret<u8[]>, u: u8[]): Secret<u8[]> | null => _
export const x25519Base = (scalar: Secret<u8[]>): u8[] | null => _
`;

describe("secret-bytes in a contract", () => {
  test("is a valid parameter and result type", () => {
    expect(validateContractShape(contract())).toEqual([]);
  });

  test("secret-bytes? is a result type only", () => {
    const c = contract();
    c.functions[0].params[1].type = "secret-bytes?";
    expect(validateContractShape(c)).toEqual([
      "functions[0].params[1].type: secret-bytes? is a result type only; a parameter may be secret-bytes",
    ]);
  });

  test("vectors and calls type a secret as its bytes", () => {
    const r = runGates(contract());
    expect(r.issues).toEqual([]);
    const c = contract();
    (c.clauses[0] as { args: unknown[] }).args[0] = { int: 7 };
    expect(runGates(c).issues.map((i) => i.message)).toContainEqual(
      expect.stringContaining("x25519(scalar) wants bytes"),
    );
  });

  test("the signature gate maps Secret<u8[]> to secret-bytes", () => {
    expect(
      runGates(contract(), { moduleSource: MODULE }).issues.filter(
        (i) => i.gate === "signatures",
      ),
    ).toEqual([]);
    // A secret declared as plain bytes, or the reverse, is a mismatch.
    const c = contract();
    c.functions[1].params[0].type = "bytes";
    const plain = MODULE.replace("Secret<u8[]> | null", "u8[] | null");
    const issues = [
      ...runGates(c, { moduleSource: MODULE }).issues,
      ...runGates(contract(), { moduleSource: plain }).issues,
    ].filter((i) => i.gate === "signatures");
    expect(issues.map((i) => i.at)).toEqual(["x25519Base", "x25519"]);
  });

  test("the test wraps each such function on plain bytes", () => {
    const src = emitNishTest(contract(), new Map());
    expect(src).toContain(
      'import { Secret, expose, secret, wipe } from "nish:secret";',
    );
    expect(
      src,
    ).toContain(`const plain_x25519 = (a_scalar: u8[], a_u: u8[]): u8[] | null => {
  const s_scalar: Secret<u8[]> = secret(copyBytes(a_scalar));
  const r: Secret<u8[]> | null = x25519(s_scalar, a_u);
  wipe(s_scalar);
  if (r === null) {
    return null;
  }
  const out: u8[] = expose(r, copyBytes);
  wipe(r);
  return out;
};`);
    expect(
      src,
    ).toContain(`const plain_x25519Base = (a_scalar: u8[]): u8[] | null => {
  const s_scalar: Secret<u8[]> = secret(copyBytes(a_scalar));
  const r: u8[] | null = x25519Base(s_scalar);
  wipe(s_scalar);
  return r;
};`);
    // Every call goes through the wrapper.
    expect(src).not.toMatch(/[^_]x25519\(unhex/);
    expect(src).toContain("plain_x25519(unhex(");
    expect(src).toContain("plain_x25519Base(unhex(");
  });

  test("a contract with no secret imports nothing from nish:secret", () => {
    const c = contract();
    for (const f of c.functions) {
      for (const p of f.params) p.type = "bytes";
      f.returns = "bytes?";
    }
    const src = emitNishTest(c, new Map());
    expect(src).not.toContain("nish:secret");
    expect(src).not.toContain("plain_");
    expect(src).toContain("x25519(unhex(");
  });
});

describe("a SATISFIED report says what it does not prove", () => {
  const report = (status: "SATISFIED" | "VIOLATED"): ContractReport =>
    ({
      contract: contract(),
      gates: {
        ok: true,
        issues: [],
        warnings: [],
        coverage: new Map([["R-X25519", ["V5.2-1", "V6.1-ALICE"]]]),
      },
      run: {
        status,
        nish: "nish",
        stdout: "",
        stderr: "",
        integrity: [],
        requirements: new Map([
          ["R-X25519", status === "SATISFIED" ? "pass" : "fail"],
        ]),
        clauses: new Map(),
      },
    }) as unknown as ContractReport;

  test("in the text and the markdown", () => {
    expect(renderReport(report("SATISFIED"))).toContain(SATISFIED_MEANING);
    expect(renderMarkdown(report("SATISFIED"))).toContain(SATISFIED_MEANING);
    expect(SATISFIED_MEANING).toContain("not a proof");
    expect(SATISFIED_MEANING).toContain("vector spec mutate");
  });

  test("and nothing when it is not SATISFIED", () => {
    expect(renderReport(report("VIOLATED"))).not.toContain(SATISFIED_MEANING);
    expect(renderMarkdown(report("VIOLATED"))).not.toContain(SATISFIED_MEANING);
  });
});

// Against a real nish: the generated test compiles under nish's Secret rules
// and x25519 holds.
const nish = process.env.VECTOR_NISH;
describe.skipIf(!nish)("against nish", () => {
  test("x25519 on secret-bytes is SATISFIED", async () => {
    const c = contract();
    const run = await runNishTest(
      c,
      emitNishTest(c, new Map()),
      nish as string,
    );
    expect(run.stderr).toBe("");
    expect(run.status).toBe("SATISFIED");
  }, 600_000);
});
