import { createRootRoute, useRouter } from '@tanstack/react-router';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  CableIcon,
  DiscIcon,
  GaugeIcon,
  HistoryIcon,
  ListMusicIcon,
  MicVocalIcon,
  MusicIcon,
  SettingsIcon,
  UserIcon,
} from 'lucide-react';
import { useEffect } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import {
  PlayerShell,
  PlayerWorkspace,
  RouteTransition,
  SidebarNavigation,
  SidebarNavigationItem,
  Toaster,
} from '@nuclearplayer/ui';

import { ConnectedPlayerBar } from '../components/ConnectedPlayerBar';
import {
  ConnectedQueuePanel,
  QueueHeaderActions,
} from '../components/ConnectedQueuePanel';
import { ConnectedSettingsModal } from '../components/ConnectedSettingsModal';
import { ConnectedStreamVerification } from '../components/ConnectedStreamVerification';
import { ConnectedTitleBar } from '../components/ConnectedTitleBar';
import { ConnectedTopBar } from '../components/ConnectedTopBar';
import { DevTools } from '../components/DevTools';
import { FlatpakWarningBanner } from '../components/FlatpakWarningBanner';
import { MobileAndroidShell } from '../components/MobileAndroidShell';
import { SoundProvider } from '../components/SoundProvider';
import { StreamResolver } from '../components/StreamResolver';
import { useMobileEnhancementsStore } from '../services/mobileEnhancements';
import { GlobalShortcuts } from '../shortcuts';
import { useLayoutStore } from '../stores/layoutStore';
import { useSettingsModalStore } from '../stores/settingsModalStore';
import { useStartupStore } from '../stores/startupStore';

const RootComponent = () => {
  const { t } = useTranslation('navigation');
  const { t: tPrefs } = useTranslation('preferences');
  const {
    leftSidebar,
    rightSidebar,
    toggleLeftSidebar,
    toggleRightSidebar,
    setLeftSidebarWidth,
    setRightSidebarWidth,
  } = useLayoutStore();
  const router = useRouter();
  const openSettings = useSettingsModalStore((state) => state.open);
  useStartupStore((state) => state.isStartingUp);
  useEffect(() => {
    if (
      typeof navigator !== 'undefined' &&
      /Android/i.test(navigator.userAgent)
    ) {
      document.documentElement.setAttribute('data-android', 'true');
    }
    try {
      const win = getCurrentWindow();
      win
        .show()
        .then(() => win.setFocus())
        .catch(() => {});
    } catch {
      // Ignore on mobile WebView
    }
  }, []);

  const isMobileEnv = () =>
    typeof window !== 'undefined' &&
    (window.innerWidth < 768 ||
      (typeof navigator !== 'undefined' &&
        /Android/i.test(navigator.userAgent)));

  useEffect(() => {
    const handleBack = (): boolean => {
      const mobileState = useMobileEnhancementsStore.getState();
      if (mobileState.nowPlayingOpen) {
        mobileState.setNowPlayingOpen(false);
        return true;
      }
      const settingsState = useSettingsModalStore.getState();
      if (settingsState.isOpen) {
        settingsState.close();
        return true;
      }
      const layout = useLayoutStore.getState();
      const isMobile = isMobileEnv();
      if (isMobile && !layout.leftSidebar.isCollapsed) {
        layout.toggleLeftSidebar();
        return true;
      }
      if (isMobile && !layout.rightSidebar.isCollapsed) {
        layout.toggleRightSidebar();
        return true;
      }
      if (router.history.canGoBack()) {
        router.history.back();
        return true;
      }
      if (window.location.pathname !== '/playlists') {
        void router.navigate({ to: '/playlists' });
        return true;
      }
      return false;
    };
    (window as unknown as { __NUCLEAR_BACK__?: () => boolean }).__NUCLEAR_BACK__ =
      handleBack;
    return () => {
      delete (window as unknown as { __NUCLEAR_BACK__?: () => boolean })
        .__NUCLEAR_BACK__;
    };
  }, [router]);

  const handleNavClick = () => {
    if (isMobileEnv() && !leftSidebar.isCollapsed) {
      toggleLeftSidebar();
    }
  };
  const closeMobileDrawers = () => {
    if (!leftSidebar.isCollapsed) {
      toggleLeftSidebar();
    }
    if (!rightSidebar.isCollapsed) {
      toggleRightSidebar();
    }
  };
  return (
    <PlayerShell onContextMenu={(e) => e.preventDefault()}>
      <GlobalShortcuts />
      <div>
        <ConnectedTitleBar />
        <FlatpakWarningBanner />
        <ConnectedTopBar />
      </div>
      <StreamResolver />
      <SoundProvider>
        <PlayerWorkspace>
          {isMobileEnv() &&
            (!leftSidebar.isCollapsed || !rightSidebar.isCollapsed) && (
              <div
                className="fixed inset-0 z-30 bg-black/40"
                onClick={closeMobileDrawers}
              />
            )}
          <PlayerWorkspace.LeftSidebar
            width={leftSidebar.width}
            isCollapsed={leftSidebar.isCollapsed}
            onWidthChange={setLeftSidebarWidth}
            onToggle={toggleLeftSidebar}
          >
            <SidebarNavigation isCompact={leftSidebar.isCollapsed}>
              <div
                className="flex flex-1 flex-col gap-2 overflow-y-auto"
                onClick={handleNavClick}
              >
                <SidebarNavigationItem
                  to="/dashboard"
                  icon={<GaugeIcon />}
                  label={t('dashboard')}
                />
                <SidebarNavigationItem
                  to="/favorites/albums"
                  icon={<DiscIcon />}
                  label={t('favoriteAlbums')}
                />
                <SidebarNavigationItem
                  to="/favorites/tracks"
                  icon={<MusicIcon />}
                  label={t('favoriteTracks')}
                />
                <SidebarNavigationItem
                  to="/favorites/artists"
                  icon={<UserIcon />}
                  label={t('favoriteArtists')}
                />
                <SidebarNavigationItem
                  to="/playlists"
                  icon={<ListMusicIcon />}
                  label={t('playlists')}
                />
                <SidebarNavigationItem
                  to="/history"
                  icon={<HistoryIcon />}
                  label={t('history')}
                />
                <SidebarNavigationItem
                  to="/lyrics"
                  icon={<MicVocalIcon />}
                  label={t('lyrics')}
                />
                <SidebarNavigationItem
                  to="/sources"
                  icon={<CableIcon />}
                  label={t('sources')}
                />
              </div>
              <SidebarNavigationItem
                icon={<SettingsIcon />}
                label={tPrefs('title')}
                onClick={() => openSettings()}
              />
            </SidebarNavigation>
          </PlayerWorkspace.LeftSidebar>

          <PlayerWorkspace.Main>
            <RouteTransition />
          </PlayerWorkspace.Main>

          <PlayerWorkspace.RightSidebar
            width={rightSidebar.width}
            isCollapsed={rightSidebar.isCollapsed}
            onWidthChange={setRightSidebarWidth}
            onToggle={toggleRightSidebar}
            headerActions={<QueueHeaderActions />}
            footer={<ConnectedStreamVerification />}
          >
            <ConnectedQueuePanel isCollapsed={rightSidebar.isCollapsed} />
          </PlayerWorkspace.RightSidebar>
        </PlayerWorkspace>
      </SoundProvider>

      {isMobileEnv() ? <MobileAndroidShell /> : <ConnectedPlayerBar />}
      <Toaster />
      <ConnectedSettingsModal />
      <DevTools />
    </PlayerShell>
  );
};

export const Route = createRootRoute({
  component: RootComponent,
});
