import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { pickArtwork, type Track } from '@nuclearplayer/model';

export type ArtistStat = {
  name: string;
  plays: number;
  seconds: number;
};

export type TrackStat = {
  key: string;
  title: string;
  artist: string;
  coverUrl?: string;
  plays: number;
  seconds: number;
};

export type ListeningPersona = {
  title: string;
  emoji: string;
  subtitle: string;
};

type WrappedStatsState = {
  totalSeconds: number;
  totalPlays: number;
  artistStats: Record<string, ArtistStat>;
  trackStats: Record<string, TrackStat>;
  /** 24 buckets (0..23) of listening seconds by hour of day */
  hourBuckets: number[];
  /** Sorted unique YYYY-MM-DD dates listened */
  activeDays: string[];

  recordTrackPlay: (track: Track) => void;
  recordListeningSeconds: (track: Track, deltaSec: number) => void;
  resetStats: () => void;
};

const todayKey = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const trackKeyOf = (track: Track) => {
  const artist = track.artists?.[0]?.name || 'Unknown';
  return `${track.title.toLowerCase().trim()}::${artist.toLowerCase().trim()}`;
};

export const computeListeningStreak = (activeDays: string[]): number => {
  if (activeDays.length === 0) {
    return 0;
  }
  const set = new Set(activeDays);
  const d = new Date();
  const keyOf = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

  if (!set.has(keyOf(d))) {
    d.setDate(d.getDate() - 1);
    if (!set.has(keyOf(d))) {
      return 0;
    }
  }
  let streak = 0;
  while (set.has(keyOf(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
};

export const computeListeningPersona = (
  hourBuckets: number[],
): ListeningPersona => {
  const total = hourBuckets.reduce((a, b) => a + b, 0);
  if (total < 30) {
    return {
      title: 'Fresh Ears',
      emoji: '🎧',
      subtitle: 'Play a few tracks to unlock your listening vibe',
    };
  }
  let peakHour = 0;
  for (let h = 1; h < 24; h++) {
    if ((hourBuckets[h] ?? 0) > (hourBuckets[peakHour] ?? 0)) {
      peakHour = h;
    }
  }
  if (peakHour >= 0 && peakHour < 5) {
    return {
      title: 'Midnight Dreamer',
      emoji: '🌙',
      subtitle: `Peak vibe around ${peakHour}:00 — late-night headphones mode`,
    };
  }
  if (peakHour >= 5 && peakHour < 11) {
    return {
      title: 'Early Bird',
      emoji: '🌅',
      subtitle: `Peak vibe around ${peakHour}:00 — starting the day with music`,
    };
  }
  if (peakHour >= 11 && peakHour < 17) {
    return {
      title: 'Afternoon Cruiser',
      emoji: '☀️',
      subtitle: `Peak vibe around ${peakHour}:00 — soundtrack for the grind`,
    };
  }
  return {
    title: 'Night Owl',
    emoji: '🦉',
    subtitle: `Peak vibe around ${peakHour}:00 — evening sessions hit different`,
  };
};

export const useWrappedStatsStore = create<WrappedStatsState>()(
  persist(
    (set) => ({
      totalSeconds: 0,
      totalPlays: 0,
      artistStats: {},
      trackStats: {},
      hourBuckets: Array.from({ length: 24 }, () => 0),
      activeDays: [],

      recordTrackPlay: (track) =>
        set((state) => {
          const tKey = trackKeyOf(track);
          const artistName =
            track.artists?.map((a) => a.name).join(', ') || 'Unknown Artist';
          const primaryArtist = track.artists?.[0]?.name || 'Unknown Artist';
          const aKey = primaryArtist.toLowerCase().trim();
          const coverUrl =
            pickArtwork(track.artwork, 'thumbnail', 256)?.url ??
            pickArtwork(track.album?.artwork, 'thumbnail', 256)?.url;
          const today = todayKey();
          const activeDays = state.activeDays.includes(today)
            ? state.activeDays
            : [...state.activeDays, today].slice(-365);

          const prevArtist = state.artistStats[aKey] ?? {
            name: primaryArtist,
            plays: 0,
            seconds: 0,
          };
          const prevTrack = state.trackStats[tKey] ?? {
            key: tKey,
            title: track.title,
            artist: artistName,
            coverUrl,
            plays: 0,
            seconds: 0,
          };

          return {
            totalPlays: state.totalPlays + 1,
            activeDays,
            artistStats: {
              ...state.artistStats,
              [aKey]: { ...prevArtist, plays: prevArtist.plays + 1 },
            },
            trackStats: {
              ...state.trackStats,
              [tKey]: {
                ...prevTrack,
                coverUrl: prevTrack.coverUrl ?? coverUrl,
                plays: prevTrack.plays + 1,
              },
            },
          };
        }),

      recordListeningSeconds: (track, deltaSec) => {
        if (deltaSec <= 0 || deltaSec > 30) {
          return;
        }
        set((state) => {
          const tKey = trackKeyOf(track);
          const primaryArtist = track.artists?.[0]?.name || 'Unknown Artist';
          const artistName =
            track.artists?.map((a) => a.name).join(', ') || 'Unknown Artist';
          const aKey = primaryArtist.toLowerCase().trim();
          const hour = new Date().getHours();
          const buckets = [...state.hourBuckets];
          buckets[hour] = (buckets[hour] ?? 0) + deltaSec;

          const prevArtist = state.artistStats[aKey] ?? {
            name: primaryArtist,
            plays: 1,
            seconds: 0,
          };
          const prevTrack = state.trackStats[tKey] ?? {
            key: tKey,
            title: track.title,
            artist: artistName,
            plays: 1,
            seconds: 0,
          };

          const today = todayKey();
          const activeDays = state.activeDays.includes(today)
            ? state.activeDays
            : [...state.activeDays, today].slice(-365);

          return {
            totalSeconds: state.totalSeconds + deltaSec,
            hourBuckets: buckets,
            activeDays,
            artistStats: {
              ...state.artistStats,
              [aKey]: {
                ...prevArtist,
                seconds: prevArtist.seconds + deltaSec,
              },
            },
            trackStats: {
              ...state.trackStats,
              [tKey]: {
                ...prevTrack,
                seconds: prevTrack.seconds + deltaSec,
              },
            },
          };
        });
      },

      resetStats: () =>
        set({
          totalSeconds: 0,
          totalPlays: 0,
          artistStats: {},
          trackStats: {},
          hourBuckets: Array.from({ length: 24 }, () => 0),
          activeDays: [],
        }),
    }),
    {
      name: 'nuclear-wrapped-stats-v1',
    },
  ),
);
