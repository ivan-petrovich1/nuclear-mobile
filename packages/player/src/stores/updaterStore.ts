import { openUrl } from '@tauri-apps/plugin-opener';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { toast } from 'sonner';
import { create } from 'zustand';

import { Logger } from '../services/logger';
import { errorMessage } from '../utils/errorMessage';
import { reportError } from '../utils/logging';
import { getSetting } from './settingsStore';

const CURRENT_RELEASE_VERSION = '1.0.3';
const GITHUB_LATEST_RELEASE_URL =
  'https://api.github.com/repos/ivan-petrovich1/nuclear-mobile/releases/latest';

const externalFallbackUpdates = new WeakSet<object>();

type GitHubReleaseAsset = {
  name?: string;
  browser_download_url?: string;
};

type GitHubLatestRelease = {
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  body?: string;
  assets?: GitHubReleaseAsset[];
};

const parseVersionTuple = (raw: string): [number, number, number] | null => {
  const cleaned = raw.trim().replace(/^v/i, '').split('-')[0];
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!match) {
    return null;
  }
  return [
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2], 10),
    Number.parseInt(match[3] ?? '0', 10),
  ];
};

const isNewerVersion = (candidate: string, current: string): boolean => {
  const a = parseVersionTuple(candidate);
  const b = parseVersionTuple(current);
  if (!a || !b) {
    return false;
  }
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) {
      return true;
    }
    if (a[i] < b[i]) {
      return false;
    }
  }
  return false;
};

const openDownloadUrl = async (url: string): Promise<void> => {
  const isAndroid =
    typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  if (isAndroid && window.NuclearAndroid?.openExternalUrl) {
    window.NuclearAndroid.openExternalUrl(url);
    return;
  }
  try {
    await openUrl(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

const checkGitHubReleaseFallback = async (): Promise<Update | null> => {
  const response = await fetch(GITHUB_LATEST_RELEASE_URL, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    return null;
  }
  const release = (await response.json()) as GitHubLatestRelease;
  const tag = release.tag_name ?? '';
  if (!tag || !isNewerVersion(tag, CURRENT_RELEASE_VERSION)) {
    return null;
  }

  const version = tag.replace(/^v/i, '');
  const isAndroid =
    typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const assets = release.assets ?? [];
  const preferredAsset = assets.find((asset) => {
    const name = (asset.name ?? '').toLowerCase();
    return isAndroid ? name.endsWith('.apk') : name.endsWith('.appimage');
  });
  const downloadUrl =
    preferredAsset?.browser_download_url ??
    release.html_url ??
    'https://github.com/ivan-petrovich1/nuclear-mobile/releases/latest';

  const syntheticUpdate = {
    version,
    currentVersion: CURRENT_RELEASE_VERSION,
    date: release.published_at ?? '',
    body: release.body ?? '',
    downloadAndInstall: async () => {
      await openDownloadUrl(downloadUrl);
      toast.info(
        isAndroid
          ? `Downloading Nuclear v${version} APK...`
          : `Opening Nuclear v${version} download...`,
      );
    },
  } as unknown as Update;

  externalFallbackUpdates.add(syntheticUpdate);
  return syntheticUpdate;
};

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

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
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
    const checkEnabled = getSetting('core.updates.checkForUpdates');
    if (checkEnabled === false) {
      return;
    }

    set({ isChecking: true, error: null });
    const isTestEnv = import.meta.env.MODE === 'test';

    let tauriCheckError: unknown = null;
    let update: Update | null = null;

    try {
      update = await check();
    } catch (error) {
      tauriCheckError = error;
    }

    if (update === null && !isTestEnv) {
      try {
        update = await checkGitHubReleaseFallback();
        tauriCheckError = null;
      } catch (fallbackError) {
        if (!tauriCheckError) {
          tauriCheckError = fallbackError;
        }
      }
    }

    if (tauriCheckError) {
      const message = errorMessage(tauriCheckError);
      Logger.updates.error(`Failed to check for updates: ${message}`);
      set({
        isChecking: false,
        lastChecked: new Date(),
        error: message,
      });
      return;
    }

    set({
      isUpdateAvailable: update !== null,
      updateInfo: update,
      lastChecked: new Date(),
      isChecking: false,
      error: null,
    });

    if (update !== null && !externalFallbackUpdates.has(update)) {
      const autoInstall = getSetting('core.updates.autoInstall');
      if (autoInstall === true) {
        await get().downloadUpdate();
      }
    }
  },

  downloadUpdate: async () => {
    const { updateInfo } = get();
    if (!updateInfo) {
      return;
    }

    set({ isDownloading: true, downloadProgress: 0, error: null });
    if (externalFallbackUpdates.has(updateInfo)) {
      try {
        await updateInfo.downloadAndInstall();
      } catch (error) {
        const message = errorMessage(error);
        Logger.updates.error(`Failed to open update download: ${message}`);
        set({ error: message });
      } finally {
        set({ isDownloading: false, isInstalling: false });
      }
      return;
    }

    let totalSize = 0;
    let downloadedSize = 0;
    try {
      await updateInfo.downloadAndInstall((event) => {
        if (event.event === 'Started' && event.data.contentLength) {
          totalSize = event.data.contentLength;
          set({ downloadProgress: 0 });
        } else if (event.event === 'Progress') {
          downloadedSize += event.data.chunkLength;
          const percentage =
            totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0;
          set({ downloadProgress: percentage });
        } else if (event.event === 'Finished') {
          set({
            isDownloading: false,
            isInstalling: false,
            isReadyToRestart: true,
            downloadProgress: 100,
          });
        }
      });
    } catch (error) {
      const message = errorMessage(error);
      Logger.updates.error(`Failed to download/install update: ${message}`);
      set({
        isDownloading: false,
        isInstalling: false,
        error: message,
      });
    }
  },

  restartToUpdate: async () => {
    try {
      await relaunch();
    } catch (error) {
      await reportError('updates', {
        userMessage: 'Failed to restart for update',
        error,
      });
      set({ error: errorMessage(error) });
    }
  },
}));
