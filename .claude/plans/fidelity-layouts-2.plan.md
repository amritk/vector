---
name: Fidelity layouts, follow-up (#199)
overview: Finish amritk/vector#199 on top of main b94f92a (#189 and #198 merged). Three serial PRs. PR 1 fixes the call-label pairing weaknesses #199 lists, confirms #198's round-2 B1–B6, and names the merged layouts in docs/AI.md. PR 2 is prose pairing (criterion 4). PR 3 is byte parts, `Format:` and `Tail:` (criteria 5 and 6).
stages:
  - id: label-args
    title: "fix(spec): pair call-label arguments in order, and pair empty and unlabelled ones"
    goal: A vector whose arguments are printed in its expected value's call label binds only when they are printed there in argument order. An empty string or an unlabelled integer argument is placed in that label or refused, never left free to pair with any case. B1–B6 are shown fixed on main. docs/AI.md names the wrapped-value and case-heading layouts.
    verification: npm run build && node tests/run.mjs spec && node tests/run.mjs cli && npm test && npm run lint && npm run tested-exports && npm run doc-caps && node scripts/gen-reference.mjs --check
    todos:
      - id: order
        content: In gateLabelArgs (src/spec/gates/fidelity.ts:747), assign each paired argument the first occurrence in the label after the previous paired argument's. Refuse when none is left. This refuses ("salt", "passwd", 1, 64) against `PBKDF2-HMAC-SHA-256 (P="passwd", S="salt", c=1, dkLen=64)`, and still binds §12 case 1 `(P="", S="", …)`.
      - id: empty-and-bare
        content: In gateLitCheck (fidelity.ts:604), an empty string (fidelity.ts:622) and an unlabelled integer (fidelity.ts:669) push a GateBound. When the expected value has a call label, gateLabelArgs places it there (`""`, or a whole number token via gateFidTokenAt), or refuses it as from another case. With no call label, the behaviour stays as on main (the empty-value check, or the "has no label" warning).
      - id: b1-b6
        content: Confirm #198's round-2 findings on main. B1–B4 were prose code that #198 removed before merging. B6's `words.length === 0` guard is gone, and whitespace-only words already return "". For each, add a refusal row if none exists, at least `BASE64("f") = "Zg=="` / `BASE64("fo") = "Zm8="` on adjacent lines (B3). B5 survives as `out.indexOf(c) < 0` in gateBoundCases (fidelity.ts:848): mutate it, then pin it with a value printed twice under one heading, or delete it if it is equivalent. Report each result in the PR body.
      - id: tests
        content: Table-driven rows in tests/spec/gates/fidelity_test.ts cover a swap, a partial swap, a repeat of one value, an empty value in its own label versus another case's, and a bare integer in or out of the label, each with a passing neighbour. Extend the check-rfc7914-wrapped golden (or add one) with a swapped case and an empty-P case, run through the binary. Mutate every condition and pin each survivor.
      - id: docs
        content: Name `= hex` continuation lines, wrapped call labels and `With …:` case headings in docs/AI.md, inside its 6400-byte cap (it is at 6398, so shorten in place). If the guide shows a message that changes, update it too.
  - id: prose
    title: "feat(spec): pair values printed in one prose example"
    goal: RFC 6455 §4.2.2's key and accept value bind, and RFC 9000 §A.1's `0xc2197c5eff14e88c` binds to 151,288,809,941,952,652. Every false accept from #198's review rounds 1–3 is refused, so anything the gate cannot bound as one example is refused, as on main.
    verification: npm run build && node tests/run.mjs spec && node tests/run.mjs cli && npm test && npm run lint && npm run tested-exports && npm run doc-caps && node scripts/gen-reference.mjs --check
    todos:
      - id: unit
        content: The unit is one sentence, or one `;` part of a sentence. Prose pairing runs only after line pairing has refused ("never on one line together"). See Prose unit.
      - id: chain
        content: A sentence that opens back onto the one before it (whole-word `this string`, `this value`) joins that sentence's example. This is how RFC 6455's key and accept value pair. See Prose unit.
      - id: bare-int
        content: An unlabelled integer is found in prose as a whole number token, with grouping commas in threes and the stage-1 bound. This is RFC 9000's 151,288,809,941,952,652.
      - id: tests
        content: Each mandatory refusal below is a row that goes through rfcParse with real `[Page N]` / `\f` breaks, beside a passing neighbour. A golden excerpts each of the two real RFC sections, with a page break inside the example. Mutate every condition and pin each survivor.
      - id: docs
        content: Update the guide ("What a printed value is"), docs/AI.md and the vector-spec skill. The skill has 4 B of headroom, so shorten in place.
  - id: byte-parts
    title: "feat(spec): bind a format constant and a printed value's tail"
    goal: A `Format:` paragraph lets one constant part of a concat go unprinted, such as RFC 6979's SEC1 `04` before Ux and Uy. A `Tail:` paragraph binds the expected value to the last N bytes of one printed value and an argument to the bytes before it (RFC 9001 A.4's Retry packet and its 16-byte tag). The gate computes both, and the report shows both as evidence.
    verification: npm run build && node tests/run.mjs spec && node tests/run.mjs cli && npm test && npm run lint && npm run tested-exports && npm run doc-caps && npm run dogfood && node scripts/gen-reference.mjs --check
    todos:
      - id: paragraphs
        content: Read `Format:` and `Tail:` beside `Untested:` and `Note:` (src/spec/profile/profile.ts:91), then carry them through the contract (types, read, write, shape, schemas/). See Byte parts.
      - id: gate
        content: Check both in fidelity.ts and refuse every form they do not compute. See Byte parts.
      - id: report
        content: Report each constant and tail, with its reason, in src/spec/report.
      - id: tests
        content: Run tests through vectorRun or the binary on page-broken RFC 6979 A.2.5 and RFC 9001 A.4 excerpts. Each condition gets a refusal row that fails when the condition is deleted. A test refuses a pinned RFC that is edited after extraction.
      - id: docs
        content: Update the guide, docs/guide/guides/file-formats.md and schemas/ for the new contract fields, docs/AI.md and the vector-spec skill, all within their caps.
