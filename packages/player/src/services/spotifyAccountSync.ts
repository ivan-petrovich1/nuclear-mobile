import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { Playlist, PlaylistItem, Track } from '@nuclearplayer/model';

import { usePlaylistStore } from '../stores/playlistStore';
import { httpHost } from './httpHost';
import { playlistFileService } from './playlistFileService';

type SpotifyEmbedTrack = {
  uri?: string;
  title?: string;
  subtitle?: string;
  duration?: number;
};

type SpotifyEmbedEntity = {
  name?: string;
  subtitle?: string;
  trackList?: SpotifyEmbedTrack[];
  visualIdentity?: {
    image?: Array<{ url?: string; maxWidth?: number; maxHeight?: number }>;
  };
  coverArt?: {
    sources?: Array<{ url?: string; width?: number; height?: number }>;
  };
};

type SpotifySyncState = {
  accountInput: string;
  autoSyncOnLaunch: boolean;
  syncing: boolean;
  lastSyncedIso: string | null;
  lastSummary: string | null;
  /** Maps Spotify playlist ID -> Nuclear playlist ID for in-place updates. */
  syncedMap: Record<string, string>;

  setAccountInput: (val: string) => void;
  setAutoSyncOnLaunch: (val: boolean) => void;
  syncNow: (silent?: boolean) => Promise<void>;
};

export const extractSpotifyUserId = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  const urlMatch = trimmed.match(
    /open\.spotify\.com\/user\/([a-zA-Z0-9._-]+)/i,
  );
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }
  const uriMatch = trimmed.match(/spotify:user:([a-zA-Z0-9._-]+)/i);
  if (uriMatch?.[1]) {
    return uriMatch[1];
  }
  // Plain username (no slashes or spaces)
  if (/^[a-zA-Z0-9._-]{2,}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
};

const fetchText = async (url: string): Promise<string> => {
  const res = await httpHost.fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (res.status < 200 || res.status >= 400) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.body;
};

const parseEmbedPlaylist = (
  spotifyPlaylistId: string,
  html: string,
): { name: string; coverUrl?: string; tracks: Track[] } | null => {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!match?.[1]) {
    return null;
  }
  const json = JSON.parse(match[1]) as {
    props?: {
      pageProps?: {
        state?: {
          data?: {
            entity?: SpotifyEmbedEntity;
          };
        };
      };
    };
  };
  const entity = json.props?.pageProps?.state?.data?.entity;
  if (!entity || !entity.name) {
    return null;
  }

  const coverUrl =
    entity.visualIdentity?.image?.[0]?.url ??
    entity.coverArt?.sources?.[0]?.url;

  const rawTracks = entity.trackList ?? [];
  const tracks: Track[] = rawTracks
    .filter((t) => Boolean(t.title))
    .map((t, idx) => {
      const artists = (t.subtitle || 'Unknown Artist')
        .split(/,\s*/)
        .filter(Boolean)
        .map((name, aIdx) => ({
          name,
          roles: [],
          source: {
            provider: 'spotify-sync',
            id: `${spotifyPlaylistId}:artist:${idx}:${aIdx}`,
          },
        }));
      return {
        title: t.title!,
        artists,
        durationMs: typeof t.duration === 'number' ? t.duration : undefined,
        artwork: coverUrl
          ? { items: [{ url: coverUrl, purpose: 'thumbnail' as const }] }
          : undefined,
        source: {
          provider: 'spotify-sync',
          id: t.uri || `spotify:playlist:${spotifyPlaylistId}:track:${idx}`,
        },
      };
    });

  return { name: entity.name, coverUrl, tracks };
};

