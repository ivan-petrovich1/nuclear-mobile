import { appDataDir, join } from '@tauri-apps/api/path';
import { BaseDirectory, remove } from '@tauri-apps/plugin-fs';
import { LazyStore } from '@tauri-apps/plugin-store';
import { toast } from 'sonner';
import { create } from 'zustand';

import type { StreamCandidate, Track } from '@nuclearplayer/model';

import { candidatesForTrack } from '../services/streamResolution/candidateSource';
import { hasFreshStream, streamingHost } from '../services/streamingHost';
import { downloadFile } from '../services/tauri/commands';
import { getSetting } from './settingsStore';

declare global {
  interface Window {
    NuclearAndroid?: {
      exportToPublicDownloads: (
        sourcePath: string,
        displayName: string,
        mimeType: string,
      ) => string;
      updateMediaSession?: (
        title: string,
        artist: string,
        album: string,
        artworkUrl: string,
        isPlaying: boolean,
        positionMs: number,
        durationMs: number,
        hasPrevious: boolean,
        hasNext: boolean,
      ) => void;
      clearMediaSession?: () => void;
      haptic?: (kind: 'light' | 'medium' | 'heavy') => void;
      setShakeToSkip?: (
        enabled: boolean,
        sensitivity: 'low' | 'medium' | 'high',
      ) => void;
      shareImageBase64?: (
        dataUrl: string,
        fileName: string,
        caption: string,
      ) => string;
      isIgnoringBatteryOptimizations?: () => boolean;
      requestIgnoreBatteryOptimizations?: () => void;
      openExternalUrl?: (url: string) => void;
      downloadAndInstallApk?: (apkUrl: string) => void;
    };
    __NUCLEAR_MEDIA_ACTION__?: (action: string, positionMs: number) => void;
    __NUCLEAR_SHAKE_SKIP__?: () => void;
    __NUCLEAR_UPDATE_PROGRESS__?: (
      pct: number,
      status: string,
      message: string,
    ) => void;
  }
}

const DOWNLOADS_STORE_FILE = 'downloads.json';
const DOWNLOADS_DIR_NAME = 'downloads';
const store = new LazyStore(DOWNLOADS_STORE_FILE);

export type DownloadedTrackInfo = {
  key: string;
  fileName: string;
  title: string;
  artist: string;
  durationMs?: number;
  container?: string;
  codec?: string;
  downloadedAtIso: string;
};

type DownloadStoreState = {
  items: Record<string, DownloadedTrackInfo>;
  downloadingKeys: Record<string, boolean>;
  isBatchDownloading: boolean;
  batchProgress: { completed: number; total: number } | null;
  loadFromDisk: () => Promise<void>;
  isDownloaded: (track: Track) => boolean;
  isDownloading: (track: Track) => boolean;
  getDownloadedInfo: (track: Track) => DownloadedTrackInfo | undefined;
  downloadTrack: (track: Track, silent?: boolean) => Promise<boolean>;
  downloadTracks: (tracks: Track[]) => Promise<void>;
  removeDownload: (track: Track) => Promise<void>;
  clearAllDownloads: () => Promise<void>;
};

