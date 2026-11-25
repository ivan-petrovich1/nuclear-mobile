#!/usr/bin/env bash
# Fast local Windows x64 (.exe NSIS installer) cross-compiler on Linux!
# Uses cargo-xwin + lld + makensis inside `nuc-ubuntu` on all host CPU threads
# (~45-60s warm vs ~7-9 min on GitHub's Windows runner).
#
# Usage:
#   ./scripts/build-local-windows.sh   # Outputs dist-local/Nuclear-Windows-x64-setup.exe

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${NUCLEAR_LOCAL_DIST_DIR:-$REPO_DIR/dist-local}"
TARGET_CACHE="${NUCLEAR_WINDOWS_TARGET_DIR:-$HOME/.cache/nuclear-win64-target}"

START_EPOCH=$(date +%s)
echo "⚡ Cross-compiling Windows x64 NSIS (.exe) locally via cargo-xwin + lld + makensis..."

distrobox enter nuc-ubuntu -- bash -lc "
set -euo pipefail
export PATH=\"\$HOME/.cargo/bin:\$HOME/.local/node/bin:\$HOME/.local/share/pnpm:\$PATH\"

if ! command -v cargo-xwin >/dev/null 2>&1 || ! command -v makensis >/dev/null 2>&1 || ! command -v lld-link >/dev/null 2>&1; then
  echo '📦 Installing cargo-xwin + clang/lld/llvm + nsis (one-time)...'
  sudo apt-get update -qq
  sudo apt-get install -y -qq clang lld llvm nsis curl
  rustup target add x86_64-pc-windows-msvc
  command -v cargo-xwin >/dev/null 2>&1 || cargo install --locked cargo-xwin
fi

mkdir -p '$TARGET_CACHE' '$DIST_DIR'
export CARGO_TARGET_DIR='$TARGET_CACHE'
export CARGO_INCREMENTAL=0

cd '$REPO_DIR'
pnpm turbo build --filter='@nuclearplayer/player^...'
pnpm --filter @nuclearplayer/player tauri build \
  --runner cargo-xwin \
  --target x86_64-pc-windows-msvc \
  --bundles nsis

BUILT_EXE=\$(ls -t '$TARGET_CACHE'/x86_64-pc-windows-msvc/release/bundle/nsis/*-setup.exe | head -n 1)
cp \"\$BUILT_EXE\" '$DIST_DIR/Nuclear-Windows-x64-setup.exe'
"

ELAPSED=$(( $(date +%s) - START_EPOCH ))
echo "✅ Built Windows x64 installer in ${ELAPSED}s!"
ls -lh "$DIST_DIR/Nuclear-Windows-x64-setup.exe"
file "$DIST_DIR/Nuclear-Windows-x64-setup.exe"
