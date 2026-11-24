import type { Track } from '@nuclearplayer/model';
import { pickArtwork } from '@nuclearplayer/model';

import { useQueueStore } from '../stores/queue/queueStore';
import { getSetting } from '../stores/settingsStore';
import { useSoundStore } from '../stores/soundStore';
import { playbackManager } from './playback';

/**
 * Mirrors playback state into the native Android MediaSession
 * (notification player, lock screen, quick-settings media, Samsung Now Bar,
 * Bluetooth / headphone buttons, watches, car head units) and routes the
 * system's transport actions back into the player.
 */

type Snapshot = {
  itemId: string;
  isPlaying: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  durationMs: number;
  artworkUrl: string;
};

const bridge = () =>
  typeof window !== 'undefined' &&
  typeof window.NuclearAndroid?.updateMediaSession === 'function'
    ? window.NuclearAndroid
    : undefined;

export const haptic = (kind: 'light' | 'medium' | 'heavy' = 'light') => {
  try {
    if (window.NuclearAndroid?.haptic) {
      window.NuclearAndroid.haptic(kind);
      return;
    }
    navigator.vibrate?.(kind === 'heavy' ? 25 : kind === 'medium' ? 15 : 8);
  } catch {
    // haptics are best-effort
  }
};

const artworkFor = (track: Track) =>
  pickArtwork(track.artwork, 'cover', 512)?.url ??
  pickArtwork(track.album?.artwork, 'cover', 512)?.url ??
  pickArtwork(track.artwork, 'thumbnail', 512)?.url ??
  pickArtwork(track.album?.artwork, 'thumbnail', 512)?.url ??
  '';

let initialized = false;

export const initAndroidMediaBridge = () => {
  const native = bridge();
  if (initialized || !native) {
    return;
  }
  initialized = true;

  window.__NUCLEAR_MEDIA_ACTION__ = (action, positionMs) => {
    const queue = useQueueStore.getState();
    switch (action) {
      case 'play':
        playbackManager.play();
        break;
      case 'pause':
        playbackManager.pause();
        break;
      case 'next':
        queue.goToNext();
        break;
      case 'previous':
        // Behave like every other player: restart the track if we're past 3s.
        if (useSoundStore.getState().seek > 3) {
          useSoundStore.getState().seekTo(0);
        } else {
          queue.goToPrevious();
        }
        break;
      case 'seek':
        useSoundStore.getState().seekTo(positionMs / 1000);
        break;
    }
  };

  let last: Snapshot | undefined;
  let lastSeekSec = 0;
  let lastPushAt = 0;

  const push = (force = false) => {
    const queue = useQueueStore.getState();
    const item = queue.getCurrentItem();
    const sound = useSoundStore.getState();

    if (!item) {
      if (last) {
        native.clearMediaSession?.();
        last = undefined;
      }
      return;
    }

    const repeatAll =
      ((getSetting('core.playback.repeat') as string) ?? 'off') === 'all';
    const snapshot: Snapshot = {
      itemId: item.id,
      isPlaying: sound.status === 'playing',
      hasPrevious: true,
      hasNext: queue.currentIndex < queue.items.length - 1 || repeatAll,
      durationMs: Math.round(
        (sound.duration || (item.track.durationMs ?? 0) / 1000) * 1000,
      ),
      artworkUrl: artworkFor(item.track),
    };

    // Detect user seeks: position jumped relative to wall-clock extrapolation.
    const now = Date.now();
    const expected =
      lastSeekSec + (last?.isPlaying ? (now - lastPushAt) / 1000 : 0);
    const seeked = Math.abs(sound.seek - expected) > 2.5;

    const changed =
      force ||
      !last ||
      seeked ||
      last.itemId !== snapshot.itemId ||
      last.isPlaying !== snapshot.isPlaying ||
      last.hasNext !== snapshot.hasNext ||
      last.artworkUrl !== snapshot.artworkUrl ||
      Math.abs(last.durationMs - snapshot.durationMs) > 1000;

    lastSeekSec = sound.seek;
    lastPushAt = now;
    if (!changed) {
      return;
    }
    last = snapshot;

    const track = item.track;
    try {
      native.updateMediaSession?.(
        track.title ?? 'Unknown track',
        track.artists?.map((a) => a.name).join(', ') || 'Unknown artist',
        track.album?.title ?? '',
        snapshot.artworkUrl,
        snapshot.isPlaying,
        Math.max(0, Math.round(sound.seek * 1000)),
        snapshot.durationMs,
        snapshot.hasPrevious,
        snapshot.hasNext,
      );
    } catch {
      // Native bridge unavailable (e.g. during reload) — try again next tick.
      last = undefined;
    }
  };

  useQueueStore.subscribe(() => push());
  useSoundStore.subscribe(() => push());
  push(true);
};
