"""A broken order/read: every function gets the byte order or the mask wrong,
so `vector spec run --lang python` finds each byte-order-read clause VIOLATED."""


def varint62(b):
    """Eight bytes big-endian, top two bits kept, wrongly."""
    return int.from_bytes(bytes(b), "big")


def read_le_i32(b):
    """Four bytes as a signed integer, wrongly big-endian."""
    return int.from_bytes(bytes(b), "big", signed=True)


def read_be_u16(b):
    """Two bytes as an unsigned integer, wrongly little-endian."""
    return int.from_bytes(bytes(b), "little")


def put_be32(n):
    """A u32 as four bytes, wrongly little-endian."""
    return (n & 0xFFFFFFFF).to_bytes(4, "little")


def put_le64(n):
    """An i64 as eight bytes in two's complement, wrongly big-endian."""
    return (n & 0xFFFFFFFFFFFFFFFF).to_bytes(8, "big")


def id_u32(n):
    """n with its low bit wrongly flipped: a u32 parameter that takes an i32 read."""
    return n ^ 1


def id_u16(n):
    """n with its low bit wrongly flipped: a u16 parameter that takes a u16 read."""
    return n ^ 1


def id_i32(n):
    """n with its low bit wrongly flipped: a i32 parameter that takes a i32 read."""
    return n ^ 1


def id_u64(n):
    """n with its low bit wrongly flipped: a u64 parameter that takes a u64 read."""
    return n ^ 1


def id_i64(n):
    """n with its low bit wrongly flipped: a i64 parameter that takes a i64 read."""
    return n ^ 1
