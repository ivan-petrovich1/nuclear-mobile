import { useNavigate } from '@tanstack/react-router';
import {
  Bookmark,
  Dices,
  Disc,
  Flame,
  Heart,
  ListMusic,
  Loader2,
  Music2,
  Play,
  Plus,
  Radio,
  RefreshCw,
  User,
} from 'lucide-react';
import { FC, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  pickArtwork,
  type PlaylistIndexEntry,
  type PlaylistIndexNode,
  type Track,
} from '@nuclearplayer/model';

import { haptic } from '../../../services/androidMediaBridge';
import { spinForgottenGem } from '../../../services/endlessRadio';
import { useMobileEnhancementsStore } from '../../../services/mobileEnhancements';
import {
  playOrSaveRecommendedMix,
  playRecommendedAlbum,
  playSimilarArtistMix,
  usePersonalizedFeedStore,
  type PersonalizedAlbumCard,
  type PersonalizedArtistCard,
  type PersonalizedMixCard,
} from '../../../services/personalizedFeed';
import { playbackManager } from '../../../services/playback';
import { commands } from '../../../services/tauri/bindings';
import {
  computeListeningPersona,
  computeListeningStreak,
  useWrappedStatsStore,
} from '../../../services/wrappedStats';
import { useFavoritesStore } from '../../../stores/favoritesStore';
import { usePlaylistStore } from '../../../stores/playlistStore';
import { useQueueStore } from '../../../stores/queue/queueStore';

const greetingForHour = (hour: number) => {
  if (hour >= 0 && hour < 5) {
    return 'Late Night Session 🌙';
  }
  if (hour >= 5 && hour < 12) {
    return 'Good Morning 🌅';
  }
  if (hour >= 12 && hour < 18) {
    return 'Good Afternoon ☀️';
  }
  return 'Good Evening 🌆';
};

const flattenPlaylists = (nodes: PlaylistIndexNode[]): PlaylistIndexEntry[] => {
  const out: PlaylistIndexEntry[] = [];
  for (const node of nodes) {
    if (node.kind === 'playlist') {
      out.push(node);
    } else if (node.kind === 'folder') {
      out.push(...node.playlists);
    }
  }
  return out;
};

type JumpBackItem = {
  key: string;
  title: string;
  artist: string;
  coverUrl?: string;
};

