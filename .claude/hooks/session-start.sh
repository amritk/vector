#!/bin/bash
# Cloud sessions start from a bare clone. This installs what the repo's gates
# need (the pinned nish compiler, the pinned z3, an LLVM toolchain for
# `nish --link`, and the npm dev tools), then puts nish and z3 on the
# session's PATH, so a session runs `npm run build`, `npm test`, `npm run
# lint` and `npm run tested-exports` instead of guessing at them. Local
# sessions are left alone.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$(dirname "$(dirname "$(readlink -f "$0")")")")}" || exit 0

say() { echo "session-start: $*" >&2; }

# nish links with clang and lld (LLVM 15 or newer; 18 is what CI uses).
if ! command -v clang >/dev/null 2>&1 || ! command -v ld.lld >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    sudo_cmd=""
    [ "$(id -u)" -ne 0 ] && sudo_cmd="sudo"
    $sudo_cmd apt-get install -y clang-18 lld-18 llvm-18 >/dev/null 2>&1 ||
      ($sudo_cmd apt-get update >/dev/null 2>&1 && $sudo_cmd apt-get install -y clang-18 lld-18 llvm-18 >/dev/null 2>&1) ||
      say "could not install clang-18/lld-18; npm run build will fail to link"
    mkdir -p "$HOME/.local/llvm-bin"
    for t in clang llc opt ld.lld; do
      [ -x "/usr/bin/$t-18" ] && ln -sf "/usr/bin/$t-18" "$HOME/.local/llvm-bin/$t"
    done
    export PATH="$HOME/.local/llvm-bin:$PATH"
  else
    say "clang or ld.lld is missing and there is no apt-get; install LLVM 18 to build"
  fi
fi

bash scripts/fetch-nish.sh || say "fetching the pinned nish failed; npm run build and npm test need it"
bash scripts/fetch-z3.sh || say "fetching the pinned z3 failed; set VECTOR_Z3 or put z3 on PATH"
npm ci --no-audit --no-fund >/dev/null 2>&1 || say "npm ci failed; npm run lint needs biome"

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export PATH=\"$PWD/.nish/bin:$PWD/.z3:$HOME/.local/llvm-bin:\$PATH\""
  } >> "$CLAUDE_ENV_FILE"
  # Only a z3 that is there: vector refuses a VECTOR_Z3 naming a missing file,
  # while unset falls back to .z3/ beside the binary and then PATH.
  if [ -x "$PWD/.z3/z3" ]; then
    echo "export VECTOR_Z3=\"$PWD/.z3/z3\"" >> "$CLAUDE_ENV_FILE"
  fi
fi
exit 0