---

# Fidelity layouts, follow-up (#199)

## State of main (b94f92a)

- Already merged: #189 (`= hex` continuation lines and wrapped call labels) and #198 (`6a9c603`, RFC 6979 case headings, criterion 3). #198 dropped prose pairing before it merged. No PR for prose pairing was ever opened, and there are no open PRs.
- #198's round-2 findings:
  - **B1–B4** were in prose code that is no longer on main: there is no `gateProse*`, `gateEndsSentence` or `l.prose` in fidelity.ts. Line pairing ("never on one line together", fidelity.ts:936) is back as on main. No row pins B3's BASE64 case, so stage 1 adds one.
  - **B5**: the `out.indexOf(c) < 0` dedupe is still in gateBoundCases. Stage 1 pins it or removes it.
  - **B6**: the guard is gone. Whitespace-only words already return "".
- Doc headroom: docs/AI.md is 6398/6400, CLAUDE.md 8953/8960, the vector-spec skill 24316/24320. `npm run doc-caps` passes. This plan does not touch CLAUDE.md.

## Order

All three stages edit fidelity.ts and docs/AI.md, so they run one after another, each from main after the stage before it merges. Stage 1 comes first: prose pairing reuses its bare-integer bound. Before each merge:

1. Merge main.
2. Rerun `npm run doc-caps` and the full verification line.

This is #204's lesson: two PRs that each fit a cap can overflow it together.

## Prose unit

Line pairing always runs first. Prose pairing is only a fallback after line pairing refuses, and it pairs a vector's values only when all of them sit in one example:

- **Sentence end.** One rule, shared by in-paragraph splitting and page breaks: `.`, `?` or `!`, then any closers `" ' ” ’ ) ] }`, then whitespace or the end. A `.` between digits is not an end. When unsure, the rule splits: a split that should not happen is a refusal, which is safe, but a missed split is a false accept. So `etc.` also ends a sentence.
- **`;`** splits a sentence into parts. This keeps RFC 9000's `0xc2197c5eff14e88c` apart from 494,878,333.
- **Paragraphs.** A blank line ends an example, and so does a page break, unless the line before the break ends without a sentence end and the line after it starts with a lowercase letter or a digit.
- **Not prose.** A line that holds a labelled value or a dump mark (`=`, `:`, `->`, `=>`, or a value right after ` is `) is not prose. Two adjacent lines with no sentence end between them do not form an example.
- **Chain.** A sentence that opens back onto the one before it joins that sentence's example. The match is whole-word only: `this string` and `this value`, not `this stringent`.

Mandatory refusal rows (each was a false accept in #198's rounds 1–3):

| Case | Input |
| --- | --- |
| R1 | RFC 9000 §A.2: `0x734f` → 59038 |
| R2 | 9000 §A.1: `0xc2197c5eff14e88c` → 494,878,333 |
| R3 | An integer inside `SHA-256`, `key_256` or `16-bit`, or after a minus |
| R4 | A sentence ending in `.)`, `.'`, `.]`, `.}` or `.’` inside a paragraph |
| R5 | A paragraph ending in `)`, `?`, `!`, `.")` or with no period, across a page break |
| R6 | `BASE64("f") = "Zg=="` / `BASE64("fo") = "Zm8="`, and the same with `->`, `=>` or ` is ` |
| R7 | Two values in different paragraphs |
| R8 | `this stringent` |
| R9 | Upper-case hex |
| R10 | A value printed twice in one paragraph |

## Byte parts

The worker designs the exact grammar. Proposed:

- `Format: <id> <path> is <hex>, <reason>`, for example `Format: P256-SHA256 args[0].concat[0] is 04, SEC1's uncompressed point prefix`.
- `Tail: <id> expect is the last <N> bytes of the value args[<i>] is printed in, <reason>`.

In the contract:

- a literal-level `format` reason;
- a vector-level `tail: {arg, bytes, reason}`.

`unchecked` stays unreachable from a spec.

The gate computes, and refuses:

- **Format.** The part is a hex part of a concat. The paragraph's hex is that part's hex. At most one format part per concat, and at least one other part is printed and bound. The named path and vector exist. A `Format:` for an id that is not a vector is refused.
- **Tail.** The argument and expect are both hex. The argument followed by the expect is byte for byte one whole printed value, placed like any other bound, so it takes part in case and round pairing. The expect is exactly N bytes, and N is what the paragraph says. N > 0, and the argument is not empty.

## Out of scope

- Changing `Test Vector #N` narrowing, or what any existing refusal means beyond the rows above.
- Rewriting nish's specs.
- Adding source kinds that recompute a value.
- Raising a doc cap.
