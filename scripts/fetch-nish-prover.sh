#!/bin/bash
# Installs the pinned Nish prover into .nish-prover/. It is a second, newer nish
# than the compiler in .nish/: it only checks the tests vector emits (it refuses
# an unproven panic site), because vector itself cannot build under it yet. The
# pin is .nish-prover-version. NISH_PROVER_VERSION overrides it.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
version="${NISH_PROVER_VERSION:-$(tr -d '[:space:]' < "$root/.nish-prover-version")}"
dir="$root/.nish-prover"

if [ -x "$dir/bin/nish" ] && [ "$("$dir/bin/nish" --version)" = "nish $version" ]; then
  echo "nish $version already in .nish-prover/"
  exit 0
fi

# The installer comes from the same tag as the release, so it is pinned too.
curl -fsSL "https://raw.githubusercontent.com/amritk/nish/v$version/install.sh" |
  sh -s -- "$version" --dir "$dir" --force
"$dir/bin/nish" --version
