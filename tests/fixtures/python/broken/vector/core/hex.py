"""A broken vector/core/hex in Python: uppercase digits. `vector spec run
--lang python` must find it VIOLATED."""

import hashlib


def to_hex(data):
    """The bytes as hex, but in uppercase: R-HEX-DIGITS forbids it."""
    return bytes(data).hex().upper()


def sha256_hex(text):
    """The SHA-256 of the text's UTF-8 bytes, as lowercase hex."""
    return hashlib.sha256(text.encode("utf-8", "surrogateescape")).hexdigest()
