import {
  ArrowLeftRight,
  Bookmark,
  Check,
  ChevronDown,
  Dices,
  Disc,
  Download,
  FolderDown,
  Heart,
  Loader2,
  MicVocal,
  Moon,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  Repeat1,
  Send,
  Share2,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Trash2,
  Trophy,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { FC, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { pickArtwork, type RepeatMode, type Track } from '@nuclearplayer/model';

import { useCoreSetting } from '../hooks/useCoreSetting';
import { useCurrentQueueItem } from '../hooks/useCurrentQueueItem';
import { useQueue } from '../hooks/useQueue';
import { useTrackActions } from '../hooks/useTrackActions';
import { spinForgottenGem } from '../services/endlessRadio';
import {
  shuffleRemainingQueue,
  useMobileEnhancementsStore,
  type DesktopHubTab,
} from '../services/mobileEnhancements';
import { useP2pSyncStore } from '../services/p2pSync';
import { playbackManager } from '../services/playback';
import { shareTrack } from '../services/shareService';
import { resolveAllProviderCandidates } from '../services/streamingHost';
import { isOfflineBypassed } from '../services/streamResolution/offlineBypass';
import {
  shareTrackVibeCard,
  shareWrappedCard,
} from '../services/vibeCardGenerator';
import {
  computeListeningPersona,
  computeListeningStreak,
  useWrappedStatsStore,
} from '../services/wrappedStats';
import { useCustomWallpaperStore } from '../stores/customWallpaperStore';
import { getTrackDownloadKey, useDownloadStore } from '../stores/downloadStore';
import { usePlaylistStore } from '../stores/playlistStore';
import { useQueueStore } from '../stores/queue/queueStore';
import { useSoundStore } from '../stores/soundStore';
import { AudioDspPanel } from './AudioDspPanel';
import { BeatVisualizer } from './BeatVisualizer';
import { ConnectedStreamVerification } from './ConnectedStreamVerification';
import { CustomWallpaperSection } from './CustomWallpaperSection';
import { FakeBankModal } from './FakeBankModal';
import { P2pSyncPanel } from './P2pSyncPanel';
import { SpotifyAccountSyncPanel } from './SpotifyAccountSyncPanel';

const formatSeconds = (sec: number): string => {
  if (!Number.isFinite(sec) || sec < 0) {
    return '0:00';
  }
  const total = Math.floor(sec);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const HUB_TABS: Array<{ id: DesktopHubTab; label: string }> = [
  { id: 'spotify', label: 'Spotify Sync' },
  { id: 'offline', label: 'Offline & Tools' },
  { id: 'wrapped', label: 'Wrapped' },
  { id: 'p2p', label: 'P2P Sync' },
  { id: 'dsp', label: 'Audio DSP' },
];

export const DesktopEnhancementsShell: FC = () => {
  const currentItem = useCurrentQueueItem();
  const { items: queueItems, currentIndex } = useQueue();
  const goToNext = useQueueStore((s) => s.goToNext);
  const goToPrevious = useQueueStore((s) => s.goToPrevious);
  const goToId = useQueueStore((s) => s.goToId);
  const clearQueue = useQueueStore((s) => s.clearQueue);

  const { status, seek: position, duration } = useSoundStore();
  const isPlaying = status === 'playing';

  const [shuffleEnabled, setShuffleEnabled] =
    useCoreSetting<boolean>('playback.shuffle');
  const [repeatMode, setRepeatMode] =
    useCoreSetting<RepeatMode>('playback.repeat');
  const [autoDownloadPlayed, setAutoDownloadPlayed] = useCoreSetting<boolean>(
    'playback.autoDownloadPlayed',
  );
  const [exportDownloadsToPublic, setExportDownloadsToPublic] =
    useCoreSetting<boolean>('playback.exportDownloadsToPublicFolder');

  const trackActions = useTrackActions();
  const customWallpaper = useCustomWallpaperStore();
  const downloadedItems = useDownloadStore((s) => s.items);
  const downloadingKeys = useDownloadStore((s) => s.downloadingKeys);
  const downloadTrack = useDownloadStore((s) => s.downloadTrack);
  const downloadTracks = useDownloadStore((s) => s.downloadTracks);
  const removeDownload = useDownloadStore((s) => s.removeDownload);
  const clearAllDownloads = useDownloadStore((s) => s.clearAllDownloads);

  const {
    nowPlayingOpen,
    nowPlayingTab,
    desktopHubOpen,
    desktopHubTab,
    desktopStreamPickerOpen,
    sleepEndAt,
    oledBlackMode,
    sponsorBlockEnabled,
    preResolveEnabled,
    playbackSpeed,
    preservePitch,
    dominantColor,
    syncedLyrics,
    plainLyrics,
    lyricsLoading,
    preResolvedIds,
    loopA,
    loopB,
    trackBookmarks,
    visualizerEnabled,
    karaokeEnabled,
    setNowPlayingOpen,
    setNowPlayingTab,
    setDesktopHubOpen,
    openDesktopHub,
    setDesktopStreamPickerOpen,
    cycleSleepTimer,
    setOledBlackMode,
    setSponsorBlockEnabled,
    setPreResolveEnabled,
    setLoopA,
    setLoopB,
    clearLoop,
    setTrackBookmark,
    setKaraokeEnabled,
  } = useMobileEnhancementsStore();

  const wrappedStats = useWrappedStatsStore();
  const p2pPeerAddress = useP2pSyncStore((s) => s.peerAddress);
  const remoteState = useP2pSyncStore((s) => s.remoteState);
  const sendHandoffToPeer = useP2pSyncStore((s) => s.sendHandoffToPeer);
  const pullHandoffFromPeer = useP2pSyncStore((s) => s.pullHandoffFromPeer);
  const sendRemoteControl = useP2pSyncStore((s) => s.sendRemoteControl);

  const [fakeBankOpen, setFakeBankOpen] = useState(false);
  const [searchingAllStreams, setSearchingAllStreams] = useState(false);
  const [vinylMode, setVinylMode] = useState(false);
  const [heartBurstKey, setHeartBurstKey] = useState(0);
  const [sleepRemainingMin, setSleepRemainingMin] = useState<number | null>(
    null,
  );
  const localAudioInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const activeLyricRef = useRef<HTMLButtonElement | null>(null);
  const lastArtClickRef = useRef<number>(0);
  const autoSearchedStreamItemRef = useRef<string | null>(null);

  const track = currentItem?.track;
  const coverUrl = track
    ? (pickArtwork(track.artwork, 'thumbnail', 512)?.url ??
      pickArtwork(track.album?.artwork, 'thumbnail', 512)?.url)
    : undefined;
  const artistName =
    track?.artists?.map((a) => a.name).join(', ') || 'Unknown Artist';
  const dlKey = track ? getTrackDownloadKey(track) : '';
  const isTrackDownloaded = Boolean(dlKey && downloadedItems[dlKey]);
  const isTrackDownloading = Boolean(dlKey && downloadingKeys[dlKey]);
  const isTrackFavorite = track ? trackActions.isFavorite(track) : false;

  const nextItem = queueItems[currentIndex + 1];
  const isNextPreResolved = Boolean(
    nextItem &&
    (preResolvedIds[nextItem.id] ||
      downloadedItems[getTrackDownloadKey(nextItem.track)]),
  );

  useEffect(() => {
    if (!sleepEndAt) {
      setSleepRemainingMin(null);
      return;
    }
    const updateRem = () => {
      const leftMs = sleepEndAt - Date.now();
      setSleepRemainingMin(
        leftMs > 0 ? Math.max(1, Math.ceil(leftMs / 60_000)) : null,
      );
    };
    updateRem();
    const id = window.setInterval(updateRem, 10_000);
    return () => window.clearInterval(id);
  }, [sleepEndAt]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') {
        return;
      }
      if (desktopStreamPickerOpen) {
        setDesktopStreamPickerOpen(false);
      } else if (nowPlayingOpen) {
        setNowPlayingOpen(false);
      } else if (desktopHubOpen) {
        setDesktopHubOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    desktopHubOpen,
    desktopStreamPickerOpen,
    nowPlayingOpen,
    setDesktopHubOpen,
    setDesktopStreamPickerOpen,
    setNowPlayingOpen,
  ]);

  let activeLyricIndex = -1;
  for (let i = 0; i < syncedLyrics.length; i++) {
    if (position >= syncedLyrics[i].timeSec) {
      activeLyricIndex = i;
    } else {
      break;
    }
  }

  useEffect(() => {
    if (nowPlayingOpen && nowPlayingTab === 'lyrics' && activeLyricIndex >= 0) {
      activeLyricRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeLyricIndex, nowPlayingOpen, nowPlayingTab]);

  const handleSearchAllStreams = async (silentEmpty = false) => {
    if (!track || !currentItem || searchingAllStreams) {
      return;
    }
    setSearchingAllStreams(true);
    try {
      const all = await resolveAllProviderCandidates(track);
      if (all.length === 0) {
        if (!silentEmpty) {
          toast.info('No additional streams found across sources');
        }
      } else {
        const existing = track.streamCandidates ?? [];
        const seen = new Set(
          existing.map((c) => `${c.source?.provider ?? 'default'}:${c.id}`),
        );
        const extras = all.filter(
          (c) => !seen.has(`${c.source?.provider ?? 'default'}:${c.id}`),
        );
        const combined = [...existing, ...extras];
        useQueueStore.getState().updateItemState(currentItem.id, {
          track: { ...track, streamCandidates: combined },
        });
        if (!silentEmpty) {
          toast.success(
            `Found ${combined.length} stream${combined.length === 1 ? '' : 's'} across sources`,
          );
        }
      }
    } finally {
      setSearchingAllStreams(false);
    }
  };

  useEffect(() => {
    if (
      desktopStreamPickerOpen &&
      currentItem &&
      track &&
      (track.streamCandidates?.length ?? 0) <= 1 &&
      !searchingAllStreams &&
      autoSearchedStreamItemRef.current !== currentItem.id
    ) {
      autoSearchedStreamItemRef.current = currentItem.id;
      void handleSearchAllStreams(true);
    }
  }, [desktopStreamPickerOpen, currentItem?.id]);

  const handleLocalAudioFiles = (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }
    const localTracks: Track[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const blobUrl = URL.createObjectURL(file);
      const baseName = file.name.replace(/\.[^.]+$/, '');
      const [artistPart, titlePart] = baseName.includes(' - ')
        ? baseName.split(' - ', 2)
        : ['Local Audio', baseName];
      localTracks.push({
        title: titlePart.trim(),
        artists: [
          {
            name: artistPart.trim(),
            roles: [],
            source: { provider: 'local', id: `local-artist-${i}` },
          },
        ],
        source: { provider: 'local', id: blobUrl },
        streamCandidates: [
          {
            id: blobUrl,
            title: titlePart.trim(),
            failed: false,
            lastResolvedAtIso: new Date(Date.now() + 86400000).toISOString(),
            source: { provider: 'local', id: blobUrl },
            stream: {
              url: blobUrl,
              protocol: 'http',
              source: { provider: 'local', id: blobUrl },
            },
          },
        ],
      });
    }
    useQueueStore.getState().addToQueue(localTracks);
    playbackManager.play();
    toast.success(`Added ${localTracks.length} local audio file(s) to queue`);
  };

  const handleExportBackup = () => {
    try {
      const playlistState = usePlaylistStore.getState();
      const backup = {
        exportedAt: new Date().toISOString(),
        playlistsIndex: playlistState.index,
        playlists: Array.from(playlistState.playlists.entries()),
        queue: useQueueStore.getState().items,
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nuclear-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Exported Nuclear backup JSON');
    } catch {
      toast.error('Failed to export backup');
    }
  };

  const handleImportBackup = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (Array.isArray(json.queue) && json.queue.length > 0) {
        const tracks = json.queue.map((i: { track?: Track }) => i.track ?? i);
        useQueueStore.getState().addToQueue(tracks);
        toast.success(`Imported ${tracks.length} tracks from backup`);
      } else if (Array.isArray(json.items)) {
        const tracks = json.items.map((i: { track?: Track }) => i.track ?? i);
        useQueueStore.getState().addToQueue(tracks);
        toast.success(`Imported ${tracks.length} tracks into queue`);
      } else {
        toast.info('Backup file read');
      }
    } catch {
      toast.error('Invalid backup JSON file');
    }
  };

  const handleArtDoubleClick = () => {
    const now = Date.now();
    if (now - lastArtClickRef.current < 320 && track) {
      lastArtClickRef.current = 0;
      if (!isTrackFavorite) {
        trackActions.toggleFavorite(track);
      }
      setHeartBurstKey((k) => k + 1);
    } else {
      lastArtClickRef.current = now;
    }
  };

  const handleToggleRepeat = () => {
    const modes: RepeatMode[] = ['off', 'all', 'one'];
    const idx = modes.indexOf(repeatMode ?? 'off');
    setRepeatMode(modes[(idx + 1) % modes.length]);
  };

  return (
    <>
      <input
        ref={localAudioInputRef}
        type="file"
        accept="audio/*,.mp3,.flac,.m4a,.wav,.ogg"
        multiple
        className="hidden"
        onChange={(e) => handleLocalAudioFiles(e.target.files)}
      />
      <input
        ref={backupInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => void handleImportBackup(e.target.files?.[0])}
      />

      {/* Paired Mobile Remote Control Banner */}
      {remoteState?.isPlaying && !isPlaying && (
        <div className="border-border flex items-center justify-between gap-3 border-t bg-emerald-500/15 px-4 py-1.5 text-xs">
          <div className="min-w-0 flex-1 truncate">
            <span className="font-extrabold text-emerald-400">
              📱 {remoteState.deviceName}: {remoteState.title || 'Playing'}
            </span>
            {remoteState.artist && (
              <span className="ml-2 opacity-75">— {remoteState.artist}</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => void sendRemoteControl('previous')}
              className="rounded-md bg-black/25 px-2 py-1 hover:bg-black/40"
              aria-label="Remote Previous"
            >
              <SkipBack size={13} />
            </button>
            <button
              type="button"
              onClick={() => void sendRemoteControl('toggle')}
              className="rounded-md bg-emerald-500 px-2 py-1 text-black hover:opacity-90"
              aria-label="Remote Play/Pause"
            >
              <Play size={13} />
            </button>
            <button
              type="button"
              onClick={() => void sendRemoteControl('next')}
              className="rounded-md bg-black/25 px-2 py-1 hover:bg-black/40"
              aria-label="Remote Next"
            >
              <SkipForward size={13} />
            </button>
            <button
              type="button"
              onClick={() => void pullHandoffFromPeer()}
              className="rounded-md bg-white/15 px-2.5 py-1 font-bold hover:bg-white/25"
            >
              Move Here
            </button>
          </div>
        </div>
      )}

      {/* Desktop Nuclear Hub Modal */}
      {desktopHubOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-6 backdrop-blur-xs"
          onClick={() => setDesktopHubOpen(false)}
        >
          <div
            data-testid="desktop-hub-modal"
            className="border-border bg-background text-foreground flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border shadow-2xl"
            style={{
              backgroundColor: oledBlackMode ? '#000000' : 'var(--background)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-border flex items-center justify-between border-b px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Sparkles size={19} />
                <span className="text-base font-extrabold">Nuclear Hub</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-xs font-bold text-amber-300 transition hover:bg-amber-500/25"
                  onClick={() => setFakeBankOpen(true)}
                >
                  🏦 Loans
                </button>
                <button
                  type="button"
                  onClick={() => setDesktopHubOpen(false)}
                  className="border-border rounded-md border p-1.5 opacity-80 hover:opacity-100"
                  aria-label="Close Nuclear Hub"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="border-border/60 grid grid-cols-5 gap-1.5 border-b px-4 py-2.5 text-xs font-bold">
              {HUB_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => openDesktopHub(tab.id)}
                  className={`rounded-lg py-1.5 transition ${
                    desktopHubTab === tab.id
                      ? 'bg-primary text-primary-foreground shadow'
                      : 'bg-muted/60 opacity-75 hover:opacity-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {desktopHubTab === 'spotify' && <SpotifyAccountSyncPanel />}

              {desktopHubTab === 'p2p' && <P2pSyncPanel />}

              {desktopHubTab === 'dsp' && (
                <AudioDspPanel showMobileOnlyControls={false} />
              )}

              {desktopHubTab === 'wrapped' &&
                (() => {
                  const persona = computeListeningPersona(
                    wrappedStats.hourBuckets,
                  );
                  const streak = computeListeningStreak(
                    wrappedStats.activeDays,
                  );
                  const mins = Math.round(wrappedStats.totalSeconds / 60);
                  const topArtists = Object.values(wrappedStats.artistStats)
                    .sort((a, b) => b.seconds - a.seconds || b.plays - a.plays)
                    .slice(0, 5);
                  const topTracks = Object.values(wrappedStats.trackStats)
                    .sort((a, b) => b.seconds - a.seconds || b.plays - a.plays)
                    .slice(0, 5);

                  return (
                    <div className="space-y-4">
                      <div
                        className="rounded-2xl border border-white/15 p-5 text-center text-white shadow-xl"
                        style={{
                          background: `linear-gradient(135deg, ${dominantColor}, #141024 85%)`,
                        }}
                      >
                        <div className="text-4xl">{persona.emoji}</div>
                        <div className="mt-1 text-xl font-extrabold">
                          {persona.title}
                        </div>
                        <div className="mt-0.5 text-xs opacity-80">
                          {persona.subtitle}
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-2">
                          <div className="rounded-xl bg-black/30 p-2.5">
                            <div className="text-lg font-extrabold">{mins}</div>
                            <div className="text-[10px] opacity-75">
                              MINUTES
                            </div>
                          </div>
                          <div className="rounded-xl bg-black/30 p-2.5">
                            <div className="text-lg font-extrabold">
                              {wrappedStats.totalPlays}
                            </div>
                            <div className="text-[10px] opacity-75">PLAYS</div>
                          </div>
                          <div className="rounded-xl bg-black/30 p-2.5">
                            <div className="text-lg font-extrabold">
                              {streak}d 🔥
                            </div>
                            <div className="text-[10px] opacity-75">STREAK</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => shareWrappedCard(dominantColor)}
                          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-extrabold text-black shadow transition hover:scale-105"
                        >
                          <Share2 size={14} /> Share Wrapped Card
                        </button>
                      </div>

                      <div className="border-border space-y-2 rounded-xl border p-3">
                        <div className="flex items-center gap-1.5 text-xs font-extrabold">
                          <Trophy size={14} /> Top Artists
                        </div>
                        {topArtists.length === 0 ? (
                          <div className="py-3 text-center text-xs opacity-60">
                            Play some songs to build your on-device Wrapped!
                          </div>
                        ) : (
                          topArtists.map((artist, idx) => (
                            <div
                              key={artist.name}
                              className="flex items-center justify-between rounded-lg bg-black/15 px-3 py-2 text-xs"
                            >
                              <span className="truncate font-bold">
                                {idx + 1}. {artist.name}
                              </span>
                              <span className="shrink-0 font-mono text-[11px] opacity-75">
                                {artist.plays} plays •{' '}
                                {Math.max(1, Math.round(artist.seconds / 60))}m
                              </span>
                            </div>
                          ))
                        )}
                      </div>

                      {topTracks.length > 0 && (
                        <div className="border-border space-y-2 rounded-xl border p-3">
                          <div className="text-xs font-extrabold">
                            🎵 Most Played Tracks
                          </div>
                          {topTracks.map((t, idx) => (
                            <div
                              key={t.key}
                              className="flex items-center justify-between rounded-lg bg-black/15 px-3 py-2 text-xs"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-bold">
                                  {idx + 1}. {t.title}
                                </div>
                                <div className="truncate text-[11px] opacity-70">
                                  {t.artist}
                                </div>
                              </div>
                              <span className="ml-2 shrink-0 font-mono text-[11px] opacity-75">
                                {t.plays}×
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

              {desktopHubTab === 'offline' && (
                <div className="space-y-4">
                  <button
                    type="button"
                    className="bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-extrabold shadow transition hover:opacity-95"
                    onClick={() => {
                      void spinForgottenGem().then((picked) => {
                        if (picked) {
                          setDesktopHubOpen(false);
                        }
                      });
                    }}
                  >
                    <Dices size={16} />
                    <span>🎲 Spin Forgotten Gem Roulette</span>
                  </button>

                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      className="border-border surface-card flex items-center justify-center gap-2 rounded-lg border p-2.5 text-xs font-bold hover:opacity-90"
                      onClick={() => localAudioInputRef.current?.click()}
                    >
                      <Disc size={16} />
                      <span>Play Local Audio Files</span>
                    </button>
                    <button
                      type="button"
                      className="border-border surface-card flex items-center justify-center gap-2 rounded-lg border p-2.5 text-xs font-bold hover:opacity-90"
                      onClick={() =>
                        void downloadTracks(queueItems.map((i) => i.track))
                      }
                    >
                      <Download size={16} />
                      <span>Download Full Queue</span>
                    </button>
                    <button
                      type="button"
                      className="border-border surface-card flex items-center justify-center gap-2 rounded-lg border p-2.5 text-xs font-bold hover:opacity-90"
                      onClick={handleExportBackup}
                    >
                      <FolderDown size={16} />
                      <span>Export Backup JSON</span>
                    </button>
                    <button
                      type="button"
                      className="border-border surface-card flex items-center justify-center gap-2 rounded-lg border p-2.5 text-xs font-bold hover:opacity-90"
                      onClick={() => backupInputRef.current?.click()}
                    >
                      <Upload size={16} />
                      <span>Import Backup JSON</span>
                    </button>
                  </div>

                  <div className="border-border space-y-2 rounded-lg border p-3">
                    <label className="flex items-center justify-between text-xs font-semibold">
                      <span>
                        ⚡ Smart Stream Pre-Resolving (0ms track transitions)
                      </span>
                      <input
                        type="checkbox"
                        checked={preResolveEnabled}
                        onChange={(e) => setPreResolveEnabled(e.target.checked)}
                      />
                    </label>
                    <label className="flex items-center justify-between text-xs font-semibold">
                      <span>
                        📥 Auto-download played songs (off by default to save
                        space)
                      </span>
                      <input
                        type="checkbox"
                        checked={Boolean(autoDownloadPlayed)}
                        onChange={(e) =>
                          void setAutoDownloadPlayed(e.target.checked)
                        }
                      />
                    </label>
                    <label className="flex items-center justify-between text-xs font-semibold">
                      <span>📂 Export copy to Downloads/Nuclear folder</span>
                      <input
                        type="checkbox"
                        checked={Boolean(exportDownloadsToPublic)}
                        onChange={(e) =>
                          void setExportDownloadsToPublic(e.target.checked)
                        }
                      />
                    </label>
                    <label className="flex items-center justify-between text-xs font-semibold">
                      <span>
                        ⏭ SponsorBlock (auto-skip non-music intros/outros)
                      </span>
                      <input
                        type="checkbox"
                        checked={sponsorBlockEnabled}
                        onChange={(e) =>
                          setSponsorBlockEnabled(e.target.checked)
                        }
                      />
                    </label>
                    <label className="flex items-center justify-between text-xs font-semibold">
                      <span>🌑 True OLED Black Mode (#000000 AMOLED)</span>
                      <input
                        type="checkbox"
                        checked={oledBlackMode}
                        onChange={(e) => setOledBlackMode(e.target.checked)}
                      />
                    </label>
                  </div>

                  <CustomWallpaperSection compact />

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold">
                        Downloaded Songs ({Object.keys(downloadedItems).length})
                      </h3>
                      {Object.keys(downloadedItems).length > 0 && (
                        <button
                          type="button"
                          onClick={() => void clearAllDownloads()}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-[11px] font-bold text-rose-400"
                        >
                          <Trash2 size={12} /> Clear All
                        </button>
                      )}
                    </div>
                    {Object.values(downloadedItems).length === 0 ? (
                      <div className="border-border rounded-lg border p-6 text-center text-xs opacity-70">
                        No offline songs downloaded yet. Use the Download button
                        in the player bar or any playlist to save tracks
                        offline.
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {Object.values(downloadedItems).map((item) => {
                          const synthTrack: Track = {
                            title: item.title,
                            artists: [
                              {
                                name: item.artist,
                                roles: [],
                                source: { provider: 'offline', id: item.key },
                              },
                            ],
                            durationMs: item.durationMs,
                            source: { provider: 'offline', id: item.key },
                          };
                          return (
                            <div
                              key={item.key}
                              className="border-border flex items-center justify-between rounded-lg border px-3 py-2"
                            >
                              <button
                                type="button"
                                className="min-w-0 flex-1 text-left"
                                onClick={() => {
                                  playbackManager.playTracks([synthTrack]);
                                  setDesktopHubOpen(false);
                                }}
                              >
                                <div className="truncate text-xs font-bold">
                                  {item.title}
                                </div>
                                <div className="truncate text-[11px] opacity-70">
                                  {item.artist} •{' '}
                                  {item.container?.toUpperCase()}
                                </div>
                              </button>
                              <button
                                type="button"
                                className="p-1.5 opacity-70 hover:opacity-100"
                                onClick={() => void removeDownload(synthTrack)}
                                aria-label="Remove download"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Desktop Immersive Expanded Now Playing Overlay */}
      {nowPlayingOpen && (
        <div
          data-testid="desktop-now-playing-overlay"
          className="fixed inset-0 z-50 flex flex-col overflow-hidden"
          style={
            customWallpaper.enabled && customWallpaper.imageDataUrl
              ? {
                  backgroundImage: `linear-gradient(rgba(0, 0, 0, ${Math.max(0.35, customWallpaper.dim)}), rgba(0, 0, 0, ${Math.max(0.5, customWallpaper.dim)})), url("${customWallpaper.imageDataUrl.replace(/["\\\r\n]/g, '')}")`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  backgroundColor: '#000000',
                  color: '#ffffff',
                }
              : {
                  background: oledBlackMode
                    ? `radial-gradient(circle at 50% 18%, ${dominantColor}44 0%, #000000 70%)`
                    : `radial-gradient(circle at 50% 18%, ${dominantColor}66 0%, var(--background) 75%)`,
                  backgroundColor: oledBlackMode
                    ? '#000000'
                    : 'var(--background)',
                  color: oledBlackMode ? '#ffffff' : 'var(--foreground)',
                }
          }
        >
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-4">
            <button
              type="button"
              className="flex size-9 items-center justify-center rounded-full bg-black/25 hover:bg-black/40"
              onClick={() => setNowPlayingOpen(false)}
              aria-label="Close Expanded Player"
            >
              <ChevronDown size={20} />
            </button>

            <div className="flex items-center gap-1 rounded-full bg-black/25 p-1 text-xs font-bold">
              {(
                [
                  ['player', 'Player'],
                  ['lyrics', 'Lyrics'],
                  ['dsp', 'EQ / DSP'],
                  ['queue', `Queue (${queueItems.length})`],
                ] as const
              ).map(([tabKey, label]) => (
                <button
                  key={tabKey}
                  type="button"
                  className={`rounded-full px-3.5 py-1 transition ${
                    nowPlayingTab === tabKey
                      ? 'bg-primary text-primary-foreground shadow'
                      : 'opacity-75 hover:opacity-100'
                  }`}
                  onClick={() => setNowPlayingTab(tabKey)}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              type="button"
              className={`flex h-9 items-center justify-center gap-1 rounded-full px-3 text-xs font-bold ${
                sleepRemainingMin
                  ? 'bg-primary text-primary-foreground shadow'
                  : 'bg-black/25 hover:bg-black/40'
              }`}
              onClick={cycleSleepTimer}
              aria-label="Sleep Timer"
            >
              <Moon size={15} />
              {sleepRemainingMin ? <span>{sleepRemainingMin}m</span> : null}
            </button>
          </div>

          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden px-6 pb-6">
            {nowPlayingTab === 'player' && (
              <div className="flex flex-1 flex-col justify-between overflow-y-auto py-2">
                <div className="my-auto flex flex-col items-center">
                  <div className="relative">
                    <div
                      onClick={handleArtDoubleClick}
                      className={`border-border relative aspect-square w-64 cursor-pointer overflow-hidden border-2 shadow-2xl transition-all duration-300 ${
                        vinylMode ? 'rounded-full' : 'rounded-2xl'
                      } ${isPlaying ? 'scale-100' : 'scale-[0.94] opacity-90'}`}
                      style={{
                        boxShadow: `0 18px 50px -12px ${dominantColor}88`,
                      }}
                    >
                      <div
                        className={`size-full ${vinylMode ? 'nuclear-vinyl-spin' : ''}`}
                        style={
                          vinylMode
                            ? {
                                animationPlayState: isPlaying
                                  ? 'running'
                                  : 'paused',
                              }
                            : undefined
                        }
                      >
                        {coverUrl ? (
                          <img
                            src={coverUrl}
                            alt=""
                            className="size-full object-cover"
                          />
                        ) : (
                          <div className="bg-muted flex size-full items-center justify-center">
                            <Music2 size={64} className="opacity-40" />
                          </div>
                        )}
                      </div>
                      {vinylMode && (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                          <div className="size-11 rounded-full border-4 border-black/60 bg-black/80 shadow-inner" />
                        </div>
                      )}
                      {heartBurstKey > 0 && (
                        <div
                          key={heartBurstKey}
                          className="nuclear-heart-burst pointer-events-none absolute inset-0 flex items-center justify-center"
                        >
                          <Heart
                            size={76}
                            fill="#f43f5e"
                            className="text-rose-500 drop-shadow-lg"
                          />
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setVinylMode((v) => !v)}
                      className={`absolute -right-2 -bottom-2 flex size-9 items-center justify-center rounded-full border border-white/20 shadow-lg backdrop-blur-md transition ${
                        vinylMode
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-black/55 text-white'
                      }`}
                      title={
                        vinylMode
                          ? 'Switch to Cover Art'
                          : 'Spinning Vinyl Mode'
                      }
                      aria-label="Toggle Vinyl Mode"
                    >
                      <Disc
                        size={17}
                        className={vinylMode && isPlaying ? 'animate-spin' : ''}
                      />
                    </button>
                  </div>

                  {visualizerEnabled && (
                    <BeatVisualizer playing={isPlaying} color={dominantColor} />
                  )}

                  <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-[11px] font-bold">
                    {track && currentItem && (
                      <button
                        type="button"
                        onClick={() => setDesktopStreamPickerOpen(true)}
                        className="rounded-full border border-white/20 bg-black/35 px-3 py-0.5 text-white hover:bg-black/55"
                      >
                        🔀 Switch Stream ({track.streamCandidates?.length ?? 0})
                      </button>
                    )}
                    {isTrackDownloaded && (
                      <span className="rounded-full bg-emerald-500/25 px-2.5 py-0.5 text-emerald-300">
                        ✓ Offline Ready
                      </span>
                    )}
                    {sponsorBlockEnabled && (
                      <span className="rounded-full bg-amber-500/25 px-2.5 py-0.5 text-amber-300">
                        ⚡ SponsorBlock
                      </span>
                    )}
                    {isNextPreResolved && (
                      <span className="rounded-full bg-cyan-500/25 px-2.5 py-0.5 text-cyan-300">
                        🚀 Next Track Pre-Resolved
                      </span>
                    )}
                    {playbackSpeed !== 1 && (
                      <span className="rounded-full bg-purple-500/25 px-2.5 py-0.5 text-purple-300">
                        {playbackSpeed}x {!preservePitch ? '(Pitch Shift)' : ''}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-2xl font-extrabold">
                        {track?.title ?? 'No Track Playing'}
                      </h2>
                      <p className="truncate text-sm opacity-75">
                        {artistName}
                      </p>
                    </div>

                    {track && (
                      <div className="flex items-center gap-1.5">
                        {p2pPeerAddress.trim() && (
                          <button
                            type="button"
                            className="flex size-9 items-center justify-center rounded-full bg-black/25 hover:bg-black/40"
                            onClick={() => void sendHandoffToPeer()}
                            aria-label="Handoff to Paired Device"
                            title="Handoff Playback to Paired Device"
                          >
                            <Send size={16} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="flex size-9 items-center justify-center rounded-full bg-black/25 hover:bg-black/40"
                          onClick={() => void shareTrack(track)}
                          aria-label="Share Song"
                          title="Share Song Link"
                        >
                          <Share2 size={17} />
                        </button>
                        <button
                          type="button"
                          className="flex size-9 items-center justify-center rounded-full bg-black/25 hover:bg-black/40"
                          onClick={() =>
                            void shareTrackVibeCard({
                              title: track.title,
                              artist: artistName,
                              coverUrl,
                              dominantColor,
                              lyricLine:
                                activeLyricIndex >= 0
                                  ? syncedLyrics[activeLyricIndex]?.text
                                  : undefined,
                            })
                          }
                          aria-label="Share Vibe Card"
                          title="Download Track Vibe Card"
                        >
                          <Sparkles size={16} />
                        </button>
                        <button
                          type="button"
                          className="flex size-9 items-center justify-center rounded-full bg-black/25 hover:bg-black/40"
                          onClick={() => {
                            trackActions.toggleFavorite(track);
                            if (!isTrackFavorite) {
                              setHeartBurstKey((k) => k + 1);
                            }
                          }}
                          aria-label="Favorite"
                        >
                          <Heart
                            size={18}
                            fill={isTrackFavorite ? 'currentColor' : 'none'}
                            className={isTrackFavorite ? 'text-rose-500' : ''}
                          />
                        </button>
                        <button
                          type="button"
                          className="flex size-9 items-center justify-center rounded-full bg-black/25 hover:bg-black/40"
                          onClick={() => {
                            if (isTrackDownloading) {
                              return;
                            }
                            if (isTrackDownloaded) {
                              void removeDownload(track);
                            } else {
                              void downloadTrack(track);
                            }
                          }}
                          aria-label="Download"
                        >
                          {isTrackDownloading ? (
                            <Loader2 size={18} className="animate-spin" />
                          ) : isTrackDownloaded ? (
                            <Check size={18} className="text-emerald-400" />
                          ) : (
                            <Download size={18} />
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <input
                      type="range"
                      min={0}
                      max={duration > 0 ? duration : 100}
                      step={0.5}
                      value={position}
                      onChange={(e) =>
                        useSoundStore.getState().seekTo(Number(e.target.value))
                      }
                      className="accent-primary h-1.5 w-full cursor-pointer rounded-lg"
                    />
                    <div className="flex justify-between font-mono text-[11px] opacity-75">
                      <span>{formatSeconds(position)}</span>
                      <span>{formatSeconds(duration)}</span>
                    </div>

                    {track && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] font-bold">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setLoopA(position);
                              toast.info(
                                `Loop A set at ${formatSeconds(position)}`,
                              );
                            }}
                            className={`rounded-full px-2.5 py-1 ${
                              loopA !== null
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-black/25 opacity-80'
                            }`}
                          >
                            A{loopA !== null ? ` ${formatSeconds(loopA)}` : ''}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (loopA === null) {
                                toast.info('Set point A first');
                                return;
                              }
                              if (position <= loopA + 0.5) {
                                toast.info('Point B must be after point A');
                                return;
                              }
                              setLoopB(position);
                              toast.info(
                                `🔁 Looping ${formatSeconds(loopA)} → ${formatSeconds(position)}`,
                              );
                            }}
                            className={`rounded-full px-2.5 py-1 ${
                              loopB !== null
                                ? 'bg-primary text-primary-foreground animate-pulse'
                                : 'bg-black/25 opacity-80'
                            }`}
                          >
                            B{loopB !== null ? ` ${formatSeconds(loopB)}` : ''}
                          </button>
                          {(loopA !== null || loopB !== null) && (
                            <button
                              type="button"
                              onClick={clearLoop}
                              className="rounded-full bg-black/25 px-2 py-1 opacity-75"
                              title="Clear A-B Loop"
                            >
                              ×
                            </button>
                          )}
                        </div>

                        {(() => {
                          const savedDrop = dlKey
                            ? trackBookmarks[dlKey]
                            : undefined;
                          return (
                            <div className="flex items-center gap-1">
                              {savedDrop !== undefined ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      useSoundStore
                                        .getState()
                                        .seekTo(savedDrop);
                                      playbackManager.play();
                                    }}
                                    className="flex items-center gap-1 rounded-full bg-amber-500/25 px-2.5 py-1 text-amber-300"
                                  >
                                    <Bookmark size={11} fill="currentColor" />
                                    <span>Drop {formatSeconds(savedDrop)}</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (dlKey) {
                                        setTrackBookmark(dlKey, null);
                                      }
                                    }}
                                    className="rounded-full bg-black/25 px-2 py-1 opacity-70"
                                    title="Clear Drop Bookmark"
                                  >
                                    ×
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (dlKey) {
                                      setTrackBookmark(dlKey, position);
                                      toast.success(
                                        `🔖 Saved Drop bookmark at ${formatSeconds(position)}`,
                                      );
                                    }
                                  }}
                                  className="flex items-center gap-1 rounded-full bg-black/25 px-2.5 py-1 opacity-80"
                                >
                                  <Bookmark size={11} />
                                  <span>Mark Drop</span>
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-center gap-6 pb-2">
                    <button
                      type="button"
                      className={`flex size-10 items-center justify-center rounded-full ${
                        shuffleEnabled
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-black/20 opacity-75'
                      }`}
                      onClick={() => setShuffleEnabled(!shuffleEnabled)}
                      aria-label="Shuffle"
                    >
                      <Shuffle size={18} />
                    </button>
                    <button
                      type="button"
                      className="flex size-12 items-center justify-center rounded-full bg-black/25 hover:bg-black/40"
                      onClick={() => {
                        if (position > 3) {
                          useSoundStore.getState().seekTo(0);
                        } else {
                          goToPrevious();
                        }
                      }}
                      aria-label="Previous"
                    >
                      <SkipBack size={22} />
                    </button>
                    <button
                      type="button"
                      className="bg-primary text-primary-foreground flex size-14 items-center justify-center rounded-full shadow-xl"
                      onClick={playbackManager.toggle}
                      aria-label="Play/Pause"
                    >
                      {isPlaying ? <Pause size={26} /> : <Play size={26} />}
                    </button>
                    <button
                      type="button"
                      className="flex size-12 items-center justify-center rounded-full bg-black/25 hover:bg-black/40"
                      onClick={goToNext}
                      aria-label="Next"
                    >
                      <SkipForward size={22} />
                    </button>
                    <button
                      type="button"
                      className={`flex size-10 items-center justify-center rounded-full ${
                        repeatMode && repeatMode !== 'off'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-black/20 opacity-75'
                      }`}
                      onClick={handleToggleRepeat}
                      aria-label="Repeat"
                    >
                      {repeatMode === 'one' ? (
                        <Repeat1 size={18} />
                      ) : (
                        <Repeat size={18} />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {nowPlayingTab === 'lyrics' && (
              <div className="flex-1 overflow-y-auto py-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-xs opacity-65">
                    Click any line to seek
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setKaraokeEnabled(!karaokeEnabled);
                      toast.info(
                        !karaokeEnabled
                          ? '🎤 Karaoke Vocal Remover ON'
                          : '🎤 Karaoke OFF',
                      );
                    }}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                      karaokeEnabled
                        ? 'bg-primary text-primary-foreground shadow'
                        : 'bg-black/25 opacity-85'
                    }`}
                  >
                    <MicVocal size={13} />
                    <span>
                      {karaokeEnabled ? 'Karaoke ON' : 'Karaoke Mode'}
                    </span>
                  </button>
                </div>
                {lyricsLoading ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 opacity-75">
                    <Loader2 size={28} className="animate-spin" />
                    <span className="text-sm">
                      Fetching synced lyrics from LRCLIB...
                    </span>
                  </div>
                ) : syncedLyrics.length > 0 ? (
                  <div className="space-y-2.5 py-4">
                    {syncedLyrics.map((line, idx) => {
                      const isActive = idx === activeLyricIndex;
                      return (
                        <button
                          key={`${line.timeSec}-${idx}`}
                          type="button"
                          ref={isActive ? activeLyricRef : undefined}
                          onClick={() => {
                            useSoundStore.getState().seekTo(line.timeSec);
                            playbackManager.play();
                          }}
                          className={`block w-full rounded-lg px-3 py-2 text-left transition-all ${
                            isActive
                              ? 'bg-primary/25 text-lg font-extrabold'
                              : 'text-sm opacity-60 hover:opacity-90'
                          }`}
                        >
                          <span className="mr-2 font-mono text-[10px] opacity-60">
                            {formatSeconds(line.timeSec)}
                          </span>
                          <span>{line.text}</span>
                          {isActive && track && (
                            <span
                              role="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void shareTrackVibeCard({
                                  title: track.title,
                                  artist: artistName,
                                  coverUrl,
                                  dominantColor,
                                  lyricLine: line.text,
                                });
                              }}
                              className="ml-2 inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 align-middle text-[10px] font-bold"
                            >
                              <Share2 size={10} /> Card
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : plainLyrics ? (
                  <pre className="font-sans text-sm leading-relaxed whitespace-pre-wrap opacity-90">
                    {plainLyrics}
                  </pre>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-center opacity-70">
                    <MicVocal size={42} className="mb-2 opacity-50" />
                    <p className="text-sm font-bold">
                      No synced lyrics found for this track
                    </p>
                  </div>
                )}
              </div>
            )}

            {nowPlayingTab === 'dsp' && (
              <div className="flex-1 overflow-y-auto py-3">
                <AudioDspPanel showMobileOnlyControls={false} />
              </div>
            )}

            {nowPlayingTab === 'queue' && (
              <div className="flex flex-1 flex-col overflow-hidden py-2">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-lg bg-black/25 px-3 py-1.5 text-xs font-bold hover:bg-black/40"
                    onClick={shuffleRemainingQueue}
                  >
                    <Shuffle size={13} /> Shuffle Upcoming
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-lg bg-black/25 px-3 py-1.5 text-xs font-bold hover:bg-black/40"
                    onClick={() => void spinForgottenGem()}
                  >
                    <Dices size={13} /> Forgotten Gem
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-lg bg-black/25 px-3 py-1.5 text-xs font-bold hover:bg-black/40"
                    onClick={() =>
                      void downloadTracks(queueItems.map((i) => i.track))
                    }
                  >
                    <Download size={13} /> Save All ({queueItems.length})
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-lg bg-black/25 px-3 py-1.5 text-xs font-bold hover:bg-black/40"
                    onClick={clearQueue}
                    aria-label="Clear Queue"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                <div className="flex-1 space-y-1.5 overflow-y-auto">
                  {queueItems.map((item, idx) => {
                    const isCurrent = idx === currentIndex;
                    const key = getTrackDownloadKey(item.track);
                    const isDl = Boolean(downloadedItems[key]);
                    const isPre = Boolean(preResolvedIds[item.id]);
                    return (
                      <div
                        key={item.id}
                        onClick={() => {
                          goToId(item.id);
                          playbackManager.play();
                        }}
                        className={`flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 ${
                          isCurrent
                            ? 'bg-primary text-primary-foreground font-bold'
                            : 'bg-black/20 hover:bg-black/30'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-bold">
                            {idx + 1}. {item.track.title}
                          </div>
                          <div className="truncate text-[11px] opacity-75">
                            {item.track.artists?.map((a) => a.name).join(', ')}
                          </div>
                        </div>
                        <div className="ml-2 flex items-center gap-1 text-[10px]">
                          {isDl && (
                            <span className="rounded bg-emerald-500/30 px-1.5 py-0.5 text-emerald-300">
                              ✓ Offline
                            </span>
                          )}
                          {!isDl && isPre && (
                            <span className="rounded bg-amber-500/30 px-1.5 py-0.5 text-amber-300">
                              <Zap size={10} className="inline" /> Ready
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Desktop Multi-Source Stream Switcher Modal */}
      {desktopStreamPickerOpen && track && currentItem && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 p-6 backdrop-blur-xs"
          onClick={() => setDesktopStreamPickerOpen(false)}
        >
          <div
            data-testid="desktop-stream-picker-modal"
            className="border-border bg-background text-foreground flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-border flex items-center justify-between border-b px-4 py-3">
              <div className="min-w-0 flex-1 pr-2">
                <div className="flex items-center gap-1.5 text-sm font-extrabold">
                  <ArrowLeftRight size={15} /> Switch Audio Stream
                </div>
                <div className="truncate text-[11px] opacity-70">
                  {track.title} — {artistName}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDesktopStreamPickerOpen(false)}
                className="border-border rounded-md border px-2.5 py-1 text-xs font-bold"
              >
                Close
              </button>
            </div>

            <div className="px-4 pt-3">
              <button
                type="button"
                disabled={searchingAllStreams}
                onClick={() => void handleSearchAllStreams(false)}
                className="bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-xl py-2 text-xs font-extrabold shadow transition disabled:opacity-60"
              >
                {searchingAllStreams ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                <span>
                  {searchingAllStreams
                    ? 'Searching all streaming sources...'
                    : 'Search All Streaming Sources'}
                </span>
              </button>
            </div>

            <div className="flex-1 space-y-1.5 overflow-y-auto p-4">
              {(track.streamCandidates ?? []).length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-xs opacity-70">
                  {searchingAllStreams
                    ? 'Searching all streaming sources...'
                    : 'No cached stream candidates yet. Click Search All Streaming Sources above!'}
                </div>
              ) : (
                (track.streamCandidates ?? []).map((cand, idx) => {
                  const isActive =
                    idx === 0 &&
                    !cand.failed &&
                    !(isTrackDownloaded && !isOfflineBypassed(currentItem.id));
                  const providerLabel =
                    cand.source?.provider?.replace(/^nuclear:/, '') || 'stream';
                  return (
                    <button
                      key={`${cand.source?.provider ?? 'p'}-${cand.id}-${idx}`}
                      type="button"
                      onClick={() => {
                        useQueueStore
                          .getState()
                          .selectCandidate(currentItem.id, cand.id);
                        playbackManager.play();
                        setDesktopStreamPickerOpen(false);
                        toast.success(
                          `🔀 Switched stream: ${cand.title || cand.id}`,
                        );
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition ${
                        isActive
                          ? 'bg-primary text-primary-foreground border-transparent font-bold shadow'
                          : 'border-border bg-black/15 hover:bg-black/25'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-bold">
                          {isActive ? '▶ ' : ''}
                          {cand.title || cand.id}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] opacity-75">
                          <span className="rounded bg-black/25 px-1.5 py-0.5 font-mono uppercase">
                            {providerLabel}
                          </span>
                          {cand.durationMs ? (
                            <span className="font-mono">
                              {formatSeconds(cand.durationMs / 1000)}
                            </span>
                          ) : null}
                          {cand.failed && (
                            <span className="text-rose-400">• Failed</span>
                          )}
                        </div>
                      </div>
                      {isActive && <Check size={16} className="shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>

            <div className="shrink-0">
              <ConnectedStreamVerification />
            </div>
          </div>
        </div>
      )}

      <FakeBankModal
        open={fakeBankOpen}
        onClose={() => setFakeBankOpen(false)}
      />
    </>
  );
};
