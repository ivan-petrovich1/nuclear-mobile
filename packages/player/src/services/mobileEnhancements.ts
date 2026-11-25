import { toast } from 'sonner';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { pickArtwork, type Track } from '@nuclearplayer/model';

import { useDownloadStore } from '../stores/downloadStore';
import { orderQueueItems } from '../stores/queue/playOrder';
import { useQueueStore } from '../stores/queue/queueStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSoundStore } from '../stores/soundStore';
import { haptic, initAndroidMediaBridge } from './androidMediaBridge';
import { triggerEndlessRadio } from './endlessRadio';
import { httpHost } from './httpHost';
import { initP2pSync } from './p2pSync';
import { playbackManager } from './playback';
import { playbackSettings } from './playbackSettings';
import { syncAmbientSoundSpace, type AmbientSpace } from './soundSpaces';
import { useSpotifyAccountSyncStore } from './spotifyAccountSync';
import { hasFreshStream, streamingHost } from './streamingHost';
import { candidatesForTrack } from './streamResolution/candidateSource';
import { useWrappedStatsStore } from './wrappedStats';

export type LrcLine = {
  timeSec: number;
  text: string;
};

export const getActiveLyricLine = (
  syncedLyrics: LrcLine[],
  positionSec: number,
): { current: LrcLine | null; next: LrcLine | null; index: number } => {
  if (!syncedLyrics.length) {
    return { current: null, next: null, index: -1 };
  }
  const target = positionSec + 0.25;
  let index = -1;
  for (let i = syncedLyrics.length - 1; i >= 0; i--) {
    if (syncedLyrics[i].timeSec <= target) {
      index = i;
      break;
    }
  }
  if (index === -1) {
    return { current: null, next: syncedLyrics[0] ?? null, index: -1 };
  }
  return {
    current: syncedLyrics[index] ?? null,
    next: syncedLyrics[index + 1] ?? null,
    index,
  };
};

export type NowPlayingTab = 'player' | 'lyrics' | 'dsp' | 'queue';
export type DesktopHubTab = 'spotify' | 'offline' | 'wrapped' | 'p2p' | 'dsp';

export const EQ_FREQUENCIES = [60, 230, 910, 3600, 14000] as const;
export const EQ_LABELS = ['60Hz', '230Hz', '910Hz', '3.6kHz', '14kHz'] as const;

export const EQ_PRESETS: Record<
  string,
  [number, number, number, number, number]
> = {
  Flat: [0, 0, 0, 0, 0],
  'Bass Boost': [6, 4, 0, 1, 2],
  Vocal: [-2, 1, 5, 4, 1],
  Acoustic: [2, 1, 2, 3, 2],
  Rock: [5, 3, -1, 3, 5],
  Electronic: [6, 3, 0, 2, 5],
};

export const shuffleRemainingQueue = (): void => {
  const { items, shuffleQueue } = useQueueStore.getState();
  if (items.length <= 1) {
    return;
  }
  shuffleQueue(false);
  toast.info('🔀 Shuffled upcoming queue');
};

type MobileEnhancementsState = {
  nowPlayingOpen: boolean;
  nowPlayingTab: NowPlayingTab;
  desktopHubOpen: boolean;
  desktopHubTab: DesktopHubTab;
  desktopStreamPickerOpen: boolean;
  sleepEndAt: number | null;
  oledBlackMode: boolean;
  sponsorBlockEnabled: boolean;
  preResolveEnabled: boolean;
  smartAutoCacheEnabled: boolean;
  playbackSpeed: number;
  preservePitch: boolean;
  bassBoostDb: number;
  loudnessBoostDb: number;
  eqBands: [number, number, number, number, number];
  dominantColor: string;
  lyricsTrackItemId: string | null;
  syncedLyrics: LrcLine[];
  plainLyrics: string | null;
  lyricsLoading: boolean;
  sponsorSegments: Array<[number, number]>;
  preResolvedIds: Record<string, boolean>;
  ambientSpace: AmbientSpace;
  ambientVolume: number;
  spatial8dEnabled: boolean;
  shakeToSkipEnabled: boolean;
  shakeSensitivity: 'low' | 'medium' | 'high';
  loopA: number | null;
  loopB: number | null;
  trackBookmarks: Record<string, number>;
  visualizerEnabled: boolean;
  floatingLyricsEnabled: boolean;
  karaokeEnabled: boolean;
  crossfadeSeconds: number;
  silenceTrimEnabled: boolean;
  endlessRadioEnabled: boolean;

  setNowPlayingOpen: (open: boolean) => void;
  setNowPlayingTab: (tab: NowPlayingTab) => void;
  setDesktopHubOpen: (open: boolean) => void;
  openDesktopHub: (tab?: DesktopHubTab) => void;
  setDesktopStreamPickerOpen: (open: boolean) => void;
  setSleepEndAt: (ts: number | null) => void;
  cycleSleepTimer: () => void;
  setOledBlackMode: (enabled: boolean) => void;
  setSponsorBlockEnabled: (enabled: boolean) => void;
  setPreResolveEnabled: (enabled: boolean) => void;
  setSmartAutoCacheEnabled: (enabled: boolean) => void;
  setPlaybackSpeed: (speed: number) => void;
  setPreservePitch: (preserve: boolean) => void;
  setBassBoostDb: (db: number) => void;
  setLoudnessBoostDb: (db: number) => void;
  setEqBand: (index: number, db: number) => void;
  applyEqPreset: (presetName: string) => void;
  resetDsp: () => void;
  setAmbientSpace: (space: AmbientSpace) => void;
  setAmbientVolume: (vol: number) => void;
  setSpatial8dEnabled: (enabled: boolean) => void;
  setShakeToSkipEnabled: (enabled: boolean) => void;
  setShakeSensitivity: (sens: 'low' | 'medium' | 'high') => void;
  setLoopA: (sec: number | null) => void;
  setLoopB: (sec: number | null) => void;
  clearLoop: () => void;
  setTrackBookmark: (trackKey: string, sec: number | null) => void;
  setVisualizerEnabled: (enabled: boolean) => void;
  setFloatingLyricsEnabled: (enabled: boolean) => void;
  toggleFloatingLyrics: () => void;
  setKaraokeEnabled: (enabled: boolean) => void;
  setCrossfadeSeconds: (sec: number) => void;
  setSilenceTrimEnabled: (enabled: boolean) => void;
  setEndlessRadioEnabled: (enabled: boolean) => void;
};

