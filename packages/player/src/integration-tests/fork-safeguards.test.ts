import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerBuiltInCoreSettings } from '../services/coreSettings';
import { getActiveLyricLine } from '../services/mobileEnhancements';
import { playbackManager } from '../services/playback';
import { maybeTriggerSearchEasterEgg } from '../services/searchEasterEggs';
import {
  buildPlaylistSharePayload,
  buildTrackSharePayload,
  getTrackShareUrl,
  shareTrack,
} from '../services/shareService';
import { orderQueueItems, PlayOrder } from '../stores/queue/playOrder';
import { useQueueStore } from '../stores/queue/queueStore';
import { useSettingsStore } from '../stores/settingsStore';
import { createQueueItem } from '../test/fixtures/queue';
import { resetInMemoryTauriStore } from '../test/utils/inMemoryTauriStore';
import { resolveChangelogAuthor } from '../views/WhatsNew/TimelineEntry';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(9100),
}));

const PLAYER_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(PLAYER_ROOT, '../..');

const readPlayerFile = (relPath: string): string =>
  fs.readFileSync(path.join(PLAYER_ROOT, relPath), 'utf8');

describe('Fork safeguards (protects custom features across upstream syncs)', () => {
  beforeEach(() => {
    resetInMemoryTauriStore();
    useSettingsStore.setState({ definitions: {}, values: {}, loaded: true });
    useQueueStore.setState(useQueueStore.getInitialState());
  });

  describe('Shuffle & visible queue invariants', () => {
    it('orderQueueItems orders visible items by playOrder without dropping items', () => {
      const items = ['A', 'B', 'C', 'D'].map((id) => ({
        ...createQueueItem(id),
        id,
      }));
      const ordered = orderQueueItems(items, ['C', 'A', 'D']);
      expect(ordered.map((i) => i.id)).toEqual(['C', 'A', 'D', 'B']);
    });

    it('PlayOrder.moveBefore updates playOrder and keeps cursor on current item', () => {
      const order = new PlayOrder(['A', 'B', 'C', 'D'], 1, null);
      const moved = order.moveBefore('D', 'B');
      expect(moved.itemIds).toEqual(['A', 'D', 'B', 'C']);
      expect(moved.currentItemId).toBe('B');
      expect(moved.cursor).toBe(2);
    });

    it('shuffleQueue(false) keeps the current track and preserves all items', () => {
      const tracks = ['A', 'B', 'C', 'D', 'E'].map(
        (t) => createQueueItem(t).track,
      );
      useQueueStore.getState().addToQueue(tracks);
      useQueueStore.getState().goToIndex(2);

      const currentBefore = useQueueStore.getState().getCurrentItem()?.id;
      useQueueStore.getState().shuffleQueue(false);

      const after = useQueueStore.getState();
      expect(after.items).toHaveLength(5);
      expect(after.getCurrentItem()?.id).toBe(currentBefore);
    });

    it('playbackManager.playTracks uses shuffleQueue(true) when shuffle is enabled', () => {
      useSettingsStore.setState({ values: { 'core.playback.shuffle': true } });
      const shuffleSpy = vi.spyOn(useQueueStore.getState(), 'shuffleQueue');

      const tracks = ['One', 'Two', 'Three'].map(
        (t) => createQueueItem(t).track,
      );
      playbackManager.playTracks(tracks);

      expect(shuffleSpy).toHaveBeenCalledWith(true);
      shuffleSpy.mockRestore();
    });

    it('useQueue visibly follows playOrder when shuffle is active', () => {
      const src = readPlayerFile('src/hooks/useQueue.ts');
      expect(src).toContain('orderQueueItems');
      expect(src).toContain('core.playback.shuffle');
    });
  });

  describe('Core settings defaults', () => {
    it('keeps auto-download toggles registered and OFF by default', () => {
      registerBuiltInCoreSettings();
      const state = useSettingsStore.getState();
      expect(state.getValue('core.playback.autoDownloadPlayed')).toBe(false);
      expect(
        state.getValue('core.playback.exportDownloadsToPublicFolder'),
      ).toBe(false);
    });
  });

  describe('UI & feature wiring invariants', () => {
    it('keeps Dashboard 100% personalized without global Top 100 widgets', () => {
      const dashboard = readPlayerFile('src/views/Dashboard/Dashboard.tsx');
      expect(dashboard).toContain('PersonalizedDashboard');
      expect(dashboard).not.toMatch(/TopTracks|TopArtists|TopAlbums/);
    });

    it('keeps both MobileAndroidShell and DesktopEnhancementsShell wired in root route', () => {
      const root = readPlayerFile('src/routes/__root.tsx');
      expect(root).toContain('MobileAndroidShell');
      expect(root).toContain('DesktopEnhancementsShell');
      expect(root).toContain('Nuclear Hub');
      expect(root).toContain('Audio DSP');
    });

    it('omits mobile-only Shake-to-Skip on Desktop and uses shuffled queue helpers in both shells', () => {
      const desktop = readPlayerFile(
        'src/components/DesktopEnhancementsShell.tsx',
      );
      expect(desktop).toContain('showMobileOnlyControls={false}');
      expect(desktop).toContain('useQueue()');
      expect(desktop).toContain('goToId(item.id)');

      const mobile = readPlayerFile('src/components/MobileAndroidShell.tsx');
      expect(mobile).toContain('useQueue()');
      expect(mobile).toContain('goToId(item.id)');
    });

    it('keeps playlist offline download actions and local offline stream resolution', () => {
      const playlistActions = readPlayerFile(
        'src/views/Playlists/components/PlaylistActions.tsx',
      );
      expect(playlistActions).toContain('downloadTracks');

      const streamRes = readPlayerFile(
        'src/services/streamResolution/streamResolution.ts',
      );
      expect(streamRes).toContain('useDownloadStore');
      expect(streamRes).toContain('/local/');

      const persistence = readPlayerFile('src/stores/queue/persistence.ts');
      expect(persistence).toContain('stripResolutionState');
      expect(persistence).toContain("store.get<number>('queue.playCursor')");
    });
  });

  describe('Rust, Android, macOS, and Linux AppImage safeguards', () => {
    it('keeps Linux AppImage COLRv1 Fontconfig crash workaround in main.rs', () => {
      const mainRs = readPlayerFile('src-tauri/src/main.rs');
      expect(mainRs).toContain('apply_appimage_fontconfig_workaround');
      expect(mainRs).toContain('*COLRv1*');
      expect(mainRs).toContain('FONTCONFIG_FILE');
    });

    it('keeps desktop-only media_controls gated out of Android builds and macOS updater registered', () => {
      const libRs = readPlayerFile('src-tauri/src/lib.rs');
      expect(libRs).toMatch(
        /#\[cfg\(not\(any\(target_os = "android", target_os = "ios"\)\)\)\]\s*pub mod media_controls;/,
      );
      expect(libRs).toContain('commands::self_update_macos');
    });

    it('keeps native Rust InnerTube/Piped resolver in ytdlp.rs', () => {
      const ytdlpRs = readPlayerFile('src-tauri/src/ytdlp.rs');
      expect(ytdlpRs).toContain('innertube_search');
      expect(ytdlpRs).toContain('innertube_get_stream');
      expect(ytdlpRs).toContain('piped_instances');
    });

    it('keeps fork bundle identifier in tauri.conf.json and blocks upstream auto-close workflows', () => {
      const tauriConf = JSON.parse(
        readPlayerFile('src-tauri/tauri.conf.json'),
      ) as { identifier?: string };
      expect(tauriConf.identifier).toBe('com.nuclearplayer');

      expect(
        fs.existsSync(
          path.join(REPO_ROOT, '.github/workflows/close-external-prs.yml'),
        ),
      ).toBe(false);
      expect(
        fs.existsSync(
          path.join(REPO_ROOT, '.github/workflows/close-external-issues.yml'),
        ),
      ).toBe(false);
    });
  });

  describe('Cross-platform Share button safeguards', () => {
    it('builds share URLs and payloads for YouTube, Spotify, and fallback tracks + playlists', () => {
      const ytTrack = {
        ...createQueueItem('Sandstorm').track,
        artists: [{ name: 'Darude' }],
        source: { provider: 'youtube', id: 'y6120QOlsfU' },
      };
      expect(getTrackShareUrl(ytTrack)).toBe(
        'https://www.youtube.com/watch?v=y6120QOlsfU',
      );
      expect(buildTrackSharePayload(ytTrack).text).toContain(
        'Darude - Sandstorm',
      );

      const spotifyTrack = {
        ...createQueueItem('Paranoid Android').track,
        artists: [{ name: 'Radiohead' }],
        source: { provider: 'spotify', id: '6LgJvl0Xdtc73RJ1mmpotq' },
      };
      expect(getTrackShareUrl(spotifyTrack)).toBe(
        'https://open.spotify.com/track/6LgJvl0Xdtc73RJ1mmpotq',
      );

      const playlistPayload = buildPlaylistSharePayload('Night Drive', [
        ytTrack,
        spotifyTrack,
      ]);
      expect(playlistPayload.text).toContain('Night Drive (2 tracks)');
      expect(playlistPayload.text).toContain('1. Darude - Sandstorm');
    });

    it('keeps Share button wired across Desktop, Android, Track menu, Playlist header, and Kotlin bridge', () => {
      expect(
        readPlayerFile(
          'src/components/ConnectedPlayerBar/ConnectedPlayerBar.tsx',
        ),
      ).toContain('shareTrack');
      expect(
        readPlayerFile('src/components/ConnectedTrackContextMenu.tsx'),
      ).toContain('shareTrack');
      expect(
        readPlayerFile('src/views/Playlists/components/PlaylistActions.tsx'),
      ).toContain('sharePlaylist');
      expect(
        readPlayerFile('src/components/DesktopEnhancementsShell.tsx'),
      ).toContain('shareTrack');
      expect(readPlayerFile('src/components/MobileAndroidShell.tsx')).toContain(
        'shareTrack',
      );
      expect(
        readPlayerFile(
          'src-tauri/gen/android/app/src/main/java/com/nuclearplayer/MainActivity.kt',
        ),
      ).toContain('fun shareText(');
    });

    it('delivers shareTrack through Android native Share Sheet when bridge is present', async () => {
      const shareTextMock = vi.fn().mockReturnValue('OK');
      const prevBridge = window.NuclearAndroid;
      window.NuclearAndroid = {
        exportToPublicDownloads: vi.fn().mockReturnValue('OK'),
        shareText: shareTextMock,
      };
      try {
        const track = {
          ...createQueueItem('Sandstorm').track,
          artists: [{ name: 'Darude' }],
          source: { provider: 'youtube', id: 'y6120QOlsfU' },
        };
        const ok = await shareTrack(track);
        expect(ok).toBe(true);
        expect(shareTextMock).toHaveBeenCalledWith(
          'Darude - Sandstorm',
          '🎵 Darude - Sandstorm\nhttps://www.youtube.com/watch?v=y6120QOlsfU',
        );
      } finally {
        window.NuclearAndroid = prevBridge;
      }
    });

    it('delivers shareTrack to system clipboard on desktop platforms', async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      const prevBridge = window.NuclearAndroid;
      const prevClipboard = navigator.clipboard;
      window.NuclearAndroid = undefined;
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        configurable: true,
      });
      try {
        const track = {
          ...createQueueItem('Paranoid Android').track,
          artists: [{ name: 'Radiohead' }],
          source: { provider: 'spotify', id: '6LgJvl0Xdtc73RJ1mmpotq' },
        };
        const ok = await shareTrack(track);
        expect(ok).toBe(true);
        expect(writeTextMock).toHaveBeenCalledWith(
          '🎵 Radiohead - Paranoid Android\nhttps://open.spotify.com/track/6LgJvl0Xdtc73RJ1mmpotq',
        );
      } finally {
        window.NuclearAndroid = prevBridge;
        Object.defineProperty(navigator, 'clipboard', {
          value: prevClipboard,
          configurable: true,
        });
      }
    });
  });

  describe('Live Floating Lyric Line safeguards', () => {
    it('tracks active and upcoming synced lyric lines accurately', () => {
      const lines = [
        { timeSec: 5, text: 'First line' },
        { timeSec: 12, text: 'Second line' },
        { timeSec: 20, text: 'Third line' },
      ];
      expect(getActiveLyricLine(lines, 1).current).toBeNull();
      expect(getActiveLyricLine(lines, 1).next?.text).toBe('First line');
      expect(getActiveLyricLine(lines, 12.1).current?.text).toBe('Second line');
      expect(getActiveLyricLine(lines, 12.1).next?.text).toBe('Third line');
      expect(getActiveLyricLine(lines, 25).current?.text).toBe('Third line');
      expect(getActiveLyricLine(lines, 25).next).toBeNull();
    });
  });

  describe('Search easter egg safeguards', () => {
    it('triggers Hava Nagila on exact "jew" query without affecting other queries', () => {
      expect(maybeTriggerSearchEasterEgg('jewel')).toBe(false);
      expect(maybeTriggerSearchEasterEgg('nirvana')).toBe(false);
      expect(maybeTriggerSearchEasterEgg('  Jew  ')).toBe(true);
      expect(useQueueStore.getState().getCurrentItem()?.track.title).toBe(
        'Hava Nagila',
      );
    });
  });

  describe("What's New attribution safeguards", () => {
    it('labels fork entries as ivan and upstream entries as nukeop', () => {
      expect(
        resolveChangelogAuthor({
          date: '2026-11-25T06:58',
          description: 'Fork update',
          type: 'feature',
          author: 'ivan',
        }),
      ).toBe('ivan');
      expect(
        resolveChangelogAuthor({
          date: '2026-11-19T00:00',
          description: 'Upstream update',
          type: 'fix',
          contributors: ['nukeop'],
        }),
      ).toBe('nukeop');
      const forkLog = JSON.parse(
        readPlayerFile('fork-changelog.json'),
      ) as Array<{
        author?: string;
        description?: string;
      }>;
      expect(forkLog.length).toBeGreaterThan(0);
      expect(forkLog.every((e) => e.author === 'ivan')).toBe(true);
    });
  });
});
