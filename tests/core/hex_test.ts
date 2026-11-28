import { Suite } from "nish/testing"
import { fromHex, hexRandom, sha256Hex, toHex, utf8Bytes } from "../../src/core/hex"

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
  hexRandomRows(t)
  return t.done()
}

/** `hexRandom`: its length for each count, its digits, and that draws differ and span every byte value's range. */
const hexRandomRows = (t: Suite): void => {
  const none: u8[] = []
  const lengths: i32[][] = [
    [-1, 0],
    [0, 0],
    [1, 2],
    [8, 16],
    [16, 32],
  ]
  for (const r of lengths) {
    const h = hexRandom(r[0])
    t.eqI32(`hexRandom(${r[0]}) is ${r[1]} digits`, h.length, r[1])
    t.ok(`hexRandom(${r[0]}) is lowercase hex`, toHex(fromHex(h).unwrapOr(none)) === h)
  }
  const seen: string[] = []
  let repeated = false
  for (let i = 0; i < 64; i++) {
    const h = hexRandom(8)
    if (seen.indexOf(h) >= 0) {
      repeated = true
    }
    seen.push(h)
  }
  t.ok("64 draws of hexRandom(8) differ", !repeated)
  const bytes = fromHex(hexRandom(512)).unwrapOr(none)
  let low: u8 = 255
  let high: u8 = 0
  for (const b of bytes) {
    low = b < low ? b : low
    high = b > high ? b : high
  }
  t.ok("512 bytes of hexRandom reach below 16 and above 239", bytes.length === 512 && low < 16 && high > 239)
}
