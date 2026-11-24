import {
  CheckIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  Loader2Icon,
  PlayIcon,
  PlusIcon,
} from 'lucide-react';
import type { FC, ReactNode } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import type { Track } from '@nuclearplayer/model';
import { Button, cn, Popover } from '@nuclearplayer/ui';

import { useQueueActions } from '../../../hooks/useQueueActions';
import { playbackManager } from '../../../services/playback';
import {
  getTrackDownloadKey,
  useDownloadStore,
} from '../../../stores/downloadStore';

type PlaylistActionsProps = {
  tracks: Track[];
  menuItems?: ReactNode;
  className?: string;
};

export const PlaylistActions: FC<PlaylistActionsProps> = ({
  tracks,
  menuItems,
  className,
}) => {
  const { t } = useTranslation('playlists');
  const { addToQueue } = useQueueActions();
  const downloadedItems = useDownloadStore((state) => state.items);
  const isBatchDownloading = useDownloadStore(
    (state) => state.isBatchDownloading,
  );
  const batchProgress = useDownloadStore((state) => state.batchProgress);
  const downloadTracks = useDownloadStore((state) => state.downloadTracks);

  const allDownloaded =
    tracks.length > 0 &&
    tracks.every((track) =>
      Boolean(downloadedItems[getTrackDownloadKey(track)]),
    );

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Button
        variant="tertiary"
        onClick={() => {
          playbackManager.playTracks(tracks);
        }}
        data-testid="play-all-button"
      >
        <PlayIcon size={16} />
        {t('play')}
      </Button>
      {tracks.length > 0 && (
        <Button
          variant="tertiary"
          onClick={() => {
            void downloadTracks(tracks);
          }}
          data-testid="download-all-button"
        >
          {isBatchDownloading ? (
            <Loader2Icon size={16} className="animate-spin" />
          ) : allDownloaded ? (
            <CheckIcon size={16} />
          ) : (
            <DownloadIcon size={16} />
          )}
          {isBatchDownloading && batchProgress
            ? `${batchProgress.completed}/${batchProgress.total}`
            : allDownloaded
              ? 'Downloaded'
              : 'Download'}
        </Button>
      )}
      <Popover
        className="relative"
        panelClassName="surface-background px-0 py-0"
        trigger={
          <Button
            variant="tertiary"
            size="icon"
            data-testid="playlist-actions-button"
          >
            <EllipsisVerticalIcon size={16} />
          </Button>
        }
        anchor="bottom start"
      >
        <Popover.Menu>
          <Popover.Item
            icon={<PlusIcon size={16} />}
            onClick={() => {
              addToQueue(tracks);
            }}
            data-testid="add-to-queue-action"
          >
            {t('addToQueue')}
          </Popover.Item>
          <Popover.Item
            icon={<DownloadIcon size={16} />}
            onClick={() => {
              void downloadTracks(tracks);
            }}
            data-testid="download-playlist-action"
          >
            Download All Songs
          </Popover.Item>
          {menuItems}
        </Popover.Menu>
      </Popover>
    </div>
  );
};
