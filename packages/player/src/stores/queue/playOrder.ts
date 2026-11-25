import shuffle from 'lodash-es/shuffle';

import type { QueueItem, RepeatMode } from '@nuclearplayer/model';

export class PlayOrder {
  constructor(
    readonly itemIds: string[],
    readonly cursor: number,
    readonly playNextTailId: string | null,
  ) {}

  static fromQueue(items: QueueItem[], currentIndex: number) {
    return new PlayOrder(
      items.map((item) => item.id),
      currentIndex,
      null,
    );
  }

  get currentItemId() {
    return this.itemIds[this.cursor];
  }

  private get lastSlot() {
    return this.itemIds.length - 1;
  }

  private get playNextTailSlot() {
    return this.itemIds.findIndex((itemId) => itemId === this.playNextTailId);
  }

  shuffle() {
    const currentItemId = this.currentItemId;
    if (!currentItemId) {
      return this;
    }
    const otherItemIds = this.itemIds.filter(
      (itemId) => itemId !== currentItemId,
    );
    return new PlayOrder([currentItemId, ...shuffle(otherItemIds)], 0, null);
  }

  shuffleAll() {
    if (this.itemIds.length <= 1) {
      return this;
    }
    return new PlayOrder(shuffle(this.itemIds), 0, null);
  }

  moveBefore(itemId: string, beforeItemId: string | null) {
    if (!this.itemIds.includes(itemId) || itemId === beforeItemId) {
      return this;
    }
    const currentItemId = this.currentItemId;
    const otherIds = this.itemIds.filter((id) => id !== itemId);
    const insertIndex =
      beforeItemId === null ? otherIds.length : otherIds.indexOf(beforeItemId);
    const targetIndex = insertIndex === -1 ? otherIds.length : insertIndex;
    const nextItemIds = [
      ...otherIds.slice(0, targetIndex),
      itemId,
      ...otherIds.slice(targetIndex),
    ];
    const nextCursor = currentItemId
      ? Math.max(0, nextItemIds.indexOf(currentItemId))
      : this.cursor;
    return new PlayOrder(nextItemIds, nextCursor, this.playNextTailId);
  }

  shuffleIn(newItemIds: string[]) {
    const allItemIds = [...this.itemIds, ...newItemIds];
    const firstShuffledSlot = Math.max(this.cursor, this.playNextTailSlot) + 1;
    const protectedItemIds = allItemIds.slice(0, firstShuffledSlot);
    const shuffledItemIds = shuffle(allItemIds.slice(firstShuffledSlot));
    return new PlayOrder(
      [...protectedItemIds, ...shuffledItemIds],
      this.cursor,
      this.playNextTailId,
    );
  }

  playNext(newItemIds: string[]) {
    const firstNewSlot = this.cursor + 1;
    const itemIdsAfterInsert = [
      ...this.itemIds.slice(0, firstNewSlot),
      ...newItemIds,
      ...this.itemIds.slice(firstNewSlot),
    ];
    if (this.playNextTailSlot > this.cursor) {
      return new PlayOrder(
        itemIdsAfterInsert,
        this.cursor,
        this.playNextTailId,
      );
    }
    return new PlayOrder(
      itemIdsAfterInsert,
      this.cursor,
      newItemIds.at(-1) ?? null,
    );
  }

  remove(removedItemIds: string[]) {
    const removed = new Set(removedItemIds);
    const remainingItemIds = this.itemIds.filter(
      (itemId) => !removed.has(itemId),
    );

    const removedBeforeCursor = this.itemIds
      .slice(0, this.cursor)
      .filter((itemId) => removed.has(itemId)).length;

    const cursor = Math.min(
      this.cursor - removedBeforeCursor,
      remainingItemIds.length - 1,
    );
    return new PlayOrder(
      remainingItemIds,
      Math.max(0, cursor),
      this.playNextTailId,
    );
  }

  jumpTo(selectedItemId: string) {
    const otherItemIds = this.itemIds.filter(
      (itemId) => itemId !== selectedItemId,
    );
    const selectedSlot = otherItemIds.indexOf(this.currentItemId) + 1;
    return new PlayOrder(
      [
        ...otherItemIds.slice(0, selectedSlot),
        selectedItemId,
        ...otherItemIds.slice(selectedSlot),
      ],
      selectedSlot,
      this.playNextTailId,
    );
  }

  private moveTo(cursor: number) {
    return new PlayOrder(this.itemIds, cursor, this.playNextTailId);
  }

  next(repeatMode: RepeatMode, shuffleEnabled: boolean) {
    if (this.cursor < this.lastSlot) {
      return this.moveTo(this.cursor + 1);
    }
    if (repeatMode !== 'all') {
      return this;
    }
    if (!shuffleEnabled) {
      return this.moveTo(0);
    }
    const otherItemIds = this.itemIds.slice(0, this.lastSlot);
    return new PlayOrder(
      [...shuffle(otherItemIds), this.currentItemId],
      0,
      null,
    );
  }

  previous(repeatMode: RepeatMode) {
    if (this.cursor > 0) {
      return this.moveTo(this.cursor - 1);
    }
    if (repeatMode === 'all') {
      return this.moveTo(this.lastSlot);
    }
    return this;
  }
}

export const orderQueueItems = (
  items: QueueItem[],
  playOrder: string[],
): QueueItem[] => {
  if (playOrder.length === 0) {
    return items;
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered: QueueItem[] = [];
  const seen = new Set<string>();
  for (const id of playOrder) {
    const item = byId.get(id);
    if (item && !seen.has(id)) {
      ordered.push(item);
      seen.add(id);
    }
  }
  for (const item of items) {
    if (!seen.has(item.id)) {
      ordered.push(item);
    }
  }
  return ordered;
};
