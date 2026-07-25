// Pure helpers behind `bun run fetch-z3`, split out so they can be unit
// tested: picking the right Z3Prover/z3 release asset for the host platform,
// and extracting members from its zip without any system `unzip`/python —
// zip entries are raw-deflate, which node:zlib decodes.
import { Buffer } from "node:buffer";
import { inflateRawSync } from "node:zlib";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

// Z3 release assets embed a build-environment suffix that drifts between
// releases (x64-glibc-2.39, arm64-osx-13.7.6, x64-win, ...), so match on the
// stable `<arch>-<os-family>` core instead of a full name.
const OS_TOKEN: Partial<Record<NodeJS.Platform, string>> = {
  linux: "glibc",
  darwin: "osx",
  win32: "win",
};

export function pickZ3Asset(
  assets: ReleaseAsset[],
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): ReleaseAsset | undefined {
  const os = OS_TOKEN[platform];
  if (!os || (arch !== "x64" && arch !== "arm64")) return undefined;
  return assets.find(
    (a) => a.name.includes(`-${arch}-${os}`) && a.name.endsWith(".zip"),
  );
}

/** The two files the solver needs: the executable and its shared library. */
export function isWantedZ3File(entryName: string): boolean {
  const base = entryName.split("/").pop() ?? "";
  return (
    base === "z3" ||
    base === "z3.exe" ||
    base === "libz3.so" ||
    base.startsWith("libz3.so.") ||
    base === "libz3.dylib" ||
    base === "libz3.dll"
  );
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/**
 * Minimal zip reader: walks the central directory and inflates the entries
 * `want` accepts, keyed by their basename. Supports stored (0) and deflate
 * (8) entries — everything z3 release zips use. No zip64 (z3 zips are ~40 MB).
 */
export function extractZipEntries(
  zip: Uint8Array,
  want: (name: string) => boolean,
): Map<string, Buffer> {
  const buf = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  const scanFloor = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= scanFloor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file (no end-of-central-directory)");

  const entryCount = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();

  for (let n = 0; n < entryCount; n++) {
    if (buf.readUInt32LE(offset) !== CENTRAL_SIG) {
      throw new Error("corrupt zip: bad central directory entry");
    }
    const method = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;

    if (!want(name) || name.endsWith("/")) continue;
    if (buf.readUInt32LE(localOffset) !== LOCAL_SIG) {
      throw new Error(`corrupt zip: bad local header for ${name}`);
    }
    // Local-header name/extra lengths can differ from the central ones.
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);

    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else
      throw new Error(`unsupported zip compression method ${method} (${name})`);

    const base = name.split("/").pop() ?? name;
    out.set(base, data);
  }
  return out;
}
