"""order/read in Python: integers read from and written to bytes, the module
the byte-order-read contract checks against vector's read and write ops."""


def varint62(b):
    """Eight bytes big-endian, top two bits cleared."""
    return int.from_bytes(bytes(b), "big") & ((1 << 62) - 1)


def read_le_i32(b):
    """Four bytes as a signed integer, little-endian."""
    return int.from_bytes(bytes(b), "little", signed=True)


def read_be_u16(b):
    """Two bytes as an unsigned integer, big-endian."""
    return int.from_bytes(bytes(b), "big")


def put_be32(n):
    """A u32 as four bytes, big-endian."""
    return (n & 0xFFFFFFFF).to_bytes(4, "big")


def put_le64(n):
    """An i64 as eight bytes in two's complement, little-endian."""
    return (n & 0xFFFFFFFFFFFFFFFF).to_bytes(8, "little")


def id_u32(n):
    """n unchanged: a u32 parameter that takes an i32 read."""
    return n


def id_u16(n):
    """n unchanged: a u16 parameter that takes a u16 read."""
    return n


def id_i32(n):
    """n unchanged: a i32 parameter that takes a i32 read."""
    return n


def id_u64(n):
    """n unchanged: a u64 parameter that takes a u64 read."""
    return n


def id_i64(n):
    """n unchanged: a i64 parameter that takes a i64 read."""
    return n
