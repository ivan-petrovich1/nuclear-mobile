import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type {
  AlbumRef,
  ArtistRef,
  Playlist,
  PlaylistIndexNode,
  PlaylistItem,
  Track,
} from '@nuclearplayer/model';
import { pickArtwork } from '@nuclearplayer/model';
import type { FavoriteEntry } from '@nuclearplayer/plugin-sdk';

import { useFavoritesStore } from '../stores/favoritesStore';
import { usePlaylistStore } from '../stores/playlistStore';
import { useQueueStore } from '../stores/queue/queueStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSoundStore } from '../stores/soundStore';
import { httpHost } from './httpHost';
import { useMobileEnhancementsStore } from './mobileEnhancements';
import { playbackManager } from './playback';
import { playlistFileService } from './playlistFileService';
import { useSpotifyAccountSyncStore } from './spotifyAccountSync';
import { useWrappedStatsStore } from './wrappedStats';

export type P2pPeerInfo = {
  ip: string;
  port: number;
  pin: string;
  enabled: boolean;
  deviceName: string;
};

type SyncSnapshot = {
  version: 1;
  generatedAtIso: string;
  playlists: Playlist[];
  deletedPlaylists: Record<string, string>; // playlistId -> deletedAtIso
  favorites: {
    tracks: FavoriteEntry<Track>[];
    albums: FavoriteEntry<AlbumRef>[];
    artists: FavoriteEntry<ArtistRef>[];
  };
  trackBookmarks: Record<string, number>;
  spotifyAccountInput: string;
  wrappedActiveDays: string[];
};

export type RemotePlaybackState = {
  deviceName: string;
  isPlaying: boolean;
  title: string;
  artist: string;
  coverUrl?: string;
  seek: number;
  duration: number;
  volume: number;
  tracks?: Track[];
  currentIndex?: number;
};

export type RemoteControlAction =
  'play' | 'pause' | 'toggle' | 'next' | 'previous' | 'seek' | 'volume';

type P2pSyncStoreState = {
  enabled: boolean;
  pin: string;
  peerAddress: string; // e.g. "192.168.1.42:37371" or "192.168.1.42:37371|424242"
  autoSyncOnLaunch: boolean;
  seamlessHandoff: boolean;
  syncing: boolean;
  localInfo: P2pPeerInfo | null;
  remoteState: RemotePlaybackState | null;
  lastSyncedIso: string | null;
  lastSummary: string | null;
  deletedPlaylists: Record<string, string>;

  setEnabled: (enabled: boolean) => void;
  setPin: (pin: string) => void;
  setPeerAddress: (addr: string) => void;
  setAutoSyncOnLaunch: (enabled: boolean) => void;
  setSeamlessHandoff: (enabled: boolean) => void;
  recordPlaylistDeletion: (playlistId: string) => void;
  refreshLocalInfo: () => Promise<void>;
  pushLocalSnapshotToRust: () => Promise<SyncSnapshot>;
  pushLocalPlaybackToRust: () => Promise<void>;
  pollRemoteState: () => Promise<RemotePlaybackState | null>;
  syncWithPeer: (silent?: boolean) => Promise<void>;
  sendHandoffToPeer: (silent?: boolean) => Promise<void>;
  pullHandoffFromPeer: (silent?: boolean) => Promise<void>;
  sendRemoteControl: (
    action: RemoteControlAction,
    value?: number,
  ) => Promise<void>;
};

const flattenPlaylistIds = (nodes: PlaylistIndexNode[]): string[] => {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.kind === 'playlist') {
      ids.push(node.id);
    } else if (node.kind === 'folder') {
      for (const pl of node.playlists) {
        ids.push(pl.id);
      }
    }
  }
  return ids;
};

