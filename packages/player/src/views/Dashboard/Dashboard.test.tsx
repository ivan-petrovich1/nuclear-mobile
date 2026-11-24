import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { usePersonalizedFeedStore } from '../../services/personalizedFeed';
import { useWrappedStatsStore } from '../../services/wrappedStats';
import { useFavoritesStore } from '../../stores/favoritesStore';
import { usePlaylistStore } from '../../stores/playlistStore';
import { useStartupStore } from '../../stores/startupStore';
import { DashboardWrapper } from './Dashboard.test-wrapper';

describe('Dashboard view (100% Personalized)', () => {
  beforeEach(() => {
    DashboardWrapper.reset();
    useWrappedStatsStore.getState().resetStats();
    usePersonalizedFeedStore.getState().clearFeed();
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
  });

  it('shows a skeleton during startup instead of personalized content', async () => {
    act(() => {
      useStartupStore.getState().startStartup();
    });

    await DashboardWrapper.mount();

    expect(DashboardWrapper.skeleton).toBeInTheDocument();
    expect(
      screen.queryByTestId('personalized-empty-state'),
    ).not.toBeInTheDocument();
  });

  it('shows personalized empty state with no listening history and navigates to search', async () => {
    const { router } = await DashboardWrapper.mount();

    expect(screen.getByTestId('personalized-empty-state')).toBeInTheDocument();
    expect(
      screen.getByText('Start listening to build your feed'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('personalized-empty-search'));
    expect(router.state.location.pathname).toBe('/search');
  });

  it('never renders generic global chart widgets even when a dashboard provider is registered', async () => {
    DashboardWrapper.seedProvider(
      DashboardWrapper.fixtures.topTracksAndArtistsProvider(),
    );
    DashboardWrapper.seedProvider(
      DashboardWrapper.fixtures.newReleasesProvider(),
    );
    DashboardWrapper.seedProvider(
      DashboardWrapper.fixtures.topAlbumsProvider(),
    );
    DashboardWrapper.seedProvider(
      DashboardWrapper.fixtures.editorialPlaylistsProvider(),
    );

    await DashboardWrapper.mount();

    expect(DashboardWrapper.topTracks.table).not.toBeInTheDocument();
    expect(DashboardWrapper.newReleases.heading).not.toBeInTheDocument();
    expect(DashboardWrapper.topAlbums.heading).not.toBeInTheDocument();
    expect(DashboardWrapper.editorialPlaylists.heading).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('dashboard-top-artists'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('personalized-empty-state')).toBeInTheDocument();
  });

  it('renders personalized shelves when wrapped stats and personalized feed are populated', async () => {
    useWrappedStatsStore.setState({
      totalSeconds: 1200,
      totalPlays: 6,
      artistStats: {
        'molchat doma': { name: 'Molchat Doma', plays: 6, seconds: 1200 },
      },
      trackStats: {
        'sudno::molchat doma': {
          key: 'sudno::molchat doma',
          title: 'Sudno',
          artist: 'Molchat Doma',
          plays: 6,
          seconds: 1200,
        },
      },
    });

    const recTrack = {
      title: 'Zakaz',
      artists: [
        {
          name: 'Ploho',
          roles: [],
          source: { provider: 'deezer-rec', id: 'ploho' },
        },
      ],
      source: { provider: 'deezer-rec', id: 'deezer:2' },
    };

    usePersonalizedFeedStore.setState({
      feed: {
        seedArtists: ['Molchat Doma'],
        recommendedTracks: [
          {
            track: recTrack,
            reason: 'Inspired by Molchat Doma',
            seedArtist: 'Molchat Doma',
          },
        ],
        artistShelves: [
          {
            seedArtist: 'Molchat Doma',
            tracks: [recTrack],
          },
        ],
        similarArtists: [
          {
            id: '123',
            name: 'Ploho',
            reason: 'Similar to Molchat Doma',
          },
        ],
        albums: [
          {
            id: '501',
            title: 'Belaya Polosa',
            artistName: 'Molchat Doma',
            releaseDate: '2024-09-06',
          },
        ],
        mixes: [
          {
            id: '901',
            title: '100% Molchat Doma',
            trackCount: 25,
            seedArtist: 'Molchat Doma',
          },
        ],
        updatedAtMs: Date.now(),
      },
      lastSignature: 'molchat doma',
      loading: false,
    });

    await DashboardWrapper.mount();

    expect(
      screen.getByRole('heading', { name: 'Recommended for You' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Because You Listen to Molchat Doma' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Similar Artists' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Albums & Releases' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Mixes for You' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Jump Back In' }),
    ).toBeInTheDocument();
  });
});
