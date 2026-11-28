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
import { useMobileEnhancementsStore } from './mobileEnhancements';
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
  nb_fan?: number;
  nb_album?: number;
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
const MAX_PLAYLISTS_TO_SCAN = 8;
const MAX_TRACKS_PER_ARTIST_PER_PLAYLIST = 12;

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

const normMixTitleKey = (title: string): string =>
  title.toLowerCase().replace(/\s+/g, ' ').trim();

const isValidArtistName = (name?: string | null): name is string => {
  if (!name) {
    return false;
  }
  const normalized = normArtistKey(name);
  return normalized.length > 0 && !IGNORED_ARTISTS.has(normalized);
};

export const parseCustomSeeds = (raw: string): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\n]+/)) {
    const trimmed = part.trim();
    if (!isValidArtistName(trimmed)) {
      continue;
    }
    const key = normArtistKey(trimmed);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed);
  }
  return out;
};

const flattenPlaylistEntries = (
  nodes: PlaylistIndexNode[],
): Array<{ id: string; itemCount: number; lastModifiedIso: string }> => {
  const entries: Array<{
    id: string;
    itemCount: number;
    lastModifiedIso: string;
  }> = [];
  for (const node of nodes) {
    if (node.kind === 'playlist') {
      entries.push(node);
    } else if (node.kind === 'folder') {
      for (const child of node.playlists) {
        entries.push(child);
      }
    }
  }
  return entries;
};

const sleepMs = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const fetchJson = async <T>(url: string, attempt = 0): Promise<T | null> => {
  try {
    const res = await httpHost.fetch(url);
    if (res.status < 200 || res.status >= 300 || !res.body) {
      return null;
    }
    const parsed = JSON.parse(res.body) as unknown;
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const errObj = (parsed as { error?: { code?: number } }).error;
      if (
        errObj?.code === 4 &&
        attempt === 0 &&
        import.meta.env.MODE !== 'test'
      ) {
        await sleepMs(350);
        return fetchJson<T>(url, 1);
      }
      return null;
    }
    return parsed as T;
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

  // 0. Optional user custom seed artists
  const customSeeds = parseCustomSeeds(
    useMobileEnhancementsStore.getState().customSeedArtists,
  );
  for (const seed of customSeeds) {
    bumpArtist(seed, 25);
  }

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
    bumpArtist(favArtist.ref.name, 10);
  }
  for (const favTrack of favorites.tracks) {
    const primaryArtist = favTrack.ref.artists?.[0]?.name;
    bumpArtist(primaryArtist, 8);
    if (favTrack.ref.title && primaryArtist) {
      knownTrackKeys.add(normTrackKey(favTrack.ref.title, primaryArtist));
    }
  }
  for (const favAlbum of favorites.albums) {
    const primaryArtist = favAlbum.ref.artists?.[0]?.name;
    bumpArtist(primaryArtist, 6);
  }

  // 4. Local & synced playlists (capped per artist per playlist so large playlists stay balanced)
  const playlistState = usePlaylistStore.getState();
  const scorePlaylist = (items: PlaylistItem[]) => {
    const perPlaylistArtistScore = new Map<string, number>();
    for (const item of items) {
      const primaryArtist = item.track.artists?.[0]?.name;
      if (item.track.title && primaryArtist) {
        knownTrackKeys.add(normTrackKey(item.track.title, primaryArtist));
      }
      if (!isValidArtistName(primaryArtist)) {
        continue;
      }
      const aKey = normArtistKey(primaryArtist);
      const used = perPlaylistArtistScore.get(aKey) ?? 0;
      if (used >= MAX_TRACKS_PER_ARTIST_PER_PLAYLIST * 2) {
        continue;
      }
      perPlaylistArtistScore.set(aKey, used + 2);
      bumpArtist(primaryArtist, 2);
    }
  };

  for (const playlist of playlistState.playlists.values()) {
    scorePlaylist(playlist.items);
  }

  if (import.meta.env.MODE !== 'test' && artistScores.size < 8) {
    const entries = flattenPlaylistEntries(playlistState.index)
      .filter((entry) => entry.itemCount > 0)
      .sort((a, b) =>
        (b.lastModifiedIso ?? '').localeCompare(a.lastModifiedIso ?? ''),
      )
      .slice(0, MAX_PLAYLISTS_TO_SCAN);

    for (const entry of entries) {
      if (playlistState.playlists.has(entry.id)) {
        continue;
      }
      try {
        const loaded = await playlistState.loadPlaylist(entry.id);
        if (loaded) {
          scorePlaylist(loaded.items);
        }
      } catch {
        // Ignore individual playlist read failures
      }
    }
  }

  // 5. Queue fallback if few seeds exist yet
  if (artistScores.size < 5) {
    for (const item of useQueueStore.getState().items.slice(0, 20)) {
      const primaryArtist = item.track.artists?.[0]?.name;
      bumpArtist(primaryArtist, 3);
      if (item.track.title && primaryArtist) {
        knownTrackKeys.add(normTrackKey(item.track.title, primaryArtist));
      }
    }
  }

  const rankedArtists = Array.from(artistScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((a) => a.name);

  const signature = [
    ...rankedArtists.slice(0, 5).map((name) => normArtistKey(name)),
    ...customSeeds.map((seed) => `c:${normArtistKey(seed)}`),
  ].join('|');

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
  discoveryTracks: Track[];
  relatedArtists: Array<DeezerRelatedArtist & { seedArtist: string }>;
  albums: PersonalizedAlbumCard[];
  mixes: PersonalizedMixCard[];
};

