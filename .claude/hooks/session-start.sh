#!/bin/bash
# SessionStart hook for Claude Code on the web.
# Synchronous, idempotent: installs deps so lint/typecheck/tests work
# immediately. Only runs in a remote (web) session.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR"

# `npm install` (not `npm ci`) so a cached container layer's node_modules is
# reused and only updated, rather than wiped and reinstalled from scratch.
npm install

# This container's pre-installed Playwright browsers (/opt/pw-browsers) are
# chromium/chromium-headless-shell revision 1194, one major revision behind
# what the pinned @playwright/test in package.json expects (1234). Point
# Playwright at the installed browsers and stop it from trying (and failing,
# or hanging on a large download) to fetch a matching one during npm install.
# test:e2e will still not run correctly here — see CLAUDE.md — but
# test:unit and test:integration are unaffected.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  grep -qxF 'export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers' "$CLAUDE_ENV_FILE" 2>/dev/null || \
    echo 'export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers' >> "$CLAUDE_ENV_FILE"
  grep -qxF 'export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1' "$CLAUDE_ENV_FILE" 2>/dev/null || \
    echo 'export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1' >> "$CLAUDE_ENV_FILE"
fi

exit 0
