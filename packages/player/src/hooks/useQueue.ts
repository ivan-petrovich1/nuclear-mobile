import { useMemo } from 'react';

import { orderQueueItems } from '../stores/queue/playOrder';
import { useQueueStore } from '../stores/queue/queueStore';
import { useSettingsStore } from '../stores/settingsStore';

// You can't replace this with lodash pick because it causes infinite re-renders
export const useQueue = () => {
  const items = useQueueStore((state) => state.items);
  const currentIndex = useQueueStore((state) => state.currentIndex);
  const playOrder = useQueueStore((state) => state.playOrder);
  const playCursor = useQueueStore((state) => state.playCursor);
  const shuffleEnabled = useSettingsStore((state) =>
    Boolean(state.getValue('core.playback.shuffle')),
  );

  return useMemo(() => {
    if (shuffleEnabled && playOrder.length > 0) {
      const orderedItems = orderQueueItems(items, playOrder);
      return {
        items: orderedItems,
        currentIndex: Math.min(
          Math.max(0, playCursor),
          Math.max(0, orderedItems.length - 1),
        ),
      };
    }
    return { items, currentIndex };
  }, [items, currentIndex, playOrder, playCursor, shuffleEnabled]);
};
