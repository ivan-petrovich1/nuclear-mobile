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
import { useMobileEnhancementsStore } from './mobileEnhancements';
import {
  collectSeedProfile,
  fetchPersonalizedFeedFromSeeds,
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
    useMobileEnhancementsStore.setState({ customSeedArtists: '' });
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

  it('picks the highest-fan exact Deezer match over empty stub duplicates', async () => {
    await useFavoritesStore
      .getState()
      .addTrack(makeTrack('Inside Out', 'Duster', 'd1'));

    vi.spyOn(httpHost, 'fetch').mockImplementation(async (url) => {
      if (url.includes('/search/artist') && url.includes('Duster')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [
              { id: 166855, name: 'Duster', nb_fan: 6580, nb_album: 5 },
              { id: 77142812, name: 'Duster', nb_fan: 29424, nb_album: 14 },
            ],
          }),
        };
      }
      if (url.includes('/artist/166855/')) {
        return { status: 200, headers: {}, body: JSON.stringify({ data: [] }) };
      }
      if (url.includes('/artist/77142812/top')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [
              {
                id: 7101,
                title: 'Inside Out',
                duration: 141,
                artist: { id: 77142812, name: 'Duster' },
                album: {
                  id: 701,
                  title: 'Stratosphere',
                  cover_medium: 'strat.jpg',
                },
              },
            ],
          }),
        };
      }
      if (url.includes('/artist/77142812/related')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [
              {
                id: 901,
                name: 'Helvetia',
                nb_fan: 12000,
                picture_medium: 'h.jpg',
              },
              {
                id: 902,
                name: 'Eiafuawn',
                nb_fan: 8000,
                picture_medium: 'e.jpg',
              },
            ],
          }),
        };
      }
      if (url.includes('/artist/77142812/radio')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [
              {
                id: 7201,
                title: 'Duster Radio Gem',
                duration: 195,
                artist: { id: 901, name: 'Helvetia' },
                album: { id: 911, title: 'Crumbs' },
              },
            ],
          }),
        };
      }
      if (url.includes('/artist/77142812/albums')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [
              {
                id: 701,
                title: 'Stratosphere',
                cover_medium: 'strat.jpg',
                release_date: '1998-02-24',
              },
            ],
          }),
        };
      }
      if (url.includes('/search/playlist') && url.includes('Duster')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [
              {
                id: 801,
                title: 'Duster Slowcore Mix',
                nb_tracks: 20,
                picture_medium: 'mix.jpg',
                user: { name: 'Slowcore' },
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
    expect(feed?.similarArtists.map((a) => a.name)).toContain('Helvetia');
    expect(feed?.similarArtists.map((a) => a.name)).toContain('Eiafuawn');
    expect(
      feed?.recommendedTracks.some(
        (item) => item.track.title === 'Duster Radio Gem',
      ),
    ).toBe(true);
    expect(feed?.mixes[0]?.title).toBe('Duster Slowcore Mix');
  });

  it('prioritizes unheard discovery tracks over saved tracks, caps per artist, and rotates seeds on refresh', async () => {
    await useFavoritesStore
      .getState()
      .addTrack(makeTrack('Known Song', 'Known Artist', 'k1'));

    useMobileEnhancementsStore
      .getState()
      .setCustomSeedArtists(
        'SeedOne, SeedTwo, SeedThree, SeedFour, SeedFive, SeedSix, SeedSeven',
      );

    vi.spyOn(httpHost, 'fetch').mockImplementation(async (url) => {
      const seedMatch = url.match(/artist:"([^"]+)"/) ?? url.match(/q=([^&]+)/);
      if (url.includes('/search/artist')) {
        const name = decodeURIComponent(seedMatch?.[1] ?? 'SeedOne').replace(
          /"/g,
          '',
        );
        const idx = [
          'SeedOne',
          'SeedTwo',
          'SeedThree',
          'SeedFour',
          'SeedFive',
          'SeedSix',
          'SeedSeven',
        ].indexOf(name);
        const id = idx >= 0 ? 1000 + idx : 1099;
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [{ id, name, nb_fan: 50000, nb_album: 5 }],
          }),
        };
      }
      if (url.includes('/artist/1000/radio')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [
              {
                id: 1,
                title: 'Known Song',
                duration: 180,
                artist: { id: 50, name: 'Known Artist' },
                album: { id: 500, title: 'Old Album' },
              },
              {
                id: 2,
                title: 'Fresh X1',
                duration: 180,
                artist: { id: 51, name: 'Artist X' },
                album: { id: 501, title: 'X Album' },
              },
              {
                id: 3,
                title: 'Fresh X2',
                duration: 180,
                artist: { id: 51, name: 'Artist X' },
                album: { id: 501, title: 'X Album' },
              },
              {
                id: 4,
                title: 'Fresh X3',
                duration: 180,
                artist: { id: 51, name: 'Artist X' },
                album: { id: 501, title: 'X Album' },
              },
              {
                id: 5,
                title: 'Fresh Y1',
                duration: 180,
                artist: { id: 52, name: 'Artist Y' },
                album: { id: 502, title: 'Y Album' },
              },
              {
                id: 6,
                title: 'Fresh Z1',
                duration: 180,
                artist: { id: 53, name: 'Artist Z' },
                album: { id: 503, title: 'Z Album' },
              },
              {
                id: 7,
                title: 'Fresh W1',
                duration: 180,
                artist: { id: 54, name: 'Artist W' },
                album: { id: 504, title: 'W Album' },
              },
              {
                id: 8,
                title: 'Fresh V1',
                duration: 180,
                artist: { id: 55, name: 'Artist V' },
                album: { id: 505, title: 'V Album' },
              },
              {
                id: 9,
                title: 'Fresh U1',
                duration: 180,
                artist: { id: 56, name: 'Artist U' },
                album: { id: 506, title: 'U Album' },
              },
              {
                id: 10,
                title: 'Fresh T1',
                duration: 180,
                artist: { id: 57, name: 'Artist T' },
                album: { id: 507, title: 'T Album' },
              },
            ],
          }),
        };
      }
      if (url.includes('/artist/1005/radio')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [
              {
                id: 601,
                title: 'Rotated SeedSix Gem',
                duration: 200,
                artist: { id: 60, name: 'Artist S6' },
                album: { id: 600, title: 'S6 Album' },
              },
            ],
          }),
        };
      }
      if (/\/artist\/100\d\/(top|radio|related|albums)/.test(url)) {
        return { status: 200, headers: {}, body: JSON.stringify({ data: [] }) };
      }
      return { status: 404, headers: {}, body: '' };
    });

    const profile = await collectSeedProfile();
    const feed0 = await fetchPersonalizedFeedFromSeeds(profile, 0);
    const feed1 = await fetchPersonalizedFeedFromSeeds(profile, 1);

    const titles0 = feed0.recommendedTracks.map((item) => item.track.title);
    const titles1 = feed1.recommendedTracks.map((item) => item.track.title);
    const artistXCount = feed0.recommendedTracks.filter(
      (item) => item.track.artists[0]?.name === 'Artist X',
    ).length;

    expect(artistXCount).toBeLessThanOrEqual(2);
    expect(titles0).toContain('Fresh X1');
    expect(titles0).toContain('Fresh Y1');
    if (titles0.includes('Known Song')) {
      expect(titles0.indexOf('Known Song')).toBeGreaterThan(
        titles0.indexOf('Fresh Y1'),
      );
    }

    expect(titles0).not.toContain('Rotated SeedSix Gem');
    expect(titles1).toContain('Rotated SeedSix Gem');
    expect(titles1).not.toEqual(titles0);
  });

  it('balances similar artists across seeds, promotes multi-seed overlaps, and deduplicates mix titles', async () => {
    useMobileEnhancementsStore
      .getState()
      .setCustomSeedArtists('Duster, Current Joys');

    vi.spyOn(httpHost, 'fetch').mockImplementation(async (url) => {
      if (url.includes('/search/artist')) {
        if (url.includes('Duster')) {
          return {
            status: 200,
            headers: {},
            body: JSON.stringify({
              data: [{ id: 101, name: 'Duster', nb_fan: 30000, nb_album: 10 }],
            }),
          };
        }
        if (url.includes('Current')) {
          return {
            status: 200,
            headers: {},
            body: JSON.stringify({
              data: [
                { id: 202, name: 'Current Joys', nb_fan: 80000, nb_album: 20 },
              ],
            }),
          };
        }
      }
      if (url.includes('/artist/101/related')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [
              { id: 10, name: 'SharedBand', nb_fan: 5000 },
              { id: 11, name: 'DusterOnly', nb_fan: 900000 },
            ],
          }),
        };
      }
      if (url.includes('/artist/202/related')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [
              { id: 10, name: 'SharedBand', nb_fan: 5000 },
              { id: 12, name: 'CJOnly', nb_fan: 4000 },
            ],
          }),
        };
      }
      if (url.includes('/search/playlist') && url.includes('Duster')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [
              { id: 9001, title: 'Viktor Tsoi (Russia)', nb_tracks: 10 },
              { id: 9002, title: 'Viktor tsoi  (Russia)', nb_tracks: 15 },
              { id: 9003, title: 'Duster Deep Cuts', nb_tracks: 25 },
            ],
          }),
        };
      }
      if (url.includes('/artist/101/radio')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [
              {
                id: 8101,
                title: 'Echoes of Duster',
                duration: 180,
                artist: { id: 10, name: 'SharedBand' },
                album: { id: 810, title: 'Slow Waves' },
              },
            ],
          }),
        };
      }
      if (url.includes('/artist/202/radio')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [
              {
                id: 8201,
                title: 'Currents Drift',
                duration: 190,
                artist: { id: 12, name: 'CJOnly' },
                album: { id: 820, title: 'Night Tapes' },
              },
            ],
          }),
        };
      }
      if (/\/artist\/(101|202)\/(top|albums)/.test(url)) {
        return { status: 200, headers: {}, body: JSON.stringify({ data: [] }) };
      }
      return { status: 404, headers: {}, body: '' };
    });

    await usePersonalizedFeedStore.getState().refreshFeed(true);
    const feed = usePersonalizedFeedStore.getState().feed;

    expect(feed).not.toBeNull();
    expect(feed?.similarArtists[0]?.name).toBe('SharedBand');
    expect(feed?.similarArtists[0]?.reason).toContain('Duster');
    expect(feed?.similarArtists[0]?.reason).toContain('Current Joys');
    expect(feed?.similarArtists.map((a) => a.name)).toContain('DusterOnly');
    expect(feed?.similarArtists.map((a) => a.name)).toContain('CJOnly');

    const normalizedMixTitles = (feed?.mixes ?? []).map((m) =>
      m.title.trim().toLowerCase().replace(/\s+/g, ' '),
    );
    expect(
      normalizedMixTitles.filter((t) => t === 'viktor tsoi (russia)'),
    ).toHaveLength(1);
    expect(feed?.mixes.map((m) => m.title)).toContain('Duster Deep Cuts');
  });
});
