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

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const tryPlay = () => {
      if (!audio.paused) {
        return;
      }
      activeSrcRef.current = srcUrl;
      audio.play().then(undefined, (err: DOMException) => {
        if (err.name === 'AbortError' || err.name === 'NotSupportedError') {
          return;
        }
        if (isReadyToPlay(audio)) {
          onError?.(err);
        }
      });
    };

    switch (status) {
      case 'playing': {
        tryPlay();
        const onCanPlay = () => tryPlay();
        audio.addEventListener('canplay', onCanPlay);
        audio.addEventListener('loadeddata', onCanPlay);
        return () => {
          audio.removeEventListener('canplay', onCanPlay);
          audio.removeEventListener('loadeddata', onCanPlay);
        };
      }
      case 'paused': {
        audio.pause();
        return;
      }
      case 'stopped': {
        audio.pause();
        audio.currentTime = 0;
        return;
      }
    }
  }, [status, srcUrl, audioRef, onError]);
};
