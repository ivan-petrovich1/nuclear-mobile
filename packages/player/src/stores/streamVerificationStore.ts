import { LazyStore } from '@tauri-apps/plugin-store';
import omit from 'lodash-es/omit';
import { create } from 'zustand';

import type { Track } from '@nuclearplayer/model';

import { streamVerificationApi } from '../apis/streamVerificationApi';

const store = new LazyStore('stream-verifications.json');

type StreamVerificationState = {
  verifications: Record<string, string>;
  loaded: boolean;
  revision: number;
  isBusy: boolean;

  loadFromDisk: () => Promise<void>;
  saveVerification: (track: Track, streamId: string) => Promise<void>;
  removeVerification: (track: Track) => Promise<void>;
  bumpRevision: () => void;
  setBusy: (busy: boolean) => void;
};

export const useStreamVerificationStore = create<StreamVerificationState>(
  (set, get) => {
    const write = async (verifications: Record<string, string>) => {
      set((state) => ({ verifications, revision: state.revision + 1 }));
      await store.set('verifications', verifications);
      await store.save();
    };

    return {
      verifications: {},
      loaded: false,
      revision: 0,
      isBusy: false,

      loadFromDisk: async () => {
        const verifications =
          (await store.get<Record<string, string>>('verifications')) ?? {};
        set((state) => ({
          verifications,
          loaded: true,
          revision: state.revision + 1,
        }));
      },

      saveVerification: (track, streamId) =>
        write({
          ...get().verifications,
          [streamVerificationApi.verificationKey(track)]: streamId,
        }),

      removeVerification: (track) =>
        write(
          omit(
            get().verifications,
            streamVerificationApi.verificationKey(track),
          ),
        ),

      bumpRevision: () => set((state) => ({ revision: state.revision + 1 })),

      setBusy: (isBusy) => set({ isBusy }),
    };
  },
);

export const initializeStreamVerificationStore = async (): Promise<void> => {
  await useStreamVerificationStore.getState().loadFromDisk();
};
