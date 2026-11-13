#!/bin/bash
# Installs the pinned Nish compiler into .nish/, which `npm run build` and the
# test runner use. NISH_VERSION overrides the pin for trying another release.
set -euo pipefail

version="${NISH_VERSION:-0.39.0}"
root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/.nish"

if [ -x "$dir/bin/nish" ] && [ "$("$dir/bin/nish" --version)" = "nish $version" ]; then
  echo "nish $version already in .nish/"
  exit 0
fi

curl -fsSL https://raw.githubusercontent.com/amritk/nish/main/install.sh |
  sh -s -- "$version" --dir "$dir" --force
"$dir/bin/nish" --version
