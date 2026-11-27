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

type PathfinderTrackItem = {
  itemV2?: {
    data?: {
      __typename?: string;
      uri?: string;
      name?: string;
      trackDuration?: { totalMilliseconds?: number };
      artists?: {
        items?: Array<{
          uri?: string;
          profile?: { name?: string };
        }>;
      };
      albumOfTrack?: {
        uri?: string;
        name?: string;
        coverArt?: {
          sources?: Array<{ url?: string; width?: number; height?: number }>;
        };
      };
    };
  };
};

type PathfinderPlaylistResponse = {
  data?: {
    playlistV2?: {
      content?: {
        totalCount?: number;
        items?: PathfinderTrackItem[];
      };
    };
  };
};

const PATHFINDER_V2_URL = 'https://api-partner.spotify.com/pathfinder/v2/query';
const FETCH_PLAYLIST_CONTENTS_HASHES = [
  'c56c706a062f82052d87fdaeeb300a258d2d54153222ef360682a0ee625284d9',
  '9c53fb83f35c6a177be88bf1b67cb080b853e86b576ed174216faa8f9164fc8f',
];
const PAGE_LIMIT = 100;
const MAX_PLAYLIST_TRACKS = 5000;
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

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
      'User-Agent': MOBILE_UA,
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (res.status < 200 || res.status >= 400) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.body;
};

const queryPathfinderPlaylistPage = async (
  spotifyPlaylistId: string,
  accessToken: string,
  sha256Hash: string,
  offset: number,
  limit: number,
): Promise<{ totalCount: number; items: PathfinderTrackItem[] }> => {
  const res = await httpHost.fetch(PATHFINDER_V2_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': MOBILE_UA,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    body: JSON.stringify({
      operationName: 'fetchPlaylistContents',
      variables: {
        uri: `spotify:playlist:${spotifyPlaylistId}`,
        offset,
        limit,
      },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash,
        },
      },
    }),
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Pathfinder HTTP ${res.status}`);
  }

  const parsed = JSON.parse(res.body) as PathfinderPlaylistResponse;
  const content = parsed.data?.playlistV2?.content;
  if (!content || !Array.isArray(content.items)) {
    throw new Error('Malformed Pathfinder playlist content response');
  }

  return {
    totalCount:
      typeof content.totalCount === 'number'
        ? content.totalCount
        : content.items.length,
    items: content.items,
  };
};

const mapPathfinderItemToTrack = (
  spotifyPlaylistId: string,
  item: PathfinderTrackItem,
  globalIdx: number,
  fallbackCoverUrl?: string,
): Track | null => {
  const data = item.itemV2?.data;
  if (!data?.name) {
    return null;
  }

  const rawArtists = (data.artists?.items ?? [])
    .map((artist, aIdx) => ({
      name: artist.profile?.name?.trim() || '',
      roles: [] as string[],
      source: {
        provider: 'spotify-sync',
        id: artist.uri || `${spotifyPlaylistId}:artist:${globalIdx}:${aIdx}`,
      },
    }))
    .filter((artist) => artist.name.length > 0);

  const artists =
    rawArtists.length > 0
      ? rawArtists
      : [
          {
            name: 'Unknown Artist',
            roles: [],
            source: {
              provider: 'spotify-sync',
              id: `${spotifyPlaylistId}:artist:${globalIdx}:0`,
            },
          },
        ];

  const coverSources = (data.albumOfTrack?.coverArt?.sources ?? []).filter(
    (source): source is { url: string; width?: number; height?: number } =>
      Boolean(source.url),
  );

  const artworkItems =
    coverSources.length > 0
      ? coverSources.map((source) => ({
          url: source.url,
          width: source.width,
          height: source.height,
          purpose: 'thumbnail' as const,
        }))
      : fallbackCoverUrl
        ? [{ url: fallbackCoverUrl, purpose: 'thumbnail' as const }]
        : undefined;

  return {
    title: data.name,
    artists,
    album: data.albumOfTrack?.name
      ? {
          title: data.albumOfTrack.name,
          source: {
            provider: 'spotify-sync',
            id:
              data.albumOfTrack.uri ||
              `${spotifyPlaylistId}:album:${globalIdx}`,
          },
        }
      : undefined,
    durationMs:
      typeof data.trackDuration?.totalMilliseconds === 'number'
        ? data.trackDuration.totalMilliseconds
        : undefined,
    artwork: artworkItems ? { items: artworkItems } : undefined,
    source: {
      provider: 'spotify-sync',
      id:
        data.uri || `spotify:playlist:${spotifyPlaylistId}:track:${globalIdx}`,
    },
  };
};

export const fetchPathfinderPlaylistTracks = async (
  spotifyPlaylistId: string,
  accessToken: string,
  fallbackCoverUrl?: string,
): Promise<Track[] | null> => {
  let workingHash: string | null = null;
  let totalCount = 0;
  let offset = 0;
  const collected: Track[] = [];

  for (const candidateHash of FETCH_PLAYLIST_CONTENTS_HASHES) {
    try {
      const firstPage = await queryPathfinderPlaylistPage(
        spotifyPlaylistId,
        accessToken,
        candidateHash,
        0,
        PAGE_LIMIT,
      );
      workingHash = candidateHash;
      totalCount = firstPage.totalCount;
      for (const item of firstPage.items) {
        const track = mapPathfinderItemToTrack(
          spotifyPlaylistId,
          item,
          offset,
          fallbackCoverUrl,
        );
        if (track) {
          collected.push(track);
        }
        offset += 1;
      }
      if (firstPage.items.length === 0) {
        return collected;
      }
      break;
    } catch {
      // Try next persisted query hash
    }
  }

  if (!workingHash) {
    return null;
  }

  while (offset < totalCount && offset < MAX_PLAYLIST_TRACKS) {
    try {
      const page = await queryPathfinderPlaylistPage(
        spotifyPlaylistId,
        accessToken,
        workingHash,
        offset,
        PAGE_LIMIT,
      );
      if (page.items.length === 0) {
        break;
      }
      for (const item of page.items) {
        const track = mapPathfinderItemToTrack(
          spotifyPlaylistId,
          item,
          offset,
          fallbackCoverUrl,
        );
        if (track) {
          collected.push(track);
        }
        offset += 1;
      }
    } catch {
      return collected.length > 0 ? collected : null;
    }
  }

  return collected;
};

const parseEmbedPlaylist = (
  spotifyPlaylistId: string,
  html: string,
): {
  name: string;
  coverUrl?: string;
  accessToken?: string;
  tracks: Track[];
} | null => {
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
          settings?: {
            session?: {
              accessToken?: string;
            };
          };
          data?: {
            entity?: SpotifyEmbedEntity;
          };
        };
      };
    };
  };
  const state = json.props?.pageProps?.state;
  const entity = state?.data?.entity;
  if (!entity || !entity.name) {
    return null;
  }
  const accessToken = state?.settings?.session?.accessToken;

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

  return { name: entity.name, coverUrl, accessToken, tracks };
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
          ).slice(0, 50);

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
              const paginatedTracks = parsed.accessToken
                ? await fetchPathfinderPlaylistTracks(
                    spId,
                    parsed.accessToken,
                    parsed.coverUrl,
                  )
                : null;
              const resolvedTracks =
                paginatedTracks && paginatedTracks.length > 0
                  ? paginatedTracks
                  : parsed.tracks;
              totalTracks += resolvedTracks.length;

              const now = new Date().toISOString();
              const items: PlaylistItem[] = resolvedTracks.map((track) => ({
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
