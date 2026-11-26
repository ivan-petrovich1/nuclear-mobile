import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { FC, ReactNode } from 'react';

type TrackContextMenuContentProps = {
  children: ReactNode;
};

export const TrackContextMenuContent: FC<TrackContextMenuContentProps> = ({
  children,
}) => {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align="end"
        sideOffset={4}
        collisionPadding={8}
        className="surface-popover border-border data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] w-56 max-w-[calc(100vw-16px)] origin-top-right overflow-x-hidden overflow-y-auto rounded-sm border-(length:--border-width) shadow-lg backdrop-blur-xl outline-none"
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
};