export const useMobileEnhancementsStore = create<MobileEnhancementsState>()(
  persist(
    (set, get) => ({
      nowPlayingOpen: false,
      nowPlayingTab: 'player',
      desktopHubOpen: false,
      desktopHubTab: 'spotify',
      desktopStreamPickerOpen: false,
      sleepEndAt: null,
      oledBlackMode: false,
      sponsorBlockEnabled: true,
      preResolveEnabled: true,
      smartAutoCacheEnabled: false,
      playbackSpeed: 1.0,
      preservePitch: true,
      bassBoostDb: 0,
      loudnessBoostDb: 0,
      eqBands: [0, 0, 0, 0, 0],
      dominantColor: '#7c3aed',
      lyricsTrackItemId: null,
      syncedLyrics: [],
      plainLyrics: null,
      lyricsLoading: false,
      sponsorSegments: [],
      preResolvedIds: {},
      ambientSpace: 'off',
      ambientVolume: 0.35,
      spatial8dEnabled: false,
      shakeToSkipEnabled: false,
      shakeSensitivity: 'medium',
      loopA: null,
      loopB: null,
      trackBookmarks: {},
      visualizerEnabled: true,
      floatingLyricsEnabled: true,
      karaokeEnabled: false,
      crossfadeSeconds: 0,
      silenceTrimEnabled: false,
      endlessRadioEnabled: false,

      setNowPlayingOpen: (nowPlayingOpen) => set({ nowPlayingOpen }),
      setNowPlayingTab: (nowPlayingTab) => set({ nowPlayingTab }),
      setDesktopHubOpen: (desktopHubOpen) => set({ desktopHubOpen }),
      openDesktopHub: (tab) =>
        set((s) => ({
          desktopHubOpen: true,
          desktopHubTab: tab ?? s.desktopHubTab,
        })),
      setDesktopStreamPickerOpen: (desktopStreamPickerOpen) =>
        set({ desktopStreamPickerOpen }),
      setSleepEndAt: (sleepEndAt) => set({ sleepEndAt }),
      cycleSleepTimer: () => {
        const presets = [15, 30, 45, 60];
        const currentEnd = get().sleepEndAt;
        if (!currentEnd) {
          const mins = presets[0];
          set({ sleepEndAt: Date.now() + mins * 60_000 });
          toast.info(`🌙 Sleep timer: ${mins} min`);
          return;
        }
        const rem = Math.ceil((currentEnd - Date.now()) / 60_000);
        const next = presets.find((p) => p > rem + 2);
        if (next) {
          set({ sleepEndAt: Date.now() + next * 60_000 });
          toast.info(`🌙 Sleep timer: ${next} min`);
        } else {
          set({ sleepEndAt: null });
          toast.info('🌙 Sleep timer off');
        }
      },
      setOledBlackMode: (oledBlackMode) => set({ oledBlackMode }),
      setSponsorBlockEnabled: (sponsorBlockEnabled) =>
        set({ sponsorBlockEnabled }),
      setPreResolveEnabled: (preResolveEnabled) => set({ preResolveEnabled }),
      setSmartAutoCacheEnabled: (smartAutoCacheEnabled) => {
        set({ smartAutoCacheEnabled });
        void useSettingsStore
          .getState()
          .setValue('core.playback.autoDownloadPlayed', smartAutoCacheEnabled);
      },
      setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),
      setPreservePitch: (preservePitch) => set({ preservePitch }),
      setBassBoostDb: (bassBoostDb) => set({ bassBoostDb }),
      setLoudnessBoostDb: (loudnessBoostDb) => set({ loudnessBoostDb }),
      setEqBand: (index, db) =>
        set((state) => {
          const next = [...state.eqBands] as [
            number,
            number,
            number,
            number,
            number,
          ];
          next[index] = db;
          return { eqBands: next };
        }),
      applyEqPreset: (presetName) => {
        const preset = EQ_PRESETS[presetName];
        if (preset) {
          set({ eqBands: [...preset] });
        }
      },
      resetDsp: () =>
        set({
          playbackSpeed: 1.0,
          preservePitch: true,
          bassBoostDb: 0,
          loudnessBoostDb: 0,
          eqBands: [0, 0, 0, 0, 0],
          ambientSpace: 'off',
          spatial8dEnabled: false,
          karaokeEnabled: false,
        }),
      setAmbientSpace: (ambientSpace) => set({ ambientSpace }),
      setAmbientVolume: (ambientVolume) => set({ ambientVolume }),
      setSpatial8dEnabled: (spatial8dEnabled) => set({ spatial8dEnabled }),
      setShakeToSkipEnabled: (shakeToSkipEnabled) =>
        set({ shakeToSkipEnabled }),
      setShakeSensitivity: (shakeSensitivity) => set({ shakeSensitivity }),
      setLoopA: (loopA) => set({ loopA }),
      setLoopB: (loopB) => set({ loopB }),
      clearLoop: () => set({ loopA: null, loopB: null }),
      setTrackBookmark: (trackKey, sec) =>
        set((state) => {
          const next = { ...state.trackBookmarks };
          if (sec === null) {
            delete next[trackKey];
          } else {
            next[trackKey] = sec;
          }
          return { trackBookmarks: next };
        }),
      setVisualizerEnabled: (visualizerEnabled) => set({ visualizerEnabled }),
      setFloatingLyricsEnabled: (floatingLyricsEnabled) =>
        set({ floatingLyricsEnabled }),
      toggleFloatingLyrics: () =>
        set((state) => ({
          floatingLyricsEnabled: !state.floatingLyricsEnabled,
        })),
      setKaraokeEnabled: (karaokeEnabled) => set({ karaokeEnabled }),
      setCrossfadeSeconds: (crossfadeSeconds) => set({ crossfadeSeconds }),
      setSilenceTrimEnabled: (silenceTrimEnabled) =>
        set({ silenceTrimEnabled }),
      setEndlessRadioEnabled: (endlessRadioEnabled) =>
        set({ endlessRadioEnabled }),
    }),
    {
      name: 'nuclear-mobile-enhancements',
      version: 2,
      migrate: (persistedState: unknown) => ({
        ...(typeof persistedState === 'object' && persistedState !== null
          ? (persistedState as Record<string, unknown>)
          : {}),
        smartAutoCacheEnabled: false,
      }),
      partialize: (state) => ({
        oledBlackMode: state.oledBlackMode,
        sponsorBlockEnabled: state.sponsorBlockEnabled,
        preResolveEnabled: state.preResolveEnabled,
        smartAutoCacheEnabled: state.smartAutoCacheEnabled,
        playbackSpeed: state.playbackSpeed,
        preservePitch: state.preservePitch,
        bassBoostDb: state.bassBoostDb,
        loudnessBoostDb: state.loudnessBoostDb,
        eqBands: state.eqBands,
        ambientVolume: state.ambientVolume,
        spatial8dEnabled: state.spatial8dEnabled,
        shakeToSkipEnabled: state.shakeToSkipEnabled,
        shakeSensitivity: state.shakeSensitivity,
        trackBookmarks: state.trackBookmarks,
        visualizerEnabled: state.visualizerEnabled,
        floatingLyricsEnabled: state.floatingLyricsEnabled,
        crossfadeSeconds: state.crossfadeSeconds,
        silenceTrimEnabled: state.silenceTrimEnabled,
        endlessRadioEnabled: state.endlessRadioEnabled,
      }),
    },
  ),
);

