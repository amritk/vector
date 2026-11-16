"""A broken vector/core/hex in Python: sha256_hex writes uppercase digits once
it is fed a 64-character text, as a chain feeds it its own digest. The first
step of a chain is right; `vector spec run` finds the 1,000-step chain
VIOLATED."""

import hashlib


def to_hex(data):
    """The bytes as lowercase hex."""
    return bytes(data).hex()


def sha256_hex(text):
    """The SHA-256 of the text's UTF-8 bytes, wrongly uppercase for a
    64-character text."""
    digest = hashlib.sha256(text.encode("utf-8", "surrogateescape")).hexdigest()
    return digest.upper() if len(text) == 64 else digest
