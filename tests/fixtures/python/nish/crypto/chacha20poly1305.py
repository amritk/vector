"""nish/crypto/chacha20poly1305 in Python: the port `vector spec run --lang
python` checks against contracts/rfc8439-chacha20-poly1305.json, written out
from RFC 8439 §2."""

import hmac as _hmac
import struct

_MASK = 0xFFFFFFFF


def _rotl(x, n):
    return ((x << n) & _MASK) | (x >> (32 - n))


def _quarter(s, a, b, c, d):
    s[a] = (s[a] + s[b]) & _MASK
    s[d] = _rotl(s[d] ^ s[a], 16)
    s[c] = (s[c] + s[d]) & _MASK
    s[b] = _rotl(s[b] ^ s[c], 12)
    s[a] = (s[a] + s[b]) & _MASK
    s[d] = _rotl(s[d] ^ s[a], 8)
    s[c] = (s[c] + s[d]) & _MASK
    s[b] = _rotl(s[b] ^ s[c], 7)


def _block(key, counter, nonce):
    init = [0x61707865, 0x3320646E, 0x79622D32, 0x6B206574]
    init += list(struct.unpack("<8I", key)) + [counter & _MASK] + list(struct.unpack("<3I", nonce))
    s = list(init)
    for _ in range(10):
        _quarter(s, 0, 4, 8, 12)
        _quarter(s, 1, 5, 9, 13)
        _quarter(s, 2, 6, 10, 14)
        _quarter(s, 3, 7, 11, 15)
        _quarter(s, 0, 5, 10, 15)
        _quarter(s, 1, 6, 11, 12)
        _quarter(s, 2, 7, 8, 13)
        _quarter(s, 3, 4, 9, 14)
    return struct.pack("<16I", *[(x + y) & _MASK for x, y in zip(s, init)])


def _sizes_ok(key, nonce):
    return len(key) == 32 and len(nonce) == 12


def chacha20_block(key, counter, nonce):
    """The 64-byte block for (key, counter, nonce); None for a bad key or nonce size."""
    if not _sizes_ok(key, nonce):
        return None
    return _block(bytes(key), counter, bytes(nonce))


def chacha20(key, counter, nonce, data):
    """data XORed with the keystream from block counter on."""
    if not _sizes_ok(key, nonce):
        return None
    out = bytearray()
    for at in range(0, len(data), 64):
        ks = _block(bytes(key), counter + at // 64, bytes(nonce))
        out += bytes(x ^ y for x, y in zip(data[at : at + 64], ks))
    return bytes(out)


def poly1305(key, msg):
    """The 16-byte Poly1305 tag of msg under a 32-byte one-time key."""
    if len(key) != 32:
        return None
    r = int.from_bytes(key[:16], "little") & 0x0FFFFFFC0FFFFFFC0FFFFFFC0FFFFFFF
    s = int.from_bytes(key[16:], "little")
    p = (1 << 130) - 5
    acc = 0
    for at in range(0, len(msg), 16):
        n = int.from_bytes(bytes(msg[at : at + 16]) + b"\x01", "little")
        acc = (acc + n) * r % p
    return ((acc + s) & ((1 << 128) - 1)).to_bytes(16, "little")


def poly1305_key_gen(key, nonce):
    """The one-time key: the first 32 bytes of block 0."""
    if not _sizes_ok(key, nonce):
        return None
    return _block(bytes(key), 0, bytes(nonce))[:32]


def _pad16(b):
    return bytes(-len(b) % 16)


def _tag(otk, aad, ct):
    mac_data = aad + _pad16(aad) + ct + _pad16(ct) + struct.pack("<QQ", len(aad), len(ct))
    return poly1305(otk, mac_data)


def chacha20_poly1305_seal(key, nonce, aad, plaintext):
    """The ciphertext then its 16-byte tag; None for a bad key or nonce size."""
    if not _sizes_ok(key, nonce):
        return None
    ct = chacha20(key, 1, nonce, bytes(plaintext))
    return ct + _tag(poly1305_key_gen(key, nonce), bytes(aad), ct)


def chacha20_poly1305_open(key, nonce, aad, sealed):
    """The plaintext when the tag matches; None otherwise."""
    if not _sizes_ok(key, nonce) or len(sealed) < 16:
        return None
    ct, tag = bytes(sealed[:-16]), bytes(sealed[-16:])
    if not _hmac.compare_digest(_tag(poly1305_key_gen(key, nonce), bytes(aad), ct), tag):
        return None
    return chacha20(key, 1, nonce, ct)