const parseLrc = (lrc: string): LrcLine[] => {
  const lines: LrcLine[] = [];
  const regex = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\](.*)/;
  for (const rawLine of lrc.split(/\r?\n/)) {
    const match = regex.exec(rawLine);
    if (!match) {
      continue;
    }
    const mins = parseInt(match[1], 10);
    const secs = parseInt(match[2], 10);
    const frac = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) / 1000 : 0;
    const text = match[4].trim();
    if (text) {
      lines.push({ timeSec: mins * 60 + secs + frac, text });
    }
  }
  return lines.sort((a, b) => a.timeSec - b.timeSec);
};

const extractColorFromTrack = (track: Track): Promise<string> => {
  return new Promise((resolve) => {
    const url =
      pickArtwork(track.artwork, 'thumbnail', 300)?.url ??
      pickArtwork(track.album?.artwork, 'thumbnail', 300)?.url;

    const fallbackFromTitle = () => {
      const str = `${track.artists?.[0]?.name ?? ''}-${track.title}`;
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
      }
      const hue = Math.abs(hash) % 360;
      resolve(`hsl(${hue}, 72%, 48%)`);
    };

    if (!url) {
      fallbackFromTitle();
      return;
    }

    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          fallbackFromTitle();
          return;
        }
        ctx.drawImage(img, 0, 0, 24, 24);
        const data = ctx.getImageData(0, 0, 24, 24).data;
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          if (lum > 28 && lum < 235) {
            rSum += r;
            gSum += g;
            bSum += b;
            count++;
          }
        }
        if (count > 0) {
          const r = Math.round(rSum / count);
          const g = Math.round(gSum / count);
          const b = Math.round(bSum / count);
          resolve(`rgb(${r}, ${g}, ${b})`);
          return;
        }
      } catch {
        // Cross-origin canvas fallback
      }
      fallbackFromTitle();
    };
    img.onerror = () => fallbackFromTitle();
    img.src = url;
  });
};

type LrcLibResult = {
  trackName?: string;
  artistName?: string;
  duration?: number;
  syncedLyrics?: string;
  plainLyrics?: string;
};

