import { RefObject, useEffect, useRef } from 'react';

import { SoundStatus } from '../types';

const HAVE_FUTURE_DATA = 3;

const isReadyToPlay = (audio: HTMLAudioElement): boolean =>
  audio.readyState >= HAVE_FUTURE_DATA;

export const usePlaybackStatus = (
  audioRef: RefObject<HTMLAudioElement | null>,
  status: SoundStatus,
  srcUrl: string,
  onError?: (error: Error) => void,
) => {
  const activeSrcRef = useRef(srcUrl);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    let cancelled = false;
    const srcChanged = srcUrl !== activeSrcRef.current;

    const tryPlay = () => {
      if (cancelled || !isReadyToPlay(audio)) {
        return;
      }
      if (!audio.paused && !audio.ended) {
        return;
      }
      activeSrcRef.current = srcUrl;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise.then(
          () => {
            if (cancelled) {
              audio.pause();
            }
          },
          (err: DOMException) => {
            if (
              cancelled ||
              err.name === 'AbortError' ||
              err.name === 'NotSupportedError'
            ) {
              return;
            }
            onErrorRef.current?.(err);
          },
        );
      }
    };

    switch (status) {
      case 'playing': {
        if (!srcChanged) {
          tryPlay();
        }
        const onCanPlay = () => tryPlay();
        audio.addEventListener('canplay', onCanPlay);
        audio.addEventListener('loadeddata', onCanPlay);
        audio.addEventListener('seeked', onCanPlay);
        return () => {
          cancelled = true;
          audio.removeEventListener('canplay', onCanPlay);
          audio.removeEventListener('loadeddata', onCanPlay);
          audio.removeEventListener('seeked', onCanPlay);
        };
      }
      case 'paused': {
        audio.pause();
        return () => {
          cancelled = true;
        };
      }
      case 'stopped': {
        audio.pause();
        audio.currentTime = 0;
        return () => {
          cancelled = true;
        };
      }
    }
  }, [status, srcUrl, audioRef]);
};
