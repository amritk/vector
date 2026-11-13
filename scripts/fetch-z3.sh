#!/bin/bash
# Installs z3 into .z3/ (the `z3` executable and libz3) from the z3-solver
# wheel on PyPI, which ships a prebuilt z3 for the host. vector runs .z3/z3
# when $VECTOR_Z3 is unset.
set -euo pipefail

version="4.16.0"
root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/.z3"

if [ -x "$dir/z3" ] && "$dir/z3" --version | grep -q "Z3 version $version"; then
  echo "z3 $version already in .z3/"
  exit 0
fi

mkdir -p "$dir"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

# pip flakes on fresh containers and cold proxies, so retry with a backoff.
for attempt in 1 2 3; do
  if pip3 install --quiet --target "$staging" "z3-solver==$version"; then
    break
  fi
  if [ "$attempt" = 3 ]; then
    echo "fetch-z3: pip install z3-solver==$version failed" >&2
    exit 1
  fi
  sleep $((2 * attempt))
done

bin="$(find "$staging" -type f -name z3 | head -n 1)"
if [ -z "$bin" ]; then
  echo "fetch-z3: no z3 executable in the z3-solver wheel" >&2
  exit 1
fi
cp "$bin" "$dir/z3"
chmod +x "$dir/z3"
find "$staging" -type f \( -name 'libz3.so' -o -name 'libz3.so.*' -o -name 'libz3.dylib' \) \
  -exec cp {} "$dir/" \;
"$dir/z3" --version
