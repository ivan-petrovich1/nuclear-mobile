import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AudioSource } from '@nuclearplayer/hifi';

import { useQueueStore } from '../../stores/queue/queueStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSoundStore } from '../../stores/soundStore';
import { createQueueItem } from '../../test/fixtures/queue';
import { resetInMemoryTauriStore } from '../../test/utils/inMemoryTauriStore';
import { eventBus } from '../eventBus';
import { PlaybackManager } from './playbackManager';

const DUMMY_SOURCE: AudioSource = { url: '/track.mp3', protocol: 'http' };

describe('PlaybackManager.finishTrack safeguards', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T12:00:00.000Z'));
    resetInMemoryTauriStore();
    useSettingsStore.setState({ definitions: {}, values: {}, loaded: true });
    useSoundStore.setState({
      src: null,
      status: 'stopped',
      seek: 0,
      duration: 0,
      crossfadeMs: 0,
      preload: 'auto',
      crossOrigin: '',
    });
    useQueueStore.setState(useQueueStore.getInitialState());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('advances only once when finishTrack is fired twice back-to-back', () => {
    const manager = new PlaybackManager();
    const a = createQueueItem('Track A');
    const b = createQueueItem('Track B');
    const c = createQueueItem('Track C');
    useQueueStore.getState().addToQueue([a.track, b.track, c.track]);

    const items = useQueueStore.getState().items;
    manager.startTrack(items[0], DUMMY_SOURCE, { autoPlay: true });

    manager.finishTrack();
    expect(useQueueStore.getState().getCurrentItem()?.track.title).toBe(
      'Track B',
    );

    // Second ended event firing before Track B finishes loading must not skip Track B
    manager.finishTrack();
    expect(useQueueStore.getState().getCurrentItem()?.track.title).toBe(
      'Track B',
    );
  });

  it('clears pendingAdvance once startTrack mounts the next track', () => {
    const manager = new PlaybackManager();
    const a = createQueueItem('Track A');
    const b = createQueueItem('Track B');
    const c = createQueueItem('Track C');
    useQueueStore.getState().addToQueue([a.track, b.track, c.track]);

    const items = useQueueStore.getState().items;
    manager.startTrack(items[0], DUMMY_SOURCE, { autoPlay: true });
    manager.finishTrack();
    expect(useQueueStore.getState().getCurrentItem()?.id).toBe(items[1].id);

    manager.startTrack(items[1], DUMMY_SOURCE, { autoPlay: true });
    manager.finishTrack();
    expect(useQueueStore.getState().getCurrentItem()?.id).toBe(items[2].id);
  });

  it('ignores finishTrack when mountedItemId belongs to a different item than currentItem', () => {
    const manager = new PlaybackManager();
    const a = createQueueItem('Track A');
    const b = createQueueItem('Track B');
    useQueueStore.getState().addToQueue([a.track, b.track]);

    const items = useQueueStore.getState().items;
    // Mount Track A, then externally advance queue to Track B without calling startTrack(B)
    manager.startTrack(items[0], DUMMY_SOURCE, { autoPlay: true });
    useQueueStore.getState().goToNext();
    expect(useQueueStore.getState().getCurrentItem()?.id).toBe(items[1].id);

    const finishedSpy = vi.fn();
    const unsub = eventBus.on('trackFinished', finishedSpy);
    try {
      manager.finishTrack();
      expect(finishedSpy).not.toHaveBeenCalled();
      expect(useQueueStore.getState().getCurrentItem()?.id).toBe(items[1].id);
    } finally {
      unsub();
    }
  });

  it('debounces rapid duplicate finishTrack within 1000ms in repeat-one mode, then allows loop after 1000ms', () => {
    const manager = new PlaybackManager();
    useSettingsStore.setState({ values: { 'core.playback.repeat': 'one' } });
    const loopTrack = createQueueItem('Loop Track');
    useQueueStore.getState().addToQueue([loopTrack.track]);

    const item = useQueueStore.getState().items[0];
    manager.startTrack(item, DUMMY_SOURCE, { autoPlay: true });

    const finishedSpy = vi.fn();
    const unsub = eventBus.on('trackFinished', finishedSpy);
    try {
      manager.finishTrack();
      expect(finishedSpy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(500);
      manager.finishTrack();
      expect(finishedSpy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(600);
      manager.finishTrack();
      expect(finishedSpy).toHaveBeenCalledTimes(2);
    } finally {
      unsub();
    }
  });

  it('keeps playback paused if pause() is called while stream is still resolving before startTrack', () => {
    const manager = new PlaybackManager();
    const a = createQueueItem('Slow Loading Track');
    useQueueStore.getState().addToQueue([a.track]);
    const item = useQueueStore.getState().items[0];

    manager.beginTrackLoad();
    manager.pause();

    manager.startTrack(item, DUMMY_SOURCE, { autoPlay: true });
    expect(useSoundStore.getState().status).toBe('paused');
  });
});
