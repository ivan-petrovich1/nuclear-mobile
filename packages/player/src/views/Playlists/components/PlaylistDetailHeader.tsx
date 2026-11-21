import { PencilIcon } from 'lucide-react';
import type { FC, ReactNode } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import type { Playlist } from '@nuclearplayer/model';
import { Badge, Button, cn, Input, Textarea, Tooltip } from '@nuclearplayer/ui';

import { PlaylistArtwork } from './PlaylistArtwork';
import { usePlaylistDetailHeader } from './usePlaylistDetailHeader';

type PlaylistDetailHeaderProps = {
  playlist: Playlist;
  thumbnails?: string[];
  className?: string;
  children?: ReactNode;
};

export const PlaylistDetailHeader: FC<PlaylistDetailHeaderProps> = ({
  playlist,
  thumbnails,
  className,
  children,
}) => {
  const { t } = useTranslation('playlists');
  const {
    isEditing,
    editName,
    setEditName,
    editDescription,
    setEditDescription,
    startEditing,
    save,
    cancel,
  } = usePlaylistDetailHeader(playlist);

  return (
    <div
      className={cn(
        'border-border surface-card shadow-shadow relative flex flex-row items-center gap-3 rounded-md border-(length:--border-width) p-3 md:items-stretch md:gap-6 md:p-6',
        className,
      )}
    >
      {!playlist.isReadOnly && !isEditing && (
        <Button
          variant="tertiary"
          size="icon-sm"
          className="absolute top-2 right-2 z-10 md:top-4 md:right-4"
          onClick={startEditing}
          data-testid="edit-playlist-button"
        >
          <PencilIcon size={14} />
        </Button>
      )}
      {playlist.isReadOnly && playlist.origin && (
        <div className="absolute top-2 right-2 z-10 md:top-4 md:right-4">
          <Tooltip
            content={t('readOnlyTooltip', { source: playlist.origin.provider })}
            side="bottom"
          >
            <Badge variant="pill" color="cyan" data-testid="read-only-badge">
              {t('readOnlyBadge', { source: playlist.origin.provider })}
            </Badge>
          </Tooltip>
        </div>
      )}
      <div className="border-border shadow-shadow size-16 shrink-0 overflow-hidden rounded-md border-(length:--border-width) select-none md:h-60 md:w-60">
        <PlaylistArtwork name={playlist.name} thumbnails={thumbnails} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 md:gap-4">
        {isEditing ? (
          <div className="flex flex-col gap-2 md:gap-3">
            <Input
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              data-testid="playlist-detail-title-input"
              className="font-heading text-xl font-extrabold md:text-3xl"
            />
            <Textarea
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
              placeholder={t('descriptionPlaceholder')}
              data-testid="playlist-detail-description-input"
              className="min-h-[3rem] text-sm md:min-h-[4rem] md:text-lg"
            />
            <div className="flex gap-2">
              <Button
                variant="tertiary"
                onClick={save}
                data-testid="save-edit-button"
              >
                {t('common:actions.save')}
              </Button>
              <Button
                variant="tertiary"
                onClick={cancel}
                data-testid="cancel-edit-button"
              >
                {t('common:actions.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1 md:gap-2">
            <h1
              className="font-heading truncate pr-6 text-xl font-extrabold tracking-tight md:text-5xl"
              data-testid="playlist-detail-title"
            >
              {playlist.name}
            </h1>
            {playlist.description && (
              <p
                className="text-card-foreground/60 line-clamp-1 text-xs md:line-clamp-none md:text-lg"
                data-testid="playlist-detail-description"
              >
                {playlist.description}
              </p>
            )}
          </div>
        )}

        {children}
      </div>
    </div>
  );
};
