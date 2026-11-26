import type { AudioSource } from '@nuclearplayer/hifi';
import type { QueueItem, Track } from '@nuclearplayer/model';

import { useQueueStore } from '../../stores/queue/queueStore';
import { useSoundStore } from '../../stores/soundStore';
import { eventBus } from '../eventBus';
import { playbackSettings } from '../playbackSettings';

export type StartTrackOptions = {
  autoPlay: boolean;
};

export class PlaybackManager {
  private mountedItemId: string | null = null;
  private playRequested = false;
  private pauseRequested = false;
  private pendingAdvance = false;
  private lastFinishedItemId: string | null = null;
  private lastFinishedAt = 0;
  private prematureEofRetriedItemId: string | null = null;

  beginTrackLoad = (): void => {
    this.pauseRequested = false;
  };

  play = (): void => {
    this.pendingAdvance = false;
    this.pauseRequested = false;
    const { status } = useSoundStore.getState();
    if (status === 'playing') {
      return;
    }
    if (status === 'paused') {
      useSoundStore.getState().play();
      return;
    }

    const item = useQueueStore.getState().getCurrentItem();
    if (!item) {
      return;
    }
    if (this.mountedItemId !== item.id) {
      this.playRequested = true;
      return;
    }

    useSoundStore.getState().play();
    eventBus.emit('trackStarted', item.track);
  };

  playTracks = (tracks: Track[]): void => {
    const { clearQueue, addToQueue, shuffleQueue } = useQueueStore.getState();
    clearQueue();
    addToQueue(tracks);
    if (playbackSettings.shuffleEnabled && tracks.length > 1) {
      shuffleQueue(true);
    }
    this.play();
  };

  pause = (): void => {
    this.playRequested = false;
    this.pauseRequested = true;
    useSoundStore.getState().pause();
    if (typeof document !== 'undefined') {
      document.querySelectorAll('audio').forEach((el) => el.pause());
    }
  };

  toggle = (): void => {
    if (useSoundStore.getState().status === 'playing') {
      this.pause();
      return;
    }
    this.play();
  };

  startTrack = (
    item: QueueItem,
    source: AudioSource,
    options: StartTrackOptions,
  ): void => {
    useSoundStore.getState().setSrc(source);
    this.mountedItemId = item.id;
    this.pendingAdvance = false;
    this.lastFinishedItemId = null;
    this.lastFinishedAt = 0;

    const shouldPlay =
      !this.pauseRequested && (options.autoPlay || this.playRequested);
    this.playRequested = false;
    this.pauseRequested = false;

    if (!shouldPlay) {
      return;
    }

    useSoundStore.getState().play();

    const isResumingMidTrack = source.startPositionSeconds !== undefined;
    if (isResumingMidTrack) {
      return;
    }

    eventBus.emit('trackStarted', item.track);
  };

  finishTrack = (): void => {
    const item = useQueueStore.getState().getCurrentItem();
    if (!item) {
      return;
    }
    if (this.pendingAdvance) {
      return;
    }
    if (this.mountedItemId !== null && this.mountedItemId !== item.id) {
      return;
    }
    const now = Date.now();
    if (
      this.lastFinishedItemId === item.id &&
      now - this.lastFinishedAt < 1000
    ) {
      return;
    }
    this.lastFinishedItemId = item.id;
    this.lastFinishedAt = now;

    const { duration, seek } = useSoundStore.getState();
    if (
      duration > 30 &&
      seek > 0 &&
      seek < duration - 15 &&
      this.prematureEofRetriedItemId !== item.id
    ) {
      this.prematureEofRetriedItemId = item.id;
      this.mountedItemId = null;
      useSoundStore.getState().setSrc(null);
      useQueueStore
        .getState()
        .updateItemState(item.id, { status: 'idle', error: undefined });
      return;
    }

    eventBus.emit('trackFinished', item.track);

    if (playbackSettings.repeatMode === 'one') {
      useSoundStore.getState().seekTo(0);
      useSoundStore.getState().play();
      if (typeof document !== 'undefined') {
        const audio = document.querySelector('audio');
        if (audio) {
          const restartAudio = () => {
            if (useSoundStore.getState().status !== 'playing') {
              return;
            }
            void audio.play().catch(() => {});
          };
          audio.pause();
          audio.currentTime = 0;
          audio.addEventListener('seeked', restartAudio, { once: true });
          restartAudio();
        }
      }
      eventBus.emit('trackStarted', item.track);
      return;
    }

    this.mountedItemId = null;
    useQueueStore.getState().goToNext();
    const nextItem = useQueueStore.getState().getCurrentItem();
    if (nextItem && nextItem.id !== item.id) {
      this.pendingAdvance = true;
    }
  };

  sourceReady = (): void => {
    this.updateMountedItem({ status: 'success' });
  };

  sourceFailed = (message: string): void => {
    this.updateMountedItem({ status: 'error', error: message });
  };

  private updateMountedItem(updates: Partial<QueueItem>): void {
    if (!this.mountedItemId) {
      return;
    }
    useQueueStore.getState().updateItemState(this.mountedItemId, updates);
  }
}

export const playbackManager = new PlaybackManager();
