#!/usr/bin/env bash
# Fast local Ubuntu 22.04 (glibc 2.35 compatible) x86_64 Linux builder.
# Uses your host's 28 CPU threads + clang/lld + persistent Cargo cache inside `nuc-ubuntu`
# (~35-45s warm vs ~8-10 min on 4-core GitHub Actions runners).
#
# Usage:
#   ./scripts/build-local-appimage.sh                  # AppImage only -> ~/Desktop/Nuclear-Release-x86_64.AppImage
#   ./scripts/build-local-appimage.sh --restart        # AppImage only + restart Nuclear
#   ./scripts/build-local-appimage.sh --all-bundles    # Build .AppImage, .deb, .rpm -> dist-local/ + Desktop AppImage

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_PATH="${NUCLEAR_APPIMAGE_OUT:-$HOME/Desktop/Nuclear-Release-x86_64.AppImage}"
DIST_DIR="${NUCLEAR_LOCAL_DIST_DIR:-$REPO_DIR/dist-local}"
TARGET_CACHE="${NUCLEAR_UBUNTU_TARGET_DIR:-$HOME/.cache/nuclear-ubuntu22-target}"
RESTART=0
BUNDLES="appimage"

for arg in "$@"; do
  case "$arg" in
    --restart) RESTART=1 ;;
    --all-bundles) BUNDLES="deb,rpm,appimage" ;;
  esac
done

START_EPOCH=$(date +%s)
echo "⚡ Building Linux x86_64 (${BUNDLES}) on Ubuntu 22.04 (glibc 2.35) via nuc-ubuntu + clang/lld..."

distrobox enter nuc-ubuntu -- bash -lc "
set -euo pipefail
export PATH=\"\$HOME/.cargo/bin:\$HOME/.local/node/bin:\$HOME/.local/share/pnpm:\$PATH\"

if ! dpkg -s libwebkit2gtk-4.1-dev clang lld patchelf rpm xdg-utils >/dev/null 2>&1; then
  echo '📦 Installing Ubuntu 22.04 Tauri build deps + clang/lld (one-time)...'
  sudo apt-get update -qq
  sudo apt-get install -y -qq \
    build-essential pkg-config clang lld patchelf file wget rpm xdg-utils \
    libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev \
    libdbus-1-dev libssl-dev \
    gstreamer1.0-libav gstreamer1.0-plugins-base gstreamer1.0-plugins-good
fi

mkdir -p '$TARGET_CACHE' '$DIST_DIR'
export CARGO_TARGET_DIR='$TARGET_CACHE'
export CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=clang
export CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS='-C link-arg=-fuse-ld=lld'
export CARGO_INCREMENTAL=0
export APPIMAGE_EXTRACT_AND_RUN=1

cd '$REPO_DIR'
pnpm turbo build --filter='@nuclearplayer/player^...'
pnpm --filter @nuclearplayer/player tauri build --bundles '$BUNDLES'

BUILT_APPIMAGE=\$(ls -t '$TARGET_CACHE'/release/bundle/appimage/*.AppImage | head -n 1)
cp \"\$BUILT_APPIMAGE\" '${OUT_PATH}.new'
chmod +x '${OUT_PATH}.new'
mv '${OUT_PATH}.new' '${OUT_PATH}'
cp \"\$BUILT_APPIMAGE\" '$DIST_DIR/Nuclear-Release-x86_64.AppImage'

if [[ '$BUNDLES' == *deb* ]]; then
  cp \$(ls -t '$TARGET_CACHE'/release/bundle/deb/*.deb | head -n 1) '$DIST_DIR/Nuclear-Linux-amd64.deb'
fi
if [[ '$BUNDLES' == *rpm* ]]; then
  cp \$(ls -t '$TARGET_CACHE'/release/bundle/rpm/*.rpm | head -n 1) '$DIST_DIR/Nuclear-Linux-x86_64.rpm'
fi
"

ELAPSED=$(( $(date +%s) - START_EPOCH ))
echo "✅ Built Linux x86_64 (${BUNDLES}) in ${ELAPSED}s!"
ls -lh "$OUT_PATH" "$DIST_DIR"/Nuclear-* 2>/dev/null || true

if [ "$RESTART" -eq 1 ]; then
  echo "🔄 Restarting Nuclear..."
  killall nuclear-music-player 2>/dev/null || true
  sleep 1
  systemd-run --user --collect "$OUT_PATH"
  echo "✅ Relaunched ${OUT_PATH}"
fi