const normalizeMatchText = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[([{].*?[)\]}]/g, ' ')
    .replace(/feat\.?|ft\.?|featuring/gi, ' ')
    .replace(
      /[^a-z0-9\u0400-\u04ff\u0590-\u05ff\u3040-\u30ff\u4e00-\u9fff]+/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();

const cleanSearchTitle = (raw: string): string =>
  raw
    .replace(
      /\s*[([]\s*(?:feat\.?|ft\.?|featuring|official.*|lyrics.*|audio.*|video.*|sped\s*up|slowed.*|nightcore.*|radio\s*edit|club\s*mix|airplay\s*mix|remaster.*)\s*[)\]]/gi,
      '',
    )
    .replace(
      /\s*-\s*(?:sped\s*up|slowed.*|nightcore.*|radio\s*edit|club\s*mix|airplay\s*mix|original\s*mix|instrumental.*)$/gi,
      '',
    )
    .trim();

export const pickBestLrcCandidate = (
  results: LrcLibResult[],
  track: Pick<Track, 'title' | 'artists' | 'durationMs'>,
  requireSynced: boolean,
): LrcLibResult | undefined => {
  const normTitle = normalizeMatchText(track.title ?? '');
  const titleWords = normTitle.split(' ').filter((w) => w.length > 1);
  const normArtists = (track.artists ?? [])
    .map((a) => normalizeMatchText(a.name ?? ''))
    .filter(Boolean);
  const targetSec =
    track.durationMs && track.durationMs > 0 ? track.durationMs / 1000 : null;

  let best: LrcLibResult | undefined;
  let bestScore = -Infinity;

  for (const candidate of results) {
    if (requireSynced && !candidate.syncedLyrics) {
      continue;
    }
    if (!requireSynced && !candidate.plainLyrics) {
      continue;
    }

    const candTitle = normalizeMatchText(candidate.trackName ?? '');
    const candArtist = normalizeMatchText(candidate.artistName ?? '');

    // Reject completely unrelated songs
    const exactTitle = Boolean(normTitle && candTitle === normTitle);
    const containsTitle = Boolean(
      normTitle &&
      candTitle &&
      (candTitle.includes(normTitle) || normTitle.includes(candTitle)),
    );
    const matchingWords = titleWords.filter((w) =>
      candTitle.includes(w),
    ).length;
    const wordRatio =
      titleWords.length > 0 ? matchingWords / titleWords.length : 0;

    if (!exactTitle && !containsTitle && wordRatio < 0.5) {
      continue;
    }

    let score = 0;
    if (exactTitle) {
      score += 50;
    } else if (containsTitle) {
      score += 30;
    } else {
      score += Math.round(wordRatio * 25);
    }

    const artistMatched = normArtists.some(
      (a) => candArtist.includes(a) || a.includes(candArtist),
    );
    if (artistMatched) {
      score += 40;
    } else if (normArtists.length > 0 && candArtist) {
      score -= 15;
    }

    if (
      targetSec !== null &&
      typeof candidate.duration === 'number' &&
      candidate.duration > 0
    ) {
      const diff = Math.abs(candidate.duration - targetSec);
      score += Math.max(-25, 25 - diff * 0.5);
    }

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
};

let lyricsRequestSeq = 0;
let lastLrcBatch: {
  itemId: string;
  track: Track;
  results: LrcLibResult[];
  matchedDurationSec: number | null;
} | null = null;

const applyBestLyricsFromBatch = (
  itemId: string,
  track: Track,
  results: LrcLibResult[],
  overrideDurationSec?: number | null,
) => {
  const effectiveTrack =
    overrideDurationSec && overrideDurationSec > 10
      ? { ...track, durationMs: overrideDurationSec * 1000 }
      : track;
  const withSynced = pickBestLrcCandidate(results, effectiveTrack, true);
  if (withSynced?.syncedLyrics) {
    lastLrcBatch = {
      itemId,
      track,
      results,
      matchedDurationSec: withSynced.duration ?? null,
    };
    useMobileEnhancementsStore.setState({
      lyricsTrackItemId: itemId,
      syncedLyrics: parseLrc(withSynced.syncedLyrics),
      plainLyrics: withSynced.plainLyrics ?? null,
      lyricsLoading: false,
    });
    return true;
  }

  const withPlain = pickBestLrcCandidate(results, effectiveTrack, false);
  if (withPlain?.plainLyrics) {
    lastLrcBatch = {
      itemId,
      track,
      results,
      matchedDurationSec: withPlain.duration ?? null,
    };
    useMobileEnhancementsStore.setState({
      lyricsTrackItemId: itemId,
      syncedLyrics: [],
      plainLyrics: withPlain.plainLyrics,
      lyricsLoading: false,
    });
    return true;
  }
  return false;
};

const queryLrcLib = async (url: string): Promise<LrcLibResult[]> => {
  const resp = await httpHost.fetch(url, {
    headers: { 'User-Agent': 'NuclearPlayer/1.0.7' },
  });
  if (resp.status !== 200 || !resp.body) {
    return [];
  }
  const parsed = JSON.parse(resp.body) as unknown;
  return Array.isArray(parsed) ? (parsed as LrcLibResult[]) : [];
};

const fetchLyricsForTrack = async (itemId: string, track: Track) => {
  const reqSeq = ++lyricsRequestSeq;
  lastLrcBatch = null;
  useMobileEnhancementsStore.setState({
    lyricsLoading: true,
    lyricsTrackItemId: itemId,
    syncedLyrics: [],
    plainLyrics: null,
  });

  const isStillCurrent = () =>
    reqSeq === lyricsRequestSeq &&
    useQueueStore.getState().getCurrentItem()?.id === itemId;

  const artist = track.artists?.[0]?.name ?? '';
  const rawTitle = track.title ?? '';
  const cleanedTitle = cleanSearchTitle(rawTitle) || rawTitle;

  const urls: string[] = [];
  if (artist && cleanedTitle) {
    urls.push(
      `https://lrclib.net/api/search?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(cleanedTitle)}`,
    );
  }
  const fullQ = `${artist} ${rawTitle}`.trim();
  if (fullQ) {
    urls.push(`https://lrclib.net/api/search?q=${encodeURIComponent(fullQ)}`);
  }

  try {
    const allResults: LrcLibResult[] = [];
    for (const url of urls) {
      if (!isStillCurrent()) {
        return;
      }
      const batch = await queryLrcLib(url);
      allResults.push(...batch);
      if (pickBestLrcCandidate(allResults, track, true)) {
        break;
      }
    }

    if (!isStillCurrent()) {
      return;
    }

    const liveDur = useSoundStore.getState().duration;
    if (
      applyBestLyricsFromBatch(
        itemId,
        track,
        allResults,
        liveDur > 10 ? liveDur : null,
      )
    ) {
      return;
    }
  } catch {
    // Ignore lyrics lookup errors
  }

  if (!isStillCurrent()) {
    return;
  }

  useMobileEnhancementsStore.setState({
    lyricsTrackItemId: itemId,
    syncedLyrics: [],
    plainLyrics: null,
    lyricsLoading: false,
  });
};

const fetchSponsorBlockForVideo = async (videoId: string) => {
  useMobileEnhancementsStore.setState({ sponsorSegments: [] });
  if (!videoId || videoId.length !== 11) {
    return;
  }
  try {
    const cats = encodeURIComponent(
      JSON.stringify([
        'music_offtopic',
        'intro',
        'outro',
        'sponsor',
        'selfpromo',
      ]),
    );
    const resp = await httpHost.fetch(
      `https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(videoId)}&categories=${cats}`,
    );
    if (resp.status === 200 && resp.body) {
      const json = JSON.parse(resp.body) as Array<{
        segment?: [number, number];
      }>;
      const segments = json
        .map((entry) => entry.segment)
        .filter(
          (seg): seg is [number, number] =>
            Array.isArray(seg) &&
            seg.length === 2 &&
            seg[1] > seg[0] &&
            seg[1] - seg[0] >= 1.5,
        );
      useMobileEnhancementsStore.setState({ sponsorSegments: segments });
    }
  } catch {
    // Ignore SponsorBlock 404 (no segments for this track)
  }
};

// Pre-resolve the next 2 tracks in the queue so transitions are 0ms
let preResolveInFlight = false;
const preResolveUpcomingTracks = async () => {
  if (
    preResolveInFlight ||
    !useMobileEnhancementsStore.getState().preResolveEnabled
  ) {
    return;
  }
  preResolveInFlight = true;
  try {
    const {
      items,
      currentIndex,
      playOrder,
      playCursor,
      updateItemState,
      updateCandidate,
    } = useQueueStore.getState();
    const isShuffled = playbackSettings.shuffleEnabled && playOrder.length > 0;
    const orderedItems = isShuffled ? orderQueueItems(items, playOrder) : items;
    const activeIndex = isShuffled ? playCursor : currentIndex;
    const upcoming = [
      orderedItems[activeIndex + 1],
      orderedItems[activeIndex + 2],
    ].filter(Boolean);

    for (const nextItem of upcoming) {
      if (
        useDownloadStore.getState().isDownloaded(nextItem.track) ||
        nextItem.track.streamCandidates?.some(
          (c) => !c.failed && hasFreshStream(c),
        )
      ) {
        continue;
      }
      const candidates = await candidatesForTrack(nextItem.track);
      if (!candidates?.length) {
        continue;
      }
      updateItemState(nextItem.id, {
        track: { ...nextItem.track, streamCandidates: candidates },
      });
      const head = candidates.find((c) => !c.failed);
      if (head) {
        const resolved = await streamingHost.resolveStreamForCandidate(head);
        if (resolved && !resolved.failed && resolved.stream?.url) {
          updateCandidate(nextItem.id, resolved);
          useMobileEnhancementsStore.setState((s) => ({
            preResolvedIds: { ...s.preResolvedIds, [nextItem.id]: true },
          }));
        }
      }
    }
  } catch {
    // Ignore pre-resolve errors
  } finally {
    preResolveInFlight = false;
  }
};

// Web Audio DSP Graph attached to active <audio> element
type DspGraph = {
  ctx: AudioContext;
  bassFilter: BiquadFilterNode;
  eqFilters: BiquadFilterNode[];
  loudnessGain: GainNode;
  masterVolumeGain: GainNode;
  panner: StereoPannerNode | null;
  lfoGain: GainNode | null;
  normalGain: GainNode;
  karaokeGain: GainNode;
  analyser: AnalyserNode;
};

const dspGraphs = new WeakMap<HTMLAudioElement, DspGraph>();
let activeAnalyser: AnalyserNode | null = null;

export const getAudioAnalyser = (): AnalyserNode | null => activeAnalyser;

const isAndroidDevice = () =>
  typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

const syncAudioElementDsp = () => {
  const audio = document.querySelector('audio');
  if (!audio) {
    return;
  }

  const {
    playbackSpeed,
    preservePitch,
    bassBoostDb,
    loudnessBoostDb,
    eqBands,
    spatial8dEnabled,
    karaokeEnabled,
    silenceTrimEnabled,
  } = useMobileEnhancementsStore.getState();

  try {
    if (Math.abs(audio.playbackRate - playbackSpeed) > 0.01) {
      audio.playbackRate = playbackSpeed;
    }
    const audioWithPitch = audio as HTMLAudioElement & {
      preservesPitch?: boolean;
      webkitPreservesPitch?: boolean;
    };
    if (audioWithPitch.preservesPitch !== undefined) {
      audioWithPitch.preservesPitch = preservePitch;
    }
    if (audioWithPitch.webkitPreservesPitch !== undefined) {
      audioWithPitch.webkitPreservesPitch = preservePitch;
    }
  } catch {
    // Ignore speed errors
  }

  // Only attach Web Audio when an explicit DSP effect is active.
  // Keeping <audio> off Web Audio by default preserves Android's native hardware audio path
  // (instant track starts, full loudness, and zero resampling distortion).
  // BeatVisualizer automatically renders a smooth animated wave when no AudioContext is attached.
  const needsGraph =
    bassBoostDb > 0 ||
    loudnessBoostDb > 0 ||
    spatial8dEnabled ||
    karaokeEnabled ||
    silenceTrimEnabled ||
    eqBands.some((gain) => Math.abs(gain) > 0.1);

  let graph = dspGraphs.get(audio);
  if (!graph && needsGraph) {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaElementSource(audio);

      const bassFilter = ctx.createBiquadFilter();
      bassFilter.type = 'lowshelf';
      bassFilter.frequency.value = 85;

      const eqFilters = EQ_FREQUENCIES.map((freq, idx) => {
        const filter = ctx.createBiquadFilter();
        filter.type =
          idx === 0
            ? 'lowshelf'
            : idx === EQ_FREQUENCIES.length - 1
              ? 'highshelf'
              : 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1.0;
        return filter;
      });

      const loudnessGain = ctx.createGain();
      const masterVolumeGain = ctx.createGain();
      // On Android Chromium, HTMLAudioElement.volume already scales pre-WebAudio output;
      // mirroring it again would square volume (v^2) and halve max loudness!
      // Only mirror audio.volume into masterVolumeGain on Desktop (WebKitGTK).
      const syncVol = () => {
        if (isAndroidDevice()) {
          masterVolumeGain.gain.value = 1;
          return;
        }
        const targetVol = audio.muted
          ? 0
          : Math.max(0, Math.min(1, audio.volume));
        masterVolumeGain.gain.setTargetAtTime(targetVol, ctx.currentTime, 0.02);
      };
      syncVol();
      audio.addEventListener('volumechange', syncVol);

      let panner: StereoPannerNode | null = null;
      let lfoGain: GainNode | null = null;

      let prevNode: AudioNode = source;
      prevNode.connect(bassFilter);
      prevNode = bassFilter;
      for (const f of eqFilters) {
        prevNode.connect(f);
        prevNode = f;
      }
      prevNode.connect(loudnessGain);
      prevNode = loudnessGain;

      if (typeof ctx.createStereoPanner === 'function') {
        panner = ctx.createStereoPanner();
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.13;
        lfoGain = ctx.createGain();
        lfoGain.gain.value = spatial8dEnabled ? 0.85 : 0;
        lfo.connect(lfoGain);
        lfoGain.connect(panner.pan);
        lfo.start();
        prevNode.connect(panner);
        prevNode = panner;
      }

      // Parallel Normal vs Karaoke (L - R center-vocal cancellation)
      const normalGain = ctx.createGain();
      normalGain.gain.value = karaokeEnabled ? 0 : 1;

      const karaokeGain = ctx.createGain();
      karaokeGain.gain.value = karaokeEnabled ? 1 : 0;

      const splitter = ctx.createChannelSplitter(2);
      const invertR = ctx.createGain();
      invertR.gain.value = -1;
      const diffBus = ctx.createGain();
      diffBus.gain.value = 0.85;

      prevNode.connect(normalGain);
      prevNode.connect(splitter);
      splitter.connect(diffBus, 0);
      splitter.connect(invertR, 1);
      invertR.connect(diffBus);
      diffBus.connect(karaokeGain);

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.78;

      normalGain.connect(masterVolumeGain);
      karaokeGain.connect(masterVolumeGain);
      masterVolumeGain.connect(analyser);
      analyser.connect(ctx.destination);

      graph = {
        ctx,
        bassFilter,
        eqFilters,
        loudnessGain,
        masterVolumeGain,
        panner,
        lfoGain,
        normalGain,
        karaokeGain,
        analyser,
      };
      dspGraphs.set(audio, graph);
      activeAnalyser = analyser;
    } catch {
      // Ignore if element already attached to another AudioContext
    }
  }

  if (graph) {
    activeAnalyser = graph.analyser;
    if (graph.ctx.state === 'suspended' && !audio.paused) {
      void graph.ctx.resume();
    }
    graph.bassFilter.gain.value = bassBoostDb;
    graph.eqFilters.forEach((filter, idx) => {
      filter.gain.value = eqBands[idx] ?? 0;
    });
    // Convert dB to linear gain
    graph.loudnessGain.gain.value = Math.pow(10, loudnessBoostDb / 20);
    if (isAndroidDevice()) {
      graph.masterVolumeGain.gain.value = 1;
    } else {
      const targetVol = audio.muted
        ? 0
        : Math.max(0, Math.min(1, audio.volume));
      graph.masterVolumeGain.gain.setTargetAtTime(
        targetVol,
        graph.ctx.currentTime,
        0.02,
      );
    }
    graph.normalGain.gain.setTargetAtTime(
      karaokeEnabled ? 0 : 1,
      graph.ctx.currentTime,
      0.06,
    );
    graph.karaokeGain.gain.setTargetAtTime(
      karaokeEnabled ? 1 : 0,
      graph.ctx.currentTime,
      0.06,
    );
    if (graph.lfoGain && graph.panner) {
      graph.lfoGain.gain.setTargetAtTime(
        spatial8dEnabled ? 0.85 : 0,
        graph.ctx.currentTime,
        0.15,
      );
      if (!spatial8dEnabled) {
        graph.panner.pan.setTargetAtTime(0, graph.ctx.currentTime, 0.15);
      }
    }
  }
};

const syncMediaSessionMetadata = (track: Track) => {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
    return;
  }
  try {
    const cover =
      pickArtwork(track.artwork, 'thumbnail', 512)?.url ??
      pickArtwork(track.album?.artwork, 'thumbnail', 512)?.url;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artists?.map((a) => a.name).join(', ') || 'Unknown Artist',
      album: track.album?.title || 'Nuclear',
      artwork: cover
        ? [{ src: cover, sizes: '512x512', type: 'image/jpeg' }]
        : [],
    });

    navigator.mediaSession.setActionHandler('play', () =>
      playbackManager.play(),
    );
    navigator.mediaSession.setActionHandler('pause', () =>
      playbackManager.pause(),
    );
    navigator.mediaSession.setActionHandler('previoustrack', () =>
      useQueueStore.getState().goToPrevious(),
    );
    navigator.mediaSession.setActionHandler('nexttrack', () =>
      useQueueStore.getState().goToNext(),
    );
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) {
        useSoundStore.getState().seekTo(details.seekTime);
      }
    });
  } catch {
    // Ignore unsupported mediaSession actions
  }
};