export const PersonalizedDashboard: FC = () => {
  const navigate = useNavigate();
  const {
    totalSeconds,
    totalPlays,
    artistStats,
    trackStats,
    hourBuckets,
    activeDays,
  } = useWrappedStatsStore();
  const {
    index: playlistIndex,
    loaded: playlistsLoaded,
    loadIndex,
  } = usePlaylistStore();
  const {
    tracks: favoriteTracks,
    artists: favoriteArtists,
    loaded: favsLoaded,
    loadFromDisk,
  } = useFavoritesStore();
  const dominantColor = useMobileEnhancementsStore((s) => s.dominantColor);
  const endlessRadioEnabled = useMobileEnhancementsStore(
    (s) => s.endlessRadioEnabled,
  );
  const setEndlessRadioEnabled = useMobileEnhancementsStore(
    (s) => s.setEndlessRadioEnabled,
  );

  const feed = usePersonalizedFeedStore((s) => s.feed);
  const feedLoading = usePersonalizedFeedStore((s) => s.loading);
  const refreshFeed = usePersonalizedFeedStore((s) => s.refreshFeed);
  const [historyTopTracks, setHistoryTopTracks] = useState<JumpBackItem[]>([]);
  const [playingArtistId, setPlayingArtistId] = useState<string | null>(null);

  useEffect(() => {
    if (!playlistsLoaded) {
      void loadIndex();
    }
    if (!favsLoaded) {
      void loadFromDisk();
    }
  }, [playlistsLoaded, loadIndex, favsLoaded, loadFromDisk]);

  useEffect(() => {
    void refreshFeed(false);
  }, [
    refreshFeed,
    totalPlays,
    playlistsLoaded,
    favsLoaded,
    favoriteTracks.length,
    favoriteArtists.length,
    playlistIndex.length,
  ]);

  useEffect(() => {
    if (import.meta.env.MODE === 'test' || Object.keys(trackStats).length > 0) {
      return;
    }
    let cancelled = false;
    void commands
      .historyTopTracks({ from: 0, to: Date.now() + 86_400_000 }, 8)
      .then((tracks) => {
        if (cancelled || !Array.isArray(tracks)) {
          return;
        }
        setHistoryTopTracks(
          tracks.map((t, idx) => ({
            key: `hist-${idx}-${t.title}`,
            title: t.title,
            artist: t.artists.join(', ') || 'Unknown Artist',
            coverUrl: t.artworkUrl ?? undefined,
          })),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [trackStats, totalPlays]);

  const persona = useMemo(
    () => computeListeningPersona(hourBuckets),
    [hourBuckets],
  );
  const streak = useMemo(
    () => computeListeningStreak(activeDays),
    [activeDays],
  );
  const minutes = Math.round(totalSeconds / 60);

  const topTracks = useMemo<JumpBackItem[]>(() => {
    const fromWrapped = Object.values(trackStats)
      .sort((a, b) => b.plays - a.plays || b.seconds - a.seconds)
      .slice(0, 8);
    return fromWrapped.length > 0 ? fromWrapped : historyTopTracks;
  }, [trackStats, historyTopTracks]);

  const topArtists = useMemo(
    () =>
      Object.values(artistStats)
        .sort((a, b) => b.seconds - a.seconds || b.plays - a.plays)
        .slice(0, 6),
    [artistStats],
  );

  const playlists = useMemo(
    () => flattenPlaylists(playlistIndex).slice(0, 8),
    [playlistIndex],
  );

  const hasSeeds =
    topArtists.length > 0 ||
    favoriteTracks.length > 0 ||
    favoriteArtists.length > 0 ||
    playlists.length > 0 ||
    historyTopTracks.length > 0 ||
    Boolean(feed && feed.seedArtists.length > 0);

  const currentHour =
    import.meta.env.MODE === 'test' ? 20 : new Date().getHours();

  const playTrackNow = (track: Track) => {
    haptic('medium');
    const q = useQueueStore.getState();
    const idx = q.items.length;
    q.addToQueue([track]);
    q.goToIndex(idx);
    playbackManager.play();
  };

  const queueSingleTrack = (track: Track) => {
    haptic('light');
    useQueueStore.getState().addToQueue([track]);
    toast.success(`Added "${track.title}" to queue`);
  };

  const playTrackList = (tracks: Track[], label: string) => {
    if (tracks.length === 0) {
      return;
    }
    haptic('medium');
    const q = useQueueStore.getState();
    q.clearQueue();
    q.addToQueue(tracks);
    playbackManager.play();
    toast.success(`Playing ${label} (${tracks.length} tracks)`);
  };

  const queueTrackList = (tracks: Track[], label: string) => {
    if (tracks.length === 0) {
      return;
    }
    haptic('light');
    useQueueStore.getState().addToQueue(tracks);
    toast.success(`Queued ${tracks.length} tracks from ${label}`);
  };

  const playStatTrack = (t: JumpBackItem) => {
    playTrackNow({
      title: t.title,
      artists: [
        {
          name: t.artist,
          roles: [],
          source: { provider: 'personalized', id: t.artist },
        },
      ],
      artwork: t.coverUrl
        ? { items: [{ url: t.coverUrl, purpose: 'thumbnail' }] }
        : undefined,
      source: { provider: 'personalized', id: t.key },
    });
  };

  const shuffleFavorites = () => {
    haptic('medium');
    if (favoriteTracks.length === 0) {
      toast.info('Heart some songs first to shuffle your favorites!');
      return;
    }
    const shuffled = favoriteTracks.map((f) => f.ref);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    playbackManager.playTracks(shuffled);
    toast.success(`❤️ Shuffling ${favoriteTracks.length} favorite tracks`);
  };

  const handleOpenAlbum = async (album: PersonalizedAlbumCard) => {
    haptic('medium');
    const played = await playRecommendedAlbum(album);
    if (!played) {
      void navigate({
        to: '/search',
        search: { q: `${album.artistName} ${album.title}` },
      });
    }
  };

  const handlePlaySimilarArtist = async (artist: PersonalizedArtistCard) => {
    if (playingArtistId === artist.id) {
      return;
    }
    haptic('medium');
    setPlayingArtistId(artist.id);
    try {
      const played = await playSimilarArtistMix(artist);
      if (!played) {
        void navigate({ to: '/search', search: { q: artist.name } });
      }
    } finally {
      setPlayingArtistId(null);
    }
  };

  const handleMixAction = async (
    mix: PersonalizedMixCard,
    mode: 'play' | 'save',
  ) => {
    haptic('medium');
    await playOrSaveRecommendedMix(mix, mode);
  };

  return (
    <div className="mb-6 space-y-5">
      {/* Personalized Greeting + Vibe Banner */}
      <div
        className="border-border rounded-2xl border p-4 shadow-sm"
        style={{
          background: `linear-gradient(135deg, ${dominantColor}33 0%, var(--muted) 85%)`,
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-extrabold">
              {greetingForHour(currentHour)}
            </h2>
            <p className="text-xs opacity-75">
              {persona.emoji} <strong>{persona.title}</strong> • {minutes} min
              listened
              {streak > 0 ? ` • ${streak}d streak` : ''}
            </p>
          </div>
          {streak > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-extrabold text-amber-400">
              <Flame size={13} /> {streak}d
            </span>
          )}
        </div>

        {/* Quick Personalized Actions */}
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
          <button
            onClick={() => {
              haptic('heavy');
              void spinForgottenGem();
            }}
            className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 shadow transition active:scale-95"
          >
            <Dices size={14} /> Forgotten Gem
          </button>
          {favoriteTracks.length > 0 && (
            <button
              onClick={shuffleFavorites}
              className="border-border bg-background/70 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 transition active:scale-95"
            >
              <Heart size={13} className="text-rose-500" fill="currentColor" />{' '}
              Shuffle Favorites ({favoriteTracks.length})
            </button>
          )}
          <button
            onClick={() => {
              haptic('light');
              setEndlessRadioEnabled(!endlessRadioEnabled);
              toast.info(
                !endlessRadioEnabled
                  ? '📻 Endless Vibe Radio ON'
                  : '📻 Endless Vibe Radio OFF',
              );
            }}
            className={`border-border inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 transition active:scale-95 ${
              endlessRadioEnabled
                ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-400'
                : 'bg-background/70'
            }`}
          >
            <Radio size={13} /> Endless Radio{' '}
            {endlessRadioEnabled ? 'ON' : 'OFF'}
          </button>
          {hasSeeds && (
            <button
              onClick={() => {
                haptic('light');
                void refreshFeed(true);
              }}
              disabled={feedLoading}
              className="border-border bg-background/70 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 transition active:scale-95 disabled:opacity-60"
            >
              <RefreshCw
                size={13}
                className={feedLoading ? 'animate-spin' : ''}
              />
              Refresh Feed
            </button>
          )}
        </div>
      </div>

      {feedLoading && !feed && (
        <div className="border-border bg-muted/40 rounded-xl border p-4 text-xs font-semibold opacity-75">
          Building recommendations from your listening history...
        </div>
      )}

      {!hasSeeds && !feedLoading && (
        <div
          data-testid="personalized-empty-state"
          className="border-border bg-muted/40 flex flex-col items-center justify-center gap-3 rounded-2xl border p-8 text-center"
        >
          <Music2 size={36} className="opacity-50" />
          <div className="space-y-1">
            <h3 className="text-base font-extrabold">
              Start listening to build your feed
            </h3>
            <p className="max-w-md text-xs opacity-70">
              Play a few songs, favorite tracks, or import a playlist.
              Everything on this page updates to match what you listen to.
            </p>
          </div>
          <div className="mt-1 flex flex-wrap justify-center gap-2 text-xs font-bold">
            <button
              data-testid="personalized-empty-search"
              onClick={() => {
                haptic('light');
                void navigate({ to: '/search' });
              }}
              className="bg-primary text-primary-foreground rounded-full px-4 py-2 shadow transition active:scale-95"
            >
              Search Music
            </button>
            <button
              onClick={() => {
                haptic('light');
                void navigate({ to: '/playlists' });
              }}
              className="border-border bg-background/70 rounded-full border px-4 py-2 transition active:scale-95"
            >
              Playlists
            </button>
          </div>
        </div>
      )}

      {/* Recommended Tracks For You */}
      {feed && feed.recommendedTracks.length > 0 && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-extrabold">Recommended for You</h3>
              {feed.seedArtists.length > 0 && (
                <p className="text-[11px] opacity-65">
                  Based on {feed.seedArtists.slice(0, 3).join(', ')}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold">
              <button
                onClick={() =>
                  playTrackList(
                    feed.recommendedTracks.map((item) => item.track),
                    'Recommended Mix',
                  )
                }
                className="bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-full px-3 py-1 transition active:scale-95"
              >
                <Play size={12} fill="currentColor" /> Play Mix
              </button>
              <button
                onClick={() =>
                  queueTrackList(
                    feed.recommendedTracks.map((item) => item.track),
                    'Recommended Mix',
                  )
                }
                className="border-border bg-muted/70 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition active:scale-95"
              >
                <Plus size={12} /> Queue All
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {feed.recommendedTracks.map((item) => {
              const coverUrl =
                pickArtwork(item.track.artwork, 'thumbnail', 180)?.url ??
                pickArtwork(item.track.album?.artwork, 'thumbnail', 180)?.url;
              const artistLabel =
                item.track.artists?.map((a) => a.name).join(', ') ||
                'Unknown Artist';

              return (
                <div
                  key={`${item.track.source.provider}-${item.track.source.id}`}
                  className="border-border bg-muted/70 flex items-center gap-2 overflow-hidden rounded-xl border p-2 transition"
                >
                  <button
                    onClick={() => playTrackNow(item.track)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left active:scale-95"
                  >
                    <div className="bg-background relative size-11 shrink-0 overflow-hidden rounded-lg">
                      {coverUrl ? (
                        <img
                          src={coverUrl}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center opacity-50">
                          <Music2 size={16} />
                        </div>
                      )}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/25 text-white opacity-0 transition hover:opacity-100">
                        <Play size={14} fill="currentColor" />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold">
                        {item.track.title}
                      </div>
                      <div className="truncate text-[10px] opacity-75">
                        {artistLabel}
                      </div>
                      <div className="truncate text-[9px] opacity-55">
                        {item.reason}
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => queueSingleTrack(item.track)}
                    title="Add to queue"
                    aria-label={`Add ${item.track.title} to queue`}
                    className="hover:bg-background/80 flex size-7 shrink-0 items-center justify-center rounded-full opacity-75 transition hover:opacity-100 active:scale-90"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* "Because You Listen to <Artist>" Shelves */}
      {feed &&
        feed.artistShelves.map((shelf) => (
          <section key={shelf.seedArtist} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {shelf.seedImageUrl && (
                  <img
                    src={shelf.seedImageUrl}
                    alt=""
                    className="size-6 rounded-full object-cover"
                  />
                )}
                <h3 className="text-sm font-extrabold">
                  Because You Listen to {shelf.seedArtist}
                </h3>
              </div>
              <button
                onClick={() =>
                  playTrackList(shelf.tracks, `${shelf.seedArtist} Radio`)
                }
                className="border-border bg-muted/70 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold transition active:scale-95"
              >
                <Play size={11} fill="currentColor" /> Play Radio
              </button>
            </div>

            <div className="flex gap-2.5 overflow-x-auto pb-1">
              {shelf.tracks.map((track) => {
                const coverUrl =
                  pickArtwork(track.artwork, 'thumbnail', 180)?.url ??
                  pickArtwork(track.album?.artwork, 'thumbnail', 180)?.url;
                const artistLabel =
                  track.artists?.map((a) => a.name).join(', ') || '';

                return (
                  <button
                    key={`${shelf.seedArtist}-${track.source.id}`}
                    onClick={() => playTrackNow(track)}
                    className="border-border bg-muted/70 flex w-36 shrink-0 flex-col gap-1.5 rounded-xl border p-2.5 text-left transition active:scale-95"
                  >
                    <div className="bg-background relative aspect-square w-full overflow-hidden rounded-lg">
                      {coverUrl ? (
                        <img
                          src={coverUrl}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center opacity-40">
                          <Music2 size={26} />
                        </div>
                      )}
                      <div className="absolute right-1.5 bottom-1.5 flex size-7 items-center justify-center rounded-full bg-black/70 text-white">
                        <Play size={12} fill="currentColor" />
                      </div>
                    </div>
                    <div className="truncate text-xs font-bold">
                      {track.title}
                    </div>
                    <div className="truncate text-[10px] opacity-70">
                      {artistLabel}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}

      {/* Similar Artists */}
      {feed && feed.similarArtists.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-extrabold">Similar Artists</h3>
          <div className="flex gap-2.5 overflow-x-auto pb-1">
            {feed.similarArtists.map((artist) => (
              <div
                key={artist.id}
                className="border-border bg-muted/70 flex w-36 shrink-0 flex-col gap-1.5 rounded-xl border p-2.5 text-left"
              >
                <div className="relative aspect-square w-full">
                  <button
                    type="button"
                    onClick={() => {
                      haptic('light');
                      void navigate({
                        to: '/search',
                        search: { q: artist.name },
                      });
                    }}
                    className="bg-background block size-full cursor-pointer overflow-hidden rounded-full"
                    aria-label={`Search ${artist.name}`}
                  >
                    {artist.imageUrl ? (
                      <img
                        src={artist.imageUrl}
                        alt={artist.name}
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center opacity-40">
                        <User size={28} />
                      </div>
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={playingArtistId === artist.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handlePlaySimilarArtist(artist);
                    }}
                    aria-label={`Play ${artist.name}`}
                    className="bg-primary text-primary-foreground ring-background/70 absolute right-0.5 bottom-0.5 z-10 flex size-8 cursor-pointer items-center justify-center rounded-full shadow-md ring-2 transition hover:scale-105 active:scale-90 disabled:opacity-70"
                  >
                    {playingArtistId === artist.id ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Play size={13} fill="currentColor" />
                    )}
                  </button>
                </div>
                <button
                  onClick={() => {
                    haptic('light');
                    void navigate({
                      to: '/search',
                      search: { q: artist.name },
                    });
                  }}
                  className="text-left"
                >
                  <div className="truncate text-xs font-bold">
                    {artist.name}
                  </div>
                  <div className="truncate text-[10px] opacity-65">
                    {artist.reason}
                  </div>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Albums & Releases from Your Artists */}
      {feed && feed.albums.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-extrabold">Albums & Releases</h3>
          <div className="flex gap-2.5 overflow-x-auto pb-1">
            {feed.albums.map((album) => {
              const releaseYear = album.releaseDate?.slice(0, 4);
              return (
                <button
                  key={`${album.id}-${album.title}`}
                  onClick={() => void handleOpenAlbum(album)}
                  className="border-border bg-muted/70 flex w-36 shrink-0 flex-col gap-1.5 rounded-xl border p-2.5 text-left transition active:scale-95"
                >
                  <div className="bg-background relative aspect-square w-full overflow-hidden rounded-lg">
                    {album.coverUrl ? (
                      <img
                        src={album.coverUrl}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center opacity-40">
                        <Disc size={28} />
                      </div>
                    )}
                    {releaseYear && (
                      <span className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white">
                        {releaseYear}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs font-bold">
                    {album.title}
                  </div>
                  <div className="truncate text-[10px] opacity-70">
                    {album.artistName}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Mixes For You */}
      {feed && feed.mixes.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-extrabold">Mixes for You</h3>
          <div className="flex gap-2.5 overflow-x-auto pb-1">
            {feed.mixes.map((mix) => (
              <div
                key={mix.id}
                className="border-border bg-muted/70 flex w-40 shrink-0 flex-col gap-2 rounded-xl border p-2.5 text-left"
              >
                <div className="bg-background aspect-square w-full overflow-hidden rounded-lg">
                  {mix.pictureUrl ? (
                    <img
                      src={mix.pictureUrl}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center opacity-40">
                      <ListMusic size={28} />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold">{mix.title}</div>
                  <div className="text-[10px] opacity-65">
                    {mix.trackCount} tracks • {mix.seedArtist}
                  </div>
                </div>
                <div className="mt-auto flex items-center gap-1.5 text-[11px] font-bold">
                  <button
                    onClick={() => void handleMixAction(mix, 'play')}
                    className="bg-primary text-primary-foreground inline-flex flex-1 items-center justify-center gap-1 rounded-lg py-1 transition active:scale-95"
                  >
                    <Play size={11} fill="currentColor" /> Play
                  </button>
                  <button
                    onClick={() => void handleMixAction(mix, 'save')}
                    aria-label={`Save ${mix.title}`}
                    title="Save to Playlists"
                    className="border-border bg-background/70 inline-flex items-center justify-center rounded-lg border px-2 py-1 transition active:scale-95"
                  >
                    <Bookmark size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Jump Back In — Most Played Tracks */}
      {topTracks.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-extrabold">Jump Back In</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {topTracks.map((t) => (
              <button
                key={t.key}
                onClick={() => playStatTrack(t)}
                className="border-border bg-muted/70 flex items-center gap-2.5 overflow-hidden rounded-xl border p-2 text-left transition active:scale-95"
              >
                <div className="bg-background relative size-10 shrink-0 overflow-hidden rounded-lg">
                  {t.coverUrl ? (
                    <img
                      src={t.coverUrl}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center opacity-50">
                      <Music2 size={16} />
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/25 text-white opacity-0 transition hover:opacity-100">
                    <Play size={14} fill="currentColor" />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-bold">{t.title}</div>
                  <div className="truncate text-[10px] opacity-70">
                    {t.artist}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Your Playlists Quick Shelf */}
      {playlists.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold">Your Playlists</h3>
            <button
              onClick={() => void navigate({ to: '/playlists' })}
              className="text-xs font-bold opacity-70 hover:opacity-100"
            >
              See all →
            </button>
          </div>
          <div className="flex gap-2.5 overflow-x-auto pb-1">
            {playlists.map((pl) => (
              <button
                key={pl.id}
                onClick={() => {
                  haptic('light');
                  void navigate({
                    to: '/playlists/$playlistId',
                    params: { playlistId: pl.id },
                  });
                }}
                className="border-border bg-muted/70 flex w-36 shrink-0 flex-col gap-1.5 rounded-xl border p-2.5 text-left transition active:scale-95"
              >
                <div className="bg-background flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg">
                  {pl.thumbnails?.[0] ? (
                    <img
                      src={pl.thumbnails[0]}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    <ListMusic size={28} className="opacity-40" />
                  )}
                </div>
                <div className="truncate text-xs font-bold">{pl.name}</div>
                <div className="text-[10px] opacity-65">
                  {pl.itemCount} track{pl.itemCount === 1 ? '' : 's'}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* For Fans Of (Your Top Artists) */}
      {topArtists.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-extrabold">Your Top Artists</h3>
          <div className="flex flex-wrap gap-1.5">
            {topArtists.map((a) => (
              <button
                key={a.name}
                onClick={() => {
                  haptic('light');
                  void navigate({ to: '/search', search: { q: a.name } });
                }}
                className="border-border bg-muted/70 rounded-full border px-3 py-1.5 text-xs font-bold transition active:scale-95"
              >
                {a.name}{' '}
                <span className="font-mono text-[10px] opacity-65">
                  ({a.plays})
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
