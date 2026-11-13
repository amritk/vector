# File formats

vector reads and writes a handful of files. The JSON ones each have a JSON
Schema in [`schemas/`](https://github.com/amritk/vector/tree/main/schemas),
and the reference pages generated from those schemas are normative: this page
says what each file is for and where it lives, and links the reference for
every property.

| File | Written by | Read by | Reference |
| --- | --- | --- | --- |
| spec plan (`*.json`) | you, or a model through the `vector` skill | `verify` | [spec-plan.json](../../reference/formats/spec-plan.md) |
| program (`*.json`) | you, or a model through the `vector` skill | `verify`, `diff` | [program.json](../../reference/formats/program.md) |
| spec (`specs/<name>.md`, `specs/<name>.xml`) | you; `scripts/build-spec.sh` renders the XML | `spec extract` | [Writing a spec](writing-a-spec.md) |
| contract (`contracts/<name>.json`) | `spec extract` | every `spec` command | [rfc-contract.json](../../reference/formats/rfc-contract.md) |
| survivors (`contracts/<name>.survivors.json`) | you | `spec extract`, which merges it into the contract | [`allowSurvivors`](../../reference/formats/rfc-contract.md#root-allowsurvivors) |
| generated test (`test/spec/<name>.ts`) | `spec emit` | nish, `spec stale` | [Testing an implementation](testing.md) |
| RFC (`rfcs/rfc<N>.xml` or `.txt`) | the RFC Editor | `spec extract`, `spec check` and every command that checks a contract | [Sources](spec-to-contract.md#sources) |

## Spec plans and programs

A **spec plan** states what a function must do: its parameters and their
units, the preconditions it may assume, and the postconditions (axioms) that
must hold. A **program** is the function, written in vector's small
expression language. `verify` proves the program meets the plan; `diff`
proves two programs equivalent. [Your first
proof](../getting-started/first-proof.md) shows a pair, and [Proving a
function](proving.md) shows the verdicts and `verify --json`, whose output is
JSON too.

## Contracts

A **contract** is what a spec requires of a set of functions: the
requirements quoted verbatim, the functions' signatures, and the clauses that
test them (vectors and properties), with the sources it quotes pinned by
SHA-256. It is generated: change the spec and run `spec extract` again rather
than editing it. Its output is canonical (schema key order, a 2-space indent,
a trailing newline), so a rebuild changes only what the spec changed.

Two parts of a contract are not in the spec:

- **`allowSurvivors`** comes from the survivors sidecar beside the contract,
  `{"allowSurvivors": [...]}`, each entry a `file`, a `line` and a `reason`;
  see [`spec mutate`](pr-gates.md#mutate).
- **The source hashes** (`sha256`, and `file` for an RFC) are filled in by
  extract from the bytes it read; [`spec frozen`](pr-gates.md#frozen) refuses
  a contract whose sources no longer match them.

## Generated tests

A generated test is a Nish program. Its header names the contract and the
command that regenerates it, and its `// vector-contract-sha256: <hex>` line
pins the contract it came from, which [`spec stale`](pr-gates.md#stale)
checks. Its `main` takes a nonce as its argument and ends its output with
`vector-done <nonce> …`; `spec run` trusts no transcript without that line.
