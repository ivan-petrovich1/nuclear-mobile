import React from 'react';

import App from './App';
import { initLogStream } from './hooks/useLogStream';
import { applyThemeFromSettingsIfAny } from './services/advancedThemeService';
import { startAdvancedThemeWatcher } from './services/advancedThemeWatcher';
import { initBridgeHandler } from './services/bridge/bridgeHandler';
import { registerBuiltInCoreSettings } from './services/coreSettings';
import { initDiscordHandler } from './services/discordHandler';
import { initDiscoveryService } from './services/discoveryService';
import { initHistoryService } from './services/history';
import { initHttpApiHandler } from './services/httpApi';
import {
  applyLanguageFromSettings,
  initLanguageWatcher,
} from './services/languageService';
import { loadMarketplaceThemes } from './services/marketplaceThemeDirService';
import { initMcpHandler } from './services/mcp';
import { initMobileEnhancements } from './services/mobileEnhancements';
import { initMpdHandler } from './services/mpd';
import { initPlaybackEventBridge } from './services/playbackEventBridge';
import { hydratePluginsFromRegistry } from './services/plugins/pluginBootstrap';
import { providersHost } from './services/providersHost';
import { ytdlpHost } from './services/ytdlpHost';
import { initializeDownloadStore } from './stores/downloadStore';
import { initializeFavoritesStore } from './stores/favoritesStore';
import { initializePlaylistStore } from './stores/playlistStore';
import { initializeQueueStore } from './stores/queue/queueStore';
import { initializeSettingsStore } from './stores/settingsStore';
import { initializeShortcutsStore } from './stores/shortcutsStore';
import { initializeStreamVerificationStore } from './stores/streamVerificationStore';
import { hydrateThemeStore } from './stores/themeStore';
import { useUpdaterStore } from './stores/updaterStore';

const registerBuiltInYoutubeProvider = () => {
  if (providersHost.get('youtube', 'streaming')) {
    return;
  }
  providersHost.register({
    id: 'youtube',
    kind: 'streaming',
    name: 'YouTube',
    searchForTrack: async (artist: string, title: string) => {
      const safeTitle = title.replace(/"/g, '');
      const [quoted, plain] = await Promise.allSettled([
        ytdlpHost.search(`${artist} "${safeTitle}"`),
        ytdlpHost.search(`${artist} ${title}`),
      ]);
      const raw = [
        ...(quoted.status === 'fulfilled' ? quoted.value : []),
        ...(plain.status === 'fulfilled' ? plain.value : []),
      ];
      const seen = new Set<string>();
      return raw
        .filter((r) => {
          if (seen.has(r.id)) {
            return false;
          }
          seen.add(r.id);
          return true;
        })
        .map((r) => ({
          id: r.id,
          title: r.title,
          durationMs: r.duration ? r.duration * 1000 : undefined,
          thumbnail: r.thumbnail ?? undefined,
          failed: false,
          source: { provider: 'youtube', id: r.id },
        }));
    },
    getStreamUrl: async (candidateId: string) => {
      const info = await ytdlpHost.getStream(
        `https://www.youtube.com/watch?v=${candidateId}`,
      );
      return {
        url: info.stream_url,
        protocol: 'https',
        durationMs: info.duration ? info.duration * 1000 : undefined,
        container: info.container ?? undefined,
        codec: info.codec ?? undefined,
        source: { provider: 'youtube', id: candidateId },
      };
    },
  });
};

const initializeStores = () =>
  initializeSettingsStore()
    .then(() => initializeShortcutsStore())
    .then(() => initializeDownloadStore())
    .then(() => initializeQueueStore())
    .then(() => initializeFavoritesStore())
    .then(() => initializeStreamVerificationStore())
    .then(() => initializePlaylistStore())
    .then(() => registerBuiltInYoutubeProvider());

const initRemoteControl = () =>
  initMcpHandler()
    .catch(() => {})
    .then(() => initMpdHandler().catch(() => {}))
    .then(() => initHttpApiHandler().catch(() => {}))
    .then(() => initBridgeHandler().catch(() => {}));

const initLanguage = () =>
  applyLanguageFromSettings().then(() => initLanguageWatcher());

const initThemes = () =>
  startAdvancedThemeWatcher()
    .catch(() => {})
    .then(() => loadMarketplaceThemes().catch(() => {}))
    .then(() => {
      try {
        hydrateThemeStore();
      } catch {
        // Ignore
      }
    })
    .then(() => applyThemeFromSettingsIfAny().catch(() => {}));

const startBackgroundTasks = () => {
  initMobileEnhancements();
  void hydratePluginsFromRegistry();
  void useUpdaterStore
    .getState()
    .checkForUpdate()
    .catch(() => {});
};

export const initPlayerApp = async (
  root: ReturnType<typeof import('react-dom/client').createRoot>,
) => {
  initLogStream();

  await initializeStores()
    .then(() => registerBuiltInCoreSettings())
    .then(() => initDiscoveryService())
    .then(() => initRemoteControl())
    .then(() => initDiscordHandler())
    .then(() => initPlaybackEventBridge())
    .then(() => initHistoryService())
    .then(() => initLanguage())
    .then(() => initThemes())
    .then(() => startBackgroundTasks());

  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
};