const buildLocalSnapshot = async (
  deletedPlaylists: Record<string, string>,
): Promise<SyncSnapshot> => {
  const plStore = usePlaylistStore.getState();
  if (!plStore.loaded) {
    await plStore.loadIndex();
  }
  const ids = flattenPlaylistIds(usePlaylistStore.getState().index);
  const playlists: Playlist[] = [];
  for (const id of ids) {
    const pl = await usePlaylistStore.getState().loadPlaylist(id);
    if (pl) {
      playlists.push(pl);
    }
  }

  const favStore = useFavoritesStore.getState();
  if (!favStore.loaded) {
    await favStore.loadFromDisk();
  }
  const fav = useFavoritesStore.getState();

  return {
    version: 1,
    generatedAtIso: new Date().toISOString(),
    playlists,
    deletedPlaylists,
    favorites: {
      tracks: fav.tracks,
      albums: fav.albums,
      artists: fav.artists,
    },
    trackBookmarks: useMobileEnhancementsStore.getState().trackBookmarks,
    spotifyAccountInput: useSpotifyAccountSyncStore.getState().accountInput,
    wrappedActiveDays: useWrappedStatsStore.getState().activeDays,
  };
};

const trackIdentity = (item: PlaylistItem) =>
  `${item.track.title.toLowerCase().trim()}::${(item.track.artists?.[0]?.name ?? '').toLowerCase().trim()}`;

const mergePlaylistItems = (
  localItems: PlaylistItem[],
  remoteItems: PlaylistItem[],
): PlaylistItem[] => {
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const merged: PlaylistItem[] = [];

  for (const item of [...localItems, ...remoteItems]) {
    const key = trackIdentity(item);
    if (seenIds.has(item.id) || seenKeys.has(key)) {
      continue;
    }
    seenIds.add(item.id);
    seenKeys.add(key);
    merged.push(item);
  }
  return merged;
};

export const mergeRemoteSnapshot = async (
  remote: SyncSnapshot,
): Promise<{
  playlistsAdded: number;
  playlistsMerged: number;
  favoritesAdded: number;
}> => {
  const store = useP2pSyncStore.getState();
  const mergedDeleted: Record<string, string> = {
    ...store.deletedPlaylists,
    ...(remote.deletedPlaylists ?? {}),
  };

  const plStore = usePlaylistStore.getState();
  if (!plStore.loaded) {
    await plStore.loadIndex();
  }
  const localIds = new Set(
    flattenPlaylistIds(usePlaylistStore.getState().index),
  );

  let playlistsAdded = 0;
  let playlistsMerged = 0;

  // 1. Apply deletions from remote tombstones if deletion is newer than local playlist
  for (const [delId, delIso] of Object.entries(mergedDeleted)) {
    if (localIds.has(delId)) {
      const localPl = await usePlaylistStore.getState().loadPlaylist(delId);
      if (localPl && delIso > localPl.lastModifiedIso) {
        await usePlaylistStore.getState().deletePlaylist(delId);
        localIds.delete(delId);
      }
    }
  }

  // 2. Merge remote playlists into local
  for (const remotePl of remote.playlists ?? []) {
    const tombIso = mergedDeleted[remotePl.id];
    if (tombIso && tombIso > remotePl.lastModifiedIso) {
      continue;
    }

    if (localIds.has(remotePl.id)) {
      const localPl = await usePlaylistStore
        .getState()
        .loadPlaylist(remotePl.id);
      if (localPl) {
        const remoteNewer = remotePl.lastModifiedIso > localPl.lastModifiedIso;
        const mergedItems = mergePlaylistItems(localPl.items, remotePl.items);
        if (mergedItems.length !== localPl.items.length || remoteNewer) {
          const updated: Playlist = {
            ...localPl,
            name: remoteNewer ? remotePl.name : localPl.name,
            description: remoteNewer
              ? remotePl.description
              : localPl.description,
            artwork: remotePl.artwork ?? localPl.artwork,
            lastModifiedIso: remoteNewer
              ? remotePl.lastModifiedIso
              : localPl.lastModifiedIso,
            items: mergedItems,
          };
          const index = await playlistFileService.savePlaylist(updated);
          usePlaylistStore.setState((s) => ({
            playlists: new Map(s.playlists).set(updated.id, updated),
            index,
          }));
          playlistsMerged++;
        }
      }
    } else {
      const index = await playlistFileService.savePlaylist(remotePl);
      usePlaylistStore.setState((s) => ({
        playlists: new Map(s.playlists).set(remotePl.id, remotePl),
        index,
      }));
      localIds.add(remotePl.id);
      playlistsAdded++;
    }
  }

  // 3. Union-merge Favorites
  const favStore = useFavoritesStore.getState();
  if (!favStore.loaded) {
    await favStore.loadFromDisk();
  }
  let favoritesAdded = 0;
  for (const entry of remote.favorites?.tracks ?? []) {
    if (!useFavoritesStore.getState().isTrackFavorite(entry.ref.source)) {
      await useFavoritesStore.getState().addTrack(entry.ref);
      favoritesAdded++;
    }
  }
  for (const entry of remote.favorites?.albums ?? []) {
    if (!useFavoritesStore.getState().isAlbumFavorite(entry.ref.source)) {
      await useFavoritesStore.getState().addAlbum(entry.ref);
      favoritesAdded++;
    }
  }
  for (const entry of remote.favorites?.artists ?? []) {
    if (!useFavoritesStore.getState().isArtistFavorite(entry.ref.source)) {
      await useFavoritesStore.getState().addArtist(entry.ref);
      favoritesAdded++;
    }
  }

  // 4. Union-merge Drop Bookmarks
  if (remote.trackBookmarks) {
    const localBm = useMobileEnhancementsStore.getState().trackBookmarks;
    useMobileEnhancementsStore.setState({
      trackBookmarks: { ...remote.trackBookmarks, ...localBm },
    });
  }

  // 5. Sync Spotify public account username if local is blank
  if (
    remote.spotifyAccountInput &&
    !useSpotifyAccountSyncStore.getState().accountInput.trim()
  ) {
    useSpotifyAccountSyncStore
      .getState()
      .setAccountInput(remote.spotifyAccountInput);
  }

  // 6. Union-merge Wrapped active days
  if (remote.wrappedActiveDays?.length) {
    const curDays = useWrappedStatsStore.getState().activeDays;
    const union = Array.from(
      new Set([...curDays, ...remote.wrappedActiveDays]),
    ).sort();
    useWrappedStatsStore.setState({ activeDays: union.slice(-365) });
  }

  useP2pSyncStore.setState({
    deletedPlaylists: mergedDeleted,
    lastSyncedIso: new Date().toISOString(),
  });

  return { playlistsAdded, playlistsMerged, favoritesAdded };
};

