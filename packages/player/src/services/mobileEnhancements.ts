import { toast } from 'sonner';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { pickArtwork, type Track } from '@nuclearplayer/model';

import { useDownloadStore } from '../stores/downloadStore';
import { useQueueStore } from '../stores/queueStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSoundStore } from '../stores/soundStore';
import { haptic, initAndroidMediaBridge } from './androidMediaBridge';
import { triggerEndlessRadio } from './endlessRadio';
import { httpHost } from './httpHost';
import { initP2pSync } from './p2pSync';
import { playbackManager } from './playback';
import { type AmbientSpace, syncAmbientSoundSpace } from './soundSpaces';
import { useSpotifyAccountSyncStore } from './spotifyAccountSync';
import { candidatesForTrack } from './streamResolution/candidateSource';
import { hasFreshStream, streamingHost } from './streamingHost';
import { useWrappedStatsStore } from './wrappedStats';

export type LrcLine = {
  timeSec: number;
  text: string;
};

export type NowPlayingTab = 'player' | 'lyrics' | 'dsp' | 'queue';

export const EQ_FREQUENCIES = [60, 230, 910, 3600, 14000] as const;
export const EQ_LABELS = ['60Hz', '230Hz', '910Hz', '3.6kHz', '14kHz'] as const;

export const EQ_PRESETS: Record<
  string,
  [number, number, number, number, number]
> = {
  Flat: [0, 0, 0, 0, 0],
  'Bass Boost': [6, 4, 0, 1, 2],
  Vocal: [-2, 1, 5, 4, 1],
  Rock: [5, 3, -1, 3, 5],
  Electronic: [6, 3, 0, 2, 5],
};

type MobileEnhancementsState = {
  nowPlayingOpen: boolean;
  nowPlayingTab: NowPlayingTab;
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
  karaokeEnabled: boolean;
  crossfadeSeconds: number;
  silenceTrimEnabled: boolean;
  endlessRadioEnabled: boolean;

  setNowPlayingOpen: (open: boolean) => void;
  setNowPlayingTab: (tab: NowPlayingTab) => void;
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
  setKaraokeEnabled: (enabled: boolean) => void;
  setCrossfadeSeconds: (sec: number) => void;
  setSilenceTrimEnabled: (enabled: boolean) => void;
  setEndlessRadioEnabled: (enabled: boolean) => void;
};

export const useMobileEnhancementsStore = create<MobileEnhancementsState>()(
  persist(
    (set) => ({
      nowPlayingOpen: false,
      nowPlayingTab: 'player',
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
      karaokeEnabled: false,
      crossfadeSeconds: 0,
      silenceTrimEnabled: false,
      endlessRadioEnabled: false,

      setNowPlayingOpen: (nowPlayingOpen) => set({ nowPlayingOpen }),
      setNowPlayingTab: (nowPlayingTab) => set({ nowPlayingTab }),
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

const fetchLyricsForTrack = async (track: Track) => {
  useMobileEnhancementsStore.setState({
    lyricsLoading: true,
    syncedLyrics: [],
    plainLyrics: null,
  });
  const artist = track.artists?.[0]?.name ?? '';
  const title = track.title ?? '';
  try {
    const q = encodeURIComponent(`${artist} ${title}`.trim());
    const resp = await httpHost.fetch(
      `https://lrclib.net/api/search?q=${q}`,
      {
        headers: { 'User-Agent': 'NuclearPlayer/1.55.0' },
      },
    );
    if (resp.status === 200 && resp.body) {
      const results = JSON.parse(resp.body) as Array<{
        syncedLyrics?: string;
        plainLyrics?: string;
      }>;
      const withSynced = results.find((r) => Boolean(r.syncedLyrics));
      if (withSynced?.syncedLyrics) {
        useMobileEnhancementsStore.setState({
          syncedLyrics: parseLrc(withSynced.syncedLyrics),
          plainLyrics: withSynced.plainLyrics ?? null,
          lyricsLoading: false,
        });
        return;
      }
      const withPlain = results.find((r) => Boolean(r.plainLyrics));
      if (withPlain?.plainLyrics) {
        useMobileEnhancementsStore.setState({
          syncedLyrics: [],
          plainLyrics: withPlain.plainLyrics,
          lyricsLoading: false,
        });
        return;
      }
    }
  } catch {
    // Ignore lyrics lookup errors
  }
  useMobileEnhancementsStore.setState({
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
    const { items, currentIndex, updateItemState, updateCandidate } =
      useQueueStore.getState();
    const upcoming = [items[currentIndex + 1], items[currentIndex + 2]].filter(
      Boolean,
    );

    for (const nextItem of upcoming) {
      if (
        useDownloadStore.getState().isDownloaded(nextItem.track) ||
        nextItem.track.streamCandidates?.some((c) => !c.failed && hasFreshStream(c))
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
        const targetVol = audio.muted ? 0 : Math.max(0, Math.min(1, audio.volume));
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
      const targetVol = audio.muted ? 0 : Math.max(0, Math.min(1, audio.volume));
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
      artwork: cover ? [{ src: cover, sizes: '512x512', type: 'image/jpeg' }] : [],
    });

    navigator.mediaSession.setActionHandler('play', () => playbackManager.play());
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

  const onQueueChanged = () => {
    const currentItem = useQueueStore.getState().getCurrentItem();
    if (!currentItem) {
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
      useMobileEnhancementsStore.getState().clearLoop();
      useWrappedStatsStore.getState().recordTrackPlay(currentItem.track);
      void extractColorFromTrack(currentItem.track).then((dominantColor) => {
        useMobileEnhancementsStore.setState({ dominantColor });
      });
      void fetchLyricsForTrack(currentItem.track);
      syncMediaSessionMetadata(currentItem.track);

      const autoDownloadEnabled = Boolean(
        useSettingsStore.getState().getValue('core.playback.autoDownloadPlayed'),
      );
      if (autoDownloadEnabled) {
        void useDownloadStore
          .getState()
          .downloadTrack(currentItem.track, true);
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
};
