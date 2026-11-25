import { useMemo, useState } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import { ViewShell } from '@nuclearplayer/ui';

import changelog from '../../../changelog.json';
import forkChangelog from '../../../fork-changelog.json';
import type { ChangelogAuthor, ChangelogEntry } from '../../types/changelog';
import { resolveChangelogAuthor, TimelineEntry } from './TimelineEntry';

const mergedEntries: ChangelogEntry[] = [
  ...(forkChangelog as ChangelogEntry[]).map((entry) => ({
    ...entry,
    author: entry.author ?? ('ivan' as const),
  })),
  ...(changelog as ChangelogEntry[]).map((entry) => ({
    ...entry,
    author: entry.author ?? ('nukeop' as const),
  })),
].sort((a, b) => b.date.localeCompare(a.date));

const INITIAL_COUNT = 3;

type AuthorFilter = 'all' | ChangelogAuthor;

export const WhatsNew = () => {
  const { t } = useTranslation('changelog');
  const [showAll, setShowAll] = useState(false);
  const [authorFilter, setAuthorFilter] = useState<AuthorFilter>('all');

  const filteredEntries = useMemo(() => {
    if (authorFilter === 'all') {
      return mergedEntries;
    }
    return mergedEntries.filter(
      (entry) => resolveChangelogAuthor(entry) === authorFilter,
    );
  }, [authorFilter]);

  const visibleEntries = showAll
    ? filteredEntries
    : filteredEntries.slice(0, INITIAL_COUNT);
  const hiddenCount = filteredEntries.length - INITIAL_COUNT;

  return (
    <ViewShell title={t('title')}>
      <div className="mb-2 flex items-center gap-1.5 px-2">
        {(
          [
            ['all', 'All'],
            ['ivan', 'by ivan'],
            ['nukeop', 'by nukeop'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            data-testid={`changelog-filter-${key}`}
            onClick={() => {
              setAuthorFilter(key);
              setShowAll(false);
            }}
            className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              authorFilter === key
                ? key === 'ivan'
                  ? 'bg-purple-500/25 text-purple-300 ring-1 ring-purple-400/50'
                  : key === 'nukeop'
                    ? 'bg-blue-500/25 text-blue-300 ring-1 ring-blue-400/50'
                    : 'bg-primary text-primary-foreground'
                : 'bg-muted/70 hover:bg-muted opacity-75 hover:opacity-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex w-full flex-col pr-4 pl-2">
        {visibleEntries.map((entry, index) => (
          <TimelineEntry
            key={`${entry.date}-${entry.description.slice(0, 24)}-${index}`}
            entry={entry}
            isFirst={index === 0}
            isLast={index === visibleEntries.length - 1}
          />
        ))}
        {!showAll && hiddenCount > 0 && (
          <button
            className="hover:text-foreground cursor-pointer py-4 text-sm transition-colors"
            onClick={() => setShowAll(true)}
          >
            {t('seeMore', { count: hiddenCount })}
          </button>
        )}
      </div>
    </ViewShell>
  );
};
