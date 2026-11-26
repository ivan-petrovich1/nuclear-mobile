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
        'surface-topbar border-border grid h-12 w-full max-w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b-(length:--border-width) px-2 select-none md:grid-cols-[1fr_4fr_1fr] md:px-3',
        className,
      )}
      data-tauri-drag-region
    >
      {children}
    </header>
  );
};
