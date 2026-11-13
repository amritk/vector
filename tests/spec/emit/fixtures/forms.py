"""nish/forms in Python: the module tests/spec/emit/fixtures/forms.json's
Python test runs against, as forms.ts is for its Nish test. A form the
Python emitter writes wrong fails that test."""


def id_i32(x):
    """x as it is."""
    return x


def add_i64(a, b):
    """a + b, wrapping to 64 bits."""
    s = (a + b) & 0xFFFFFFFFFFFFFFFF
    return s - (1 << 64) if s >= 1 << 63 else s


def _i32(x):
    """x wrapped to 32 bits, two's complement."""
    s = x & 0xFFFFFFFF
    return s - (1 << 32) if s >= 1 << 31 else s


def add_i32(a, b):
    """a + b, wrapping to 32 bits."""
    return _i32(a + b)


def sub_i32(a, b):
    """a - b, wrapping to 32 bits."""
    return _i32(a - b)


def mul_i32(a, b):
    """a * b, wrapping to 32 bits."""
    return _i32(a * b)


def le_bytes(x):
    """x sign-extended to 64 bits, as 8 little-endian bytes."""
    return (x & 0xFFFFFFFFFFFFFFFF).to_bytes(8, "little")


def xor_b(a, b):
    """a XOR b, as long as the shorter; a bytearray, which the test takes as bytes."""
    return bytearray(x ^ y for x, y in zip(a, b))


def non_empty(s):
    """s, or None when it is empty."""
    return s if s else None


def non_empty_b(a):
    """a, or None when it is empty."""
    return a if a else None


def half(x):
    """Half of x."""
    return x / 2


def is_max(x):
    """Whether x is the largest u64."""
    return x == (1 << 64) - 1


def keep(k, u):
    """A copy of k; None when u is empty."""
    return None if len(u) == 0 else bytes(k)


def keep_base(k):
    """k, or None when there is none."""
    return None if k is None else bytes(k)