const parsePeerTarget = (
  raw: string,
  fallbackPin: string,
): { url: string; pin: string } | null => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const [hostPart, pinPart] = trimmed.split('|').map((s) => s.trim());
  const pin = pinPart || fallbackPin;
  let base = hostPart;
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  // Add default port 37371 if user only entered an IP
  if (/^https?:\/\/[^:/]+$/i.test(base)) {
    base = `${base}:37371`;
  }
  base = base.replace(/\/+$/, '');
  return { url: `${base}/api/p2p/exchange`, pin };
};

export const useP2pSyncStore = create<P2pSyncStoreState>()(
  persist(
    (set, get) => ({
      enabled: true,
      pin: String(Math.floor(100000 + Math.random() * 900000)),
      peerAddress: '',
      autoSyncOnLaunch: true,
      seamlessHandoff: true,
      syncing: false,
      localInfo: null,
      remoteState: null,
      lastSyncedIso: null,
      lastSummary: null,
      deletedPlaylists: {},

      setEnabled: (enabled) => {
        set({ enabled });
        void invoke('p2p_sync_configure', { enabled, pin: get().pin }).catch(
          () => {},
        );
      },

      setPin: (pin) => {
        set({ pin });
        void invoke('p2p_sync_configure', {
          enabled: get().enabled,
          pin,
        }).catch(() => {});
      },

      setPeerAddress: (peerAddress) => set({ peerAddress }),
      setAutoSyncOnLaunch: (autoSyncOnLaunch) => set({ autoSyncOnLaunch }),
      setSeamlessHandoff: (seamlessHandoff) => set({ seamlessHandoff }),

      recordPlaylistDeletion: (playlistId) =>
        set((s) => ({
          deletedPlaylists: {
            ...s.deletedPlaylists,
            [playlistId]: new Date().toISOString(),
          },
        })),

      refreshLocalInfo: async () => {
        try {
          await invoke('p2p_sync_configure', {
            enabled: get().enabled,
            pin: get().pin,
          });
          const info = await invoke<P2pPeerInfo>('p2p_sync_info');
          set({ localInfo: info });
        } catch {
          // Non-Tauri environment (tests/browser)
        }
      },

      pushLocalSnapshotToRust: async () => {
        const snap = await buildLocalSnapshot(get().deletedPlaylists);
        try {
          await invoke('p2p_sync_update_snapshot', {
            snapshotJson: JSON.stringify(snap),
          });
        } catch {
          // ignore outside Tauri
        }
        return snap;
      },

      pushLocalPlaybackToRust: async () => {
        const queue = useQueueStore.getState();
        const cur = queue.getCurrentItem();
        const sound = useSoundStore.getState();
        const start = Math.max(0, queue.currentIndex - 5);
        const tracks = queue.items.slice(start, start + 35).map((i) => i.track);
        const relIndex = Math.max(0, queue.currentIndex - start);
        const coverUrl = cur?.track
          ? (pickArtwork(cur.track.artwork, 'thumbnail', 256)?.url ??
            pickArtwork(cur.track.album?.artwork, 'thumbnail', 256)?.url)
          : undefined;
        const vol =
          (useSettingsStore
            .getState()
            .getValue('core.playback.volume') as number) ?? 1;

        const payload: RemotePlaybackState = {
          deviceName: get().localInfo?.deviceName ?? 'Nuclear Peer',
          isPlaying: sound.status === 'playing',
          title: cur?.track.title ?? '',
          artist: cur?.track.artists?.map((a) => a.name).join(', ') || '',
          coverUrl,
          seek: sound.seek,
          duration: sound.duration,
          volume: vol,
          tracks,
          currentIndex: relIndex,
        };
        try {
          await invoke('p2p_sync_update_playback', {
            playbackJson: JSON.stringify(payload),
          });
        } catch {
          // ignore outside Tauri
        }
      },

      pollRemoteState: async () => {
        const target = parsePeerTarget(get().peerAddress, get().pin);
        if (!target) {
          if (get().remoteState !== null) {
            set({ remoteState: null });
          }
          return null;
        }
        const stateUrl = target.url.replace(/\/exchange$/, '/state');
        try {
          const res = await httpHost.fetch(stateUrl, {
            method: 'GET',
            headers: { 'x-nuclear-pin': target.pin },
          });
          if (res.status < 200 || res.status >= 300) {
            set({ remoteState: null });
            return null;
          }
          const parsed = JSON.parse(res.body) as RemotePlaybackState;
          if (!parsed || typeof parsed.deviceName !== 'string') {
            set({ remoteState: null });
            return null;
          }
          set({ remoteState: parsed });
          return parsed;
        } catch {
          set({ remoteState: null });
          return null;
        }
      },

      sendRemoteControl: async (action, value) => {
        const target = parsePeerTarget(get().peerAddress, get().pin);
        if (!target) {
          toast.error('Link your other device in P2P Sync first!');
          return;
        }
        const controlUrl = target.url.replace(/\/exchange$/, '/control');
        try {
          const res = await httpHost.fetch(controlUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-nuclear-pin': target.pin,
            },
            body: JSON.stringify({ action, value }),
          });
          if (res.status >= 200 && res.status < 300) {
            window.setTimeout(() => {
              void get().pollRemoteState();
            }, 350);
          }
        } catch {
          toast.error('Could not reach paired device');
        }
      },

      pullHandoffFromPeer: async (silent = false) => {
        const target = parsePeerTarget(get().peerAddress, get().pin);
        if (!target) {
          if (!silent) {
            toast.error('Link your other device in P2P Sync first!');
          }
          return;
        }
        const pullUrl = target.url.replace(/\/exchange$/, '/pull-handoff');
        try {
          const res = await httpHost.fetch(pullUrl, {
            method: 'POST',
            headers: { 'x-nuclear-pin': target.pin },
          });
          if (res.status < 200 || res.status >= 300) {
            throw new Error(`HTTP ${res.status}`);
          }
          const remote = JSON.parse(res.body) as RemotePlaybackState;
          if (!remote.tracks || remote.tracks.length === 0) {
            if (!silent) {
              toast.info('Nothing playing on your other device');
            }
            return;
          }
          const q = useQueueStore.getState();
          q.clearQueue();
          q.addToQueue(remote.tracks);
          const idx = Math.max(
            0,
            Math.min(remote.tracks.length - 1, remote.currentIndex ?? 0),
          );
          q.goToIndex(idx);
          playbackManager.play();
          if (typeof remote.seek === 'number' && remote.seek > 1) {
            window.setTimeout(() => {
              useSoundStore.getState().seekTo(remote.seek);
            }, 1600);
          }
          set((s) => ({
            remoteState: s.remoteState
              ? { ...s.remoteState, isPlaying: false }
              : null,
          }));
          if (!silent) {
            toast.success(
              `🎧 Switched playback here: ${remote.title || 'Queue'}`,
            );
          }
        } catch (err) {
          if (!silent) {
            toast.error(
              `Switch failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      },

      syncWithPeer: async (silent = false) => {
        if (get().syncing) {
          return;
        }
        const target = parsePeerTarget(get().peerAddress, get().pin);
        if (!target) {
          if (!silent) {
            toast.error('Enter your other device’s Pairing Code (IP:Port|PIN)');
          }
          return;
        }

        set({ syncing: true });
        try {
          const localSnap = await get().pushLocalSnapshotToRust();
          const res = await httpHost.fetch(target.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-nuclear-pin': target.pin,
            },
            body: JSON.stringify(localSnap),
          });

          if (res.status === 401) {
            throw new Error('Wrong pairing PIN');
          }
          if (res.status < 200 || res.status >= 300) {
            throw new Error(`Peer returned HTTP ${res.status}`);
          }

          const remoteSnap = JSON.parse(res.body) as SyncSnapshot;
          const result = await mergeRemoteSnapshot(remoteSnap);
          await get().pushLocalSnapshotToRust();

          const summary = `Merged (+${result.playlistsAdded} playlists, ${result.playlistsMerged} updated, +${result.favoritesAdded} favs)`;
          set({
            syncing: false,
            lastSyncedIso: new Date().toISOString(),
            lastSummary: summary,
          });
          if (!silent) {
            toast.success(`🔗 Peer Sync: ${summary}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          set({ syncing: false, lastSummary: `Sync failed: ${msg}` });
          if (!silent) {
            toast.error(`Peer Sync failed: ${msg}`);
          }
        }
      },

      sendHandoffToPeer: async (silent = false) => {
        const target = parsePeerTarget(get().peerAddress, get().pin);
        if (!target) {
          if (!silent) {
            toast.error('Link your other device in P2P Sync first!');
          }
          return;
        }
        const queue = useQueueStore.getState();
        const cur = queue.getCurrentItem();
        if (!cur) {
          if (!silent) {
            toast.info('Play a track first to hand off!');
          }
          return;
        }
        const sound = useSoundStore.getState();
        const start = Math.max(0, queue.currentIndex - 5);
        const slice = queue.items.slice(start, start + 35).map((i) => i.track);
        const relIndex = queue.currentIndex - start;
        const handoffUrl = target.url.replace(/\/exchange$/, '/handoff');

        try {
          const res = await httpHost.fetch(handoffUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-nuclear-pin': target.pin,
            },
            body: JSON.stringify({
              tracks: slice,
              currentIndex: relIndex,
              seekSec: sound.seek,
              isPlaying: sound.status === 'playing',
            }),
          });
          if (res.status < 200 || res.status >= 300) {
            throw new Error(`Peer returned HTTP ${res.status}`);
          }
          playbackManager.pause();
          window.setTimeout(() => {
            void get().pollRemoteState();
          }, 500);
          if (!silent) {
            toast.success(
              `🚀 Playing on your other device: "${cur.track.title}"`,
            );
          }
        } catch (err) {
          if (!silent) {
            toast.error(
              `Handoff failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      },
    }),
    {
      name: 'nuclear-p2p-sync-v1',
      partialize: (s) => ({
        enabled: s.enabled,
        pin: s.pin,
        peerAddress: s.peerAddress,
        autoSyncOnLaunch: s.autoSyncOnLaunch,
        seamlessHandoff: s.seamlessHandoff,
        lastSyncedIso: s.lastSyncedIso,
        lastSummary: s.lastSummary,
        deletedPlaylists: s.deletedPlaylists,
      }),
    },
  ),
);

let p2pInitialized = false;
export const initP2pSync = () => {
  if (p2pInitialized || typeof window === 'undefined') {
    return;
  }
  p2pInitialized = true;

  const store = useP2pSyncStore.getState();
  void store.refreshLocalInfo().then(() => store.pushLocalSnapshotToRust());

  // Listen for incoming syncs initiated by the other device
  void listen<string>('p2p-sync-incoming', async (event) => {
    try {
      const remoteSnap = JSON.parse(event.payload) as SyncSnapshot;
      const result = await mergeRemoteSnapshot(remoteSnap);
      await useP2pSyncStore.getState().pushLocalSnapshotToRust();
      const summary = `Received sync (+${result.playlistsAdded} playlists, ${result.playlistsMerged} updated, +${result.favoritesAdded} favs)`;
      useP2pSyncStore.setState({ lastSummary: summary });
      toast.success(`🔗 ${summary}`);
    } catch {
      // ignore malformed payload
    }
  }).catch(() => {});

  // Listen for Instant Handoff from the paired device
  void listen<string>('p2p-handoff-incoming', (event) => {
    try {
      const payload = JSON.parse(event.payload) as {
        tracks?: Track[];
        currentIndex?: number;
        seekSec?: number;
        isPlaying?: boolean;
      };
      if (!payload.tracks || payload.tracks.length === 0) {
        return;
      }
      const q = useQueueStore.getState();
      q.clearQueue();
      q.addToQueue(payload.tracks);
      const idx = Math.max(
        0,
        Math.min(payload.tracks.length - 1, payload.currentIndex ?? 0),
      );
      q.goToIndex(idx);
      if (payload.isPlaying !== false) {
        playbackManager.play();
      }
      if (typeof payload.seekSec === 'number' && payload.seekSec > 1) {
        window.setTimeout(() => {
          useSoundStore.getState().seekTo(payload.seekSec!);
        }, 1800);
      }
      toast.success(
        `🚀 Handoff received: ${payload.tracks[idx]?.title ?? 'Queue'}`,
      );
    } catch {
      // ignore malformed handoff
    }
  }).catch(() => {});

  // Listen for Remote Control commands from the paired device (Play/Pause/Next/Prev/Seek/Volume)
  void listen<string>('p2p-remote-control', (event) => {
    try {
      const cmd = JSON.parse(event.payload) as {
        action?: RemoteControlAction;
        value?: number;
      };
      const queue = useQueueStore.getState();
      switch (cmd.action) {
        case 'play':
          playbackManager.play();
          break;
        case 'pause':
          playbackManager.pause();
          break;
        case 'toggle':
          playbackManager.toggle();
          break;
        case 'next':
          queue.goToNext();
          break;
        case 'previous':
          if (useSoundStore.getState().seek > 3) {
            useSoundStore.getState().seekTo(0);
          } else {
            queue.goToPrevious();
          }
          break;
        case 'seek':
          if (typeof cmd.value === 'number') {
            useSoundStore.getState().seekTo(cmd.value);
          }
          break;
        case 'volume':
          if (typeof cmd.value === 'number') {
            const v = Math.max(0, Math.min(1, cmd.value));
            void useSettingsStore
              .getState()
              .setValue('core.playback.volume', v);
            const audio = document.querySelector('audio');
            if (audio) {
              audio.volume = v;
            }
          }
          break;
      }
      window.setTimeout(() => {
        void useP2pSyncStore.getState().pushLocalPlaybackToRust();
      }, 200);
    } catch {
      // ignore
    }
  }).catch(() => {});

  // Listen for Pull-Handoff pause (other device seamlessly took over playback)
  void listen<string>('p2p-handoff-pause', () => {
    playbackManager.pause();
    toast.info('🎧 Playback moved to your other device');
    window.setTimeout(() => {
      void useP2pSyncStore.getState().pushLocalPlaybackToRust();
    }, 200);
  }).catch(() => {});

  // Push live playback state to Rust so the other device can see & control us
  let lastPlaybackPush = 0;
  const pushPlaybackThrottled = (force = false) => {
    const now = Date.now();
    if (!force && now - lastPlaybackPush < 1000) {
      return;
    }
    lastPlaybackPush = now;
    void useP2pSyncStore.getState().pushLocalPlaybackToRust();
  };
  useQueueStore.subscribe(() => pushPlaybackThrottled(true));
  let wasPlayingLocally = false;
  useSoundStore.subscribe((s) => {
    const nowPlaying = s.status === 'playing';
    const flipped = nowPlaying !== wasPlayingLocally;
    wasPlayingLocally = nowPlaying;
    pushPlaybackThrottled(flipped);
    // One-device-at-a-time: if user hits Play here while other device is playing, pause other device!
    if (flipped && nowPlaying) {
      const p2p = useP2pSyncStore.getState();
      if (p2p.remoteState?.isPlaying) {
        void p2p.sendRemoteControl('pause');
      }
    }
  });
  pushPlaybackThrottled(true);

  // Poll paired peer's live playback state every 2.5s while app is visible
  window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      const p2p = useP2pSyncStore.getState();
      if (p2p.peerAddress.trim()) {
        void p2p.pollRemoteState();
      }
    }
  }, 2500);

  // Seamless Auto-Handoff: when you open/focus this device while your other device is playing,
  // automatically pull playback here without touching anything!
  let lastAutoPullAt = 0;
  const trySeamlessAutoPull = async () => {
    const now = Date.now();
    if (now - lastAutoPullAt < 12000) {
      return;
    }
    const p2p = useP2pSyncStore.getState();
    if (!p2p.seamlessHandoff || !p2p.peerAddress.trim()) {
      return;
    }
    if (useSoundStore.getState().status === 'playing') {
      return;
    }
    const remote = await p2p.pollRemoteState();
    if (remote?.isPlaying && remote.tracks && remote.tracks.length > 0) {
      lastAutoPullAt = Date.now();
      await p2p.pullHandoffFromPeer(false);
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void trySeamlessAutoPull();
    }
  });
  window.addEventListener('focus', () => {
    void trySeamlessAutoPull();
  });

  // Keep cached snapshot fresh when playlists or favorites change, and track deleted playlist IDs
  let prevPlaylistIds = new Set(
    flattenPlaylistIds(usePlaylistStore.getState().index),
  );
  let refreshTimer: number | undefined;
  const scheduleRefresh = () => {
    const currentIds = new Set(
      flattenPlaylistIds(usePlaylistStore.getState().index),
    );
    if (usePlaylistStore.getState().loaded) {
      for (const oldId of prevPlaylistIds) {
        if (!currentIds.has(oldId)) {
          useP2pSyncStore.getState().recordPlaylistDeletion(oldId);
        }
      }
      prevPlaylistIds = currentIds;
    }
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      void useP2pSyncStore.getState().pushLocalSnapshotToRust();
    }, 1500);
  };
  usePlaylistStore.subscribe(scheduleRefresh);
  useFavoritesStore.subscribe(scheduleRefresh);

  // Auto-sync with paired peer shortly after launch
  window.setTimeout(() => {
    const s = useP2pSyncStore.getState();
    if (s.autoSyncOnLaunch && s.peerAddress.trim()) {
      void s.syncWithPeer(true);
    }
  }, 4500);
};
