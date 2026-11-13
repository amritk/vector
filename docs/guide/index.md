# vector

vector is a deterministic judge for code a model writes. It proves small numeric functions correct with the Z3 solver, and it holds implementations to contracts extracted from specs and RFCs. It never calls a model itself: Claude Code, through the bundled skills, does the writing, and vector checks it.

<scalar-grid cols="2">

<scalar-card title="Getting started" icon="phosphor/regular/rocket-launch" href="getting-started/installation.md">

Install the pinned Nish compiler and z3, build `dist/vector`, and prove your first program.

</scalar-card>

<scalar-card title="Reference" icon="phosphor/regular/book-open" href="../reference/index.md">

Every command and flag, the JSON files vector reads and writes, and the modules it is built from, generated from the source.

</scalar-card>

</scalar-grid>

## What it checks

- **`vector verify`** proves that a program meets its spec plan: every postcondition holds for every input its preconditions allow, or vector shows a counterexample.
- **`vector diff`** proves two programs equivalent, or shows an input on which they differ.
- **`vector spec`** turns a spec into a contract and a Nish test, and gates a change on it: a frozen contract, a stale test, an uncovered export or a mutant the test misses is refused.

Every command ends with exit 0 when the check passed, 1 when vector refused the input, and 2 for bad usage or an I/O or tool failure.