export const getTrackDownloadKey = (track: Track): string => {
  const artist = (track.artists?.[0]?.name ?? 'unknown')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_');
  const title = (track.title ?? 'unknown')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_');
  const raw = `${artist}__${title}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `${raw.slice(0, 48)}_${hex}`;
};

const resolveDownloadCandidates = async (
  track: Track,
): Promise<StreamCandidate[]> => {
  const freshExisting = (track.streamCandidates ?? []).filter(
    (c) => !c.failed && hasFreshStream(c) && c.stream?.protocol !== 'hls',
  );
  if (freshExisting.length > 0) {
    return freshExisting;
  }

  const candidates = await candidatesForTrack({
    ...track,
    streamCandidates: undefined,
  });
  if (!candidates?.length) {
    return [];
  }

  const resolvedList: StreamCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.failed) {
      continue;
    }
    const resolved = await streamingHost.resolveStreamForCandidate(candidate);
    if (
      resolved &&
      !resolved.failed &&
      resolved.stream?.url &&
      resolved.stream.protocol !== 'hls'
    ) {
      resolvedList.push(resolved);
      if (resolvedList.length >= 2) {
        break;
      }
    }
  }
  return resolvedList;
};

const persistItems = async (items: Record<string, DownloadedTrackInfo>) => {
  try {
    await store.set('items', items);
    await store.save();
  } catch {
    // Ignore store save errors
  }
};

export const useDownloadStore = create<DownloadStoreState>((set, get) => ({
  items: {},
  downloadingKeys: {},
  isBatchDownloading: false,
  batchProgress: null,

  loadFromDisk: async () => {
    try {
      const saved =
        await store.get<Record<string, DownloadedTrackInfo>>('items');
      if (saved && typeof saved === 'object') {
        set({ items: saved });
      }
    } catch {
      // Ignore on fresh install
    }
  },

  isDownloaded: (track: Track) => {
    const key = getTrackDownloadKey(track);
    return Boolean(get().items[key]);
  },

  isDownloading: (track: Track) => {
    const key = getTrackDownloadKey(track);
    return Boolean(get().downloadingKeys[key]);
  },

  getDownloadedInfo: (track: Track) => {
    const key = getTrackDownloadKey(track);
    return get().items[key];
  },

  downloadTrack: async (track: Track, silent = false) => {
    const key = getTrackDownloadKey(track);
    if (get().items[key]) {
      if (!silent) {
        toast.info(`Already downloaded: ${track.title}`);
      }
      return true;
    }
    if (get().downloadingKeys[key]) {
      return false;
    }

    set((state) => ({
      downloadingKeys: { ...state.downloadingKeys, [key]: true },
    }));

    const toastId = silent ? undefined : `dl-${key}`;
    if (!silent) {
      toast.loading(`Downloading "${track.title}"...`, { id: toastId });
    }

    try {
      const resolvedCandidates = await resolveDownloadCandidates(track);
      if (resolvedCandidates.length === 0) {
        throw new Error('Could not resolve audio stream for track');
      }

      const artistName =
        track.artists?.map((a) => a.name).join(', ') || 'Unknown Artist';
      const baseDir = await appDataDir();
      const downloadsDir = await join(baseDir, DOWNLOADS_DIR_NAME);

      let downloadedFrom: StreamCandidate | undefined;
      let fileName = '';
      let ext = 'm4a';
      let lastError: unknown;

      const exportToPublic = Boolean(
        getSetting('core.playback.exportDownloadsToPublicFolder'),
      );

      for (const candidate of resolvedCandidates) {
        const stream = candidate.stream;
        if (!stream?.url) {
          continue;
        }
        ext = stream.container === 'webm' ? 'webm' : 'm4a';
        fileName = `${key}.${ext}`;
        const niceExportName = `${artistName} - ${track.title}.${ext}`;
        const destFile = await join(downloadsDir, fileName);

        try {
          await downloadFile(
            stream.url,
            exportToPublic ? `${destFile}|${niceExportName}` : destFile,
          );
          if (exportToPublic) {
            try {
              const mimeType = ext === 'webm' ? 'audio/webm' : 'audio/mp4';
              window.NuclearAndroid?.exportToPublicDownloads(
                destFile,
                niceExportName,
                mimeType,
              );
            } catch {
              // Public MediaStore export is best-effort; offline playback still works from appDataDir
            }
          }
          downloadedFrom = candidate;
          break;
        } catch (err) {
          lastError = err;
          console.error('[downloadStore] Candidate download failed:', err);
        }
      }

      if (!downloadedFrom) {
        throw lastError instanceof Error
          ? lastError
          : new Error(String(lastError ?? 'Could not download audio stream'));
      }

      const stream = downloadedFrom.stream;
      const info: DownloadedTrackInfo = {
        key,
        fileName,
        title: track.title,
        artist: artistName,
        durationMs: stream?.durationMs ?? downloadedFrom.durationMs,
        container: ext,
        codec: stream?.codec,
        downloadedAtIso: new Date().toISOString(),
      };

      const nextItems = { ...get().items, [key]: info };
      set((state) => {
        const nextDownloading = { ...state.downloadingKeys };
        delete nextDownloading[key];
        return {
          items: nextItems,
          downloadingKeys: nextDownloading,
        };
      });
      await persistItems(nextItems);

      if (!silent) {
        toast.success(`Downloaded "${track.title}"`, { id: toastId });
      }
      return true;
    } catch (error) {
      set((state) => {
        const nextDownloading = { ...state.downloadingKeys };
        delete nextDownloading[key];
        return { downloadingKeys: nextDownloading };
      });
      if (!silent) {
        const msg = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to download "${track.title}": ${msg}`, {
          id: toastId,
        });
      }
      return false;
    }
  },

  downloadTracks: async (tracks: Track[]) => {
    const pending = tracks.filter((t) => !get().isDownloaded(t));
    if (pending.length === 0) {
      toast.info('All songs are already downloaded!');
      return;
    }
    if (get().isBatchDownloading) {
      toast.info('A batch download is already in progress');
      return;
    }

    const total = pending.length;
    let completed = 0;
    let succeeded = 0;
    const toastId = 'batch-download-toast';

    set({
      isBatchDownloading: true,
      batchProgress: { completed: 0, total },
    });
    toast.loading(`Downloading songs (0/${total})...`, { id: toastId });

    const queue = [...pending];
    const worker = async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) {
          break;
        }
        const ok = await get().downloadTrack(next, true);
        completed += 1;
        if (ok) {
          succeeded += 1;
        }
        set({ batchProgress: { completed, total } });
        toast.loading(
          `Downloading (${completed}/${total}): ${next.title}`,
          { id: toastId },
        );
      }
    };

    await Promise.all([worker(), worker()]);

    set({ isBatchDownloading: false, batchProgress: null });
    if (succeeded > 0) {
      const exportToPublic = Boolean(
        getSetting('core.playback.exportDownloadsToPublicFolder'),
      );
      toast.success(
        exportToPublic
          ? `Downloaded ${succeeded}/${total} songs (saved for offline playback & in Downloads/Nuclear)`
          : `Downloaded ${succeeded}/${total} songs for offline playback`,
        { id: toastId },
      );
    } else {
      toast.error('Could not download songs', { id: toastId });
    }
  },

  removeDownload: async (track: Track) => {
    const key = getTrackDownloadKey(track);
    const existing = get().items[key];
    if (!existing) {
      return;
    }

    const nextItems = { ...get().items };
    delete nextItems[key];
    set({ items: nextItems });
    await persistItems(nextItems);

    try {
      await remove(`${DOWNLOADS_DIR_NAME}/${existing.fileName}`, {
        baseDir: BaseDirectory.AppData,
      });
    } catch {
      // Ignore if file already removed
    }
    toast.info(`Removed offline download: "${track.title}"`);
  },

  clearAllDownloads: async () => {
    const entries = Object.values(get().items);
    if (entries.length === 0) {
      return;
    }

    set({ items: {} });
    await persistItems({});

    for (const entry of entries) {
      try {
        await remove(`${DOWNLOADS_DIR_NAME}/${entry.fileName}`, {
          baseDir: BaseDirectory.AppData,
        });
      } catch {
        // Ignore individual file deletion failures
      }
    }

    toast.success(
      `Cleared ${entries.length} offline download${entries.length === 1 ? '' : 's'}`,
    );
  },
}));

export const initializeDownloadStore = async (): Promise<void> => {
  await useDownloadStore.getState().loadFromDisk();
};
