import { useLocation, useNavigate } from '@tanstack/react-router';
import {
  Bookmark,
  Check,
  ChevronDown,
  Dices,
  Disc,
  Download,
  FolderDown,
  Heart,
  Home,
  ListMusic,
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
  Sliders,
  Sparkles,
  Trash2,
  Trophy,
  Upload,
  Zap,
} from 'lucide-react';
import { FC, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { pickArtwork, type RepeatMode, type Track } from '@nuclearplayer/model';

import { useCoreSetting } from '../hooks/useCoreSetting';
import { useCurrentQueueItem } from '../hooks/useCurrentQueueItem';
import { useQueue } from '../hooks/useQueue';
import { useStreamVerification } from '../hooks/useStreamVerification';
import { useTrackActions } from '../hooks/useTrackActions';
import { haptic } from '../services/androidMediaBridge';
import { spinForgottenGem } from '../services/endlessRadio';
import {
  shuffleRemainingQueue,
  useMobileEnhancementsStore,
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
import { useUpdaterStore } from '../stores/updaterStore';
import { AudioDspPanel } from './AudioDspPanel';
import { BeatVisualizer } from './BeatVisualizer';
import { ConnectedStreamVerification } from './ConnectedStreamVerification';
import { CustomWallpaperSection } from './CustomWallpaperSection';
import { FakeBankModal } from './FakeBankModal';
import { LiveLyricTicker } from './LiveLyricTicker';
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

const EqualizerBars: FC<{ playing: boolean }> = ({ playing }) => (
  <span className="inline-flex h-3 items-end gap-[2px]" aria-hidden="true">
    {[0, 0.2, 0.4].map((delay, i) => (
      <span
        key={i}
        className="nuclear-eq-bar w-[2.5px] rounded-full bg-current"
        style={{
          height: '100%',
          animationDelay: `${delay}s`,
          animationPlayState: playing ? 'running' : 'paused',
          transform: playing ? undefined : 'scaleY(0.35)',
        }}
      />
    ))}
  </span>
);

export const MobileAndroidShell: FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentItem = useCurrentQueueItem();
  const streamVerification = useStreamVerification();
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
    floatingLyricsEnabled,
    karaokeEnabled,
    setNowPlayingOpen,
    setNowPlayingTab,
    cycleSleepTimer,
    setOledBlackMode,
    setFloatingLyricsEnabled,
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
  const isUpdateAvailable = useUpdaterStore((s) => s.isUpdateAvailable);
  const updateInfo = useUpdaterStore((s) => s.updateInfo);
  const isUpdateDownloading = useUpdaterStore((s) => s.isDownloading);
  const updateProgress = useUpdaterStore((s) => s.downloadProgress);
  const downloadUpdate = useUpdaterStore((s) => s.downloadUpdate);

  const [offlineDrawerOpen, setOfflineDrawerOpen] = useState(false);
  const [fakeBankOpen, setFakeBankOpen] = useState(false);
  const [streamPickerOpen, setStreamPickerOpen] = useState(false);
  const [searchingAllStreams, setSearchingAllStreams] = useState(false);
  const [hubTab, setHubTab] = useState<
    'offline' | 'spotify' | 'wrapped' | 'p2p'
  >('offline');
  const [vinylMode, setVinylMode] = useState(false);
  const [heartBurstKey, setHeartBurstKey] = useState(0);
  const [sleepRemainingMin, setSleepRemainingMin] = useState<number | null>(
    null,
  );
  const localAudioInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const activeLyricRef = useRef<HTMLButtonElement | null>(null);
  const lastArtTapRef = useRef<number>(0);
  const autoSearchedStreamItemRef = useRef<string | null>(null);

  // Touch gesture state for Mini-Player & Full-Screen Sheet
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const sheetTouchStartRef = useRef<{ x: number; y: number } | null>(null);

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

  const handleToggleShuffle = () => {
    haptic('light');
    setShuffleEnabled(!shuffleEnabled);
  };

  const handleToggleRepeat = () => {
    haptic('light');
    const modes: RepeatMode[] = ['off', 'all', 'one'];
    const idx = modes.indexOf(repeatMode ?? 'off');
    setRepeatMode(modes[(idx + 1) % modes.length]);
  };

  const handleCycleSleepTimer = () => {
    haptic('light');
    cycleSleepTimer();
  };

  useEffect(() => {
    if (!sleepEndAt) {
      setSleepRemainingMin(null);
      return;
    }
    const tick = () => {
      const leftMs = sleepEndAt - Date.now();
      setSleepRemainingMin(
        leftMs > 0 ? Math.max(1, Math.ceil(leftMs / 60_000)) : null,
      );
    };
    tick();
    const id = window.setInterval(tick, 10_000);
    return () => window.clearInterval(id);
  }, [sleepEndAt]);

  // Import local device audio files (.mp3, .flac, .m4a, .wav, .ogg) directly into queue!
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
        playlists: playlistState.playlists,
        queue: useQueueStore.getState().items,
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nuclear-mobile-backup-${new Date().toISOString().slice(0, 10)}.json`;
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

  // Find active synced lyric line index
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
      streamPickerOpen &&
      currentItem &&
      track &&
      (track.streamCandidates?.length ?? 0) <= 1 &&
      !searchingAllStreams &&
      autoSearchedStreamItemRef.current !== currentItem.id
    ) {
      autoSearchedStreamItemRef.current = currentItem.id;
      void handleSearchAllStreams(true);
    }
  }, [streamPickerOpen, currentItem?.id]);

  const handleArtTap = () => {
    const now = Date.now();
    if (now - lastArtTapRef.current < 320 && track) {
      lastArtTapRef.current = 0;
      haptic('medium');
      if (!isTrackFavorite) {
        trackActions.toggleFavorite(track);
      }
      setHeartBurstKey((k) => k + 1);
    } else {
      lastArtTapRef.current = now;
    }
  };

  const progressPercent =
    duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

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

      {/* Swipeable Android Mini-Player + Bottom Navigation Bar */}
      <div
        className="border-border z-20 flex w-full max-w-full min-w-0 shrink-0 flex-col overflow-hidden border-t"
        style={{
          backgroundColor: oledBlackMode ? '#000000' : 'var(--muted)',
        }}
      >
        {/* App Update Banner (when a newer release is published on GitHub) */}
        {isUpdateAvailable && (
          <div className="border-border/50 bg-primary/15 flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs">
            <div className="min-w-0 flex-1 truncate font-bold">
              ✨ Update v{updateInfo?.version ?? 'new'} available
            </div>
            <button
              disabled={isUpdateDownloading}
              onClick={() => {
                haptic('medium');
                void downloadUpdate();
              }}
              className="bg-primary text-primary-foreground flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold shadow transition active:scale-95 disabled:opacity-60"
            >
              <Download size={12} />
              <span>
                {isUpdateDownloading
                  ? `Downloading ${updateProgress}%...`
                  : 'Install Update'}
              </span>
            </button>
          </div>
        )}
        {/* Live PC Remote Control Bar (shows when PC is playing & phone is idle) */}
        {remoteState?.isPlaying && !isPlaying && (
          <div className="border-border/50 flex items-center justify-between gap-2 border-b bg-emerald-500/15 px-3 py-1.5 text-xs">
            <div className="min-w-0 flex-1">
              <div className="truncate font-extrabold text-emerald-300">
                💻 {remoteState.deviceName}: {remoteState.title || 'Playing'}
              </div>
              {remoteState.artist && (
                <div className="truncate text-[10px] opacity-75">
                  {remoteState.artist}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => {
                  haptic('light');
                  void sendRemoteControl('previous');
                }}
                className="flex size-7 items-center justify-center rounded-full bg-black/25 active:scale-90"
                aria-label="PC Previous"
              >
                <SkipBack size={13} />
              </button>
              <button
                onClick={() => {
                  haptic('medium');
                  void sendRemoteControl('toggle');
                }}
                className="flex size-7 items-center justify-center rounded-full bg-emerald-500 text-black active:scale-90"
                aria-label="PC Play/Pause"
              >
                <Pause size={13} />
              </button>
              <button
                onClick={() => {
                  haptic('light');
                  void sendRemoteControl('next');
                }}
                className="flex size-7 items-center justify-center rounded-full bg-black/25 active:scale-90"
                aria-label="PC Next"
              >
                <SkipForward size={13} />
              </button>
              <button
                onClick={() => {
                  haptic('medium');
                  void pullHandoffFromPeer(false);
                }}
                className="rounded-full bg-white/15 px-2 py-1 text-[10px] font-bold active:scale-95"
              >
                Here
              </button>
            </div>
          </div>
        )}
        <LiveLyricTicker variant="mobile" />
        {track && (
          <div
            className="relative flex cursor-pointer items-center gap-2.5 px-3 py-2 select-none"
            style={{
              background: oledBlackMode
                ? `linear-gradient(90deg, rgba(0,0,0,0.95), ${dominantColor}28)`
                : `linear-gradient(90deg, var(--muted), ${dominantColor}33)`,
            }}
            onTouchStart={(e) => {
              const t = e.touches[0];
              touchStartRef.current = { x: t.clientX, y: t.clientY };
            }}
            onTouchEnd={(e) => {
              if (!touchStartRef.current) {
                return;
              }
              const t = e.changedTouches[0];
              const dx = t.clientX - touchStartRef.current.x;
              const dy = t.clientY - touchStartRef.current.y;
              touchStartRef.current = null;
              if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) {
                haptic('medium');
                if (dx < 0) {
                  goToNext();
                  toast.info('⏭ Next track');
                } else {
                  goToPrevious();
                  toast.info('⏮ Previous track');
                }
              } else if (dy < -40) {
                haptic('light');
                setNowPlayingOpen(true);
              }
            }}
            onClick={() => {
              haptic('light');
              setNowPlayingOpen(true);
            }}
          >
            {/* Progress line along top of Mini-Player */}
            <div className="bg-border/30 absolute top-0 right-0 left-0 h-0.5">
              <div
                className="bg-primary h-full transition-all duration-150"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="border-border bg-background relative size-10 shrink-0 overflow-hidden rounded-md border">
              {coverUrl ? (
                <img src={coverUrl} alt="" className="size-full object-cover" />
              ) : (
                <div className="flex size-full items-center justify-center">
                  <Music2 size={18} />
                </div>
              )}
              {isPlaying && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/35 text-white">
                  <EqualizerBars playing />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-bold">
                  {track.title}
                </span>
                {isTrackDownloaded && (
                  <span className="py-0.2 rounded bg-emerald-500/20 px-1 text-[9px] font-bold text-emerald-400">
                    OFFLINE
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs opacity-75">
                <span className="truncate">{artistName}</span>
                {isNextPreResolved && (
                  <span className="shrink-0 text-[9px] text-amber-400">
                    • ⚡ Next ready
                  </span>
                )}
              </div>
            </div>

            <button
              className="flex size-8 items-center justify-center rounded-full transition-transform active:scale-90"
              onClick={(e) => {
                e.stopPropagation();
                haptic('light');
                void shareTrack(track);
              }}
              aria-label="Share song"
            >
              <Share2 size={15} />
            </button>

            <button
              className="flex size-9 items-center justify-center rounded-full"
              onClick={(e) => {
                e.stopPropagation();
                if (isTrackDownloading) {
                  return;
                }
                if (isTrackDownloaded) {
                  void removeDownload(track);
                } else {
                  void downloadTrack(track);
                }
              }}
              aria-label="Download song"
            >
              {isTrackDownloading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : isTrackDownloaded ? (
                <Check size={16} className="text-emerald-400" />
              ) : (
                <Download size={16} />
              )}
            </button>

            <button
              className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-full shadow transition-transform active:scale-90"
              onClick={(e) => {
                e.stopPropagation();
                haptic('medium');
                playbackManager.toggle();
              }}
              aria-label="Play or Pause"
            >
              {isPlaying ? <Pause size={17} /> : <Play size={17} />}
            </button>

            <button
              className="flex size-8 items-center justify-center rounded-full transition-transform active:scale-90"
              onClick={(e) => {
                e.stopPropagation();
                haptic('medium');
                goToNext();
              }}
              aria-label="Next track"
            >
              <SkipForward size={17} />
            </button>
          </div>
        )}

        {/* Native Android 5-Tab Bottom Navigation Bar */}
        <nav className="border-border/40 grid h-13 grid-cols-5 items-center border-t px-1 text-[10px] font-semibold">
          <button
            className={`flex flex-col items-center justify-center gap-0.5 py-1 transition-transform active:scale-90 ${
              location.pathname.startsWith('/dashboard')
                ? 'text-primary font-bold'
                : 'opacity-70'
            }`}
            onClick={() => {
              haptic('light');
              setNowPlayingOpen(false);
              setOfflineDrawerOpen(false);
              void navigate({ to: '/dashboard' });
            }}
          >
            <Home size={17} />
            <span>Home</span>
          </button>

          <button
            className={`flex flex-col items-center justify-center gap-0.5 py-1 transition-transform active:scale-90 ${
              location.pathname.startsWith('/playlists') &&
              !nowPlayingOpen &&
              !offlineDrawerOpen
                ? 'text-primary font-bold'
                : 'opacity-70'
            }`}
            onClick={() => {
              haptic('light');
              setNowPlayingOpen(false);
              setOfflineDrawerOpen(false);
              void navigate({ to: '/playlists' });
            }}
          >
            <ListMusic size={17} />
            <span>Playlists</span>
          </button>

          <button
            className={`flex flex-col items-center justify-center gap-0.5 py-1 transition-transform active:scale-90 ${
              nowPlayingOpen && nowPlayingTab === 'lyrics'
                ? 'text-primary font-bold'
                : 'opacity-70'
            }`}
            onClick={() => {
              haptic('light');
              setOfflineDrawerOpen(false);
              setNowPlayingTab('lyrics');
              setNowPlayingOpen(true);
            }}
          >
            <MicVocal size={17} />
            <span>Synced LRC</span>
          </button>

          <button
            className={`flex flex-col items-center justify-center gap-0.5 py-1 transition-transform active:scale-90 ${
              nowPlayingOpen && nowPlayingTab === 'dsp'
                ? 'text-primary font-bold'
                : 'opacity-70'
            }`}
            onClick={() => {
              haptic('light');
              setOfflineDrawerOpen(false);
              setNowPlayingTab('dsp');
              setNowPlayingOpen(true);
            }}
          >
            <Sliders size={17} />
            <span>EQ & DSP</span>
          </button>

          <button
            className={`flex flex-col items-center justify-center gap-0.5 py-1 transition-transform active:scale-90 ${
              offlineDrawerOpen ? 'text-primary font-bold' : 'opacity-70'
            }`}
            onClick={() => {
              haptic('light');
              setNowPlayingOpen(false);
              setOfflineDrawerOpen(!offlineDrawerOpen);
            }}
          >
            <FolderDown size={17} />
            <span>Hub ({Object.keys(downloadedItems).length})</span>
          </button>
        </nav>
      </div>

      {/* Hub Drawer: Offline Library, Public Spotify Account Sync & Wrapped Anytime */}
      {offlineDrawerOpen && (
        <div
          className="animate-in slide-in-from-bottom-6 fixed inset-0 z-50 flex flex-col overflow-hidden pt-[max(0.5rem,env(safe-area-inset-top))] duration-200"
          style={{
            backgroundColor: oledBlackMode ? '#000000' : 'var(--background)',
            color: 'var(--foreground)',
          }}
        >
          <div className="border-border flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <Sparkles size={19} />
              <span className="text-base font-extrabold">Nuclear Hub</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                className="rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-xs font-bold text-amber-300 active:scale-95"
                onClick={() => {
                  haptic('light');
                  setFakeBankOpen(true);
                }}
              >
                🏦 Loans
              </button>
              <button
                className="rounded-md border px-2.5 py-1 text-xs font-bold active:scale-95"
                onClick={() => {
                  haptic('light');
                  setOfflineDrawerOpen(false);
                }}
              >
                Close
              </button>
            </div>
          </div>

          {/* 4-Tab Switcher: Offline | Spotify | Wrapped | P2P Sync */}
          <div className="border-border/60 grid grid-cols-4 gap-1 border-b px-2.5 py-2 text-[11px] font-bold">
            {(
              [
                ['offline', 'Offline'],
                ['spotify', 'Spotify'],
                ['wrapped', 'Wrapped'],
                ['p2p', 'P2P Sync'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => {
                  haptic('light');
                  setHubTab(key);
                }}
                className={`rounded-lg py-1.5 transition active:scale-95 ${
                  hubTab === key
                    ? 'bg-primary text-primary-foreground shadow'
                    : 'bg-muted/60 opacity-75'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {hubTab === 'p2p' && (
            <div className="flex-1 overflow-y-auto p-4">
              <P2pSyncPanel />
            </div>
          )}

          {hubTab === 'spotify' && (
            <div className="flex-1 overflow-y-auto p-4">
              <SpotifyAccountSyncPanel />
            </div>
          )}

          {hubTab === 'wrapped' &&
            (() => {
              const persona = computeListeningPersona(wrappedStats.hourBuckets);
              const streak = computeListeningStreak(wrappedStats.activeDays);
              const mins = Math.round(wrappedStats.totalSeconds / 60);
              const topArtists = Object.values(wrappedStats.artistStats)
                .sort((a, b) => b.seconds - a.seconds || b.plays - a.plays)
                .slice(0, 5);
              const topTracks = Object.values(wrappedStats.trackStats)
                .sort((a, b) => b.seconds - a.seconds || b.plays - a.plays)
                .slice(0, 5);

              return (
                <div className="flex-1 space-y-4 overflow-y-auto p-4">
                  {/* Persona Hero Card */}
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
                        <div className="text-[10px] opacity-75">MINUTES</div>
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
                      onClick={() => {
                        haptic('medium');
                        shareWrappedCard(dominantColor);
                      }}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-extrabold text-black shadow transition active:scale-95"
                    >
                      <Share2 size={14} /> Share Wrapped Card
                    </button>
                  </div>

                  {/* Top Artists */}
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

                  {/* Top Tracks */}
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

          {hubTab === 'offline' && (
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {window.NuclearAndroid?.isIgnoringBatteryOptimizations &&
                !window.NuclearAndroid.isIgnoringBatteryOptimizations() && (
                  <button
                    onClick={() => {
                      haptic('medium');
                      window.NuclearAndroid?.requestIgnoreBatteryOptimizations?.();
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3.5 py-2.5 text-left text-xs text-amber-200 transition active:scale-95"
                  >
                    <div>
                      <div className="font-extrabold">
                        ⚡ Fix Background Playback Stopping
                      </div>
                      <div className="text-[11px] opacity-85">
                        Tap to allow Unrestricted battery so Android never
                        freezes Nuclear when the screen is off.
                      </div>
                    </div>
                    <Zap size={18} className="shrink-0 text-amber-400" />
                  </button>
                )}
              {/* Quick Actions: Forgotten Gem Roulette, Local Files, Backup Export/Import */}
              <button
                className="bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-extrabold shadow transition active:scale-95"
                onClick={() => {
                  haptic('heavy');
                  void spinForgottenGem().then((picked) => {
                    if (picked) {
                      setOfflineDrawerOpen(false);
                    }
                  });
                }}
              >
                <Dices size={16} />
                <span>🎲 Spin Forgotten Gem Roulette</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  className="border-border surface-card flex items-center justify-center gap-2 rounded-lg border p-2.5 text-xs font-bold"
                  onClick={() => localAudioInputRef.current?.click()}
                >
                  <Disc size={16} />
                  <span>Play Local Audio Files</span>
                </button>
                <button
                  className="border-border surface-card flex items-center justify-center gap-2 rounded-lg border p-2.5 text-xs font-bold"
                  onClick={() =>
                    void downloadTracks(queueItems.map((i) => i.track))
                  }
                >
                  <Download size={16} />
                  <span>Download Full Queue</span>
                </button>
                <button
                  className="border-border surface-card flex items-center justify-center gap-2 rounded-lg border p-2.5 text-xs font-bold"
                  onClick={handleExportBackup}
                >
                  <FolderDown size={16} />
                  <span>Export Desktop Backup</span>
                </button>
                <button
                  className="border-border surface-card flex items-center justify-center gap-2 rounded-lg border p-2.5 text-xs font-bold"
                  onClick={() => backupInputRef.current?.click()}
                >
                  <Upload size={16} />
                  <span>Import Backup JSON</span>
                </button>
              </div>

              {/* Smart Toggles */}
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
                    📥 Auto-download played songs (off by default to save space)
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(autoDownloadPlayed)}
                    onChange={(e) => {
                      haptic('light');
                      void setAutoDownloadPlayed(e.target.checked);
                    }}
                  />
                </label>
                <label className="flex items-center justify-between text-xs font-semibold">
                  <span>📂 Export copy to Downloads/Nuclear folder</span>
                  <input
                    type="checkbox"
                    checked={Boolean(exportDownloadsToPublic)}
                    onChange={(e) => {
                      haptic('light');
                      void setExportDownloadsToPublic(e.target.checked);
                    }}
                  />
                </label>
                <label className="flex items-center justify-between text-xs font-semibold">
                  <span>
                    ⏭ SponsorBlock (auto-skip non-music intros/outros)
                  </span>
                  <input
                    type="checkbox"
                    checked={sponsorBlockEnabled}
                    onChange={(e) => setSponsorBlockEnabled(e.target.checked)}
                  />
                </label>
                <label className="flex items-center justify-between text-xs font-semibold">
                  <span>🎤 Live Floating Lyric Bar (above Mini-Player)</span>
                  <input
                    type="checkbox"
                    checked={floatingLyricsEnabled}
                    onChange={(e) => setFloatingLyricsEnabled(e.target.checked)}
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

              {/* Downloaded Songs List */}
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold">
                    Downloaded Songs ({Object.keys(downloadedItems).length})
                    {exportDownloadsToPublic
                      ? ' — Saved in App & Downloads/Nuclear/'
                      : ' — Offline App Cache'}
                  </h3>
                  {Object.keys(downloadedItems).length > 0 && (
                    <button
                      onClick={() => {
                        haptic('medium');
                        void clearAllDownloads();
                      }}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-[11px] font-bold text-rose-400 active:scale-95"
                    >
                      <Trash2 size={12} /> Clear All
                    </button>
                  )}
                </div>
                {Object.values(downloadedItems).length === 0 ? (
                  <div className="border-border rounded-lg border p-6 text-center text-xs opacity-70">
                    No offline songs downloaded yet. Tap the{' '}
                    <strong>Download</strong> button on any song, playlist, or
                    the Mini-Player to save songs for 100% offline playback!
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
                            className="min-w-0 flex-1 text-left"
                            onClick={() => {
                              useQueueStore.getState().clearQueue();
                              useQueueStore.getState().addToQueue([synthTrack]);
                              playbackManager.play();
                              setOfflineDrawerOpen(false);
                            }}
                          >
                            <div className="truncate text-xs font-bold">
                              {item.title}
                            </div>
                            <div className="truncate text-[11px] opacity-70">
                              {item.artist} • {item.container?.toUpperCase()}
                            </div>
                          </button>
                          <button
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
      )}

      {/* Full-Screen Now Playing Sheet (Material You Dynamic Palette + Synced Lyrics + Audio DSP) */}
      {nowPlayingOpen && (
        <div
          className="animate-in slide-in-from-bottom-6 fixed inset-0 z-50 flex flex-col overflow-hidden pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(3.5rem,env(safe-area-inset-bottom))] duration-200 select-none"
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
          {/* Drag Handle Pill (swipe down to dismiss) */}
          <div
            className="flex justify-center pt-1 pb-0.5"
            onTouchStart={(e) => {
              const t = e.touches[0];
              sheetTouchStartRef.current = { x: t.clientX, y: t.clientY };
            }}
            onTouchEnd={(e) => {
              if (!sheetTouchStartRef.current) {
                return;
              }
              const dy =
                e.changedTouches[0].clientY - sheetTouchStartRef.current.y;
              sheetTouchStartRef.current = null;
              if (dy > 45) {
                haptic('light');
                setNowPlayingOpen(false);
              }
            }}
          >
            <div className="h-1 w-10 rounded-full bg-current opacity-30" />
          </div>

          {/* Sheet Header + Tabs */}
          <div className="flex items-center justify-between px-3 pt-1.5 pb-2">
            <button
              className="flex size-9 items-center justify-center rounded-full bg-black/20 transition-transform active:scale-90"
              onClick={() => {
                haptic('light');
                setNowPlayingOpen(false);
              }}
              aria-label="Dismiss Now Playing"
            >
              <ChevronDown size={22} />
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
                  className={`rounded-full px-3 py-1 transition active:scale-95 ${
                    nowPlayingTab === tabKey
                      ? 'bg-primary text-primary-foreground shadow'
                      : 'opacity-75'
                  }`}
                  onClick={() => {
                    haptic('light');
                    setNowPlayingTab(tabKey);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              className={`flex h-9 items-center justify-center gap-1 rounded-full px-2.5 text-[11px] font-bold transition-transform active:scale-90 ${
                sleepRemainingMin
                  ? 'bg-primary text-primary-foreground shadow'
                  : 'bg-black/20'
              }`}
              onClick={handleCycleSleepTimer}
              title="Sleep Timer"
              aria-label="Sleep Timer"
            >
              <Moon size={15} />
              {sleepRemainingMin ? <span>{sleepRemainingMin}m</span> : null}
            </button>
          </div>

          {/* TAB 1: NOW PLAYING */}
          {nowPlayingTab === 'player' && (
            <div className="flex flex-1 flex-col justify-between overflow-y-auto px-6 py-3">
              {/* Album Art (Double-tap to favorite, Swipe left/right to skip, Swipe down to close) */}
              <div
                className="my-auto flex flex-col items-center"
                onTouchStart={(e) => {
                  const t = e.touches[0];
                  sheetTouchStartRef.current = { x: t.clientX, y: t.clientY };
                }}
                onTouchEnd={(e) => {
                  if (!sheetTouchStartRef.current) {
                    return;
                  }
                  const t = e.changedTouches[0];
                  const dx = t.clientX - sheetTouchStartRef.current.x;
                  const dy = t.clientY - sheetTouchStartRef.current.y;
                  sheetTouchStartRef.current = null;
                  if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy)) {
                    haptic('medium');
                    if (dx < 0) {
                      goToNext();
                      toast.info('⏭ Next track');
                    } else {
                      goToPrevious();
                      toast.info('⏮ Previous track');
                    }
                  } else if (dy > 80 && Math.abs(dy) > Math.abs(dx)) {
                    haptic('light');
                    setNowPlayingOpen(false);
                  }
                }}
              >
                <div className="relative">
                  <div
                    onClick={handleArtTap}
                    className={`border-border relative aspect-square w-60 max-w-[68vw] overflow-hidden border-2 shadow-2xl transition-all duration-300 ${
                      vinylMode ? 'rounded-full' : 'rounded-2xl'
                    } ${isPlaying ? 'scale-100' : 'scale-[0.93] opacity-90'}`}
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

                  {/* Vinyl Mode Toggle Button */}
                  <button
                    onClick={() => {
                      haptic('light');
                      setVinylMode((v) => !v);
                    }}
                    className={`absolute -right-2 -bottom-2 flex size-9 items-center justify-center rounded-full border border-white/20 shadow-lg backdrop-blur-md transition-transform active:scale-90 ${
                      vinylMode
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-black/55 text-white'
                    }`}
                    title={
                      vinylMode ? 'Switch to Cover Art' : 'Spinning Vinyl Mode'
                    }
                    aria-label="Toggle Vinyl Mode"
                  >
                    <Disc
                      size={17}
                      className={vinylMode && isPlaying ? 'animate-spin' : ''}
                    />
                  </button>
                </div>

                {/* Live Beat-Reactive Visualizer */}
                {visualizerEnabled && (
                  <BeatVisualizer playing={isPlaying} color={dominantColor} />
                )}

                {/* Status Badges + Switch Stream Button */}
                <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-[10px] font-bold">
                  {track && currentItem && (
                    <button
                      onClick={() => {
                        haptic('light');
                        setStreamPickerOpen(true);
                      }}
                      className="rounded-full border border-white/20 bg-black/35 px-2.5 py-0.5 text-white transition active:scale-95"
                    >
                      🔀 Switch Stream ({track.streamCandidates?.length ?? 0})
                    </button>
                  )}
                  {streamVerification.isVisible && (
                    <button
                      type="button"
                      disabled={
                        streamVerification.isBusy ||
                        streamVerification.isDisabled ||
                        streamVerification.status === 'loading'
                      }
                      onClick={() => {
                        haptic('medium');
                        if (streamVerification.status === 'verifiedByUser') {
                          void streamVerification.onUnverify();
                        } else {
                          void streamVerification.onVerify();
                        }
                      }}
                      className={`rounded-full border px-2.5 py-0.5 transition active:scale-95 disabled:opacity-50 ${
                        streamVerification.status === 'verifiedByUser' ||
                        streamVerification.status === 'verified'
                          ? 'border-emerald-400/40 bg-emerald-500/25 text-emerald-200'
                          : streamVerification.status === 'weaklyVerified'
                            ? 'border-amber-400/40 bg-amber-500/25 text-amber-200'
                            : 'border-white/20 bg-black/35 text-white'
                      }`}
                    >
                      {streamVerification.isBusy
                        ? '⏳ Saving...'
                        : streamVerification.status === 'verifiedByUser'
                          ? '✓ Verified (Tap to Unverify)'
                          : streamVerification.status === 'verified'
                            ? '✓ Verified • Verify'
                            : streamVerification.status === 'weaklyVerified'
                              ? '◐ Weakly Verified • Verify'
                              : '✓ Verify Track'}
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

              {/* Title, Artist & Quick Actions */}
              <div className="mt-4 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-xl font-extrabold">
                      {track?.title ?? 'No Track Playing'}
                    </h2>
                    <p className="truncate text-sm opacity-75">{artistName}</p>
                  </div>

                  {track && (
                    <div className="flex items-center gap-1.5">
                      {p2pPeerAddress.trim() && (
                        <button
                          className="flex size-9 items-center justify-center rounded-full bg-black/25 transition-transform active:scale-90"
                          onClick={() => {
                            haptic('medium');
                            void sendHandoffToPeer();
                          }}
                          aria-label="Handoff to PC"
                          title="Handoff Playback to Paired Device"
                        >
                          <Send size={16} />
                        </button>
                      )}
                      <button
                        className="flex size-9 items-center justify-center rounded-full bg-black/25 transition-transform active:scale-90"
                        onClick={() => {
                          haptic('medium');
                          void shareTrack(track);
                        }}
                        aria-label="Share Song"
                        title="Share Song"
                      >
                        <Share2 size={17} />
                      </button>
                      <button
                        className="flex size-9 items-center justify-center rounded-full bg-black/25 transition-transform active:scale-90"
                        onClick={() => {
                          haptic('medium');
                          void shareTrackVibeCard({
                            title: track.title,
                            artist: artistName,
                            coverUrl,
                            dominantColor,
                            lyricLine:
                              activeLyricIndex >= 0
                                ? syncedLyrics[activeLyricIndex]?.text
                                : undefined,
                          });
                        }}
                        aria-label="Share Vibe Card"
                        title="Share Vibe Card"
                      >
                        <Sparkles size={16} />
                      </button>
                      <button
                        className="flex size-9 items-center justify-center rounded-full bg-black/25 transition-transform active:scale-90"
                        onClick={() => {
                          haptic('medium');
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
                        className="flex size-9 items-center justify-center rounded-full bg-black/25 transition-transform active:scale-90"
                        onClick={() => {
                          haptic('light');
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

                {/* Seek Slider */}
                <div className="space-y-1">
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

                  {/* A-B Loop & Drop/Chorus Bookmark */}
                  {track && (
                    <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 text-[11px] font-bold">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            haptic('light');
                            setLoopA(position);
                            toast.info(
                              `Loop A set at ${formatSeconds(position)}`,
                            );
                          }}
                          className={`rounded-full px-2.5 py-1 transition active:scale-95 ${
                            loopA !== null
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-black/25 opacity-80'
                          }`}
                        >
                          A{loopA !== null ? ` ${formatSeconds(loopA)}` : ''}
                        </button>
                        <button
                          onClick={() => {
                            haptic('light');
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
                          className={`rounded-full px-2.5 py-1 transition active:scale-95 ${
                            loopB !== null
                              ? 'bg-primary text-primary-foreground animate-pulse'
                              : 'bg-black/25 opacity-80'
                          }`}
                        >
                          B{loopB !== null ? ` ${formatSeconds(loopB)}` : ''}
                        </button>
                        {(loopA !== null || loopB !== null) && (
                          <button
                            onClick={() => {
                              haptic('light');
                              clearLoop();
                            }}
                            className="rounded-full bg-black/25 px-2 py-1 opacity-75 active:scale-95"
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
                                  onClick={() => {
                                    haptic('medium');
                                    useSoundStore.getState().seekTo(savedDrop);
                                    playbackManager.play();
                                  }}
                                  className="flex items-center gap-1 rounded-full bg-amber-500/25 px-2.5 py-1 text-amber-300 active:scale-95"
                                >
                                  <Bookmark size={11} fill="currentColor" />
                                  <span>Drop {formatSeconds(savedDrop)}</span>
                                </button>
                                <button
                                  onClick={() => {
                                    haptic('light');
                                    if (dlKey) {
                                      setTrackBookmark(dlKey, null);
                                    }
                                  }}
                                  className="rounded-full bg-black/25 px-2 py-1 opacity-70 active:scale-95"
                                  title="Clear Drop Bookmark"
                                >
                                  ×
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => {
                                  haptic('medium');
                                  if (dlKey) {
                                    setTrackBookmark(dlKey, position);
                                    toast.success(
                                      `🔖 Saved Drop bookmark at ${formatSeconds(position)}`,
                                    );
                                  }
                                }}
                                className="flex items-center gap-1 rounded-full bg-black/25 px-2.5 py-1 opacity-80 active:scale-95"
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

                {/* Primary Playback Transport Controls */}
                <div className="flex items-center justify-between pb-2">
                  <button
                    className={`flex size-10 items-center justify-center rounded-full ${
                      shuffleEnabled
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-black/20 opacity-75'
                    }`}
                    onClick={handleToggleShuffle}
                    aria-label="Shuffle"
                  >
                    <Shuffle size={18} />
                  </button>

                  <button
                    className="flex size-12 items-center justify-center rounded-full bg-black/25 transition-transform active:scale-90"
                    onClick={() => {
                      haptic('medium');
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
                    className="bg-primary text-primary-foreground flex size-16 items-center justify-center rounded-full shadow-xl transition-transform active:scale-90"
                    onClick={() => {
                      haptic('medium');
                      playbackManager.toggle();
                    }}
                    aria-label="Play/Pause"
                  >
                    {isPlaying ? <Pause size={28} /> : <Play size={28} />}
                  </button>

                  <button
                    className="flex size-12 items-center justify-center rounded-full bg-black/25 transition-transform active:scale-90"
                    onClick={() => {
                      haptic('medium');
                      goToNext();
                    }}
                    aria-label="Next"
                  >
                    <SkipForward size={22} />
                  </button>

                  <button
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

          {/* TAB 2: SYNCED LYRICS (LRCLIB WITH TAP-TO-SEEK + KARAOKE MODE) */}
          {nowPlayingTab === 'lyrics' && (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-[11px] opacity-65">
                  Tap any line to seek
                </span>
                <button
                  onClick={() => {
                    haptic('medium');
                    setKaraokeEnabled(!karaokeEnabled);
                    toast.info(
                      !karaokeEnabled
                        ? '🎤 Karaoke Vocal Remover ON'
                        : '🎤 Karaoke OFF',
                    );
                  }}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition active:scale-95 ${
                    karaokeEnabled
                      ? 'bg-primary text-primary-foreground shadow'
                      : 'bg-black/25 opacity-85'
                  }`}
                >
                  <MicVocal size={13} />
                  <span>{karaokeEnabled ? 'Karaoke ON' : 'Karaoke Mode'}</span>
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
                <div className="space-y-3 py-6">
                  <div className="mb-2 text-center text-[11px] opacity-60">
                    Tap any lyric line to jump directly to that timestamp
                  </div>
                  {syncedLyrics.map((line, idx) => {
                    const isActive = idx === activeLyricIndex;
                    return (
                      <button
                        key={`${line.timeSec}-${idx}`}
                        ref={isActive ? activeLyricRef : undefined}
                        onClick={() => {
                          haptic('light');
                          useSoundStore.getState().seekTo(line.timeSec);
                          playbackManager.play();
                        }}
                        className={`block w-full rounded-lg px-3 py-2 text-left transition-all ${
                          isActive
                            ? 'bg-primary/25 scale-[1.02] text-lg font-extrabold'
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
                              haptic('medium');
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
                  <p className="text-xs opacity-75">
                    Play a song to automatically pull synced LRC lyrics from
                    LRCLIB.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: AUDIO DSP, EQUALIZER, SPEED/PITCH & SPONSORBLOCK */}
          {nowPlayingTab === 'dsp' && (
            <div className="flex-1 overflow-y-auto px-5 py-3">
              <AudioDspPanel showMobileOnlyControls />
            </div>
          )}

          {/* TAB 4: UP NEXT QUEUE */}
          {nowPlayingTab === 'queue' && (
            <div className="flex flex-1 flex-col overflow-hidden px-4 py-2">
              <div className="mb-2 flex items-center justify-between gap-1.5">
                <button
                  className="flex items-center gap-1 rounded-lg bg-black/25 px-2.5 py-1.5 text-xs font-bold active:scale-95"
                  onClick={() => {
                    haptic('light');
                    shuffleRemainingQueue();
                  }}
                >
                  <Shuffle size={13} /> Shuffle
                </button>
                <button
                  className="flex items-center gap-1 rounded-lg bg-black/25 px-2.5 py-1.5 text-xs font-bold active:scale-95"
                  onClick={() => {
                    haptic('heavy');
                    void spinForgottenGem();
                  }}
                >
                  <Dices size={13} /> Gem
                </button>
                <button
                  className="flex items-center gap-1 rounded-lg bg-black/25 px-2.5 py-1.5 text-xs font-bold active:scale-95"
                  onClick={() =>
                    void downloadTracks(queueItems.map((i) => i.track))
                  }
                >
                  <Download size={13} /> Save ({queueItems.length})
                </button>
                <button
                  className="flex items-center gap-1 rounded-lg bg-black/25 px-2.5 py-1.5 text-xs font-bold active:scale-95"
                  onClick={clearQueue}
                >
                  <Trash2 size={13} />
                </button>
              </div>

              <div className="flex-1 space-y-1.5 overflow-y-auto pb-4">
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
                          : 'bg-black/20'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 truncate text-xs font-bold">
                          {isCurrent ? (
                            <EqualizerBars playing={isPlaying} />
                          ) : (
                            <span>{idx + 1}.</span>
                          )}
                          <span className="truncate">{item.track.title}</span>
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

              <div className="mt-1 shrink-0 rounded-xl bg-black/25">
                <ConnectedStreamVerification />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Multi-Source Stream Switcher Sheet */}
      {streamPickerOpen && track && currentItem && (
        <div
          className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/60 backdrop-blur-xs"
          onClick={() => setStreamPickerOpen(false)}
        >
          <div
            className="animate-in slide-in-from-bottom-6 border-border flex max-h-[75dvh] flex-col rounded-t-2xl border-t pb-[max(1rem,env(safe-area-inset-bottom))] duration-200"
            style={{
              backgroundColor: oledBlackMode ? '#09090b' : 'var(--background)',
              color: 'var(--foreground)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-border flex items-center justify-between border-b px-4 py-3">
              <div className="min-w-0 flex-1 pr-2">
                <div className="text-sm font-extrabold">
                  🔀 Switch Audio Stream
                </div>
                <div className="truncate text-[11px] opacity-70">
                  {track.title} — {artistName}
                </div>
              </div>
              <button
                onClick={() => setStreamPickerOpen(false)}
                className="rounded-md border px-2.5 py-1 text-xs font-bold active:scale-95"
              >
                Close
              </button>
            </div>

            <div className="px-4 pt-3">
              <button
                disabled={searchingAllStreams}
                onClick={() => {
                  haptic('medium');
                  void handleSearchAllStreams(false);
                }}
                className="bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-xl py-2 text-xs font-extrabold shadow transition active:scale-95 disabled:opacity-60"
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
                    : 'No cached stream candidates yet. Tap Search All Streaming Sources above!'}
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
                      onClick={() => {
                        haptic('medium');
                        useQueueStore
                          .getState()
                          .selectCandidate(currentItem.id, cand.id);
                        playbackManager.play();
                        setStreamPickerOpen(false);
                        toast.success(
                          `🔀 Switched stream: ${cand.title || cand.id}`,
                        );
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.98] ${
                        isActive
                          ? 'bg-primary text-primary-foreground border-transparent font-bold shadow'
                          : 'border-border bg-black/15'
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
