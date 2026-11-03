#!/bin/bash
# Cloud sessions start from a bare clone. This installs what `bun test`,
# `bun run coverage` and the live nish tests need, so a session can run the
# repo's gates instead of guessing at them. Local sessions are left alone.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$(dirname "$(dirname "$(readlink -f "$0")")")")}"

bun install --frozen-lockfile
[ -x .z3/z3 ] || bun run fetch-z3

# nish sits beside vector (../nish): `vector rfc` emits tests for nish's std,
# and the live tests run them with a nish binary. It is a public repo, so an
# anonymous shallow clone works without nish being attached to the session.
nish_dir="$(dirname "$PWD")/nish"
if [ ! -d "$nish_dir/.git" ]; then
  GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/amritk/nish "$nish_dir" ||
    echo "session-start: could not clone amritk/nish into $nish_dir"
fi

# The seed is nish's last release, downloaded from GitHub releases. That
# download needs nish attached to the session; when it fails, say so plainly:
# the live tests then skip, and a skipped test is not a passing one.
nish_bin="$nish_dir/build/seed/bin/nish"
if [ -d "$nish_dir" ] && [ ! -x "$nish_bin" ]; then
  (cd "$nish_dir" && timeout 120 bash scripts/fetch-seed.sh) ||
    echo "session-start: nish seed download failed; VECTOR_NISH is unset and the live nish tests will skip"
fi
if [ -x "$nish_bin" ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export VECTOR_NISH=\"$nish_bin\"" >> "$CLAUDE_ENV_FILE"
fi
exit 0
