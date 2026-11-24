import { toast } from 'sonner';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type {
  PlaylistIndexNode,
  PlaylistItem,
  Track,
} from '@nuclearplayer/model';

import { useFavoritesStore } from '../stores/favoritesStore';
import { usePlaylistStore } from '../stores/playlistStore';
import { useQueueStore } from '../stores/queue/queueStore';
import { httpHost } from './httpHost';
import { playbackManager } from './playback';
import { commands } from './tauri/bindings';
import { useWrappedStatsStore } from './wrappedStats';

export type PersonalizedTrackItem = {
  track: Track;
  reason: string;
  seedArtist: string;
};

export type PersonalizedArtistCard = {
  id: string;
  name: string;
  imageUrl?: string;
  reason: string;
};

export type PersonalizedAlbumCard = {
  id: string;
  title: string;
  artistName: string;
  coverUrl?: string;
  releaseDate?: string;
  recordType?: string;
};

export type PersonalizedMixCard = {
  id: string;
  title: string;
  pictureUrl?: string;
  trackCount: number;
  seedArtist: string;
};

export type ArtistSeedShelf = {
  seedArtist: string;
  seedImageUrl?: string;
  tracks: Track[];
};

export type PersonalizedFeedData = {
  seedArtists: string[];
  recommendedTracks: PersonalizedTrackItem[];
  artistShelves: ArtistSeedShelf[];
  similarArtists: PersonalizedArtistCard[];
  albums: PersonalizedAlbumCard[];
  mixes: PersonalizedMixCard[];
  updatedAtMs: number;
};

export type SeedProfile = {
  seedArtists: string[];
  knownTrackKeys: Set<string>;
  overplayedKeys: Set<string>;
  signature: string;
};

type DeezerArtistSearchItem = {
  id: number;
  name: string;
  picture_medium?: string;
  picture_big?: string;
};

type DeezerTrackItem = {
  id: number;
  title?: string;
  duration?: number;
  link?: string;
  artist?: {
    id?: number;
    name?: string;
    picture_medium?: string;
    picture_big?: string;
  };
  album?: {
    id?: number;
    title?: string;
    cover_medium?: string;
    cover_big?: string;
  };
};

type DeezerRelatedArtist = {
  id: number;
  name?: string;
  picture_medium?: string;
  picture_big?: string;
  nb_fan?: number;
};

type DeezerAlbumItem = {
  id: number;
  title?: string;
  cover_medium?: string;
  cover_big?: string;
  release_date?: string;
  record_type?: string;
};

type DeezerPlaylistSearchItem = {
  id: number;
  title?: string;
  nb_tracks?: number;
  picture_medium?: string;
  picture_big?: string;
};

type ItunesSearchResult = {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
  releaseDate?: string;
};

const FEED_STALE_MS = 20 * 60 * 1000;

const IGNORED_ARTISTS = new Set([
  '',
  'unknown',
  'unknown artist',
  'various artists',
  'personalized',
  'offline',
]);

export const normTrackKey = (title: string, artist: string): string =>
  `${title.toLowerCase().trim()}::${artist.toLowerCase().trim()}`;

const normArtistKey = (name: string): string => name.toLowerCase().trim();

const isValidArtistName = (name?: string | null): name is string => {
  if (!name) {
    return false;
  }
  const normalized = normArtistKey(name);
  return normalized.length > 0 && !IGNORED_ARTISTS.has(normalized);
};

const flattenPlaylistIds = (nodes: PlaylistIndexNode[]): string[] => {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.kind === 'playlist') {
      ids.push(node.id);
    } else if (node.kind === 'folder') {
      for (const child of node.playlists) {
        ids.push(child.id);
      }
    }
  }
  return ids;
};

const fetchJson = async <T>(url: string): Promise<T | null> => {
  try {
    const res = await httpHost.fetch(url);
    if (res.status < 200 || res.status >= 300 || !res.body) {
      return null;
    }
    return JSON.parse(res.body) as T;
  } catch {
    return null;
  }
};