const fetchSeedBundle = async (
  seedArtist: string,
): Promise<SeedFetchBundle> => {
  const artistSearch = await fetchJson<{ data?: DeezerArtistSearchItem[] }>(
    `https://api.deezer.com/search/artist?q=${encodeURIComponent(seedArtist)}&limit=8`,
  );

  const candidates = artistSearch?.data ?? [];
  const exactMatches = candidates
    .filter((a) => normArtistKey(a.name) === normArtistKey(seedArtist))
    .sort(
      (a, b) =>
        (b.nb_fan ?? 0) - (a.nb_fan ?? 0) ||
        (b.nb_album ?? 0) - (a.nb_album ?? 0),
    );
  const orderedMatches =
    exactMatches.length > 0
      ? exactMatches.slice(0, 2)
      : candidates[0]
        ? [candidates[0]]
        : [];

  for (const matched of orderedMatches) {
    if (!matched?.id) {
      continue;
    }

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

    if (radioTracks.length === 0) {
      continue;
    }

    const seedNorm = normArtistKey(matched.name || seedArtist);
    const nonSeedTracks = radioTracks.filter(
      (t) => normArtistKey(t.artists?.[0]?.name ?? '') !== seedNorm,
    );
    const sameSeedTracks = radioTracks.filter(
      (t) => normArtistKey(t.artists?.[0]?.name ?? '') === seedNorm,
    );
    const discoveryTracks = [...nonSeedTracks, ...sameSeedTracks];

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
      discoveryTracks,
      relatedArtists,
      albums,
      mixes,
    };
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
    discoveryTracks: radioTracks,
    relatedArtists: [],
    albums: Array.from(albumMap.values()).slice(0, 4),
    mixes: [],
  };
};

const selectActiveSeeds = (
  seedArtists: string[],
  refreshOffset: number,
): string[] => {
  if (seedArtists.length <= 5) {
    return seedArtists;
  }
  const anchored = seedArtists.slice(0, 2);
  const pool = seedArtists.slice(2);
  const chosen: string[] = [...anchored];
  const start = (Math.max(0, refreshOffset) * 3) % pool.length;
  for (let i = 0; i < 3 && i < pool.length; i++) {
    chosen.push(pool[(start + i) % pool.length]!);
  }
  return chosen;
};

const rotateSlice = <T>(items: T[], offset: number): T[] => {
  if (items.length <= 1 || offset <= 0) {
    return items;
  }
  const shift = offset % items.length;
  return [...items.slice(shift), ...items.slice(0, shift)];
};