export const useSpotifyAccountSyncStore = create<SpotifySyncState>()(
  persist(
    (set, get) => ({
      accountInput: '',
      autoSyncOnLaunch: true,
      syncing: false,
      lastSyncedIso: null,
      lastSummary: null,
      syncedMap: {},

      setAccountInput: (val) => set({ accountInput: val }),
      setAutoSyncOnLaunch: (val) => set({ autoSyncOnLaunch: val }),

      syncNow: async (silent = false) => {
        if (get().syncing) {
          return;
        }
        const userId = extractSpotifyUserId(get().accountInput);
        if (!userId) {
          if (!silent) {
            toast.error('Enter a public Spotify profile URL or username first');
          }
          return;
        }

        set({ syncing: true });
        try {
          const profileUrl = `https://open.spotify.com/user/${encodeURIComponent(userId)}`;
          const profileHtml = await fetchText(profileUrl);

          const idMatches = profileHtml.matchAll(
            /\/playlist\/([a-zA-Z0-9]{22})/g,
          );
          const playlistIds = Array.from(
            new Set(Array.from(idMatches, (m) => m[1])),
          ).slice(0, 25);

          if (playlistIds.length === 0) {
            set({
              syncing: false,
              lastSummary: `No public playlists found for "${userId}"`,
            });
            if (!silent) {
              toast.info(
                `No public playlists found on Spotify profile "${userId}"`,
              );
            }
            return;
          }

          const playlistStore = usePlaylistStore.getState();
          if (!playlistStore.loaded) {
            await playlistStore.loadIndex();
          }

          const nextMap = { ...get().syncedMap };
          let createdCount = 0;
          let updatedCount = 0;
          let totalTracks = 0;

          for (const spId of playlistIds) {
            try {
              const embedHtml = await fetchText(
                `https://open.spotify.com/embed/playlist/${spId}`,
              );
              const parsed = parseEmbedPlaylist(spId, embedHtml);
              if (!parsed || parsed.tracks.length === 0) {
                continue;
              }
              totalTracks += parsed.tracks.length;

              const now = new Date().toISOString();
              const items: PlaylistItem[] = parsed.tracks.map((track) => ({
                id: uuidv4(),
                track,
                addedAtIso: now,
              }));

              const existingNuclearId = nextMap[spId];
              const existingPlaylist = existingNuclearId
                ? await usePlaylistStore
                    .getState()
                    .loadPlaylist(existingNuclearId)
                : null;

              if (existingPlaylist) {
                const updated: Playlist = {
                  ...existingPlaylist,
                  name: parsed.name,
                  description: `Synced from Spotify (@${userId})`,
                  artwork: parsed.coverUrl
                    ? { items: [{ url: parsed.coverUrl, purpose: 'cover' }] }
                    : existingPlaylist.artwork,
                  lastModifiedIso: now,
                  items,
                };
                const index = await playlistFileService.savePlaylist(updated);
                usePlaylistStore.setState((state) => ({
                  playlists: new Map(state.playlists).set(updated.id, updated),
                  index,
                }));
                updatedCount++;
              } else {
                const newId = await usePlaylistStore.getState().importPlaylist({
                  id: uuidv4(),
                  name: parsed.name,
                  description: `Synced from Spotify (@${userId})`,
                  artwork: parsed.coverUrl
                    ? { items: [{ url: parsed.coverUrl, purpose: 'cover' }] }
                    : undefined,
                  createdAtIso: now,
                  lastModifiedIso: now,
                  isReadOnly: false,
                  items,
                });
                nextMap[spId] = newId;
                createdCount++;
              }
            } catch {
              // Skip private/unavailable playlist and continue syncing the rest
            }
          }

          const syncedTotal = createdCount + updatedCount;
          const summary = `Synced ${syncedTotal} playlist${syncedTotal === 1 ? '' : 's'} (${totalTracks} tracks)`;
          set({
            syncing: false,
            syncedMap: nextMap,
            lastSyncedIso: new Date().toISOString(),
            lastSummary: summary,
          });
          if (!silent) {
            toast.success(`🎧 Spotify: ${summary}`);
          }
        } catch (err) {
          set({
            syncing: false,
            lastSummary: `Sync failed: ${err instanceof Error ? err.message : String(err)}`,
          });
          if (!silent) {
            toast.error('Failed to reach Spotify profile');
          }
        }
      },
    }),
    {
      name: 'nuclear-spotify-account-sync-v1',
      partialize: (state) => ({
        accountInput: state.accountInput,
        autoSyncOnLaunch: state.autoSyncOnLaunch,
        lastSyncedIso: state.lastSyncedIso,
        lastSummary: state.lastSummary,
        syncedMap: state.syncedMap,
      }),
    },
  ),
);
