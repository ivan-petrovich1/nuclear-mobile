import { vi } from 'vitest';

import { usePlaylistStore } from '../stores/playlistStore';
import { resetInMemoryTauriStore } from '../test/utils/inMemoryTauriStore';
import { httpHost } from './httpHost';
import {
  fetchPathfinderPlaylistTracks,
  useSpotifyAccountSyncStore,
} from './spotifyAccountSync';

vi.mock('./httpHost', () => ({
  httpHost: {
    fetch: vi.fn(),
  },
}));

vi.mock(
  './playlistFileService',
  async () =>
    (await import('../test/fixtures/playlists')).playlistFileServiceMock,
);

const makePathfinderItem = (index: number) => ({
  itemV2: {
    data: {
      __typename: 'Track',
      uri: `spotify:track:track_${index}`,
      name: `Track ${index}`,
      trackDuration: { totalMilliseconds: 180000 + index },
      artists: {
        items: [
          {
            uri: `spotify:artist:artist_${index}`,
            profile: { name: `Artist ${index}` },
          },
        ],
      },
      albumOfTrack: {
        uri: `spotify:album:album_${index}`,
        name: `Album ${index}`,
        coverArt: {
          sources: [
            {
              url: `https://i.scdn.co/image/cover_${index}`,
              width: 300,
              height: 300,
            },
          ],
        },
      },
    },
  },
});

const makeEmbedHtml = (
  name: string,
  trackCount: number,
  accessToken?: string,
) => {
  const payload = {
    props: {
      pageProps: {
        state: {
          settings: accessToken ? { session: { accessToken } } : {},
          data: {
            entity: {
              name,
              coverArt: {
                sources: [{ url: 'https://i.scdn.co/image/playlist_cover' }],
              },
              trackList: Array.from({ length: trackCount }, (_, idx) => ({
                uri: `spotify:track:embed_${idx}`,
                title: `Embed Track ${idx}`,
                subtitle: `Embed Artist ${idx}`,
                duration: 200000,
              })),
            },
          },
        },
      },
    },
  };
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script></html>`;
};

describe('spotifyAccountSync pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetInMemoryTauriStore();
    usePlaylistStore.setState({
      index: [],
      playlists: new Map(),
      loaded: true,
    });
    useSpotifyAccountSyncStore.setState({
      accountInput: 'orionuser',
      autoSyncOnLaunch: true,
      syncing: false,
      lastSyncedIso: null,
      lastSummary: null,
      syncedMap: {},
    });
  });

  it('paginates across multiple Pathfinder v2 pages beyond 100 tracks', async () => {
    const fetchMock = vi.mocked(httpHost.fetch);
    fetchMock.mockImplementation(async (_url, init) => {
      const reqBody = JSON.parse(init?.body as string) as {
        variables: { offset: number; limit: number };
      };
      const offset = reqBody.variables.offset;
      const count = offset === 0 ? 100 : offset === 100 ? 100 : 50;
      const items = Array.from({ length: count }, (_, idx) =>
        makePathfinderItem(offset + idx),
      );
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          data: {
            playlistV2: {
              content: {
                totalCount: 250,
                items,
              },
            },
          },
        }),
      };
    });

    const tracks = await fetchPathfinderPlaylistTracks(
      '37i9dQZF1DX4o1oenSJRJd',
      'anon-token',
    );

    expect(tracks).toHaveLength(250);
    expect(tracks?.[0].title).toBe('Track 0');
    expect(tracks?.[0].album?.title).toBe('Album 0');
    expect(tracks?.[0].artwork?.items[0].url).toBe(
      'https://i.scdn.co/image/cover_0',
    );
    expect(tracks?.[249].title).toBe('Track 249');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stops cleanly when Spotify returns an empty page before totalCount', async () => {
    const fetchMock = vi.mocked(httpHost.fetch);
    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: JSON.stringify({
          data: {
            playlistV2: {
              content: {
                totalCount: 150,
                items: Array.from({ length: 100 }, (_, idx) =>
                  makePathfinderItem(idx),
                ),
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: JSON.stringify({
          data: {
            playlistV2: {
              content: {
                totalCount: 150,
                items: [],
              },
            },
          },
        }),
      });

    const tracks = await fetchPathfinderPlaylistTracks(
      'pl-empty',
      'anon-token',
    );

    expect(tracks).toHaveLength(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the second persisted query hash when the first fails', async () => {
    const fetchMock = vi.mocked(httpHost.fetch);
    fetchMock
      .mockResolvedValueOnce({
        status: 400,
        headers: {},
        body: 'PersistedQueryNotFound',
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: JSON.stringify({
          data: {
            playlistV2: {
              content: {
                totalCount: 2,
                items: [makePathfinderItem(0), makePathfinderItem(1)],
              },
            },
          },
        }),
      });

    const tracks = await fetchPathfinderPlaylistTracks('pl-hash', 'anon-token');

    expect(tracks).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to embed trackList during syncNow when Pathfinder fails', async () => {
    const fetchMock = vi.mocked(httpHost.fetch);
    const playlistId = 'AbCdEfGhIjKlMnOpQrStUv';

    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: `<a href="/playlist/${playlistId}">My Big List</a>`,
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: makeEmbedHtml('My Big List', 100, 'anon-token'),
      })
      .mockResolvedValue({
        status: 500,
        headers: {},
        body: 'Server Error',
      });

    await useSpotifyAccountSyncStore.getState().syncNow(true);

    const state = useSpotifyAccountSyncStore.getState();
    const nuclearId = state.syncedMap[playlistId];
    const saved = usePlaylistStore.getState().playlists.get(nuclearId);
    expect(saved?.items).toHaveLength(100);
    expect(saved?.items[0].track.title).toBe('Embed Track 0');
    expect(state.lastSummary).toBe('Synced 1 playlist (100 tracks)');
  });
});
