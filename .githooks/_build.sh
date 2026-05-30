#!/bin/sh
# Shared helper: rebuild dist when TypeScript sources may have changed.
# Sourced by post-merge and post-checkout hooks so dist never drifts from src.
#
# The locallama-dev MCP server runs `node dist/index.js`, so a stale dist means
# the running server serves old code until rebuilt + reconnected (/mcp).
# These hooks keep dist current automatically; the MCP process still needs a
# manual reconnect to load the new build.

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$repo_root" || exit 0

# Skip if no build script or no node_modules yet (e.g. fresh clone pre-install).
[ -f package.json ] || exit 0
[ -d node_modules ] || { echo "[githook] skip build: run 'npm install' first"; exit 0; }

echo "[githook] rebuilding dist (tsc)..."
if npm run build >/tmp/locallama-githook-build.log 2>&1; then
  echo "[githook] dist rebuilt. Reconnect the locallama-dev MCP (/mcp) to load it."
else
  echo "[githook] BUILD FAILED — dist may be stale. See /tmp/locallama-githook-build.log"
  exit 0   # never block the git operation on a build failure
fi