const mapDeezerTrack = (
  item: DeezerTrackItem,
  fallbackCover?: string,
  fallbackAlbumTitle?: string,
  fallbackAlbumId?: string,
): Track | null => {
  const title = item.title?.trim();
  const artistName = item.artist?.name?.trim();
  if (!title || !artistName) {
    return null;
  }
  const coverUrl =
    item.album?.cover_big ?? item.album?.cover_medium ?? fallbackCover;
  const albumTitle = item.album?.title ?? fallbackAlbumTitle;
  const albumId = item.album?.id ? String(item.album.id) : fallbackAlbumId;

  return {
    title,
    artists: [
      {
        name: artistName,
        roles: [],
        source: {
          provider: 'deezer-rec',
          id: String(item.artist?.id ?? normArtistKey(artistName)),
        },
      },
    ],
    album: albumTitle
      ? {
          title: albumTitle,
          artwork: coverUrl
            ? { items: [{ url: coverUrl, purpose: 'cover' }] }
            : undefined,
          source: {
            provider: 'deezer-rec',
            id: albumId ?? `album:${albumTitle}`,
          },
        }
      : undefined,
    durationMs:
      typeof item.duration === 'number' && item.duration > 0
        ? item.duration * 1000
        : undefined,
    artwork: coverUrl
      ? { items: [{ url: coverUrl, purpose: 'thumbnail' }] }
      : undefined,
    source: {
      provider: 'deezer-rec',
      id: `deezer:${item.id}`,
      url: item.link,
    },
  };
};

const mapItunesTrack = (item: ItunesSearchResult): Track | null => {
  const title = item.trackName?.trim();
  const artistName = item.artistName?.trim();
  if (!title || !artistName) {
    return null;
  }
  const coverUrl = item.artworkUrl100?.replace('100x100', '512x512');
  return {
    title,
    artists: [
      {
        name: artistName,
        roles: [],
        source: { provider: 'itunes-rec', id: `artist:${artistName}` },
      },
    ],
    album: item.collectionName
      ? {
          title: item.collectionName,
          artwork: coverUrl
            ? { items: [{ url: coverUrl, purpose: 'cover' }] }
            : undefined,
          source: {
            provider: 'itunes-rec',
            id: `album:${item.collectionName}`,
          },
        }
      : undefined,
    durationMs: item.trackTimeMillis,
    artwork: coverUrl
      ? { items: [{ url: coverUrl, purpose: 'thumbnail' }] }
      : undefined,
    source: {
      provider: 'itunes-rec',
      id: `itunes:${item.trackId ?? normTrackKey(title, artistName)}`,
    },
  };
};

/**
 * Extracts user's top seed artists & played tracks across Wrapped stats,
 * SQLite playback history, Favorites, and local/synced Playlists.
 */
