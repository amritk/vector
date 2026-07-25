import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { deflateRawSync } from "node:zlib";
import {
  extractZipEntries,
  isWantedZ3File,
  pickZ3Asset,
} from "../scripts/fetch-z3-lib.ts";

// The fetch-z3 helpers: release-asset selection across platforms and the
// minimal zip reader (stored + deflate entries), with zips built in-memory.

const asset = (name: string) => ({
  name,
  browser_download_url: `https://example.invalid/${name}`,
});

// Shaped like the real z3-4.16.0 release asset list.
const RELEASE_ASSETS = [
  asset("z3-4.16.0-arm64-glibc-2.34.zip"),
  asset("z3-4.16.0-arm64-osx-13.7.6.zip"),
  asset("z3-4.16.0-arm64-win.zip"),
  asset("z3-4.16.0-x64-glibc-2.39.zip"),
  asset("z3-4.16.0-x64-osx-13.7.6.zip"),
  asset("z3-4.16.0-x64-win.zip"),
  asset("z3-4.16.0-x86-win.zip"),
];

describe("pickZ3Asset", () => {
  test("matches arch + os family despite drifting suffixes", () => {
    expect(pickZ3Asset(RELEASE_ASSETS, "linux", "x64")?.name).toBe(
      "z3-4.16.0-x64-glibc-2.39.zip",
    );
    expect(pickZ3Asset(RELEASE_ASSETS, "darwin", "arm64")?.name).toBe(
      "z3-4.16.0-arm64-osx-13.7.6.zip",
    );
    expect(pickZ3Asset(RELEASE_ASSETS, "win32", "x64")?.name).toBe(
      "z3-4.16.0-x64-win.zip",
    );
  });

  test("returns undefined for unsupported platforms", () => {
    expect(pickZ3Asset(RELEASE_ASSETS, "freebsd", "x64")).toBeUndefined();
    expect(pickZ3Asset(RELEASE_ASSETS, "linux", "ia32")).toBeUndefined();
    expect(pickZ3Asset([], "linux", "x64")).toBeUndefined();
  });
});

describe("isWantedZ3File", () => {
  test("keeps the executable and shared libraries, drops the rest", () => {
    expect(isWantedZ3File("z3-4.16.0-x64-glibc-2.39/bin/z3")).toBe(true);
    expect(isWantedZ3File("z3/bin/z3.exe")).toBe(true);
    expect(isWantedZ3File("z3/bin/libz3.so")).toBe(true);
    expect(isWantedZ3File("z3/bin/libz3.so.4.16")).toBe(true);
    expect(isWantedZ3File("z3/bin/libz3.dylib")).toBe(true);
    expect(isWantedZ3File("z3/bin/libz3.dll")).toBe(true);
    expect(isWantedZ3File("z3/bin/libz3.a")).toBe(false);
    expect(isWantedZ3File("z3/include/z3.h")).toBe(false);
    expect(isWantedZ3File("z3/bin/python/z3/z3.py")).toBe(false);
  });
});

// Build a real (minimal) zip: local headers + central directory + EOCD.
interface ZipEntry {
  name: string;
  data: Buffer;
  method: 0 | 8;
}

function buildZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const payload = e.method === 8 ? deflateRawSync(e.data) : e.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(e.method, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(e.method, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + payload.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

describe("extractZipEntries", () => {
  test("extracts stored and deflated entries the filter accepts", () => {
    const zip = buildZip([
      { name: "z3/bin/z3", data: Buffer.from("ELF-fake-z3"), method: 8 },
      { name: "z3/bin/libz3.so", data: Buffer.from("fake-lib"), method: 0 },
      { name: "z3/include/z3.h", data: Buffer.from("header"), method: 8 },
    ]);
    const files = extractZipEntries(zip, isWantedZ3File);
    expect([...files.keys()].sort()).toEqual(["libz3.so", "z3"]);
    expect(files.get("z3")?.toString()).toBe("ELF-fake-z3");
    expect(files.get("libz3.so")?.toString()).toBe("fake-lib");
  });

  test("rejects non-zip input", () => {
    expect(() =>
      extractZipEntries(Buffer.from("not a zip at all"), () => true),
    ).toThrow("not a zip");
  });

  test("rejects unsupported compression methods", () => {
    const zip = buildZip([
      { name: "bin/z3", data: Buffer.from("x"), method: 0 },
    ]);
    // Patch the central directory's method field to 99 (12 = bzip2 etc.).
    const cdOffset = zip.readUInt32LE(zip.length - 22 + 16);
    zip.writeUInt16LE(99, cdOffset + 10);
    expect(() => extractZipEntries(zip, () => true)).toThrow(
      "unsupported zip compression method",
    );
  });
});
