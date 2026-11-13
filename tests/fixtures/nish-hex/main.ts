// Smoke test for tests/fixtures/nish-hex/hex.ts against specs/example-hex.md:
// the spec's vectors V1–V9, then every byte through the round trip, every
// byte value in each digit position, odd lengths and mixed case. smoke.sh
// copies hex.ts into a scratch install as std/hex.ts and runs this file there.
import { hexDecode, hexEncode } from "nish/hex";
import { Suite } from "nish/testing";

/** `bytes` as a string, byte for byte. */
const smokeText = (bytes: u8[]): string =>
  String.fromBytes(bytes, 0, toI32(bytes.length));

/** The bytes of `s`. */
const smokeBytes = (s: string): u8[] => {
  const n: i32 = toI32(s.length);
  const out: u8[] = new Array<u8>(n);
  for (let i: i32 = 0; i < n; i++) {
    out[i] = toU8(toI32(s.charCodeAt(i)));
  }
  return out;
};

/** Whether `a` and `b` hold the same bytes. */
const smokeSame = (a: u8[], b: u8[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  for (let i: i32 = 0; i < toI32(a.length); i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
};

/** `s` with a-f raised to A-F. */
const smokeUpper = (s: string): string => {
  const b: u8[] = smokeBytes(s);
  for (let i: i32 = 0; i < toI32(b.length); i++) {
    const c: i32 = toI32(b[i]);
    if (c >= 97 && c <= 102) {
      b[i] = toU8(c - 32);
    }
  }
  return smokeText(b);
};

/** Pass when `hexDecode(text)` is exactly `expected`. */
const smokeDecodes = (
  t: Suite,
  name: string,
  text: string,
  expected: u8[],
): boolean => {
  const got = hexDecode(text);
  if (got === null) {
    return t.fail(name, `expected ${hexEncode(expected)}, got null`);
  }
  if (!smokeSame(got, expected)) {
    return t.fail(
      name,
      `expected ${hexEncode(expected)}, got ${hexEncode(got)}`,
    );
  }
  return t.pass(name);
};

/** Pass when `hexDecode(text)` is null. */
const smokeRefuses = (t: Suite, name: string, text: string): boolean => {
  const got = hexDecode(text);
  if (got === null) {
    return t.pass(name);
  }
  return t.fail(name, `expected null, got ${hexEncode(got)}`);
};

/** The nibble of a hex digit byte by the obvious branches, or -1. */
const smokeNibble = (c: i32): i32 => {
  if (c >= 48 && c <= 57) {
    return c - 48;
  }
  if (c >= 97 && c <= 102) {
    return c - 87;
  }
  if (c >= 65 && c <= 70) {
    return c - 55;
  }
  return -1;
};

export const main = (): number => {
  const t = new Suite("nish/hex smoke");

  // §6 test vectors.
  const empty: u8[] = [];
  smokeDecodes(t, 'V1 hexDecode("") is empty, not null', "", empty);
  smokeDecodes(t, 'V2 hexDecode("66") is "f"', "66", smokeBytes("f"));
  smokeDecodes(
    t,
    'V3 hexDecode("666F6F") is "foo"',
    "666F6F",
    smokeBytes("foo"),
  );
  smokeDecodes(
    t,
    'V4 hexDecode("666F6F626172") is "foobar"',
    "666F6F626172",
    smokeBytes("foobar"),
  );
  const v5: u8[] = [toU8(0), toU8(15), toU8(240), toU8(255)];
  t.eqStr("V5 hexEncode([00 0f f0 ff])", hexEncode(v5), "000ff0ff");
  const v6: u8[] = [toU8(171), toU8(205)];
  smokeDecodes(t, 'V6 hexDecode("aBcD") is [ab cd]', "aBcD", v6);
  smokeRefuses(t, 'V7 hexDecode("abc") is null (odd length)', "abc");
  smokeRefuses(t, 'V8 hexDecode("0x00") is null (prefix)', "0x00");
  smokeRefuses(t, 'V9 hexDecode("ab cd") is null (whitespace)', "ab cd");

  // The rest of RFC 4648 §10's BASE16 vectors, and their lowercase spelling.
  smokeDecodes(t, 'RFC 4648 §10 "fo"', "666F", smokeBytes("fo"));
  smokeDecodes(t, 'RFC 4648 §10 "foob"', "666F6F62", smokeBytes("foob"));
  smokeDecodes(t, 'RFC 4648 §10 "fooba"', "666F6F6261", smokeBytes("fooba"));
  t.eqStr(
    'hexEncode("foobar") is lowercase',
    hexEncode(smokeBytes("foobar")),
    "666f6f626172",
  );
  t.eqStr('hexEncode([]) is ""', hexEncode(empty), "");

  // §3 and §4.4: every byte value encodes to two lowercase digits, high nibble
  // first, and decodes back.
  const all: u8[] = new Array<u8>(256);
  let encodeBad = "";
  for (let b: i32 = 0; b < 256; b++) {
    all[b] = toU8(b);
    const one: u8[] = [toU8(b)];
    const s: string = hexEncode(one);
    const expected: string =
      "0123456789abcdef".substring(b >> 4, (b >> 4) + 1) +
      "0123456789abcdef".substring(b & 15, (b & 15) + 1);
    if (s !== expected && encodeBad === "") {
      encodeBad = `byte ${b}: expected ${expected}, got ${s}`;
    }
  }
  if (encodeBad === "") {
    t.pass("§3 every byte encodes to its two lowercase digits");
  } else {
    t.fail("§3 every byte encodes to its two lowercase digits", encodeBad);
  }
  const allHex: string = hexEncode(all);
  t.eqI32("§3.1 256 bytes encode to 512 characters", toI32(allHex.length), 512);
  smokeDecodes(t, "§4.4 round trip of all 256 byte values", allHex, all);
  const upperAll: string = smokeUpper(allHex);
  smokeDecodes(
    t,
    "§4.1 uppercase spelling of all 256 byte values",
    upperAll,
    all,
  );

  // §4.1 and §4.2: every byte value in the high and the low digit position,
  // against a branchy reference. Built with fromBytes so that a byte >= 128 is
  // one byte of text and the length stays even.
  let posBad = "";
  for (let c: i32 = 0; c < 256; c++) {
    const want: i32 = smokeNibble(c);
    const hiText: string = smokeText([toU8(c), toU8(48)]);
    const loText: string = smokeText([toU8(48), toU8(c)]);
    const hiGot = hexDecode(hiText);
    const loGot = hexDecode(loText);
    if (toI32(hiText.length) !== 2 || toI32(loText.length) !== 2) {
      if (posBad === "") {
        posBad = `byte ${c} did not make a two-byte text`;
      }
    } else if (want < 0) {
      if ((hiGot !== null || loGot !== null) && posBad === "") {
        posBad = `byte ${c} was accepted`;
      }
    } else {
      if (hiGot === null || loGot === null) {
        if (posBad === "") {
          posBad = `byte ${c} was refused`;
        }
      } else if (
        (toI32(hiGot[0]) !== want * 16 || toI32(loGot[0]) !== want) &&
        posBad === ""
      ) {
        posBad = `byte ${c} decoded wrong`;
      }
    }
  }
  if (posBad === "") {
    t.pass("§4.1/§4.2 every byte value in each digit position");
  } else {
    t.fail("§4.1/§4.2 every byte value in each digit position", posBad);
  }

  // §4.2: odd lengths, and invalid characters of each class anywhere.
  smokeRefuses(t, "§4.2 odd length 1", "a");
  smokeRefuses(t, "§4.2 odd length 5", "00112");
  smokeRefuses(t, '§4.2 "0X00" prefix', "0X00");
  smokeRefuses(t, "§4.2 tab", "ab\tc");
  smokeRefuses(t, "§4.2 newline", "abcd\n0");
  smokeRefuses(t, "§4.2 letter g", "0g");
  smokeRefuses(t, "§4.2 letter G", "G0");
  smokeRefuses(t, "§4.2 ':' just past '9'", "0:");
  smokeRefuses(t, "§4.2 '/' just before '0'", "/0");
  smokeRefuses(t, "§4.2 '@' just before 'A'", "@0");
  smokeRefuses(t, "§4.2 '`' just before 'a'", "`0");
  smokeRefuses(t, "§4.2 a bad character after good ones", "00112233z0");
  smokeRefuses(t, "§4.2 NUL", smokeText([toU8(48), toU8(0)]));
  smokeRefuses(t, "§4.2 byte 0xff", smokeText([toU8(255), toU8(48)]));
  smokeRefuses(t, "§4.2 separator ':'", "ab:cd");
  smokeRefuses(t, "§4.2 separator '-'", "ab-c");

  // §4.1: mixed case.
  const dead: u8[] = [toU8(222), toU8(173), toU8(190), toU8(239)];
  smokeDecodes(t, '§4.1 "DeAdBeEf"', "DeAdBeEf", dead);
  smokeDecodes(t, '§4.1 "deadBEEF"', "deadBEEF", dead);
  t.eqStr("§3.2 hexEncode(deadbeef) is lowercase", hexEncode(dead), "deadbeef");

  return t.done();
};
