import { LazyStore } from '@tauri-apps/plugin-store';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Track } from '@nuclearplayer/model';

import { resetInMemoryTauriStore } from '../test/utils/inMemoryTauriStore';
import { getTrackDownloadKey, useDownloadStore } from './downloadStore';

const makeTrack = (artist: string, title: string): Track => ({
  title,
  artists: [{ name: artist, roles: [] }],
  source: { provider: 'spotify', id: `${artist}-${title}` },
});

describe('downloadStore', () => {
  beforeEach(() => {
    resetInMemoryTauriStore();
    useDownloadStore.setState({
      items: {},
      downloadingKeys: {},
      isBatchDownloading: false,
      batchProgress: null,
    });
  });

  it('produces unique keys for distinct Cyrillic tracks', () => {
    const plastinki = makeTrack('Дурной Вкус', 'Пластинки');
    const shalandy = makeTrack('Марк Бернес', 'Шаланды полные кефали');
    const sudno = makeTrack('Molchat Doma', 'Судно (Борис Рыжий)');

    const keyPlastinki = getTrackDownloadKey(plastinki);
    const keyShalandy = getTrackDownloadKey(shalandy);
    const keySudno = getTrackDownloadKey(sudno);

    expect(keyPlastinki).not.toBe('_____450b8971');
    expect(keyShalandy).not.toBe('_____450b8971');
    expect(keyPlastinki).not.toBe(keyShalandy);
    expect(keyPlastinki).not.toBe(keySudno);
    expect(keyShalandy).not.toBe(keySudno);
    expect(keyPlastinki).toMatch(/^track_[0-9a-f]{8}$/);
  });

  it('migrates legacy colliding Cyrillic keys on loadFromDisk while preserving fileName', async () => {
    const store = new LazyStore('downloads.json');
    await store.set('items', {
      _____450b8971: {
        key: '_____450b8971',
        fileName: '_____450b8971.m4a',
        title: 'Пластинки',
        artist: 'Дурной Вкус',
        downloadedAtIso: '2026-11-25T10:00:00.000Z',
      },
    });

    await useDownloadStore.getState().loadFromDisk();

    const plastinki = makeTrack('Дурной Вкус', 'Пластинки');
    const otherRussian = makeTrack('Марк Бернес', 'Шаланды полные кефали');
    const expectedKey = getTrackDownloadKey(plastinki);

    const items = useDownloadStore.getState().items;
    expect(items['_____450b8971']).toBeUndefined();
    expect(items[expectedKey]).toBeDefined();
    expect(items[expectedKey].fileName).toBe('_____450b8971.m4a');
    expect(items[expectedKey].key).toBe(expectedKey);
    expect(useDownloadStore.getState().isDownloaded(plastinki)).toBe(true);
    expect(useDownloadStore.getState().isDownloaded(otherRussian)).toBe(false);
  });
});
