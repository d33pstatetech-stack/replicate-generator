#!/usr/bin/env bash
# Serve the SPA on http://localhost:8000 - Linux/macOS equivalent of START_SERVER.bat
# (Serving over HTTP avoids file:// CORS blocks against https://api.replicate.com)
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8000}"

if command -v python3 >/dev/null 2>&1; then
  PYTHON=python3
elif command -v python >/dev/null 2>&1; then
  PYTHON=python
else
  echo "Python not found. Install python3 or use: npx serve ." >&2
  exit 1
fi

echo "Serving $PWD on http://localhost:$PORT"
echo "Press Ctrl+C to stop"
exec "$PYTHON" -m http.server "$PORT"
