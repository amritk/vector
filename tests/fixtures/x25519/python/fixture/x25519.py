"""The X25519 function of RFC 7748 Section 5, in plain Python: a stand-in
module for vector's Python emitter, which passes a Secret<u8[]> parameter as
bytes. Not constant time; a test fixture only."""

P = 2**255 - 19
A24 = 121665


def _clamp(k):
    b = bytearray(k)
    b[0] &= 248
    b[31] &= 127
    b[31] |= 64
    return int.from_bytes(b, "little")


def _ladder(k, u):
    x1, x2, z2, x3, z3, swap = u, 1, 0, u, 1, 0
    for t in reversed(range(255)):
        bit = (k >> t) & 1
        swap ^= bit
        if swap:
            x2, x3, z2, z3 = x3, x2, z3, z2
        swap = bit
        a, b = (x2 + z2) % P, (x2 - z2) % P
        aa, bb = a * a % P, b * b % P
        e = (aa - bb) % P
        c, d = (x3 + z3) % P, (x3 - z3) % P
        da, cb = d * a % P, c * b % P
        x3, z3 = (da + cb) ** 2 % P, x1 * (da - cb) ** 2 % P
        x2, z2 = aa * bb % P, e * (aa + A24 * e) % P
    if swap:
        x2, z2 = x3, z3
    return x2 * pow(z2, P - 2, P) % P


def x25519(scalar, u):
    if len(scalar) != 32 or len(u) != 32:
        return None
    ub = bytearray(u)
    ub[31] &= 127
    return _ladder(_clamp(scalar), int.from_bytes(ub, "little") % P).to_bytes(32, "little")


def x25519_base(scalar):
    return x25519(scalar, bytes([9]) + bytes(31))
