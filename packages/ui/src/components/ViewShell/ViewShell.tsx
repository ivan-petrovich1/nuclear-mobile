import { FC, ReactNode } from 'react';

import { cn } from '../../utils';
import { ScrollableArea } from '../ScrollableArea';

type ViewShellClasses = {
  root?: string;
  scrollableArea?: string;
};

type ViewShellProps = {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  'data-testid'?: string;
  classes?: ViewShellClasses;
};

export const ViewShell: FC<ViewShellProps> = ({
  children,
  title,
  subtitle,
  'data-testid': dataTestId,
  classes,
}) => (
  <div
    className={cn(
      'surface-background relative flex h-full min-h-0 w-full flex-1 flex-col items-start justify-start px-3 pt-3 md:px-6 md:pt-6',
      classes?.root,
    )}
    data-testid={dataTestId}
  >
    {title && (
      <h1
        className="mb-3 flex w-full flex-0 flex-row text-center text-xl font-bold md:mb-6 md:text-3xl"
        data-testid="title"
      >
        {title}
      </h1>
    )}
    {subtitle && (
      <h2 className="mb-2 flex w-full flex-0 flex-row text-center text-base font-semibold md:mb-4 md:text-xl">
        {subtitle}
      </h2>
    )}
    <ScrollableArea
      className={cn(
        'flex min-h-0 w-full flex-1 flex-col',
        classes?.scrollableArea,
      )}
    >
      {children}
    </ScrollableArea>
  </div>
);
