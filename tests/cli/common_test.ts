// src/cli/common.ts holds what the command stubs share. It goes when the last
// stub does, and this test goes with it.

import { Suite } from "nish/testing"
import { notImplemented } from "../../src/cli/common"

export const main = (): i32 => {
  const t = new Suite("cli/common")
  t.eqI32("notImplemented exits 2", notImplemented("test"), 2)
  return t.done()
}
