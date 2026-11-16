// The nish module the exports-outofscope goldens judge. nish/std is a
// symlink to this directory, so git at HEAD has no std/fmath.ts under it:
// against --base HEAD both exports read as added.

/** Half of `x`: the function the spec tests. */
export const fmathHalf = (x: f64): f64 => x / 2

/** Half of `x` again: the export the spec leaves out of scope. */
export const fmathHalfBits = (x: f64): f64 => fmathHalf(x)
