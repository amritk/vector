import { Suite } from "nish/testing"
import { F64Env, F64Val } from "../../src/verify/emit/float64"

// `F64Env.set` and `copy` on an environment whose fields were pushed by
// hand: a name with no value at its index is unbound.

const envNpNum = (n: f64): F64Val => new F64Val(false, false, n)

export const main = (): i32 => {
  const t = new Suite("verify/emit-env-nopanic")

  const lone = new F64Env()
  lone.names.push("x")
  lone.setNum("x", toF64(2))
  t.eqI32("set drops an unpaired name, then binds it once", toI32(lone.names.length), 1)
  t.eqI32("set binds the dropped name at its value", lone.find("x"), 0)
  t.eqI32("set keeps names and values paired", toI32(lone.vals.length), 1)
  t.ok("set binds the value given", lone.vals[0].n === toF64(2))

  const two = new F64Env()
  two.names.push("x")
  two.names.push("y")
  two.vals.push(envNpNum(toF64(1)))
  two.setNum("y", toF64(3))
  t.eqI32("set keeps a paired name before an unpaired one", two.find("x"), 0)
  t.eqI32("set binds an unpaired name as a new one", two.find("y"), 1)
  t.eqI32("set leaves two pairs", toI32(two.vals.length), 2)
  t.ok("set binds the new name to its value", two.vals[1].n === toF64(3))

  const paired = new F64Env()
  paired.setNum("a", toF64(1))
  paired.setNum("b", toF64(2))
  paired.setNum("a", toF64(4))
  t.eqI32("set rebinds a paired name in place", toI32(paired.names.length), 2)
  t.ok("set rebinds to the new value", paired.vals[0].n === toF64(4))

  const extra = new F64Env()
  extra.names.push("p")
  extra.names.push("q")
  extra.vals.push(envNpNum(toF64(5)))
  const c = extra.copy()
  t.eqI32("copy leaves an unpaired name out", toI32(c.names.length), 1)
  t.eqI32("copy keeps the paired name", c.find("p"), 0)
  t.eqI32("copy drops the unpaired name", c.find("q"), -1)
  return t.done()
}