export const collectSeedProfile = async (): Promise<SeedProfile> => {
  const artistScores = new Map<string, { name: string; score: number }>();
  const knownTrackKeys = new Set<string>();
  const overplayedKeys = new Set<string>();
  const historyPlayCounts = new Map<string, number>();

  const bumpArtist = (rawName: string | undefined | null, delta: number) => {
    if (!isValidArtistName(rawName)) {
      return;
    }
    const key = normArtistKey(rawName);
    const prev = artistScores.get(key);
    if (prev) {
      prev.score += delta;
    } else {
      artistScores.set(key, { name: rawName.trim(), score: delta });
    }
  };

  // 1. Wrapped stats (in-session / localStorage)
  const wrapped = useWrappedStatsStore.getState();
  for (const stat of Object.values(wrapped.artistStats)) {
    bumpArtist(stat.name, stat.plays * 4 + stat.seconds / 45);
  }
  for (const trackStat of Object.values(wrapped.trackStats)) {
    const k = normTrackKey(trackStat.title, trackStat.artist);
    knownTrackKeys.add(k);
    if (trackStat.plays >= 2) {
      overplayedKeys.add(k);
    }
  }

  // 2. Rust SQLite listening history (skipped in Vitest test mode to keep tests offline/deterministic)
  if (import.meta.env.MODE !== 'test') {
    try {
      const [recentRes, topArtistsRes] = await Promise.all([
        commands.historyFetch({ limit: 30, offset: 0 }),
        commands.historyTopArtists(
          { from: 0, to: Date.now() + 86_400_000 },
          12,
        ),
      ]);

      if (recentRes?.items) {
        recentRes.items.forEach((entry, idx) => {
          const primaryArtist = entry.artists?.[0];
          bumpArtist(primaryArtist, idx < 10 ? 12 : 6);
          if (entry.title && primaryArtist) {
            const k = normTrackKey(entry.title, primaryArtist);
            knownTrackKeys.add(k);
            const nextCount = (historyPlayCounts.get(k) ?? 0) + 1;
            historyPlayCounts.set(k, nextCount);
            if (nextCount >= 2) {
              overplayedKeys.add(k);
            }
          }
        });
      }

      if (Array.isArray(topArtistsRes)) {
        for (const topArtist of topArtistsRes) {
          bumpArtist(
            topArtist.name,
            topArtist.plays * 3 + topArtist.msPlayed / 60000,
          );
        }
      }
    } catch {
      // History DB may not be ready in browser preview or early boot
    }
  }

  // 3. Favorites
  const favorites = useFavoritesStore.getState();
  for (const favArtist of favorites.artists) {
    bumpArtist(favArtist.ref.name, 8);
  }
  for (const favTrack of favorites.tracks) {
    const primaryArtist = favTrack.ref.artists?.[0]?.name;
    bumpArtist(primaryArtist, 8);
    if (favTrack.ref.title && primaryArtist) {
      knownTrackKeys.add(normTrackKey(favTrack.ref.title, primaryArtist));
    }
  }

  // 4. Local & synced playlists (useful for cold starts or synced Spotify libraries)
  const playlistState = usePlaylistStore.getState();
  for (const playlist of playlistState.playlists.values()) {
    for (const item of playlist.items) {
      const primaryArtist = item.track.artists?.[0]?.name;
      bumpArtist(primaryArtist, 2);
      if (item.track.title && primaryArtist) {
        knownTrackKeys.add(normTrackKey(item.track.title, primaryArtist));
      }
    }
  }

  if (import.meta.env.MODE !== 'test' && artistScores.size < 3) {
    const plIds = flattenPlaylistIds(playlistState.index).slice(0, 5);
    for (const id of plIds) {
      if (playlistState.playlists.has(id)) {
        continue;
      }
      try {
        const loaded = await playlistState.loadPlaylist(id);
        if (!loaded) {
          continue;
        }
        for (const item of loaded.items) {
          const primaryArtist = item.track.artists?.[0]?.name;
          bumpArtist(primaryArtist, 2);
          if (item.track.title && primaryArtist) {
            knownTrackKeys.add(normTrackKey(item.track.title, primaryArtist));
          }
        }
      } catch {
        // Ignore individual playlist read failures
      }
    }
  }

  const rankedArtists = Array.from(artistScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((a) => a.name);

  const signature = rankedArtists
    .slice(0, 5)
    .map((name) => normArtistKey(name))
    .join('|');

  return {
    seedArtists: rankedArtists,
    knownTrackKeys,
    overplayedKeys,
    signature,
  };
};

type SeedFetchBundle = {
  seedArtist: string;
  seedImageUrl?: string;
  radioTracks: Track[];
  relatedArtists: Array<DeezerRelatedArtist & { seedArtist: string }>;
  albums: PersonalizedAlbumCard[];
  mixes: PersonalizedMixCard[];
};

const fetchSeedBundle = async (
  seedArtist: string,
): Promise<SeedFetchBundle> => {
  const artistSearch = await fetchJson<{ data?: DeezerArtistSearchItem[] }>(
    `https://api.deezer.com/search/artist?q=${encodeURIComponent(seedArtist)}&limit=3`,
  );

  const candidates = artistSearch?.data ?? [];
  const exact = candidates.find(
    (a) => normArtistKey(a.name) === normArtistKey(seedArtist),
  );
  const matched = exact ?? candidates[0];

  if (matched?.id) {
    const [radioRes, relatedRes, albumsRes, mixesRes] = await Promise.all([
      fetchJson<{ data?: DeezerTrackItem[] }>(
        `https://api.deezer.com/artist/${matched.id}/radio?limit=16`,
      ),
      fetchJson<{ data?: DeezerRelatedArtist[] }>(
        `https://api.deezer.com/artist/${matched.id}/related?limit=8`,
      ),
      fetchJson<{ data?: DeezerAlbumItem[] }>(
        `https://api.deezer.com/artist/${matched.id}/albums?limit=6`,
      ),
      fetchJson<{ data?: DeezerPlaylistSearchItem[] }>(
        `https://api.deezer.com/search/playlist?q=${encodeURIComponent(seedArtist)}&limit=4`,
      ),
    ]);

    let rawTracks = radioRes?.data ?? [];
    if (rawTracks.length === 0) {
      const topRes = await fetchJson<{ data?: DeezerTrackItem[] }>(
        `https://api.deezer.com/artist/${matched.id}/top?limit=12`,
      );
      rawTracks = topRes?.data ?? [];
    }

    const radioTracks = rawTracks
      .map((item) => mapDeezerTrack(item))
      .filter((track): track is Track => track !== null);

    if (radioTracks.length > 0) {
      const relatedArtists = (relatedRes?.data ?? []).map((rel) => ({
        ...rel,
        seedArtist,
      }));

      const albums: PersonalizedAlbumCard[] = [];
      for (const alb of albumsRes?.data ?? []) {
        if (!alb.id || !alb.title) {
          continue;
        }
        albums.push({
          id: String(alb.id),
          title: alb.title,
          artistName: matched.name || seedArtist,
          coverUrl: alb.cover_big ?? alb.cover_medium,
          releaseDate: alb.release_date,
          recordType: alb.record_type,
        });
      }

      const mixes: PersonalizedMixCard[] = [];
      for (const pl of mixesRes?.data ?? []) {
        if (!pl.id || !pl.title || (pl.nb_tracks ?? 0) < 8) {
          continue;
        }
        mixes.push({
          id: String(pl.id),
          title: pl.title,
          pictureUrl: pl.picture_big ?? pl.picture_medium,
          trackCount: pl.nb_tracks ?? 0,
          seedArtist,
        });
      }

      return {
        seedArtist,
        seedImageUrl: matched.picture_big ?? matched.picture_medium,
        radioTracks,
        relatedArtists,
        albums,
        mixes,
      };
    }
  }

  // Fallback to iTunes Search for niche/indie artists missing from Deezer
  const itunesRes = await fetchJson<{ results?: ItunesSearchResult[] }>(
    `https://itunes.apple.com/search?term=${encodeURIComponent(seedArtist)}&entity=song&limit=15`,
  );
  const radioTracks: Track[] = [];
  const albumMap = new Map<string, PersonalizedAlbumCard>();

  for (const item of itunesRes?.results ?? []) {
    const track = mapItunesTrack(item);
    if (track) {
      radioTracks.push(track);
      if (item.collectionName) {
        const albumKey = normTrackKey(
          item.collectionName,
          item.artistName ?? seedArtist,
        );
        if (!albumMap.has(albumKey)) {
          albumMap.set(albumKey, {
            id: `itunes:${albumKey}`,
            title: item.collectionName,
            artistName: item.artistName ?? seedArtist,
            coverUrl: item.artworkUrl100?.replace('100x100', '512x512'),
            releaseDate: item.releaseDate?.slice(0, 10),
            recordType: 'album',
          });
        }
      }
    }
  }

  return {
    seedArtist,
    radioTracks,
    relatedArtists: [],
    albums: Array.from(albumMap.values()).slice(0, 4),
    mixes: [],
  };
};

export const fetchPersonalizedFeedFromSeeds = async (
  profile: SeedProfile,
): Promise<PersonalizedFeedData> => {
  const activeSeeds = profile.seedArtists.slice(0, 5);
  const bundles = await Promise.all(activeSeeds.map(fetchSeedBundle));

  // Interleave tracks round-robin across seeds, excluding overplayed tracks
  const recommendedTracks: PersonalizedTrackItem[] = [];
  const seenRecommendedKeys = new Set<string>();
  const maxLen = Math.max(0, ...bundles.map((b) => b.radioTracks.length));

  for (let i = 0; i < maxLen && recommendedTracks.length < 16; i++) {
    for (const bundle of bundles) {
      if (recommendedTracks.length >= 16) {
        break;
      }
      const track = bundle.radioTracks[i];
      if (!track) {
        continue;
      }
      const k = normTrackKey(track.title, track.artists?.[0]?.name ?? '');
      if (profile.overplayedKeys.has(k) || seenRecommendedKeys.has(k)) {
        continue;
      }
      seenRecommendedKeys.add(k);
      recommendedTracks.push({
        track,
        seedArtist: bundle.seedArtist,
        reason: `Inspired by ${bundle.seedArtist}`,
      });
    }
  }

  // "Because You Listen to <Artist>" shelves (up to top 3 seeds with >= 4 tracks)
  const artistShelves: ArtistSeedShelf[] = [];
  for (const bundle of bundles) {
    if (artistShelves.length >= 3) {
      break;
    }
    const dedupedTracks: Track[] = [];
    const seenShelfKeys = new Set<string>();
    for (const track of bundle.radioTracks) {
      const k = normTrackKey(track.title, track.artists?.[0]?.name ?? '');
      if (seenShelfKeys.has(k)) {
        continue;
      }
      seenShelfKeys.add(k);
      dedupedTracks.push(track);
      if (dedupedTracks.length >= 10) {
        break;
      }
    }
    if (dedupedTracks.length >= 4) {
      artistShelves.push({
        seedArtist: bundle.seedArtist,
        seedImageUrl: bundle.seedImageUrl,
        tracks: dedupedTracks,
      });
    }
  }

  // Similar artists aggregated & boosted by overlap across seeds
  const topThreeSeedKeys = new Set(
    profile.seedArtists.slice(0, 3).map(normArtistKey),
  );
  const similarArtistScores = new Map<
    string,
    { card: PersonalizedArtistCard; score: number }
  >();

  for (const bundle of bundles) {
    for (const rel of bundle.relatedArtists) {
      if (!rel.name || !rel.id) {
        continue;
      }
      const key = normArtistKey(rel.name);
      if (topThreeSeedKeys.has(key)) {
        continue;
      }
      const existing = similarArtistScores.get(key);
      if (existing) {
        existing.score += 10;
      } else {
        similarArtistScores.set(key, {
          card: {
            id: String(rel.id),
            name: rel.name,
            imageUrl: rel.picture_big ?? rel.picture_medium,
            reason: `Similar to ${rel.seedArtist}`,
          },
          score: 10 + (rel.nb_fan ? Math.log10(Math.max(1, rel.nb_fan)) : 0),
        });
      }
    }
  }

  const similarArtists = Array.from(similarArtistScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((entry) => entry.card);

  // Albums & New Releases sorted newest first
  const albumMap = new Map<string, PersonalizedAlbumCard>();
  for (const bundle of bundles) {
    for (const alb of bundle.albums) {
      const k = normTrackKey(alb.title, alb.artistName);
      if (!albumMap.has(k)) {
        albumMap.set(k, alb);
      }
    }
  }
  const albums = Array.from(albumMap.values())
    .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
    .slice(0, 12);

  // Mixes
  const mixMap = new Map<string, PersonalizedMixCard>();
  for (const bundle of bundles) {
    for (const mix of bundle.mixes) {
      if (!mixMap.has(mix.id)) {
        mixMap.set(mix.id, mix);
      }
    }
  }
  const mixes = Array.from(mixMap.values()).slice(0, 8);

  return {
    seedArtists: profile.seedArtists,
    recommendedTracks,
    artistShelves,
    similarArtists,
    albums,
    mixes,
    updatedAtMs: Date.now(),
  };
};

export const playRecommendedAlbum = async (
  album: PersonalizedAlbumCard,
): Promise<boolean> => {
  if (!album.id || album.id.startsWith('itunes:')) {
    return false;
  }
  const data = await fetchJson<{ data?: DeezerTrackItem[] }>(
    `https://api.deezer.com/album/${encodeURIComponent(album.id)}/tracks?limit=50`,
  );
  const tracks = (data?.data ?? [])
    .map((item) =>
      mapDeezerTrack(
        {
          ...item,
          artist: item.artist?.name ? item.artist : { name: album.artistName },
        },
        album.coverUrl,
        album.title,
        album.id,
      ),
    )
    .filter((t): t is Track => t !== null);

  if (tracks.length === 0) {
    return false;
  }
  const q = useQueueStore.getState();
  q.clearQueue();
  q.addToQueue(tracks);
  playbackManager.play();
  toast.success(`Playing "${album.title}" (${tracks.length} tracks)`);
  return true;
};

export const playOrSaveRecommendedMix = async (
  mix: PersonalizedMixCard,
  mode: 'play' | 'save',
): Promise<string | null> => {
  const data = await fetchJson<{
    id?: number;
    title?: string;
    picture_big?: string;
    picture_medium?: string;
    tracks?: { data?: DeezerTrackItem[] };
  }>(`https://api.deezer.com/playlist/${encodeURIComponent(mix.id)}`);

  const tracks = (data?.tracks?.data ?? [])
    .map((item) => mapDeezerTrack(item))
    .filter((t): t is Track => t !== null);

  if (tracks.length === 0) {
    toast.error(`Could not load tracks for "${mix.title}"`);
    return null;
  }

  if (mode === 'play') {
    const q = useQueueStore.getState();
    q.clearQueue();
    q.addToQueue(tracks);
    playbackManager.play();
    toast.success(`Playing "${mix.title}" (${tracks.length} tracks)`);
    return mix.id;
  }

  const now = new Date().toISOString();
  const artworkUrl =
    data?.picture_big ?? data?.picture_medium ?? mix.pictureUrl;
  const items: PlaylistItem[] = tracks.map((track, idx) => ({
    id: `${mix.id}-${idx}-${Date.now()}`,
    track,
    addedAtIso: now,
  }));

  const playlistId = await usePlaylistStore.getState().importPlaylist({
    id: mix.id,
    name: mix.title,
    description: `Recommended mix based on ${mix.seedArtist}`,
    artwork: artworkUrl
      ? { items: [{ url: artworkUrl, purpose: 'cover' }] }
      : undefined,
    createdAtIso: now,
    lastModifiedIso: now,
    isReadOnly: false,
    items,
  });

  toast.success(`Saved "${mix.title}" to your playlists`);
  return playlistId;
};

export const playSimilarArtistMix = async (
  artist: PersonalizedArtistCard,
): Promise<boolean> => {
  let tracks: Track[] = [];

  if (/^\d+$/.test(artist.id)) {
    const data = await fetchJson<{ data?: DeezerTrackItem[] }>(
      `https://api.deezer.com/artist/${encodeURIComponent(artist.id)}/top?limit=15`,
    );
    tracks = (data?.data ?? [])
      .map((item) => mapDeezerTrack(item, artist.imageUrl))
      .filter((t): t is Track => t !== null);
  }

  if (tracks.length === 0 && artist.name.trim()) {
    const itunes = await fetchJson<{ results?: ItunesSearchResult[] }>(
      `https://itunes.apple.com/search?term=${encodeURIComponent(artist.name)}&entity=song&limit=15`,
    );
    const targetName = artist.name.trim().toLowerCase();
    const mapped = (itunes?.results ?? [])
      .map((item) => mapItunesTrack(item))
      .filter((t): t is Track => t !== null);
    const artistMatched = mapped.filter((t) =>
      t.artists.some((a) => a.name.trim().toLowerCase().includes(targetName)),
    );
    tracks = (artistMatched.length > 0 ? artistMatched : mapped).slice(0, 15);
  }

  if (tracks.length === 0) {
    return false;
  }
  playbackManager.playTracks(tracks);
  toast.success(`Playing top tracks by ${artist.name}`);
  return true;
};

type PersonalizedFeedStoreState = {
  feed: PersonalizedFeedData | null;
  lastSignature: string;
  loading: boolean;
  refreshFeed: (force?: boolean) => Promise<void>;
  clearFeed: () => void;
};

export const usePersonalizedFeedStore = create<PersonalizedFeedStoreState>()(
  persist(
    (set, get) => ({
      feed: null,
      lastSignature: '',
      loading: false,

      clearFeed: () => set({ feed: null, lastSignature: '', loading: false }),

      refreshFeed: async (force = false) => {
        if (import.meta.env.MODE === 'test' && !force) {
          return;
        }
        if (get().loading) {
          return;
        }

        const profile = await collectSeedProfile();
        if (profile.seedArtists.length === 0) {
          set({ feed: null, lastSignature: '' });
          return;
        }

        const { feed, lastSignature } = get();
        const isFresh =
          Boolean(feed) &&
          lastSignature === profile.signature &&
          Date.now() - (feed?.updatedAtMs ?? 0) < FEED_STALE_MS &&
          (feed?.recommendedTracks.length ?? 0) > 0;

        if (!force && isFresh) {
          return;
        }

        set({ loading: true });
        try {
          const nextFeed = await fetchPersonalizedFeedFromSeeds(profile);
          set({
            feed: nextFeed,
            lastSignature: profile.signature,
            loading: false,
          });
        } catch {
          set({ loading: false });
        }
      },
    }),
    {
      name: 'nuclear-personalized-feed-v1',
      partialize: (state) => ({
        feed: state.feed,
        lastSignature: state.lastSignature,
      }),
    },
  ),
);
