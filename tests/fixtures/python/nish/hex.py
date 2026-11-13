"""nish/hex in Python: the port `vector spec run --lang python` checks against
contracts/example-hex.json."""

_DIGITS = "0123456789abcdefABCDEF"


def hex_encode(data):
    """The bytes as lowercase hex, high nibble first."""
    return bytes(data).hex()


def hex_decode(text):
    """The bytes an even-length run of hex digits spells, in any case; None for anything else."""
    if len(text) % 2 != 0 or any(c not in _DIGITS for c in text):
        return None
    return bytes.fromhex(text)
