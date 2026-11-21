import { ComponentProps, FC } from 'react';

import { cn } from '../utils';
import { WallpaperLayer } from './Wallpaper';

type PlayerShellProps = ComponentProps<'div'>;

export const PlayerShell: FC<PlayerShellProps> = ({
  children,
  className,
  ...props
}) => {
  return (
    <div
      className={cn(
        'grid h-dvh w-screen max-w-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto] overflow-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]',
        className,
      )}
      {...props}
    >
      <WallpaperLayer />
      {children}
    </div>
  );
};
