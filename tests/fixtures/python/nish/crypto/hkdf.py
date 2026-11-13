"""nish/crypto/hkdf in Python: the port `vector spec run --lang python` checks
against contracts/rfc5869-hkdf-sha256.json, written out from RFC 5869 §2."""

import hashlib
import hmac as _hmac

_HASH_LEN = 32


def _mac(key, data):
    return _hmac.new(key, data, hashlib.sha256).digest()


def hkdf_extract_sha256(salt, ikm):
    """PRK = HMAC-Hash(salt, IKM); an empty salt is HashLen zeros."""
    return _mac(bytes(salt) or bytes(_HASH_LEN), bytes(ikm))


def hkdf_expand_sha256(prk, info, length):
    """The first length octets of T(1) | T(2) | ...; None past 255 * HashLen or below 0."""
    if length < 0 or length > 255 * _HASH_LEN:
        return None
    okm = b""
    t = b""
    i = 1
    while len(okm) < length:
        t = _mac(bytes(prk), t + bytes(info) + bytes([i]))
        okm += t
        i += 1
    return okm[:length]
