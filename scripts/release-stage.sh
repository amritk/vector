#!/bin/bash
# The release's stage hook (`.github/workflows/release.yml`): puts the pinned
# z3 beside the vector binary in $STAGE, at `.z3/z3`, where vector looks for
# it first after $VECTOR_Z3 (src/core/z3.ts), so a release runs its own z3.
set -euo pipefail

: "${STAGE:?STAGE is the release directory to fill}"
root="$(cd "$(dirname "$0")/.." && pwd)"

bash "$root/scripts/fetch-z3.sh"
mkdir -p "$STAGE/.z3"
cp "$root/.z3/z3" "$STAGE/.z3/z3"
chmod +x "$STAGE/.z3/z3"
# The Linux wheel's z3 is self-contained; a macOS one may load libz3 beside
# it. Carry whatever it names, and nothing it does not.
case "$(uname -s)" in
  Darwin)
    if otool -L "$STAGE/.z3/z3" | grep -q libz3; then
      cp "$root"/.z3/libz3*.dylib "$STAGE/.z3/"
    fi
    ;;
  Linux)
    if ldd "$STAGE/.z3/z3" | grep -q libz3; then
      cp -P "$root"/.z3/libz3.so* "$STAGE/.z3/"
    fi
    ;;
esac
"$STAGE/.z3/z3" --version
