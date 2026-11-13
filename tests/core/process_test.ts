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
  t.ok("finished run not timed out", cat.isOk() && !cat.value.timedOut)
  // A missing program cannot be started, which the runtime answers with -1.
  t.ok("missing program is an error", runProcess(["vector-no-such-program"], "", 5000).isErr())

  // `exec` so the shell is the sleeper: the kill reaches it, and no grandchild
  // holds the output pipe open past the deadline.
  const started = monotonicNanos()
  const slow = runProcess(["sh", "-c", "echo partial; echo half >&2; exec sleep 10"], "", 200)
  const tookMs = toI32((monotonicNanos() - started) / 1000000)
  if (slow.isOk()) {
    t.ok("timed out", slow.value.timedOut)
    t.eqI32("timed-out status", slow.value.status, -1)
    t.eqStr("partial stdout kept", slow.value.stdout, "partial\n")
    t.eqStr("partial stderr kept", slow.value.stderr, "half\n")
  } else {
    t.fail("timed out", slow.error)
  }
  t.ok("killed near the limit, not after the sleep", tookMs < 5000)
  return t.done()
}
