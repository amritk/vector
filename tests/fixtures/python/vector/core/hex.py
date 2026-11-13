"""vector/core/hex in Python: the port `vector spec run --lang python` checks
against contracts/vector-core-hex.json."""

import hashlib


def to_hex(data):
    """The bytes as lowercase hex, two digits each."""
    return bytes(data).hex()


def sha256_hex(text):
    """The SHA-256 of the text's UTF-8 bytes, as lowercase hex."""
    return hashlib.sha256(text.encode("utf-8", "surrogateescape")).hexdigest()
