#!/usr/bin/env bash
# Builds a signed Quraan.wgt with the Tizen Studio CLI.
#   TIZEN_PROFILE  security profile name from Tizen Studio Certificate Manager (default: quraan)
#   TIZEN_CLI      path to the `tizen` binary (default: `tizen` on PATH or ~/tizen-studio)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${TIZEN_PROFILE:-quraan}"
TIZEN="${TIZEN_CLI:-$(command -v tizen || echo "$HOME/tizen-studio/tools/ide/bin/tizen")}"
BUILD="$ROOT/build"
DIST="$ROOT/dist"

if [ ! -x "$TIZEN" ]; then
  echo "Tizen CLI not found. Install Tizen Studio (CLI) or set TIZEN_CLI." >&2
  exit 1
fi

rm -rf "$BUILD" "$DIST"
mkdir -p "$BUILD" "$DIST"
cp -R "$ROOT/config.xml" "$ROOT/index.html" "$ROOT/icon.png" "$ROOT/css" "$ROOT/js" "$BUILD/"

"$TIZEN" package -t wgt -s "$PROFILE" -o "$DIST" -- "$BUILD"
ls -l "$DIST"/*.wgt