export const fetchPersonalizedFeedFromSeeds = async (
  profile: SeedProfile,
  refreshOffset = 0,
): Promise<PersonalizedFeedData> => {
  const activeSeeds = selectActiveSeeds(profile.seedArtists, refreshOffset);
  const bundles: SeedFetchBundle[] = [];

  // Pace seed fetches in batches of 2 to avoid Deezer burst rate limits
  for (let i = 0; i < activeSeeds.length; i += 2) {
    const batch = activeSeeds.slice(i, i + 2);
    const results = await Promise.all(
      batch.map((seed) =>
        fetchSeedBundle(seed).catch((): SeedFetchBundle => ({
          seedArtist: seed,
          radioTracks: [],
          discoveryTracks: [],
          relatedArtists: [],
          albums: [],
          mixes: [],
        })),
      ),
    );
    bundles.push(...results);
    if (i + 2 < activeSeeds.length && import.meta.env.MODE !== 'test') {
      await sleepMs(100);
    }
  }

  // Enrich recommended tracks with top songs from up to 4 discovered similar artists
  const topThreeSeedKeys = new Set(
    profile.seedArtists.slice(0, 3).map(normArtistKey),
  );
  const similarArtistSeeds: Array<{
    id: string;
    name: string;
    imageUrl?: string;
    seedArtist: string;
  }> = [];
  const seenSimSeedIds = new Set<string>();

  for (const bundle of bundles) {
    for (const rel of bundle.relatedArtists) {
      if (!rel.id || !rel.name) {
        continue;
      }
      if (topThreeSeedKeys.has(normArtistKey(rel.name))) {
        continue;
      }
      const relId = String(rel.id);
      if (seenSimSeedIds.has(relId)) {
        continue;
      }
      seenSimSeedIds.add(relId);
      similarArtistSeeds.push({
        id: relId,
        name: rel.name,
        imageUrl: rel.picture_big ?? rel.picture_medium,
        seedArtist: rel.seedArtist,
      });
      break;
    }
    if (similarArtistSeeds.length >= 4) {
      break;
    }
  }

  const similarTopTrackEntries: PersonalizedTrackItem[] = [];
  for (let i = 0; i < similarArtistSeeds.length; i += 2) {
    const batch = similarArtistSeeds.slice(i, i + 2);
    const batchTracks = await Promise.all(
      batch.map(async (sim) => {
        const res = await fetchJson<{ data?: DeezerTrackItem[] }>(
          `https://api.deezer.com/artist/${encodeURIComponent(sim.id)}/top?limit=4`,
        );
        return (res?.data ?? [])
          .map((item) => mapDeezerTrack(item, sim.imageUrl))
          .filter((t): t is Track => t !== null)
          .map((track): PersonalizedTrackItem => ({
            track,
            seedArtist: sim.seedArtist,
            reason: `Recommended via ${sim.name}`,
          }));
      }),
    );
    for (const list of batchTracks) {
      similarTopTrackEntries.push(...list);
    }
    if (i + 2 < similarArtistSeeds.length && import.meta.env.MODE !== 'test') {
      await sleepMs(80);
    }
  }

  // Build candidate streams rotated on refresh, prioritizing unheard discovery tracks
  const candidateSources: PersonalizedTrackItem[][] = bundles.map((bundle) =>
    rotateSlice(bundle.discoveryTracks, refreshOffset * 2).map((track) => ({
      track,
      seedArtist: bundle.seedArtist,
      reason: `Inspired by ${bundle.seedArtist}`,
    })),
  );
  if (similarTopTrackEntries.length > 0) {
    candidateSources.push(rotateSlice(similarTopTrackEntries, refreshOffset));
  }

  const interleavedCandidates: PersonalizedTrackItem[] = [];
  const maxSourceLen = Math.max(0, ...candidateSources.map((s) => s.length));
  for (let i = 0; i < maxSourceLen; i++) {
    for (const source of candidateSources) {
      const entry = source[i];
      if (entry) {
        interleavedCandidates.push(entry);
      }
    }
  }

  const recommendedTracks: PersonalizedTrackItem[] = [];
  const seenRecommendedKeys = new Set<string>();
  const artistCounts = new Map<string, number>();

  const tryAddCandidates = (
    allowKnown: boolean,
    enforceArtistCap: boolean,
    targetCount: number,
  ) => {
    for (const item of interleavedCandidates) {
      if (recommendedTracks.length >= targetCount) {
        break;
      }
      const primaryArtist = item.track.artists?.[0]?.name ?? '';
      const k = normTrackKey(item.track.title, primaryArtist);
      if (profile.overplayedKeys.has(k) || seenRecommendedKeys.has(k)) {
        continue;
      }
      if (!allowKnown && profile.knownTrackKeys.has(k)) {
        continue;
      }
      const aKey = normArtistKey(primaryArtist);
      const count = artistCounts.get(aKey) ?? 0;
      if (enforceArtistCap && count >= 2) {
        continue;
      }
      seenRecommendedKeys.add(k);
      artistCounts.set(aKey, count + 1);
      recommendedTracks.push(item);
    }
  };

  tryAddCandidates(false, true, 16);
  if (recommendedTracks.length < 16) {
    tryAddCandidates(true, true, 16);
  }
  if (recommendedTracks.length < 8) {
    tryAddCandidates(true, false, 16);
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

  // Similar artists: prioritize multi-seed overlaps, then round-robin interleave across seeds
  const similarByKey = new Map<
    string,
    {
      id: string;
      name: string;
      imageUrl?: string;
      seeds: string[];
      fanScore: number;
    }
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
      const fanScore = rel.nb_fan ? Math.log10(Math.max(1, rel.nb_fan)) : 0;
      const existing = similarByKey.get(key);
      if (existing) {
        if (!existing.seeds.includes(rel.seedArtist)) {
          existing.seeds.push(rel.seedArtist);
        }
        existing.fanScore = Math.max(existing.fanScore, fanScore);
        existing.imageUrl =
          existing.imageUrl ?? rel.picture_big ?? rel.picture_medium;
      } else {
        similarByKey.set(key, {
          id: String(rel.id),
          name: rel.name,
          imageUrl: rel.picture_big ?? rel.picture_medium,
          seeds: [rel.seedArtist],
          fanScore,
        });
      }
    }
  }

  const multiSeedMatches: PersonalizedArtistCard[] = [];
  const perSeedBuckets = new Map<
    string,
    Array<{ card: PersonalizedArtistCard; fanScore: number }>
  >();

  for (const entry of similarByKey.values()) {
    if (entry.seeds.length >= 2) {
      multiSeedMatches.push({
        id: entry.id,
        name: entry.name,
        imageUrl: entry.imageUrl,
        reason: `Matches ${entry.seeds.slice(0, 2).join(' & ')}`,
      });
    } else {
      const seed = entry.seeds[0]!;
      const list = perSeedBuckets.get(seed) ?? [];
      list.push({
        card: {
          id: entry.id,
          name: entry.name,
          imageUrl: entry.imageUrl,
          reason: `Similar to ${seed}`,
        },
        fanScore: entry.fanScore,
      });
      perSeedBuckets.set(seed, list);
    }
  }

  multiSeedMatches.sort((a, b) => {
    const aEntry = similarByKey.get(normArtistKey(a.name));
    const bEntry = similarByKey.get(normArtistKey(b.name));
    return (
      (bEntry?.seeds.length ?? 0) - (aEntry?.seeds.length ?? 0) ||
      (bEntry?.fanScore ?? 0) - (aEntry?.fanScore ?? 0)
    );
  });

  const bucketLists = Array.from(perSeedBuckets.values()).map((bucket) =>
    bucket.sort((a, b) => b.fanScore - a.fanScore).map((item) => item.card),
  );
  const similarArtists: PersonalizedArtistCard[] = [...multiSeedMatches];
  const maxBucketLen = Math.max(0, ...bucketLists.map((b) => b.length));
  for (let i = 0; i < maxBucketLen && similarArtists.length < 12; i++) {
    for (const bucket of bucketLists) {
      if (similarArtists.length >= 12) {
        break;
      }
      const card = bucket[i];
      if (card) {
        similarArtists.push(card);
      }
    }
  }

  // Albums & Releases: sort each seed's newest first, cap 3 per seed, round-robin interleave
  const sortedAlbumsPerSeed = bundles.map((b) =>
    [...b.albums]
      .sort((a, c) => (c.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
      .slice(0, 3),
  );
  const albumMap = new Map<string, PersonalizedAlbumCard>();
  const maxAlbumLen = Math.max(0, ...sortedAlbumsPerSeed.map((l) => l.length));
  for (let i = 0; i < maxAlbumLen && albumMap.size < 12; i++) {
    for (const list of sortedAlbumsPerSeed) {
      if (albumMap.size >= 12) {
        break;
      }
      const alb = list[i];
      if (!alb) {
        continue;
      }
      const k = normTrackKey(alb.title, alb.artistName);
      if (!albumMap.has(k)) {
        albumMap.set(k, alb);
      }
    }
  }
  const albums = Array.from(albumMap.values());

  // Mixes: deduplicate by id & normalized title, cap max 2 per seed, round-robin interleave
  const mixes: PersonalizedMixCard[] = [];
  const seenMixIds = new Set<string>();
  const seenMixTitles = new Set<string>();
  const mixCountPerSeed = new Map<string, number>();

  const collectMixesPass = (enforceSeedCap: boolean) => {
    const maxMixLen = Math.max(0, ...bundles.map((b) => b.mixes.length));
    for (let i = 0; i < maxMixLen && mixes.length < 8; i++) {
      for (const bundle of bundles) {
        if (mixes.length >= 8) {
          break;
        }
        const mix = bundle.mixes[i];
        if (!mix) {
          continue;
        }
        const titleKey = normMixTitleKey(mix.title);
        if (seenMixIds.has(mix.id) || seenMixTitles.has(titleKey)) {
          continue;
        }
        const seedUsed = mixCountPerSeed.get(bundle.seedArtist) ?? 0;
        if (enforceSeedCap && seedUsed >= 2) {
          continue;
        }
        seenMixIds.add(mix.id);
        seenMixTitles.add(titleKey);
        mixCountPerSeed.set(bundle.seedArtist, seedUsed + 1);
        mixes.push(mix);
      }
    }
  };

  collectMixesPass(true);
  if (mixes.length < 8) {
    collectMixesPass(false);
  }

  return {
    seedArtists: profile.seedArtists,
    recommendedTracks,
    artistShelves,
    similarArtists: similarArtists.slice(0, 12),
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
  refreshNonce: number;
  refreshFeed: (force?: boolean) => Promise<void>;
  clearFeed: () => void;
};

export const usePersonalizedFeedStore = create<PersonalizedFeedStoreState>()(
  persist(
    (set, get) => ({
      feed: null,
      lastSignature: '',
      loading: false,
      refreshNonce: 0,

      clearFeed: () =>
        set({ feed: null, lastSignature: '', loading: false, refreshNonce: 0 }),

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

        const { feed, lastSignature, refreshNonce } = get();
        const isFresh =
          Boolean(feed) &&
          lastSignature === profile.signature &&
          Date.now() - (feed?.updatedAtMs ?? 0) < FEED_STALE_MS &&
          (feed?.recommendedTracks.length ?? 0) > 0;

        if (!force && isFresh) {
          return;
        }

        const nextNonce = force ? refreshNonce + 1 : refreshNonce;
        set({ loading: true, refreshNonce: nextNonce });
        try {
          const nextFeed = await fetchPersonalizedFeedFromSeeds(
            profile,
            nextNonce,
          );
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
      name: 'nuclear-personalized-feed-v2',
      partialize: (state) => ({
        feed: state.feed,
        lastSignature: state.lastSignature,
        refreshNonce: state.refreshNonce,
      }),
    },
  ),
);
