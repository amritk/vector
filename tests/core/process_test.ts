import { Suite } from "nish/testing"
import { runProcess } from "../../src/core/process"

export const main = (): i32 => {
  const t = new Suite("core/process")
  const cat = runProcess(["cat"], "hello\n", 5000)
  t.ok("runProcess ok", cat.isOk())
  if (cat.isOk()) {
    t.eqI32("status", cat.value.status, 0)
    t.eqStr("stdout echoes stdin", cat.value.stdout, "hello\n")
    t.eqStr("stderr empty", cat.value.stderr, "")
  }
  const sh = runProcess(["sh", "-c", "echo oops >&2; exit 3"], "", 5000)
  if (sh.isOk()) {
    t.eqI32("exit status", sh.value.status, 3)
    t.eqStr("stderr", sh.value.stderr, "oops\n")
  } else {
    t.fail("exit status", sh.error)
  }
  const none: string[] = []
  t.ok("no program", runProcess(none, "", 5000).isErr())
  t.ok("bad time limit", runProcess(["true"], "", 0).isErr())
  const missing = runProcess(["vector-no-such-program"], "", 5000)
  if (missing.isOk()) {
    t.ok("missing program fails", missing.value.status !== 0)
  } else {
    t.pass("missing program fails")
  }
  return t.done()
}
