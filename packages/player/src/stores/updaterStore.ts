import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { toast } from 'sonner';
import { create } from 'zustand';

import { Logger } from '../services/logger';
import { errorMessage } from '../utils/errorMessage';
import { reportError } from '../utils/logging';
import { getSetting } from './settingsStore';

export const CURRENT_RELEASE_VERSION = '1.1.2';
const GITHUB_LATEST_RELEASE_URL =
  'https://api.github.com/repos/ivan-petrovich1/nuclear-mobile/releases/latest';

const externalFallbackUpdates = new WeakSet<object>();
const externalFallbackUrls = new WeakMap<object, string>();

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

type RuntimePlatformInfo = {
  os: string;
  arch: string;
  package_type: string;
};

const pickBestReleaseAsset = (
  assets: GitHubReleaseAsset[],
  platform: RuntimePlatformInfo,
): GitHubReleaseAsset | undefined => {
  const byExt = (ext: string, filterFn?: (lowerName: string) => boolean) =>
    assets.find((asset) => {
      const lower = (asset.name ?? '').toLowerCase();
      return lower.endsWith(ext) && (filterFn ? filterFn(lower) : true);
    });

  if (platform.os === 'android') {
    return byExt('.apk');
  }

  const isArm = platform.arch === 'aarch64' || platform.arch === 'arm64';
  const matchesArch = (lowerName: string) =>
    isArm ? /arm64|aarch64/.test(lowerName) : !/arm64|aarch64/.test(lowerName);

  if (platform.os === 'windows') {
    return (
      byExt('.exe', matchesArch) ??
      byExt('.msi', matchesArch) ??
      byExt('.exe') ??
      byExt('.msi')
    );
  }

  if (platform.os === 'macos') {
    return byExt('.dmg', matchesArch) ?? byExt('.dmg');
  }

  if (platform.package_type === 'deb') {
    return byExt('.deb', matchesArch) ?? byExt('.appimage', matchesArch);
  }
  if (platform.package_type === 'rpm') {
    return byExt('.rpm', matchesArch) ?? byExt('.appimage', matchesArch);
  }
  return byExt('.appimage', matchesArch);
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
  const platform = (await invoke<RuntimePlatformInfo>(
    'get_runtime_platform',
  ).catch(() => null)) ?? {
    os: isAndroid
      ? 'android'
      : typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent)
        ? 'windows'
        : typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)
          ? 'macos'
          : 'linux',
    arch: 'x86_64',
    package_type: isAndroid ? 'apk' : 'appimage',
  };
  const preferredAsset = pickBestReleaseAsset(assets, platform);
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
  externalFallbackUrls.set(syntheticUpdate, downloadUrl);
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

    if (isTestEnv) {
      try {
        update = await check();
      } catch (error) {
        tauriCheckError = error;
      }
    } else {
      try {
        update = await checkGitHubReleaseFallback();
      } catch (fallbackError) {
        tauriCheckError = fallbackError;
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

    const isAndroid =
      typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
    if (
      update !== null &&
      (!externalFallbackUpdates.has(update) || !isAndroid)
    ) {
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
      const isAndroid =
        typeof navigator !== 'undefined' &&
        /Android/i.test(navigator.userAgent);
      const url = externalFallbackUrls.get(updateInfo);

      if (isAndroid && url && window.NuclearAndroid?.downloadAndInstallApk) {
        try {
          window.NuclearAndroid.downloadAndInstallApk(url);
        } catch (error) {
          const message = errorMessage(error);
          Logger.updates.error(`Failed to start APK update: ${message}`);
          set({ isDownloading: false, isInstalling: false, error: message });
        }
        return;
      }

      let unlisten: (() => void) | undefined;
      try {
        if (!isAndroid && url) {
          const lowerUrl = url.toLowerCase();
          if (lowerUrl.endsWith('.exe')) {
            unlisten = await listen<number>('appimage-update-progress', (e) => {
              set({ downloadProgress: e.payload });
            }).catch(() => undefined);
            const launched = await invoke<boolean>('self_update_windows', {
              url,
            }).catch(() => false);
            if (launched === true) {
              return;
            }
          } else if (lowerUrl.endsWith('.dmg')) {
            unlisten = await listen<number>('appimage-update-progress', (e) => {
              set({ downloadProgress: e.payload });
            }).catch(() => undefined);
            const opened = await invoke<boolean>('self_update_macos', {
              url,
            }).catch(() => false);
            if (opened === true) {
              toast.success(
                `Downloaded Nuclear v${updateInfo.version} — drag Nuclear to Applications in the opened installer`,
              );
              return;
            }
          } else if (lowerUrl.endsWith('.appimage')) {
            unlisten = await listen<number>('appimage-update-progress', (e) => {
              set({ downloadProgress: e.payload });
            }).catch(() => undefined);
            const updatedInPlace = await invoke<boolean>(
              'self_update_appimage',
              { url },
            ).catch(() => false);
            if (updatedInPlace === true) {
              toast.success(
                `Updated AppImage to v${updateInfo.version} — click Restart to apply`,
              );
              set({
                isDownloading: false,
                isInstalling: false,
                isReadyToRestart: true,
                downloadProgress: 100,
              });
              return;
            }
          }
        }
        await updateInfo.downloadAndInstall();
      } catch (error) {
        const message = errorMessage(error);
        Logger.updates.error(`Failed to open update download: ${message}`);
        set({ error: message });
      } finally {
        unlisten?.();
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
      const relaunched = await invoke<boolean>('relaunch_appimage').catch(
        () => false,
      );
      if (relaunched === true) {
        return;
      }
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

if (typeof window !== 'undefined') {
  window.__NUCLEAR_UPDATE_PROGRESS__ = (
    pct: number,
    status: string,
    message: string,
  ) => {
    if (status === 'downloading') {
      useUpdaterStore.setState({
        isDownloading: true,
        downloadProgress: pct,
        error: null,
      });
    } else if (status === 'permission') {
      toast.info(
        message || 'Allow installing updates once, then return to Nuclear',
      );
      useUpdaterStore.setState({ isDownloading: false, downloadProgress: 100 });
    } else if (status === 'installing') {
      toast.success('Installing update...');
      useUpdaterStore.setState({ isDownloading: false, downloadProgress: 100 });
    } else if (status === 'error') {
      toast.error(`Update failed: ${message || 'Download error'}`);
      useUpdaterStore.setState({
        isDownloading: false,
        error: message || 'Download failed',
      });
    }
  };
}
