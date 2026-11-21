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
import type { FavoriteEntry } from '@nuclearplayer/plugin-sdk';

import { useFavoritesStore } from '../stores/favoritesStore';
import { usePlaylistStore } from '../stores/playlistStore';
import { useQueueStore } from '../stores/queueStore';
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

type P2pSyncStoreState = {
  enabled: boolean;
  pin: string;
  peerAddress: string; // e.g. "192.168.1.42:37371" or "192.168.1.42:37371|424242"
  autoSyncOnLaunch: boolean;
  syncing: boolean;
  localInfo: P2pPeerInfo | null;
  lastSyncedIso: string | null;
  lastSummary: string | null;
  deletedPlaylists: Record<string, string>;

  setEnabled: (enabled: boolean) => void;
  setPin: (pin: string) => void;
  setPeerAddress: (addr: string) => void;
  setAutoSyncOnLaunch: (enabled: boolean) => void;
  recordPlaylistDeletion: (playlistId: string) => void;
  refreshLocalInfo: () => Promise<void>;
  pushLocalSnapshotToRust: () => Promise<SyncSnapshot>;
  syncWithPeer: (silent?: boolean) => Promise<void>;
  sendHandoffToPeer: () => Promise<void>;
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
): Promise<{ playlistsAdded: number; playlistsMerged: number; favoritesAdded: number }> => {
  const store = useP2pSyncStore.getState();
  const mergedDeleted: Record<string, string> = {
    ...store.deletedPlaylists,
    ...(remote.deletedPlaylists ?? {}),
  };

  const plStore = usePlaylistStore.getState();
  if (!plStore.loaded) {
    await plStore.loadIndex();
  }
  const localIds = new Set(flattenPlaylistIds(usePlaylistStore.getState().index));

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
      const localPl = await usePlaylistStore.getState().loadPlaylist(remotePl.id);
      if (localPl) {
        const remoteNewer = remotePl.lastModifiedIso > localPl.lastModifiedIso;
        const mergedItems = mergePlaylistItems(localPl.items, remotePl.items);
        if (
          mergedItems.length !== localPl.items.length ||
          remoteNewer
        ) {
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
      syncing: false,
      localInfo: null,
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

      sendHandoffToPeer: async () => {
        const target = parsePeerTarget(get().peerAddress, get().pin);
        if (!target) {
          toast.error('Link your other device in P2P Sync first!');
          return;
        }
        const queue = useQueueStore.getState();
        const cur = queue.getCurrentItem();
        if (!cur) {
          toast.info('Play a track first to hand off!');
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
          toast.success(`🚀 Handed off "${cur.track.title}" to your other device!`);
        } catch (err) {
          toast.error(
            `Handoff failed: ${err instanceof Error ? err.message : String(err)}`,
          );
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