let initialized = false;
export const initMobileEnhancements = () => {
  if (initialized) {
    return;
  }
  initialized = true;

  initAndroidMediaBridge();
  initP2pSync();

  // Wire native Android Shake-to-Skip callback
  if (typeof window !== 'undefined') {
    window.__NUCLEAR_SHAKE_SKIP__ = () => {
      if (!useMobileEnhancementsStore.getState().shakeToSkipEnabled) {
        return;
      }
      haptic('heavy');
      useQueueStore.getState().goToNext();
      toast.info('📳 Shake to skip!');
    };
  }

  // Auto-sync public Spotify account playlists shortly after launch
  if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      const sp = useSpotifyAccountSyncStore.getState();
      if (sp.autoSyncOnLaunch && sp.accountInput.trim()) {
        void sp.syncNow(true);
      }
    }, 3500);
  }

  let lastTrackItemId: string | undefined;
  let lastVideoId: string | undefined;
  let lastSkippedSegEnd = -1;
  let lastStatsTickAt = Date.now();
  let trackEffectsTimer: number | null = null;

  const onQueueChanged = () => {
    const currentItem = useQueueStore.getState().getCurrentItem();
    if (!currentItem) {
      if (trackEffectsTimer !== null && typeof window !== 'undefined') {
        window.clearTimeout(trackEffectsTimer);
        trackEffectsTimer = null;
      }
      lyricsRequestSeq++;
      lastTrackItemId = undefined;
      useMobileEnhancementsStore.setState({
        lyricsTrackItemId: null,
        syncedLyrics: [],
        plainLyrics: null,
        lyricsLoading: false,
      });
      return;
    }

    const activeCand = currentItem.track.streamCandidates?.find(
      (c) => !c.failed && c.id,
    );
    if (activeCand?.id && activeCand.id !== lastVideoId) {
      lastVideoId = activeCand.id;
      void fetchSponsorBlockForVideo(activeCand.id);
    }

    if (currentItem.id !== lastTrackItemId) {
      lastTrackItemId = currentItem.id;
      lastSkippedSegEnd = -1;
      lyricsRequestSeq++;
      useMobileEnhancementsStore.getState().clearLoop();
      // Immediately clear previous track's lyrics so stale lyrics never flash
      useMobileEnhancementsStore.setState({
        lyricsTrackItemId: currentItem.id,
        syncedLyrics: [],
        plainLyrics: null,
        lyricsLoading: true,
      });

      const targetItemId = currentItem.id;
      const targetTrack = currentItem.track;
      const runTrackEffects = () => {
        if (useQueueStore.getState().getCurrentItem()?.id !== targetItemId) {
          return;
        }
        useWrappedStatsStore.getState().recordTrackPlay(targetTrack);
        void extractColorFromTrack(targetTrack).then((dominantColor) => {
          if (useQueueStore.getState().getCurrentItem()?.id === targetItemId) {
            useMobileEnhancementsStore.setState({ dominantColor });
          }
        });
        void fetchLyricsForTrack(targetItemId, targetTrack);
        syncMediaSessionMetadata(targetTrack);

        const autoDownloadEnabled = Boolean(
          useSettingsStore
            .getState()
            .getValue('core.playback.autoDownloadPlayed'),
        );
        if (autoDownloadEnabled) {
          void useDownloadStore.getState().downloadTrack(targetTrack, true);
        }
      };

      if (typeof window !== 'undefined') {
        if (trackEffectsTimer !== null) {
          window.clearTimeout(trackEffectsTimer);
        }
        // Short debounce avoids firing requests for Track #0 during clearQueue -> addToQueue -> goToIndex
        trackEffectsTimer = window.setTimeout(() => {
          trackEffectsTimer = null;
          runTrackEffects();
        }, 120);
      } else {
        runTrackEffects();
      }
    }

    void preResolveUpcomingTracks();

    // Endless Vibe Radio: auto-queue similar tracks when reaching the last track
    const qState = useQueueStore.getState();
    if (
      useMobileEnhancementsStore.getState().endlessRadioEnabled &&
      qState.items.length > 0 &&
      qState.currentIndex >= qState.items.length - 1
    ) {
      void triggerEndlessRadio(currentItem.track);
    }
  };

  useQueueStore.subscribe(onQueueChanged);
  onQueueChanged();

  let lastCrossfadeTrackId = '';
  let crossfadeModifiedVol = false;
  let lastSilenceSkipAt = 0;

  useSoundStore.subscribe((soundState) => {
    syncAudioElementDsp();

    // If the resolved audio stream duration differs from metadata (e.g. album/video cut vs radio edit),
    // re-pick the closest-duration synced lyrics from the cached LRCLIB batch with zero network calls.
    if (
      lastLrcBatch &&
      soundState.duration > 10 &&
      useQueueStore.getState().getCurrentItem()?.id === lastLrcBatch.itemId &&
      (lastLrcBatch.matchedDurationSec === null ||
        Math.abs(lastLrcBatch.matchedDurationSec - soundState.duration) > 8)
    ) {
      const batch = lastLrcBatch;
      const better = pickBestLrcCandidate(
        batch.results,
        { ...batch.track, durationMs: soundState.duration * 1000 },
        true,
      );
      if (
        better?.syncedLyrics &&
        better.duration !== batch.matchedDurationSec
      ) {
        applyBestLyricsFromBatch(
          batch.itemId,
          batch.track,
          batch.results,
          soundState.duration,
        );
      }
    }

    const {
      sponsorBlockEnabled,
      sponsorSegments,
      loopA,
      loopB,
      crossfadeSeconds,
      silenceTrimEnabled,
    } = useMobileEnhancementsStore.getState();

    // DJ Auto-Crossfade (scales relative to the user's actual volume setting)
    const audio =
      typeof document !== 'undefined' ? document.querySelector('audio') : null;
    if (audio) {
      const baseVol = Math.max(
        0,
        Math.min(
          1,
          Number(
            useSettingsStore.getState().getValue('core.playback.volume') ?? 1,
          ),
        ),
      );
      if (
        crossfadeSeconds > 0 &&
        playbackSettings.repeatMode !== 'one' &&
        soundState.status === 'playing' &&
        soundState.duration > 20
      ) {
        const remaining = soundState.duration - soundState.seek;
        const curItem = useQueueStore.getState().getCurrentItem();
        const qState = useQueueStore.getState();
        const hasNext = qState.currentIndex < qState.items.length - 1;

        if (hasNext && remaining > 0 && remaining <= crossfadeSeconds) {
          const ratio = Math.max(0.08, remaining / crossfadeSeconds);
          audio.volume = baseVol * ratio;
          crossfadeModifiedVol = true;
          if (
            remaining <= 0.65 &&
            curItem &&
            curItem.id !== lastCrossfadeTrackId
          ) {
            lastCrossfadeTrackId = curItem.id;
            qState.goToNext();
          }
        } else if (soundState.seek < 2.0 && crossfadeModifiedVol) {
          const fadeIn = Math.min(1, Math.max(0.25, soundState.seek / 2.0));
          audio.volume = baseVol * fadeIn;
        } else if (crossfadeModifiedVol) {
          audio.volume = baseVol;
          crossfadeModifiedVol = false;
        }
      } else if (crossfadeModifiedVol) {
        audio.volume = baseVol;
        crossfadeModifiedVol = false;
      }
    }

    // Silence Trimmer (skip dead silent intros/outros on YouTube rips)
    if (
      silenceTrimEnabled &&
      soundState.status === 'playing' &&
      activeAnalyser &&
      soundState.duration > 30
    ) {
      const nowMs = Date.now();
      if (nowMs - lastSilenceSkipAt > 3000) {
        const timeData = new Uint8Array(activeAnalyser.fftSize);
        activeAnalyser.getByteTimeDomainData(timeData);
        let sumSq = 0;
        for (let i = 0; i < timeData.length; i++) {
          const v = (timeData[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / timeData.length);
        const remaining = soundState.duration - soundState.seek;
        if (rms < 0.006 && soundState.seek > 0.6 && soundState.seek < 7) {
          lastSilenceSkipAt = nowMs;
          useSoundStore.getState().seekTo(soundState.seek + 1.5);
        } else if (rms < 0.006 && remaining > 0.8 && remaining < 7) {
          const qState = useQueueStore.getState();
          if (qState.currentIndex < qState.items.length - 1) {
            lastSilenceSkipAt = nowMs;
            qState.goToNext();
          }
        }
      }
    }

    // A-B Loop enforcement
    if (
      soundState.status === 'playing' &&
      loopA !== null &&
      loopB !== null &&
      loopB > loopA + 0.5 &&
      soundState.seek >= loopB
    ) {
      useSoundStore.getState().seekTo(loopA);
      return;
    }

    // Record local listening seconds every 5s while playing for Wrapped Anytime
    const now = Date.now();
    if (soundState.status === 'playing' && now - lastStatsTickAt >= 5000) {
      const deltaSec = Math.min(15, (now - lastStatsTickAt) / 1000);
      lastStatsTickAt = now;
      const cur = useQueueStore.getState().getCurrentItem();
      if (cur?.track) {
        useWrappedStatsStore
          .getState()
          .recordListeningSeconds(cur.track, deltaSec);
      }
    } else if (soundState.status !== 'playing') {
      lastStatsTickAt = now;
    }

    if (
      sponsorBlockEnabled &&
      soundState.status === 'playing' &&
      sponsorSegments.length > 0
    ) {
      const pos = soundState.seek;
      for (const [start, end] of sponsorSegments) {
        if (
          pos >= start &&
          pos < end - 0.5 &&
          Math.abs(end - lastSkippedSegEnd) > 1
        ) {
          lastSkippedSegEnd = end;
          useSoundStore.getState().seekTo(end);
          toast.info(
            `⚡ SponsorBlock: Skipped non-music segment (${Math.round(end - start)}s)`,
          );
          break;
        }
      }
    }
  });

  const syncSideEffects = (
    state: ReturnType<typeof useMobileEnhancementsStore.getState>,
  ) => {
    syncAudioElementDsp();
    syncAmbientSoundSpace(state.ambientSpace, state.ambientVolume);
    try {
      window.NuclearAndroid?.setShakeToSkip?.(
        state.shakeToSkipEnabled,
        state.shakeSensitivity,
      );
    } catch {
      // ignore on desktop
    }
    if (typeof document !== 'undefined') {
      if (state.oledBlackMode) {
        document.documentElement.setAttribute('data-oled', 'true');
      } else {
        document.documentElement.removeAttribute('data-oled');
      }
    }
  };

  useMobileEnhancementsStore.subscribe(syncSideEffects);
  syncSideEffects(useMobileEnhancementsStore.getState());

  if (typeof window !== 'undefined') {
    window.setInterval(() => {
      const endAt = useMobileEnhancementsStore.getState().sleepEndAt;
      if (endAt && Date.now() >= endAt) {
        playbackManager.pause();
        useMobileEnhancementsStore.getState().setSleepEndAt(null);
        toast.info('🌙 Sleep timer finished — playback paused');
      }
    }, 5000);
  }
};
