import { Suite } from "nish/testing"
import { fromHex, sha256Hex, toHex, utf8Bytes } from "../../src/core/hex"

export const main = (): i32 => {
  const t = new Suite("core/hex")
  const none: u8[] = []
  t.eqStr("toHex", toHex([0, 15, 16, 255]), "000f10ff")
  t.eqStr("toHex empty", toHex(none), "")
  const back = fromHex("000F10ff")
  t.ok("fromHex ok", back.isOk())
  t.eqStr("fromHex round trip", toHex(back.unwrapOr(none)), "000f10ff")
  t.ok("fromHex odd", fromHex("abc").isErr())
  t.ok("fromHex bad digit", fromHex("0g").isErr())
  t.eqI32("utf8Bytes length", toI32(utf8Bytes("é").length), 2)
  t.eqStr("sha256Hex abc", sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  return t.done()
}
