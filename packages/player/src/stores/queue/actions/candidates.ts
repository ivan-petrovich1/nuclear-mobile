import { produce } from 'immer';
import partition from 'lodash-es/partition';
import { StateCreator } from 'zustand';

import type { QueueItem, StreamCandidate } from '@nuclearplayer/model';

import { bypassOfflineForItem } from '../../../services/streamResolution/offlineBypass';
import { withPersistence } from '../persistence';
import type { QueueStore } from '../types';

export const createCandidatesSlice: StateCreator<
  QueueStore,
  [],
  [],
  Pick<
    QueueStore,
    | 'updateItemState'
    | 'updateCandidate'
    | 'removeCandidate'
    | 'selectCandidate'
  >
> = (set, get) => ({
  updateItemState: withPersistence(
    get,
    (id: string, updates: Partial<QueueItem>) => {
      set(
        produce((state: QueueStore) => {
          const item = state.items.find((item) => item.id === id);
          if (item) {
            Object.assign(item, updates);
          }
        }),
      );
    },
  ),

  updateCandidate: (itemId: string, candidate: StreamCandidate) => {
    const item = get().getItemById(itemId);
    if (!item) {
      return;
    }
    const { track } = item;
    get().updateItemState(itemId, {
      track: {
        ...track,
        streamCandidates: track.streamCandidates?.map((current) => {
          if (current.id === candidate.id) {
            return candidate;
          }
          return current;
        }),
      },
    });
  },

  removeCandidate: (itemId: string, candidateId: string) => {
    const item = get().getItemById(itemId);
    if (!item) {
      return;
    }
    const { track } = item;
    get().updateItemState(itemId, {
      track: {
        ...track,
        streamCandidates: track.streamCandidates?.filter(
          (current) => current.id !== candidateId,
        ),
      },
    });
  },

  selectCandidate: (itemId: string, candidateId: string) => {
    const item = get().getItemById(itemId);
    if (!item) {
      return;
    }
    bypassOfflineForItem(itemId);
    const { track } = item;
    const [selected, rest] = partition(
      track.streamCandidates ?? [],
      (candidate) => candidate.id === candidateId,
    );
    const retried = selected.map((candidate) => ({
      ...candidate,
      failed: false,
      stream: candidate.stream?.url?.includes('/local/')
        ? undefined
        : candidate.stream,
    }));
    const shouldResetStatus =
      item.status === 'loading' ||
      item.status === 'error' ||
      get().getCurrentItem()?.id === itemId;
    get().updateItemState(itemId, {
      ...(shouldResetStatus ? { status: 'idle', error: undefined } : {}),
      track: { ...track, streamCandidates: [...retried, ...rest] },
    });
  },
});
