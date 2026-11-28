import { useCallback, useEffect, useRef } from 'react';

import { useAudioEvents } from './hooks/useAudioEvents';
import { useAudioLoader } from './hooks/useAudioLoader';
import { useAudioSeek } from './hooks/useAudioSeek';
import { useHlsSource } from './hooks/useHlsSource';
import { useMseSource } from './hooks/useMseSource';
import { usePlaybackStatus } from './hooks/usePlaybackStatus';
import { useStartPosition } from './hooks/useStartPosition';
import { SoundProps } from './types';

const teardownAudioElement = (audio: HTMLAudioElement): void => {
  try {
    audio.pause();
    // Never mute the element during teardown: on Linux (WebKitGTK +
    // PipeWire/WirePlumber), muting <audio> persists `mute: true` for
    // `application.name="Nuclear"` and mutes the next track's `webaudio` sink.
    audio.srcObject = null;
    audio.removeAttribute('src');
    audio.replaceChildren();
    audio.load();
  } catch {
    // Ignore teardown errors on already-disposed elements
  }
};

export const Sound: React.FC<SoundProps> = ({
  src,
  status,
  seek,
  volume,
  preload = 'auto',
  crossOrigin = '',
  onTimeUpdate,
  onEnd,
  onLoadStart,
  onCanPlay,
  onError,
  onSourceInvalid,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isMountedRef = useRef(true);

  useAudioSeek(audioRef, seek);
  useStartPosition(audioRef, src);
  useAudioLoader(audioRef, src);
  useHlsSource(audioRef, src);
  useMseSource(audioRef, src, onError, onSourceInvalid);
  usePlaybackStatus(audioRef, status, src.url, onError);

  useEffect(() => {
    const audio = audioRef.current;
    isMountedRef.current = true;
    if (audio) {
      audio.muted = false;
    }
    return () => {
      isMountedRef.current = false;
      if (audio) {
        teardownAudioElement(audio);
      }
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || volume === undefined) {
      return;
    }

    audio.volume = Math.max(0, Math.min(1, volume / 100));
  }, [volume]);

  const handleEnded = useCallback(() => {
    if (!isMountedRef.current) {
      return;
    }
    onEnd?.();
  }, [onEnd]);

  const handleCanPlay = useCallback(() => {
    onCanPlay?.();
  }, [onCanPlay]);

  const handleLoadStart = useCallback(() => {
    onLoadStart?.();
  }, [onLoadStart]);

  const { handleTimeUpdate, handleError } = useAudioEvents({
    onTimeUpdate,
    onError,
  });

  return (
    <audio
      ref={audioRef}
      hidden
      preload={preload}
      crossOrigin={crossOrigin}
      onTimeUpdate={handleTimeUpdate}
      onEnded={handleEnded}
      onLoadStart={handleLoadStart}
      onCanPlay={handleCanPlay}
      onError={handleError}
    />
  );
};
