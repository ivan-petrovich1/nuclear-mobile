import {
  CheckIcon,
  DownloadIcon,
  HeartIcon,
  ListMusicIcon,
  Loader2Icon,
  MusicIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
} from 'react';
import { toast } from 'sonner';

import { useTranslation } from '@nuclearplayer/i18n';
import {
  pickArtwork,
  stripResolutionState,
  type StreamCandidate,
  type Track,
} from '@nuclearplayer/model';
import type {
  MetadataProvider,
  StreamingProvider,
} from '@nuclearplayer/plugin-sdk';
import { Button, cn, Input } from '@nuclearplayer/ui';

import { useActiveProvider } from '../../../hooks/useActiveProvider';
import { metadataHost } from '../../../services/metadataHost';
import { providersHost } from '../../../services/providersHost';
import { useDownloadStore } from '../../../stores/downloadStore';
import { useFavoritesStore } from '../../../stores/favoritesStore';
import { usePlaylistStore } from '../../../stores/playlistStore';
import { useQueueStore } from '../../../stores/queue/queueStore';

type SourceTab = 'search' | 'liked' | 'downloaded' | 'queue';

type PlaylistAddSongsPanelProps = {
  playlistId: string;
  existingTracks: Track[];
};

const formatDuration = (durationMs?: number): string | null => {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }
  const totalSec = Math.floor(durationMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const getArtistLine = (track: Track): string =>
  (track.artists ?? []).map((artist) => artist.name).join(', ');

const buildTrackKeys = (track: Track): string[] => {
  const keys = [`${track.source.provider}:${track.source.id}`];
  const artist = getArtistLine(track).trim().toLowerCase();
  const title = track.title.trim().toLowerCase();
  if (artist && title) {
    keys.push(`${artist}::${title}`);
  }
  return keys;
};

const candidateToTrack = (
  candidate: StreamCandidate,
  providerId: string,
): Track => {
  const splitMatch = candidate.title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  const parsedArtist = splitMatch?.[1]?.trim();
  const parsedTitle = splitMatch?.[2]?.trim() || candidate.title;
  return {
    title: parsedTitle,
    artists: parsedArtist
      ? [
          {
            name: parsedArtist,
            roles: ['primary'],
            source: { provider: providerId, id: parsedArtist },
          },
        ]
      : [],
    durationMs: candidate.durationMs,
    artwork: candidate.thumbnail
      ? { items: [{ url: candidate.thumbnail, purpose: 'thumbnail' }] }
      : undefined,
    source: candidate.source ?? { provider: providerId, id: candidate.id },
  };
};

export const PlaylistAddSongsPanel: FC<PlaylistAddSongsPanelProps> = ({
  playlistId,
  existingTracks,
}) => {
  const { t } = useTranslation('playlists');
  const addTracks = usePlaylistStore((state) => state.addTracks);
  const favoriteTracks = useFavoritesStore((state) => state.tracks);
  const downloadedItems = useDownloadStore((state) => state.items);
  const queueItems = useQueueStore((state) => state.items);
  const activeMetadataProvider = useActiveProvider('metadata') as
    MetadataProvider | undefined;
  const activeStreamingProvider = useActiveProvider('streaming') as
    StreamingProvider | undefined;

  const [sourceTab, setSourceTab] = useState<SourceTab>('search');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [addingKeys, setAddingKeys] = useState<Record<string, boolean>>({});
  const requestSeqRef = useRef(0);

  useEffect(() => {
    requestSeqRef.current += 1;
    setQuery('');
    setSearchResults([]);
    setIsSearching(false);
    setSearchError(false);
    setSourceTab('search');
  }, [playlistId]);

  const runSearch = useCallback(
    async (rawQuery: string) => {
      const trimmed = rawQuery.trim();
      const reqId = ++requestSeqRef.current;

      if (!trimmed) {
        setSearchResults([]);
        setIsSearching(false);
        setSearchError(false);
        return;
      }

      setIsSearching(true);
      setSearchError(false);

      try {
        const metadataProvider =
          activeMetadataProvider ??
          (providersHost.list('metadata')[0] as MetadataProvider | undefined);

        if (metadataProvider) {
          const response = await metadataHost.search(
            { query: trimmed, types: ['tracks'], limit: 15 },
            metadataProvider.id,
          );
          if (reqId !== requestSeqRef.current) {
            return;
          }
          if (response.tracks && response.tracks.length > 0) {
            setSearchResults(response.tracks);
            setIsSearching(false);
            return;
          }
        }

        const streamingProvider =
          activeStreamingProvider ??
          (providersHost.get<StreamingProvider>('youtube', 'streaming') as
            StreamingProvider | undefined) ??
          (providersHost.list('streaming')[0] as StreamingProvider | undefined);

        if (streamingProvider) {
          const candidates = streamingProvider.searchForTrackV2
            ? await streamingProvider.searchForTrackV2({
                title: trimmed,
                artists: [],
                source: { provider: streamingProvider.id, id: trimmed },
              })
            : await streamingProvider.searchForTrack('', trimmed);
          if (reqId !== requestSeqRef.current) {
            return;
          }
          setSearchResults(
            (candidates ?? [])
              .slice(0, 15)
              .map((candidate) =>
                candidateToTrack(candidate, streamingProvider.id),
              ),
          );
          setIsSearching(false);
          return;
        }

        if (reqId === requestSeqRef.current) {
          setSearchResults([]);
          setIsSearching(false);
        }
      } catch {
        if (reqId === requestSeqRef.current) {
          setSearchResults([]);
          setSearchError(true);
          setIsSearching(false);
        }
      }
    },
    [activeMetadataProvider, activeStreamingProvider],
  );

  useEffect(() => {
    if (sourceTab !== 'search') {
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) {
      requestSeqRef.current += 1;
      setSearchResults([]);
      setIsSearching(false);
      setSearchError(false);
      return;
    }

    const timer = setTimeout(() => {
      void runSearch(trimmed);
    }, 350);

    return () => clearTimeout(timer);
  }, [query, sourceTab, runSearch]);

  const downloadedTracks = useMemo<Track[]>(
    () =>
      Object.values(downloadedItems).map((item) => ({
        title: item.title,
        artists: [
          {
            name: item.artist,
            roles: [],
            source: { provider: item.provider ?? 'offline', id: item.key },
          },
        ],
        durationMs: item.durationMs,
        source: {
          provider: item.provider ?? 'offline',
          id: item.streamId ?? item.key,
        },
      })),
    [downloadedItems],
  );

  const likedTracks = useMemo<Track[]>(
    () => favoriteTracks.map((entry) => entry.ref),
    [favoriteTracks],
  );

  const queueTracks = useMemo<Track[]>(
    () => queueItems.map((item) => item.track),
    [queueItems],
  );

  const localFilteredTracks = useMemo<Track[]>(() => {
    const sourceList =
      sourceTab === 'liked'
        ? likedTracks
        : sourceTab === 'downloaded'
          ? downloadedTracks
          : queueTracks;

    const filter = query.trim().toLowerCase();
    if (!filter) {
      return sourceList;
    }

    return sourceList.filter((track) => {
      const titleMatch = track.title.toLowerCase().includes(filter);
      const artistMatch = getArtistLine(track).toLowerCase().includes(filter);
      return titleMatch || artistMatch;
    });
  }, [sourceTab, likedTracks, downloadedTracks, queueTracks, query]);

  const displayedTracks =
    sourceTab === 'search' ? searchResults : localFilteredTracks;

  const existingKeys = useMemo(() => {
    const set = new Set<string>();
    for (const track of existingTracks) {
      for (const key of buildTrackKeys(track)) {
        set.add(key);
      }
    }
    return set;
  }, [existingTracks]);

  const isTrackAdded = useCallback(
    (track: Track) =>
      buildTrackKeys(track).some((key) => existingKeys.has(key)),
    [existingKeys],
  );

  const handleAddTrack = async (track: Track) => {
    const rowKey = `${track.source.provider}:${track.source.id}`;
    if (addingKeys[rowKey] || isTrackAdded(track)) {
      return;
    }
    setAddingKeys((prev) => ({ ...prev, [rowKey]: true }));
    try {
      await addTracks(playlistId, [stripResolutionState(track)]);
      toast.success(t('addSongs.addedToast', { title: track.title }));
    } finally {
      setAddingKeys((prev) => {
        const next = { ...prev };
        delete next[rowKey];
        return next;
      });
    }
  };

  const isExpanded = sourceTab !== 'search' || query.trim().length > 0;

  const collapsePanel = () => {
    requestSeqRef.current += 1;
    setSourceTab('search');
    setQuery('');
    setSearchResults([]);
    setIsSearching(false);
    setSearchError(false);
  };

  const tabs: Array<{
    id: SourceTab;
    label: string;
    icon: typeof SearchIcon;
    count?: number;
  }> = [
    { id: 'search', label: t('addSongs.tabs.search'), icon: SearchIcon },
    {
      id: 'liked',
      label: t('addSongs.tabs.liked'),
      icon: HeartIcon,
      count: likedTracks.length,
    },
    {
      id: 'downloaded',
      label: t('addSongs.tabs.downloaded'),
      icon: DownloadIcon,
      count: downloadedTracks.length,
    },
    {
      id: 'queue',
      label: t('addSongs.tabs.queue'),
      icon: ListMusicIcon,
      count: queueTracks.length,
    },
  ];

  return (
    <section
      className="border-border surface-card shadow-shadow mx-3 mt-3 rounded-md border-(length:--border-width) p-3 md:mx-6 md:mt-4 md:p-4"
      data-testid="playlist-add-songs-panel"
    >
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-sm font-bold">
            <PlusIcon size={16} />
            <span>{t('addSongs.title')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = sourceTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSourceTab(tab.id)}
                  data-testid={`playlist-add-songs-tab-${tab.id}`}
                  className={cn(
                    'border-border inline-flex cursor-pointer items-center gap-1 rounded-full border-(length:--border-width) px-2.5 py-1 text-xs font-semibold transition',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted/50 hover:bg-muted',
                  )}
                >
                  <Icon size={12} />
                  <span>{tab.label}</span>
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className="opacity-75">({tab.count})</span>
                  )}
                </button>
              );
            })}
            {isExpanded && (
              <Button
                type="button"
                variant="tertiary"
                size="sm"
                onClick={collapsePanel}
                data-testid="playlist-add-songs-close"
                aria-label={t('addSongs.close')}
              >
                <XIcon size={14} />
                <span className="hidden sm:inline">{t('addSongs.close')}</span>
              </Button>
            )}
          </div>
        </div>

        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (sourceTab === 'search') {
              void runSearch(query);
            }
          }}
        >
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              size="sm"
              tone="secondary"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('addSongs.searchPlaceholder')}
              data-testid="playlist-add-songs-input"
              className="pr-8 pl-8"
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer"
                aria-label="Clear search"
              >
                <XIcon size={14} />
              </button>
            )}
          </div>
        </form>

        {isExpanded && (
          <div className="border-border bg-muted/25 max-h-72 overflow-y-auto rounded-md border-(length:--border-width) p-1.5">
            {sourceTab === 'search' && isSearching ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs opacity-75">
                <Loader2Icon size={16} className="animate-spin" />
                <span>{t('addSongs.searching')}</span>
              </div>
            ) : sourceTab === 'search' && searchError ? (
              <div className="text-accent-red py-5 text-center text-xs font-medium">
                {t('addSongs.searchError')}
              </div>
            ) : displayedTracks.length === 0 ? (
              <div className="py-5 text-center text-xs opacity-70">
                {sourceTab === 'search' || query.trim()
                  ? t('addSongs.noResults')
                  : t('addSongs.emptyTab')}
              </div>
            ) : (
              <div className="divide-border/50 flex flex-col divide-y">
                {displayedTracks.map((track, idx) => {
                  const rowKey = `${track.source.provider}:${track.source.id}-${idx}`;
                  const actionKey = `${track.source.provider}:${track.source.id}`;
                  const added = isTrackAdded(track);
                  const adding = Boolean(addingKeys[actionKey]);
                  const thumb = pickArtwork(
                    track.artwork,
                    'thumbnail',
                    64,
                  )?.url;
                  const artistLine = getArtistLine(track);
                  const durationLabel = formatDuration(track.durationMs);

                  return (
                    <div
                      key={rowKey}
                      data-testid="playlist-add-song-result"
                      className="flex items-center justify-between gap-2.5 px-2 py-2"
                    >
                      <div className="border-border bg-muted relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded border">
                        {thumb ? (
                          <img
                            src={thumb}
                            alt=""
                            className="size-full object-cover"
                          />
                        ) : (
                          <MusicIcon size={15} className="opacity-45" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-bold md:text-sm">
                          {track.title}
                        </div>
                        <div className="flex items-center gap-1.5 truncate text-[11px] opacity-75">
                          {artistLine && (
                            <span className="truncate">{artistLine}</span>
                          )}
                          {artistLine && durationLabel && <span>•</span>}
                          {durationLabel && (
                            <span className="shrink-0 font-mono">
                              {durationLabel}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={added ? 'tertiary' : 'default'}
                        disabled={added || adding}
                        onClick={() => {
                          void handleAddTrack(track);
                        }}
                        data-testid="playlist-add-song-button"
                        className="shrink-0"
                      >
                        {added ? (
                          <>
                            <CheckIcon size={14} />
                            <span>{t('addSongs.added')}</span>
                          </>
                        ) : (
                          <>
                            <PlusIcon size={14} />
                            <span>{t('addSongs.add')}</span>
                          </>
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
