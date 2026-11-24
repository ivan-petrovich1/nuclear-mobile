import { toast } from 'sonner';

import type { PlaylistIndexNode, Track } from '@nuclearplayer/model';

import { useFavoritesStore } from '../stores/favoritesStore';
import { usePlaylistStore } from '../stores/playlistStore';
import { useQueueStore } from '../stores/queue/queueStore';
import { httpHost } from './httpHost';
import { playbackManager } from './playback';
import { useWrappedStatsStore } from './wrappedStats';

type ItunesResult = {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
};

let radioFetching = false;
let lastSeedKey = '';

const normKey = (title: string, artist: string) =>
  `${title.toLowerCase().trim()}::${artist.toLowerCase().trim()}`;

/**
 * Endless Vibe Radio: fetches 5 similar tracks based on the current track's artist
 * and appends them to the queue so playback never stops at the end of a playlist.
 */
export const triggerEndlessRadio = async (seedTrack: Track) => {
  const artist = seedTrack.artists?.[0]?.name?.trim();
  if (!artist || radioFetching) {
    return;
  }
  const seedKey = normKey(seedTrack.title, artist);
  if (seedKey === lastSeedKey) {
    return;
  }
  radioFetching = true;
  lastSeedKey = seedKey;

  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(artist)}&entity=song&limit=20`;
    const res = await httpHost.fetch(url);
    if (res.status < 200 || res.status >= 300) {
      return;
    }
    const data = JSON.parse(res.body) as { results?: ItunesResult[] };
    const existingKeys = new Set(
      useQueueStore
        .getState()
        .items.map((i) =>
          normKey(i.track.title, i.track.artists?.[0]?.name ?? ''),
        ),
    );

    const candidates: Track[] = [];
    for (const r of data.results ?? []) {
      if (!r.trackName || !r.artistName) {
        continue;
      }
      const key = normKey(r.trackName, r.artistName);
      if (existingKeys.has(key)) {
        continue;
      }
      existingKeys.add(key);
      const art = r.artworkUrl100?.replace('100x100', '512x512');
      candidates.push({
        title: r.trackName,
        artists: [
          {
            name: r.artistName,
            roles: [],
            source: { provider: 'endless-radio', id: `artist:${r.artistName}` },
          },
        ],
        album: r.collectionName
          ? {
              title: r.collectionName,
              source: {
                provider: 'endless-radio',
                id: `album:${r.collectionName}`,
              },
            }
          : undefined,
        durationMs: r.trackTimeMillis,
        artwork: art
          ? { items: [{ url: art, purpose: 'thumbnail' }] }
          : undefined,
        source: {
          provider: 'endless-radio',
          id: `itunes:${r.trackId ?? key}`,
        },
      });
    }

    // Shuffle and take 5 fresh tracks
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const picked = candidates.slice(0, 5);
    if (picked.length > 0) {
      useQueueStore.getState().addToQueue(picked);
      toast.info(`📻 Endless Radio: Queued ${picked.length} similar tracks`);
    }
  } catch {
    // Silent fallback when offline
  } finally {
    radioFetching = false;
  }
};

const collectPlaylistIds = (nodes: PlaylistIndexNode[]): string[] => {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.kind === 'playlist') {
      out.push(node.id);
    } else if (node.kind === 'folder') {
      for (const pl of node.playlists) {
        out.push(pl.id);
      }
    }
  }
  return out;
};

/**
 * Forgotten Gem Roulette: digs through your playlists & favorites, favors tracks
 * you haven't played (or played the least), and immediately plays a surprise gem!
 */
export const spinForgottenGem = async (): Promise<Track | null> => {
  const plStore = usePlaylistStore.getState();
  if (!plStore.loaded) {
    await plStore.loadIndex();
  }
  const favStore = useFavoritesStore.getState();
  if (!favStore.loaded) {
    await favStore.loadFromDisk();
  }

  const poolMap = new Map<string, Track>();
  for (const fav of useFavoritesStore.getState().tracks) {
    const key = normKey(fav.ref.title, fav.ref.artists?.[0]?.name ?? '');
    poolMap.set(key, fav.ref);
  }

  const plIds = collectPlaylistIds(usePlaylistStore.getState().index);
  for (const id of plIds) {
    const pl = await usePlaylistStore.getState().loadPlaylist(id);
    if (pl) {
      for (const item of pl.items) {
        const key = normKey(
          item.track.title,
          item.track.artists?.[0]?.name ?? '',
        );
        if (!poolMap.has(key)) {
          poolMap.set(key, item.track);
        }
      }
    }
  }

  const allTracks = Array.from(poolMap.values());
  if (allTracks.length === 0) {
    toast.info('Add some playlists or favorites first to spin Forgotten Gem!');
    return null;
  }

  const stats = useWrappedStatsStore.getState().trackStats;
  const currentTitle = useQueueStore
    .getState()
    .getCurrentItem()
    ?.track.title.toLowerCase();

  // Sort by fewest plays, then pick randomly from the least-played bottom 40%
  const ranked = allTracks
    .filter((t) => t.title.toLowerCase() !== currentTitle)
    .map((track) => {
      const k = normKey(track.title, track.artists?.[0]?.name ?? '');
      return { track, plays: stats[k]?.plays ?? 0 };
    })
    .sort((a, b) => a.plays - b.plays);

  const candidates =
    ranked.length > 0 ? ranked : [{ track: allTracks[0], plays: 0 }];
  const sliceLen = Math.max(1, Math.ceil(candidates.length * 0.4));
  const chosen =
    candidates[Math.floor(Math.random() * sliceLen)]?.track ?? allTracks[0];

  const queue = useQueueStore.getState();
  const prevLen = queue.items.length;
  queue.addToQueue([chosen]);
  queue.goToIndex(prevLen);
  playbackManager.play();

  const artist = chosen.artists?.map((a) => a.name).join(', ') || 'Unknown';
  toast.success(`🎲 Forgotten Gem: ${chosen.title} — ${artist}`);
  return chosen;
};
