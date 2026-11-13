"""nish/crypto/hmac in Python, by the standard library."""

import hashlib
import hmac as _hmac


def hmac_sha256(key, data):
    """HMAC-SHA-256 of data under key (RFC 2104)."""
    return _hmac.new(bytes(key), bytes(data), hashlib.sha256).digest()
