import { FC, ReactNode } from 'react';

import { cn } from '../utils';

type TopBarProps = {
  children?: ReactNode;
  className?: string;
  draggable?: boolean;
};

export const TopBar: FC<TopBarProps> = ({ children, className = '' }) => {
  return (
    <header
      className={cn(
        'surface-topbar border-border grid h-12 w-full min-w-0 max-w-full grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[1fr_4fr_1fr] items-center gap-2 border-b-(length:--border-width) px-2 md:px-3 select-none',
        className,
      )}
      data-tauri-drag-region
    >
      {children}
    </header>
  );
};
