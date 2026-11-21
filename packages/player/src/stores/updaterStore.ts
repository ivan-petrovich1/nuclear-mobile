import type { Update } from '@tauri-apps/plugin-updater';
import { create } from 'zustand';

type UpdaterState = {
  isUpdateAvailable: boolean;
  updateInfo: Update | null;
  lastChecked: Date | null;
  isChecking: boolean;
  isDownloading: boolean;
  isInstalling: boolean;
  isReadyToRestart: boolean;
  downloadProgress: number;
  error: string | null;
  checkForUpdate: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  restartToUpdate: () => Promise<void>;
};

export const useUpdaterStore = create<UpdaterState>((set) => ({
  isUpdateAvailable: false,
  updateInfo: null,
  lastChecked: null,
  isChecking: false,
  isDownloading: false,
  isInstalling: false,
  isReadyToRestart: false,
  downloadProgress: 0,
  error: null,

  checkForUpdate: async () => {
    // Disabled in custom Nuclear build so upstream updates never overwrite custom features
    set({ isUpdateAvailable: false, updateInfo: null, isChecking: false });
  },

  downloadUpdate: async () => {
    // Disabled in custom Nuclear build
  },

  restartToUpdate: async () => {
    // Disabled in custom Nuclear build
  },
}));
