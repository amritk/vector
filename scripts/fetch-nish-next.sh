#!/bin/bash
# Installs the next Nish compiler into .nish-next/, which `npm run panics`
# (scripts/panics.mjs) uses to count the panic sites that compiler cannot prove
# away. The pin is .nish-next-version; the build and the tests keep using the
# compiler in .nish/, pinned by .nish-version (scripts/fetch-nish.sh).
# NISH_NEXT_VERSION overrides the pin for trying another release.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
version="${NISH_NEXT_VERSION:-$(tr -d '[:space:]' < "$root/.nish-next-version")}"
dir="$root/.nish-next"

if [ -x "$dir/bin/nish" ] && [ "$("$dir/bin/nish" --version)" = "nish $version" ]; then
  echo "nish $version already in .nish-next/"
  exit 0
fi

# The installer comes from the same tag as the release, so it is pinned too.
curl -fsSL "https://raw.githubusercontent.com/amritk/nish/v$version/install.sh" |
  sh -s -- "$version" --dir "$dir" --force --no-modify-path
"$dir/bin/nish" --version
