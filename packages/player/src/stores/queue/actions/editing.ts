import { produce } from 'immer';
import takeWhile from 'lodash-es/takeWhile';
import { v4 as uuidv4 } from 'uuid';
import { StateCreator } from 'zustand';

import type { QueueItem, Track } from '@nuclearplayer/model';
import { stripResolutionState } from '@nuclearplayer/model';

import { Logger } from '../../../services/logger';
import { playbackSettings } from '../../../services/playbackSettings';
import {
  clearAllOfflineBypass,
  clearOfflineBypass,
} from '../../../services/streamResolution/offlineBypass';
import { useSoundStore } from '../../soundStore';
import { withPersistence } from '../persistence';
import { PlayOrder } from '../playOrder';
import type { QueueStore } from '../types';

const createQueueItem = (track: Track): QueueItem => ({
  id: uuidv4(),
  track: stripResolutionState(track),
  status: 'idle',
  addedAtIso: new Date().toISOString(),
});

const updatePlayOrder = (
  state: QueueStore,
  update: (playOrder: PlayOrder) => PlayOrder,
) => {
  if (!playbackSettings.shuffleEnabled) {
    return;
  }
  const playOrder = update(
    new PlayOrder(state.playOrder, state.playCursor, state.playNextTailId),
  );
  state.playOrder = playOrder.itemIds;
  state.playCursor = playOrder.cursor;
  state.playNextTailId = playOrder.playNextTailId;
  if (playOrder.itemIds.length > 0) {
    state.currentIndex = state.items.findIndex(
      (item) => item.id === playOrder.currentItemId,
    );
  }
};

const insertTracks = (state: QueueStore, tracks: Track[], index: number) => {
  const newItems = tracks.map(createQueueItem);
  state.items.splice(index, 0, ...newItems);

  if (index <= state.currentIndex) {
    state.currentIndex += newItems.length;
  }

  return newItems.map((item) => item.id);
};

export const createEditingSlice: StateCreator<
  QueueStore,
  [],
  [],
  Pick<
    QueueStore,
    | 'addToQueue'
    | 'addNext'
    | 'addAt'
    | 'removeByIds'
    | 'removeByIndices'
    | 'clearQueue'
    | 'shuffleQueue'
    | 'reorder'
    | 'moveBefore'
  >
