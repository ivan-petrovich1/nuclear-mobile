import { useCanGoBack, useRouter } from '@tanstack/react-router';
import { ArrowLeft, ListMusic, Menu } from 'lucide-react';
import { FC } from 'react';

import {
  Button,
  Tooltip,
  TopBar,
  TopBarLogo,
  TopBarNavigation,
} from '@nuclearplayer/ui';

import { useAppVersion } from '../hooks/useAppVersion';
import { useCanGoForward } from '../hooks/useCanGoForward';
import { useCoreSetting } from '../hooks/useCoreSetting';
import { useFramelessWindow } from '../hooks/useFramelessWindow';
import { useLayoutStore } from '../stores/layoutStore';
import { useQueueStore } from '../stores/queueStore';
import { ConnectDevicesButton } from './ConnectDevicesButton';
import { ConnectedThemeController } from './ConnectedThemeController';
import { JamQrCodeButton } from './JamQrCodeButton';
import { SearchBox } from './SearchBox';
import { UpdateBadge } from './UpdateBadge';

export const ConnectedTopBar: FC = () => {
  const router = useRouter();
  const { version } = useAppVersion();
  const canGoBack = useCanGoBack();
  const canGoForward = useCanGoForward();
  const frameless = useFramelessWindow();
  const [isTitleBarEnabled] = useCoreSetting<boolean>(
    'appearance.customTitleBar',
  );
  const { leftSidebar, rightSidebar, toggleLeftSidebar, toggleRightSidebar } =
    useLayoutStore();
  const queueCount = useQueueStore((state) => state.items.length);
  const isAndroid =
    typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

  const handleMobileBack = () => {
    const backFn = (
      window as unknown as { __NUCLEAR_BACK__?: () => boolean }
    ).__NUCLEAR_BACK__;
    if (backFn && backFn()) {
      return;
    }
    router.history.back();
  };

  return (
    <TopBar draggable={frameless}>
      <div className="flex flex-row items-center gap-1.5 md:gap-4">
        <Button
          size="icon"
          variant={leftSidebar.isCollapsed ? 'default' : 'tertiary'}
          className={isAndroid ? '' : 'md:hidden'}
          onClick={toggleLeftSidebar}
          aria-label="Menu"
        >
          <Menu size={16} />
        </Button>
        <Button
          size="icon"
          variant="default"
          className={isAndroid ? '' : 'md:hidden'}
          onClick={handleMobileBack}
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </Button>
        {!isTitleBarEnabled && !isAndroid && (
          <div className="hidden md:flex">
            <Tooltip
              content={`Nuclear ${version}`}
              side="bottom"
              wrapperClassName="flex items-center"
            >
              <TopBarLogo />
            </Tooltip>
          </div>
        )}
        {!isAndroid && (
          <div className="hidden md:flex">
            <TopBarNavigation
              onBack={() => router.history.back()}
              onForward={() => router.history.forward()}
              canGoBack={canGoBack}
              canGoForward={canGoForward}
            />
          </div>
        )}
        {!isAndroid && (
          <div className="hidden md:flex">
            <UpdateBadge />
          </div>
        )}
      </div>
      <SearchBox />
      <div className="flex flex-row items-center justify-end gap-1.5 md:gap-2">
        {!isAndroid && (
          <div className="hidden md:flex">
            <JamQrCodeButton />
          </div>
        )}
        {!isAndroid && (
          <div className="hidden md:flex">
            <ConnectDevicesButton />
          </div>
        )}
        <ConnectedThemeController />
        <Button
          size="icon"
          variant={rightSidebar.isCollapsed ? 'default' : 'tertiary'}
          className={isAndroid ? 'relative' : 'relative md:hidden'}
          onClick={toggleRightSidebar}
          aria-label="Queue"
        >
          <ListMusic size={16} />
          {queueCount > 0 && (
            <span className="bg-primary text-primary-foreground border-border absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full border px-0.5 text-[9px] font-bold">
              {queueCount}
            </span>
          )}
        </Button>
      </div>
    </TopBar>
  );
};
