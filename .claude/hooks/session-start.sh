#!/bin/bash
# SessionStart hook for Claude Code on the web: make the repo testable before
# the session begins — dependencies installed and a native z3 in .z3/ so
# `bun test` and the verify/fixture CLI paths work immediately.
set -euo pipefail

# Local sessions manage their own environment; only bootstrap remote ones.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

bun install

# Idempotent: skips nothing but re-runs are cheap (GitHub release download,
# pip fallback where github.com is unreachable).
if [ ! -x .z3/z3 ]; then
  bun run fetch-z3
fi