> = (set, get) => ({
  addToQueue: withPersistence(get, (tracks: Track[]) => {
    set(
      produce((state: QueueStore) => {
        const newItems = tracks.map(createQueueItem);
        state.items.push(...newItems);
        const newItemIds = newItems.map((item) => item.id);
        updatePlayOrder(state, (playOrder) => playOrder.shuffleIn(newItemIds));
      }),
    );
    Logger.queue.debug(`Added ${tracks.length} tracks to queue`);
  }),

  addNext: withPersistence(get, (tracks: Track[]) => {
    set(
      produce((state: QueueStore) => {
        const newItemIds = insertTracks(state, tracks, state.currentIndex + 1);
        updatePlayOrder(state, (playOrder) => playOrder.playNext(newItemIds));
      }),
    );
  }),

  addAt: withPersistence(get, (tracks: Track[], index: number) => {
    set(
      produce((state: QueueStore) => {
        const newItemIds = insertTracks(state, tracks, index);
        updatePlayOrder(state, (playOrder) => playOrder.shuffleIn(newItemIds));
      }),
    );
  }),

  removeByIds: withPersistence(get, (ids: string[]) => {
    const currentItem = get().getCurrentItem();
    const currentItemRemoved = currentItem && ids.includes(currentItem.id);

    set(
      produce((state: QueueStore) => {
        const idsSet = new Set(ids);
        const removedBeforeCurrent = state.items
          .slice(0, state.currentIndex)
          .filter((item) => idsSet.has(item.id)).length;

        state.items = state.items.filter((item) => !idsSet.has(item.id));
        state.currentIndex = Math.max(
          0,
          state.currentIndex - removedBeforeCurrent,
        );

        if (state.currentIndex >= state.items.length) {
          state.currentIndex = Math.max(0, state.items.length - 1);
        }

        updatePlayOrder(state, (playOrder) => playOrder.remove(ids));
      }),
    );

    if (currentItemRemoved || get().items.length === 0) {
      useSoundStore.getState().stop();
    }
    for (const id of ids) {
      clearOfflineBypass(id);
    }
  }),

  removeByIndices: (indices: number[]) => {
    const indicesSet = new Set(indices);
    const { items, removeByIds } = get();
    removeByIds(
      items.filter((_, index) => indicesSet.has(index)).map((item) => item.id),
    );
  },

  clearQueue: withPersistence(get, () => {
    const itemCount = get().items.length;
    clearAllOfflineBypass();
    set({
      items: [],
      currentIndex: 0,
      playOrder: [],
      playCursor: 0,
      playNextTailId: null,
    });
    useSoundStore.getState().stop();
    Logger.queue.info(`Cleared queue (${itemCount} items removed)`);
  }),

  shuffleQueue: withPersistence(get, (shuffleAll = false) => {
    const { items, currentIndex } = get();
    if (items.length <= 1) {
      return;
    }

    if (playbackSettings.shuffleEnabled) {
      const baseOrder = PlayOrder.fromQueue(items, currentIndex);
      const nextOrder = shuffleAll
        ? baseOrder.shuffleAll()
        : baseOrder.shuffle();
      const nextIndex = items.findIndex(
        (item) => item.id === nextOrder.currentItemId,
      );
      set({
        currentIndex: nextIndex === -1 ? 0 : nextIndex,
        playOrder: nextOrder.itemIds,
        playCursor: nextOrder.cursor,
        playNextTailId: nextOrder.playNextTailId,
      });
      return;
    }

    const copy = [...items];
    const head = shuffleAll ? [] : copy.splice(currentIndex, 1);
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    set({
      items: [...head, ...copy],
      currentIndex: 0,
    });
  }),

  reorder: withPersistence(get, (fromIndex: number, toIndex: number) => {
    set(
      produce((state: QueueStore) => {
        const [movedItem] = state.items.splice(fromIndex, 1);
        state.items.splice(toIndex, 0, movedItem);

        if (state.currentIndex === fromIndex) {
          state.currentIndex = toIndex;
        } else if (
          fromIndex < state.currentIndex &&
          toIndex >= state.currentIndex
        ) {
          state.currentIndex -= 1;
        } else if (
          fromIndex > state.currentIndex &&
          toIndex <= state.currentIndex
        ) {
          state.currentIndex += 1;
        }
      }),
    );
  }),

  moveBefore: withPersistence(
    get,
    (itemId: string, beforeItemId: string | null) => {
      const movedItem = get().getItemById(itemId);
      if (!movedItem || itemId === beforeItemId) {
        return;
      }
      const state = get();
      if (playbackSettings.shuffleEnabled && state.playOrder.length > 0) {
        const nextOrder = new PlayOrder(
          state.playOrder,
          state.playCursor,
          state.playNextTailId,
        ).moveBefore(itemId, beforeItemId);
        set({
          playOrder: nextOrder.itemIds,
          playCursor: nextOrder.cursor,
          playNextTailId: nextOrder.playNextTailId,
        });
        return;
      }

      const currentItemId = state.getCurrentItem()?.id;

      const otherItems = state.items.filter((item) => item.id !== itemId);
      const itemsBefore = takeWhile(
        otherItems,
        (item) => item.id !== beforeItemId,
      );
      const itemsAfter = otherItems.slice(itemsBefore.length);
      const items = [...itemsBefore, movedItem, ...itemsAfter];

      set({
        items,
        currentIndex: items.findIndex((item) => item.id === currentItemId),
      });
    },
  ),
});
