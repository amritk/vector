#!/bin/bash
# Installs the pinned Nish compiler into .nish/, which `npm run build` and the
# test runner use. The pin is .nish-version, the file amritk/workflows' setup-nish
# reads too. NISH_VERSION overrides it for trying another release.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
version="${NISH_VERSION:-$(tr -d '[:space:]' < "$root/.nish-version")}"
dir="$root/.nish"

if [ -x "$dir/bin/nish" ] && [ "$("$dir/bin/nish" --version)" = "nish $version" ]; then
  echo "nish $version already in .nish/"
  exit 0
fi

# The installer comes from the same tag as the release, so it is pinned too.
curl -fsSL "https://raw.githubusercontent.com/amritk/nish/v$version/install.sh" |
  sh -s -- "$version" --dir "$dir" --force
"$dir/bin/nish" --version
