#!/usr/bin/env bash
# Smoke test for the nish/hex reference implementation (specs/example-hex.md).
#
# Builds a scratch nish install — a copy of the seed whose std/ is ../nish/std
# plus hex.ts as std/hex.ts — runs main.ts (a nish/testing program over V1–V9
# and more) under it, and checks the V5/V6 python commands against the
# expected values. Exits non-zero on any failure, and when nish, its std
# sources or python3 are missing: a gate that cannot run is a failure.
#
#   VECTOR_NISH   the seed's bin/nish (default: <repo>/../nish/build/seed/bin/nish)
#   NISH_SRC      a nish checkout whose std/ is used (default: <repo>/../nish)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
nish_bin="${VECTOR_NISH:-$repo/../nish/build/seed/bin/nish}"
nish_src="${NISH_SRC:-$repo/../nish}"

fail() {
  echo "smoke: $*" >&2
  exit 1
}

[ -x "$nish_bin" ] || fail "no nish at $nish_bin (set VECTOR_NISH)"
seed="$(cd "$(dirname "$nish_bin")/.." && pwd)"
[ -x "$seed/libexec/nish" ] || fail "no $seed/libexec/nish: $nish_bin is not a seed install"
[ -d "$nish_src/std" ] || fail "no nish std sources at $nish_src/std (set NISH_SRC)"
command -v python3 >/dev/null || fail "python3 is missing (V5/V6 sources)"

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

# The scratch install: the seed, with std/ replaced by the checkout's plus
# hex.ts (over any std/hex.ts the checkout has, so the fixture is what runs).
cp -R "$seed" "$scratch/install"
rm -rf "$scratch/install/std"
cp -R "$nish_src/std" "$scratch/install/std"
cp "$here/hex.ts" "$scratch/install/std/hex.ts"
cp "$here/main.ts" "$scratch/main.ts"

status=0

# V5 and V6 cite python3 as their source: check that it agrees with the spec.
check_python() {
  local id="$1" expected="$2" code="$3" got
  if ! got="$(python3 -c "$code")"; then
    echo "FAIL  $id python source: python3 exited non-zero"
    status=1
  elif [ "$got" != "$expected" ]; then
    echo "FAIL  $id python source"
    echo "      expected $expected, got $got"
    status=1
  else
    echo "PASS  $id python source: $got"
  fi
}
check_python V5 000ff0ff 'print(bytes([0,15,240,255]).hex())'
check_python V6 abcd 'print(bytes.fromhex("aBcD").hex())'

# nish run's exit status is the suite's verdict (Suite.done()).
if ! (cd "$scratch" && "$scratch/install/libexec/nish" run main.ts); then
  echo "FAIL  nish/hex suite (nish run exited non-zero)"
  status=1
fi

if [ "$status" -ne 0 ]; then
  echo "smoke: FAILED" >&2
else
  echo "smoke: ok"
fi
exit "$status"
