import { FC, ReactNode } from 'react';

import { BottomBar } from '..';
import { cn } from '../../utils';

export type PlayerBarRootProps = {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  className?: string;
};
export const PlayerBarRoot: FC<PlayerBarRootProps> = ({
  left,
  center,
  right,
  className = '',
}) => (
  <BottomBar className={cn('px-2 py-1.5 md:px-4', className)}>
    <div className="flex w-full flex-col gap-1.5 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center md:gap-4">
      {left && <div className="min-w-0">{left}</div>}
      {center && <div className="flex justify-center md:justify-self-center">{center}</div>}
      {right && <div className="hidden md:block md:justify-self-end">{right}</div>}
    </div>
  </BottomBar>
);
