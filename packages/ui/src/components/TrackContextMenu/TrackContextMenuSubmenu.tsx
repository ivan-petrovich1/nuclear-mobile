import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { createContext, FC, ReactNode, useContext, useState } from 'react';

import { cn } from '../../utils';

const isMobileViewport = () =>
  typeof window !== 'undefined' &&
  (window.innerWidth < 768 ||
    (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)));

const SubmenuContext = createContext<{
  isOpen: boolean;
  toggle: () => void;
} | null>(null);

type TrackContextMenuSubmenuProps = {
  children: ReactNode;
};

export const TrackContextMenuSubmenu: FC<TrackContextMenuSubmenuProps> = ({
  children,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  if (isMobileViewport()) {
    return (
      <SubmenuContext.Provider
        value={{ isOpen, toggle: () => setIsOpen((prev) => !prev) }}
      >
        <div className="w-full">{children}</div>
      </SubmenuContext.Provider>
    );
  }

  return (
    <SubmenuContext.Provider value={null}>
      <DropdownMenu.Sub>{children}</DropdownMenu.Sub>
    </SubmenuContext.Provider>
  );
};

type TrackContextMenuSubmenuTriggerProps = {
  icon?: ReactNode;
  children: ReactNode;
};

export const TrackContextMenuSubmenuTrigger: FC<
  TrackContextMenuSubmenuTriggerProps
> = ({ icon, children }) => {
  const mobileCtx = useContext(SubmenuContext);

  if (mobileCtx) {
    return (
      <button
        type="button"
        aria-expanded={mobileCtx.isOpen}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          mobileCtx.toggle();
        }}
        className={cn(
          'hover:bg-muted flex w-full cursor-pointer items-center justify-between gap-3 border-t border-transparent px-3 py-2 text-left text-sm outline-none',
          mobileCtx.isOpen && 'bg-muted border-border',
        )}
        data-testid="submenu-trigger"
      >
        <span className="flex items-center gap-3">
          <span className="shrink-0">{icon}</span>
          <span>{children}</span>
        </span>
        <ChevronDown
          size={14}
          className={cn(
            'shrink-0 transition-transform',
            mobileCtx.isOpen && 'rotate-180',
          )}
        />
      </button>
    );
  }

  return (
    <DropdownMenu.SubTrigger
      className={cn(
        'flex w-full cursor-pointer items-center justify-between gap-3 border-t border-transparent px-3 py-2 text-left text-sm outline-none not-last:border-b',
        'data-[highlighted]:bg-muted data-[highlighted]:border-border',
      )}
      data-testid="submenu-trigger"
    >
      <span className="flex items-center gap-3">
        <span className="shrink-0">{icon}</span>
        <span>{children}</span>
      </span>
      <ChevronRight size={14} />
    </DropdownMenu.SubTrigger>
  );
};

type TrackContextMenuSubmenuContentProps = {
  children: ReactNode;
};

export const TrackContextMenuSubmenuContent: FC<
  TrackContextMenuSubmenuContentProps
> = ({ children }) => {
  const mobileCtx = useContext(SubmenuContext);

  if (mobileCtx) {
    if (!mobileCtx.isOpen) {
      return null;
    }

    return (
      <div
        className="border-border bg-muted/40 max-h-56 w-full overflow-x-hidden overflow-y-auto border-t pl-2"
        data-testid="submenu-content"
      >
        {children}
      </div>
    );
  }

  return (
    <DropdownMenu.Portal>
      <DropdownMenu.SubContent
        collisionPadding={8}
        className="surface-background border-border data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] w-48 max-w-[calc(100vw-16px)] overflow-x-hidden overflow-y-auto rounded-sm border-(length:--border-width) shadow-lg backdrop-blur-xl outline-none"
        sideOffset={4}
        data-testid="submenu-content"
      >
        {children}
      </DropdownMenu.SubContent>
    </DropdownMenu.Portal>
  );
};
