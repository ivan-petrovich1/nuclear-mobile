import { vi } from 'vitest';

import type { Track } from '@nuclearplayer/model';

import { useDownloadStore } from '../stores/downloadStore';
import { useFavoritesStore } from '../stores/favoritesStore';
import { usePlaylistStore } from '../stores/playlistStore';
import { useQueueStore } from '../stores/queue/queueStore';
import { getSetting, useSettingsStore } from '../stores/settingsStore';
import { resetInMemoryTauriStore } from '../test/utils/inMemoryTauriStore';
import { registerBuiltInCoreSettings } from './coreSettings';
import { httpHost } from './httpHost';
import {
  collectSeedProfile,
  normTrackKey,
  playSimilarArtistMix,
  usePersonalizedFeedStore,
} from './personalizedFeed';
import { useWrappedStatsStore } from './wrappedStats';

const makeTrack = (title: string, artist: string, id: string): Track => ({
  title,
  artists: [
    {
      name: artist,
      roles: [],
      source: { provider: 'test', id: `artist:${artist}` },
    },
  ],
  source: { provider: 'test', id },
});

describe('personalizedFeed & auto-download defaults', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetInMemoryTauriStore();
    useSettingsStore.setState({ definitions: {}, values: {}, loaded: true });
    registerBuiltInCoreSettings();

    useWrappedStatsStore.getState().resetStats();
    useFavoritesStore.setState({
      tracks: [],
      albums: [],
      artists: [],
      loaded: true,
    });
    usePlaylistStore.setState({
      index: [],
      playlists: new Map(),
      loaded: true,
    });
    usePersonalizedFeedStore.getState().clearFeed();
    useDownloadStore.setState({ items: {}, downloadingKeys: {} });
  });

  it('collects seed artists weighted by wrapped stats and favorites and filters invalid names', async () => {
    useWrappedStatsStore.setState({
      artistStats: {
        'unknown artist': { name: 'Unknown Artist', plays: 99, seconds: 9000 },
        'molchat doma': { name: 'Molchat Doma', plays: 10, seconds: 1200 },
        kino: { name: 'Kino', plays: 4, seconds: 400 },
      },
      trackStats: {
        [normTrackKey('Sudno', 'Molchat Doma')]: {
          key: normTrackKey('Sudno', 'Molchat Doma'),
          title: 'Sudno',
          artist: 'Molchat Doma',
          plays: 5,
          seconds: 600,
        },
      },
    });

    await useFavoritesStore
      .getState()
      .addTrack(makeTrack('Gid', 'Ploho', 't1'));

    const profile = await collectSeedProfile();

    expect(profile.seedArtists).not.toContain('Unknown Artist');
    expect(profile.seedArtists[0]).toBe('Molchat Doma');
    expect(profile.seedArtists).toContain('Ploho');
    expect(profile.seedArtists).toContain('Kino');
    expect(
      profile.overplayedKeys.has(normTrackKey('Sudno', 'Molchat Doma')),
    ).toBe(true);
  });

  it('fetches Deezer radio, similar artists, albums, and mixes matched to user seeds and filters overplayed tracks', async () => {
    useWrappedStatsStore.setState({
      artistStats: {
        'molchat doma': { name: 'Molchat Doma', plays: 8, seconds: 1000 },
      },
      trackStats: {
        [normTrackKey('Sudno', 'Molchat Doma')]: {
          key: normTrackKey('Sudno', 'Molchat Doma'),
          title: 'Sudno',
          artist: 'Molchat Doma',
          plays: 4,
          seconds: 500,
        },
      },
    });

    vi.spyOn(httpHost, 'fetch').mockImplementation(async (url) => {
      if (url.includes('/search/artist')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [
              {
                id: 73228892,
                name: 'Molchat Doma',
                picture_medium: 'https://img.test/molchat.jpg',
              },
            ],
          }),
        };
      }
      if (url.includes('/artist/73228892/radio')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [
              {
                id: 1,
                title: 'Sudno',
                duration: 141,
                artist: { id: 73228892, name: 'Molchat Doma' },
                album: {
                  id: 10,
                  title: 'Etazhi',
                  cover_medium: 'https://img.test/etazhi.jpg',
                },
              },
              {
                id: 2,
                title: 'Zakaz',
                duration: 210,
                artist: { id: 123, name: 'Ploho' },
                album: {
                  id: 11,
                  title: 'Kuda',
                  cover_medium: 'https://img.test/kuda.jpg',
                },
              },
              {
                id: 3,
                title: 'Toska',
                duration: 190,
                artist: { id: 73228892, name: 'Molchat Doma' },
                album: {
                  id: 10,
                  title: 'Etazhi',
                  cover_medium: 'https://img.test/etazhi.jpg',
                },
              },
              {
                id: 4,
                title: 'Tanz',
                duration: 185,
                artist: { id: 73228892, name: 'Molchat Doma' },
                album: {
                  id: 10,
                  title: 'Etazhi',
                  cover_medium: 'https://img.test/etazhi.jpg',
                },
              },
              {
                id: 5,
                title: 'Tishina',
                duration: 200,
                artist: { id: 73228892, name: 'Molchat Doma' },
                album: {
                  id: 10,
                  title: 'Etazhi',
                  cover_medium: 'https://img.test/etazhi.jpg',
                },
              },
            ],
          }),
        };
      }
      if (url.includes('/artist/73228892/related')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [
              {
                id: 123,
                name: 'Ploho',
                picture_medium: 'https://img.test/ploho.jpg',
                nb_fan: 50000,
              },
            ],
          }),
        };
      }
      if (url.includes('/artist/73228892/albums')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [
              {
                id: 501,
                title: 'Belaya Polosa',
                cover_medium: 'https://img.test/belaya.jpg',
                release_date: '2024-09-06',
                record_type: 'album',
              },
            ],
          }),
        };
      }
      if (url.includes('/search/playlist')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [
              {
                id: 901,
                title: '100% Molchat Doma',
                nb_tracks: 25,
                picture_medium: 'https://img.test/mix.jpg',
              },
            ],
          }),
        };
      }
      return { status: 404, headers: {}, body: '' };
    });

    await usePersonalizedFeedStore.getState().refreshFeed(true);

    const feed = usePersonalizedFeedStore.getState().feed;
    expect(feed).not.toBeNull();
    expect(feed?.seedArtists).toEqual(['Molchat Doma']);
    expect(
      feed?.recommendedTracks.some((item) => item.track.title === 'Sudno'),
    ).toBe(false);
    expect(
      feed?.recommendedTracks.some(
        (item) =>
          item.track.title === 'Zakaz' &&
          item.reason === 'Inspired by Molchat Doma',
      ),
    ).toBe(true);
    expect(feed?.similarArtists[0]?.name).toBe('Ploho');
    expect(feed?.albums[0]?.title).toBe('Belaya Polosa');
    expect(feed?.mixes[0]?.title).toBe('100% Molchat Doma');
    expect(feed?.artistShelves[0]?.seedArtist).toBe('Molchat Doma');
  });

  it('defaults auto-download and public export to off and clears offline cache items', async () => {
    expect(getSetting('core.playback.autoDownloadPlayed')).toBe(false);
    expect(getSetting('core.playback.exportDownloadsToPublicFolder')).toBe(
      false,
    );

    useDownloadStore.setState({
      items: {
        sample_key: {
          key: 'sample_key',
          fileName: 'sample_key.m4a',
          title: 'Sample Song',
          artist: 'Sample Artist',
          downloadedAtIso: new Date().toISOString(),
        },
      },
    });

    await useDownloadStore.getState().clearAllDownloads();
    expect(Object.keys(useDownloadStore.getState().items)).toHaveLength(0);
  });

  it('plays similar artist top tracks via Deezer and falls back to iTunes when Deezer fails or ID is non-numeric', async () => {
    vi.spyOn(httpHost, 'fetch').mockImplementation(async (url) => {
      if (url.includes('/artist/42/top')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [
              {
                id: 777,
                title: 'Kukushka',
                duration: 320,
                artist: { id: 42, name: 'Kino' },
                album: { id: 9, title: 'Black Album' },
              },
            ],
          }),
        };
      }
      if (url.includes('itunes.apple.com/search')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            results: [
              {
                trackId: 888,
                trackName: 'Zakaz',
                artistName: 'Ploho',
                collectionName: 'Pyl',
                trackTimeMillis: 210000,
              },
            ],
          }),
        };
      }
      return { status: 404, headers: {}, body: '' };
    });

    const okDeezer = await playSimilarArtistMix({
      id: '42',
      name: 'Kino',
      reason: 'Seed',
    });
    expect(okDeezer).toBe(true);
    expect(useQueueStore.getState().items.map((i) => i.track.title)).toEqual([
      'Kukushka',
    ]);

    const okItunes = await playSimilarArtistMix({
      id: 'deezer-fallback',
      name: 'Ploho',
      reason: 'Seed',
    });
    expect(okItunes).toBe(true);
    expect(useQueueStore.getState().items.map((i) => i.track.title)).toEqual([
      'Zakaz',
    ]);
  });
});
