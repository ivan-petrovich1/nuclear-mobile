#!/usr/bin/env node
/**
 * Fork Integrity Verifier (nuclear-mobile)
 *
 * Fast (<50ms), zero-dependency guard that runs in:
 *   - .husky/pre-commit (local commits & manual merges)
 *   - .github/workflows/fork-verify.yml (all PRs targeting main)
 *   - .github/workflows/upstream-sync.yml (automated nukeop/nuclear syncs)
 *
 * Exits non-zero with a clear list of violations if upstream (or an accidental edit)
 * breaks, deletes, or overwrites any critical fork feature or platform fix.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const failures = [];

const fullPath = (rel) => path.join(REPO_ROOT, rel);
const exists = (rel) => fs.existsSync(fullPath(rel));
const read = (rel) => fs.readFileSync(fullPath(rel), 'utf8');

const check = (label, condition, detail = '') => {
  if (!condition) {
    failures.push(detail ? `${label}: ${detail}` : label);
  }
};

const checkContains = (rel, needle, label) => {
  if (!exists(rel)) {
    failures.push(`${label}: missing file ${rel}`);
    return;
  }
  const content = read(rel);
  const ok =
    needle instanceof RegExp ? needle.test(content) : content.includes(needle);
  if (!ok) {
    failures.push(`${label}: expected ${String(needle)} in ${rel}`);
  }
};

const checkNotContains = (rel, needle, label) => {
  if (!exists(rel)) {
    failures.push(`${label}: missing file ${rel}`);
    return;
  }
  const content = read(rel);
  const hit =
    needle instanceof RegExp ? needle.test(content) : content.includes(needle);
  if (hit) {
    failures.push(`${label}: forbidden pattern ${String(needle)} found in ${rel}`);
  }
};

// 1. All critical fork-owned files must exist and be non-empty
const REQUIRED_FORK_FILES = [
  '.github/fork-protected-files.txt',
  '.github/workflows/multiplatform-release.yml',
  '.github/workflows/upstream-sync.yml',
  '.github/workflows/fork-verify.yml',
  'scripts/verify-fork-integrity.mjs',
  'packages/player/src/integration-tests/fork-safeguards.test.ts',
  'packages/player/fork-changelog.json',
  'packages/player/src/components/DesktopEnhancementsShell.tsx',
  'packages/player/src/components/MobileAndroidShell.tsx',
  'packages/player/src/components/AudioDspPanel.tsx',
  'packages/player/src/components/SpotifyAccountSyncPanel.tsx',
  'packages/player/src/components/P2pSyncPanel.tsx',
  'packages/player/src/components/BeatVisualizer.tsx',
  'packages/player/src/components/FakeBankModal.tsx',
  'packages/player/src/components/LiveLyricTicker.tsx',
  'packages/player/src/views/Dashboard/components/PersonalizedDashboard.tsx',
  'packages/player/src/services/mobileEnhancements.ts',
  'packages/player/src/services/searchEasterEggs.ts',
  'packages/player/src/services/shareService.ts',
  'packages/player/src/services/vibeCardGenerator.ts',
  'packages/player/src/services/spotifyAccountSync.ts',
  'packages/player/src/services/p2pSync.ts',
  'packages/player/src/services/personalizedFeed.ts',
  'packages/player/src/services/endlessRadio.ts',
  'packages/player/src/services/wrappedStats.ts',
  'packages/player/src/services/soundSpaces.ts',
  'packages/player/src/services/androidMediaBridge.ts',
  'packages/player/src/stores/downloadStore.ts',
  'packages/player/src/stores/updaterStore.ts',
  'packages/player/src-tauri/src/ytdlp.rs',
  'packages/player/src-tauri/src/stream_server.rs',
  'packages/player/src-tauri/src/p2p_sync.rs',
  'packages/player/src-tauri/gen/android/app/src/main/java/com/nuclearplayer/MainActivity.kt',
  'packages/player/src-tauri/gen/android/app/src/main/java/com/nuclearplayer/NuclearMediaService.kt',
  'packages/player/src-tauri/gen/android/app/src/main/java/com/nuclearplayer/NuclearWidgetProvider.kt',
];

for (const rel of REQUIRED_FORK_FILES) {
  const ok = exists(rel) && fs.statSync(fullPath(rel)).size > 0;
  check(`Fork file present (${rel})`, ok, 'missing or empty');
}

// 2. Identity & Version Sync Lock (prevents update loops or upstream hijack)
try {
  const tauriConf = JSON.parse(read('packages/player/src-tauri/tauri.conf.json'));
  check(
    'Bundle identifier',
    tauriConf.identifier === 'com.nuclearplayer',
    `expected "com.nuclearplayer", got ${JSON.stringify(tauriConf.identifier)}`,
  );

  const updaterSrc = read('packages/player/src/stores/updaterStore.ts');
  const versionMatch = updaterSrc.match(
    /CURRENT_RELEASE_VERSION\s*=\s*['"]([^'"]+)['"]/,
  );
  check(
    'Updater release version constant',
    Boolean(versionMatch),
    'CURRENT_RELEASE_VERSION missing in updaterStore.ts',
  );
  if (versionMatch) {
    check(
      'Version lock (tauri.conf.json === updaterStore.ts)',
      tauriConf.version === versionMatch[1],
      `tauri.conf.json=${tauriConf.version} vs updaterStore.ts=${versionMatch[1]}`,
    );
  }
  check(
    'Updater targets our fork repo',
    updaterSrc.includes('ivan-petrovich1/nuclear-mobile/releases/latest'),
    'GITHUB_LATEST_RELEASE_URL does not point to ivan-petrovich1/nuclear-mobile',
  );
} catch (err) {
  failures.push(`Failed to validate tauri.conf.json / updaterStore.ts: ${err.message}`);
}

// 3. Rust, Android, macOS, and Linux AppImage safeguards
checkContains(
  'packages/player/src-tauri/src/main.rs',
  'apply_appimage_fontconfig_workaround',
  'Linux AppImage COLRv1 workaround function',
);
checkContains(
  'packages/player/src-tauri/src/main.rs',
  '*COLRv1*',
  'Linux AppImage COLRv1 Fontconfig rejection glob',
);
checkContains(
  'packages/player/src-tauri/src/lib.rs',
  /#\[cfg\(not\(any\(target_os = "android", target_os = "ios"\)\)\)\]\s*pub mod media_controls;/,
  'Android cfg gate on media_controls module',
);
checkContains(
  'packages/player/src-tauri/src/lib.rs',
  'commands::self_update_macos',
  'macOS self-updater command registered',
);
checkContains(
  'packages/player/src-tauri/src/lib.rs',
  'pub mod p2p_sync;',
  'P2P sync Rust module',
);
checkContains(
  'packages/player/src-tauri/src/lib.rs',
  'pub mod stream_server;',
  'Local stream proxy Rust module',
);
checkContains(
  'packages/player/src-tauri/Cargo.toml',
  /\[dev-dependencies\][\s\S]*?rand\s*=\s*"0\.8"/,
  'Cargo.toml dev-dependency rand = "0.8" for pgp test fixtures',
);
checkContains(
  'packages/player/src-tauri/Cargo.toml',
  /\[target\.'cfg\(any\(target_os = "macos", windows, target_os = "linux"\)\)'\.dependencies\][\s\S]*?souvlaki/,
  'souvlaki gated to desktop targets in Cargo.toml',
);
checkContains(
  'packages/player/src-tauri/Cargo.toml',
  /\[target\.'cfg\(not\(any\(target_os = "android", target_os = "ios"\)\)\)'\.dependencies\][\s\S]*?tauri-plugin-updater/,
  'tauri-plugin-updater gated to non-mobile targets in Cargo.toml',
);
checkContains(
  'packages/player/src-tauri/src/ytdlp.rs',
  'innertube_search',
  'Native Rust InnerTube search',
);
checkContains(
  'packages/player/src-tauri/src/ytdlp.rs',
  'innertube_get_stream',
  'Native Rust InnerTube stream resolver',
);
checkContains(
  'packages/player/src-tauri/src/ytdlp.rs',
  'piped_instances',
  'Native Rust Piped fallback',
);

// Android Kotlin bridge methods
for (const method of [
  'fun shareText(',
  'fun shareImageBase64(',
  'fun downloadAndInstallApk(',
  'fun exportToPublicDownloads(',
  'fun updateMediaSession(',
]) {
  checkContains(
    'packages/player/src-tauri/gen/android/app/src/main/java/com/nuclearplayer/MainActivity.kt',
    method,
    `Android bridge ${method}`,
  );
}

// 4. Frontend Startup, Dashboard, Shuffle, Offline, Parity & Share wiring
checkContains(
  'packages/player/src/initPlayerApp.tsx',
  'registerBuiltInYoutubeProvider',
  'Built-in YouTube provider registration',
);
checkContains(
  'packages/player/src/initPlayerApp.tsx',
  'initializeDownloadStore',
  'Offline download store initialization',
);
checkContains(
  'packages/player/src/initPlayerApp.tsx',
  'initMobileEnhancements',
  'Mobile & desktop enhancements bootstrap',
);
checkContains(
  'packages/player/src/routes/__root.tsx',
  'MobileAndroidShell',
  'MobileAndroidShell mounted in root route',
);
checkContains(
  'packages/player/src/routes/__root.tsx',
  'DesktopEnhancementsShell',
  'DesktopEnhancementsShell mounted in root route',
);
checkContains(
  'packages/player/src/views/Dashboard/Dashboard.tsx',
  'PersonalizedDashboard',
  'Dashboard renders PersonalizedDashboard',
);
checkNotContains(
  'packages/player/src/views/Dashboard/Dashboard.tsx',
  /TopTracks|TopArtists|TopAlbums/,
  'Dashboard has no global Top 100 widgets',
);
checkContains(
  'packages/player/src/views/Dashboard/components/PersonalizedDashboard.tsx',
  '<div className="relative aspect-square w-full">',
  'Bug #1 fix: Similar Artists wrapper does not clip play button',
);
checkContains(
  'packages/player/src/services/personalizedFeed.ts',
  'itunes.apple.com/search',
  'Bug #1 fix: Similar Artists iTunes fallback',
);
checkContains(
  'packages/player/src/components/DesktopEnhancementsShell.tsx',
  'showMobileOnlyControls={false}',
  'Desktop omits mobile-only Shake-to-Skip',
);
checkContains(
  'packages/player/src/components/useSettingsNavigation.tsx',
  'SpotifyAccountSyncPanel',
  'Spotify Account Sync tab in Settings',
);
checkContains(
  'packages/player/src/hooks/useQueue.ts',
  'orderQueueItems',
  'Visible shuffled queue order in useQueue',
);
checkContains(
  'packages/player/src/services/playback/playbackManager.ts',
  'shuffleQueue(true)',
  'Random starting track when playing playlist with shuffle enabled',
);
checkContains(
  'packages/player/src/stores/queue/persistence.ts',
  'stripResolutionState',
  'stripResolutionState preserved in queue persistence',
);
checkContains(
  'packages/player/src/services/streamResolution/streamResolution.ts',
  '/local/',
  'Offline local file stream resolution',
);
checkContains(
  'packages/player/src/services/coreSettings.ts',
  /id:\s*'playback\.autoDownloadPlayed'[\s\S]*?default:\s*false/,
  'Auto-download played songs OFF by default',
);
checkContains(
  'packages/player/src/services/coreSettings.ts',
  /id:\s*'playback\.exportDownloadsToPublicFolder'[\s\S]*?default:\s*false/,
  'Public Downloads export OFF by default',
);
checkContains(
  'packages/player/src/components/ConnectedPlayerBar/ConnectedPlayerBar.tsx',
  'shareTrack',
  'Desktop PlayerBar Share button',
);
checkContains(
  'packages/player/src/components/ConnectedPlayerBar/ConnectedPlayerBar.tsx',
  'LiveLyricTicker',
  'Desktop PlayerBar Live Floating Lyric Ticker',
);
checkContains(
  'packages/player/src/components/MobileAndroidShell.tsx',
  'LiveLyricTicker',
  'Android Mini-Player Live Floating Lyric Ticker',
);
checkContains(
  'packages/player/src/components/ConnectedTrackContextMenu.tsx',
  'shareTrack',
  'Track context menu Share button',
);
checkContains(
  'packages/player/src/views/Playlists/components/PlaylistActions.tsx',
  'sharePlaylist',
  'Playlist header Share button',
);

// 5. Workflow Safety: No banned upstream auto-close workflows or rogue triggers on main
for (const banned of [
  '.github/workflows/close-external-prs.yml',
  '.github/workflows/close-external-issues.yml',
]) {
  check(`Banned workflow absent (${banned})`, !exists(banned), 'must not exist');
}

for (const upstreamWf of [
  '.github/workflows/ci.yml',
  '.github/workflows/release-player.yml',
  '.github/workflows/deploy-website.yml',
  '.github/workflows/release-plugin-sdk.yml',
]) {
  if (exists(upstreamWf)) {
    const content = read(upstreamWf);
    check(
      `Upstream workflow does not target main (${upstreamWf})`,
      !/branches:\s*\[[^\]]*\bmain\b[^\]]*\]/.test(content),
      'must not trigger on fork main branch',
    );
  }
}

if (failures.length > 0) {
  console.error('\n❌ FORK INTEGRITY VERIFICATION FAILED:\n');
  for (const f of failures) {
    console.error(`  - ${f}`);
  }
  console.error(`\nTotal violations: ${failures.length}\n`);
  process.exit(1);
}

console.log(
  `✅ Fork integrity verified (${REQUIRED_FORK_FILES.length} fork files + version/Rust/Android/UI/workflow safeguards OK).`,
);
