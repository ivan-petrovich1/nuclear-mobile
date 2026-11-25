import { MicVocal, X } from 'lucide-react';
import { FC } from 'react';

import { useCurrentQueueItem } from '../hooks/useCurrentQueueItem';
import {
  getActiveLyricLine,
  useMobileEnhancementsStore,
} from '../services/mobileEnhancements';
import { useSoundStore } from '../stores/soundStore';

type LiveLyricTickerProps = {
  variant: 'desktop' | 'mobile';
};

export const LiveLyricTicker: FC<LiveLyricTickerProps> = ({ variant }) => {
  const currentItem = useCurrentQueueItem();
  const floatingLyricsEnabled = useMobileEnhancementsStore(
    (s) => s.floatingLyricsEnabled,
  );
  const nowPlayingOpen = useMobileEnhancementsStore((s) => s.nowPlayingOpen);
  const lyricsTrackItemId = useMobileEnhancementsStore(
    (s) => s.lyricsTrackItemId,
  );
  const syncedLyrics = useMobileEnhancementsStore((s) => s.syncedLyrics);
  const dominantColor = useMobileEnhancementsStore((s) => s.dominantColor);
  const setNowPlayingOpen = useMobileEnhancementsStore(
    (s) => s.setNowPlayingOpen,
  );
  const setNowPlayingTab = useMobileEnhancementsStore(
    (s) => s.setNowPlayingTab,
  );
  const setFloatingLyricsEnabled = useMobileEnhancementsStore(
    (s) => s.setFloatingLyricsEnabled,
  );
  const seek = useSoundStore((s) => s.seek);
  const isPlaying = useSoundStore((s) => s.status === 'playing');

  if (
    !floatingLyricsEnabled ||
    !currentItem ||
    lyricsTrackItemId !== currentItem.id ||
    syncedLyrics.length === 0 ||
    (variant === 'mobile' && nowPlayingOpen)
  ) {
    return null;
  }

  const { current, next } = getActiveLyricLine(syncedLyrics, seek);
  const displayLine = current?.text || next?.text || syncedLyrics[0]?.text;
  if (!displayLine) {
    return null;
  }

  const openFullLyrics = () => {
    setNowPlayingTab('lyrics');
    setNowPlayingOpen(true);
  };

  return (
    <div
      data-testid="live-lyric-ticker"
      className={`border-border/40 flex items-center justify-between gap-2 border-t px-3 transition-colors ${
        variant === 'desktop' ? 'h-7 text-xs' : 'h-6 text-[11px]'
      }`}
      style={{
        background: `linear-gradient(90deg, ${dominantColor}22, rgba(0,0,0,0.35), ${dominantColor}22)`,
      }}
    >
      <button
        type="button"
        onClick={openFullLyrics}
        className="flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 text-center hover:opacity-100"
        title="Click to open full synced lyrics"
      >
        <MicVocal
          size={variant === 'desktop' ? 13 : 11}
          className={`text-primary shrink-0 ${isPlaying ? 'animate-pulse' : 'opacity-70'}`}
        />
        <span className="truncate font-semibold tracking-tight">
          {displayLine}
        </span>
        {variant === 'desktop' && current && next?.text && (
          <span className="hidden truncate text-[11px] opacity-45 xl:inline">
            • {next.text}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => setFloatingLyricsEnabled(false)}
        aria-label="Hide live lyric bar"
        title="Hide live lyric bar"
        className="flex size-5 shrink-0 items-center justify-center rounded opacity-55 transition hover:bg-white/10 hover:opacity-100"
      >
        <X size={11} />
      </button>
    </div>
  );
};
