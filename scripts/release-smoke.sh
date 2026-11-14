#!/bin/bash
# The release's smoke hook (`.github/workflows/release.yml`): runs a real
# proof through $BIN, a vector installed from a release tarball or from npm,
# and checks it used the z3 the release bundles rather than one on PATH.
set -euo pipefail

: "${BIN:?BIN is the vector to smoke}"
: "${REPO:?REPO is the checkout, for its fixtures}"
fixture="$REPO/tests/fixtures/currency.json"

out="$(env -u VECTOR_Z3 "$BIN" diff "$fixture" "$fixture")"
printf '%s\n' "$out"
want="Z3 $(sed -n 's/^version="\(.*\)"$/\1/p' "$REPO/scripts/fetch-z3.sh")"
printf '%s\n' "$out" | grep -q "Solver: $want" || {
  echo "::error::$BIN did not run the bundled $want"
  exit 1
}
printf '%s\n' "$out" | grep -q "Status: EQUIVALENT" || {
  echo "::error::$BIN did not prove the fixture equivalent to itself"
  exit 1
}
