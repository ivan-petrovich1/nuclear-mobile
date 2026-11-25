const bypassedItemIds = new Set<string>();

export const bypassOfflineForItem = (itemId: string): void => {
  bypassedItemIds.add(itemId);
};

export const isOfflineBypassed = (itemId: string): boolean =>
  bypassedItemIds.has(itemId);

export const clearOfflineBypass = (itemId: string): void => {
  bypassedItemIds.delete(itemId);
};

export const clearAllOfflineBypass = (): void => {
  bypassedItemIds.clear();
};
