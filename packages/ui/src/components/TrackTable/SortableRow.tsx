import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { flexRender, Row } from '@tanstack/react-table';
import { useRef } from 'react';

import { Track } from '@nuclearplayer/model';

import { cn } from '../../utils';
import { useTrackTableContext } from './TrackTableContext';

type SortableRowProps<T extends Track = Track> = {
  row: Row<T>;
  itemId: string;
  isReorderable?: boolean;
  style?: React.CSSProperties;
};

export function SortableRow<T extends Track = Track>({
  row,
  itemId,
  isReorderable = false,
  style: externalStyle,
}: SortableRowProps<T>) {
  const { actions } = useTrackTableContext<T>();
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const isMobile =
    typeof window !== 'undefined' &&
    (window.innerWidth < 768 ||
      (typeof navigator !== 'undefined' &&
        /Android/i.test(navigator.userAgent)));
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: itemId,
    disabled: !isReorderable || isMobile,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...externalStyle,
  };

  return (
    <tr
      data-testid="track-row"
      ref={setNodeRef}
      style={style}
      onTouchStart={(e) => {
        if (!isMobile) {
          return;
        }
        const t = e.touches[0];
        swipeStartRef.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        if (!isMobile || !swipeStartRef.current) {
          return;
        }
        const t = e.changedTouches[0];
        const dx = t.clientX - swipeStartRef.current.x;
        const dy = t.clientY - swipeStartRef.current.y;
        swipeStartRef.current = null;
        if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.8) {
          if (dx > 0) {
            actions.onPlayNext?.(row.original);
          } else {
            actions.onAddToQueue?.(row.original);
          }
        }
      }}
      onClick={() => {
        if (isMobile) {
          actions.onPlayNow?.(row.original);
        }
      }}
      className={cn(
        'border-border bg-muted group border-b-(length:--border-width) select-none',
        {
          '': !isDragging,
          'z-50': isDragging,
          'cursor-grab': isReorderable && !isMobile,
        },
      )}
      {...attributes}
      {...listeners}
    >
      {row.getVisibleCells().map((cell) => (
        <Cell key={cell.id} cell={cell} />
      ))}
    </tr>
  );
}

type CellProps<T extends Track> = {
  cell: ReturnType<Row<T>['getVisibleCells']>[number];
};

const Cell = <T extends Track>({ cell }: CellProps<T>) => {
  return flexRender(cell.column.columnDef.cell, cell.getContext());
};
