import { FC } from 'react';

import type { Track } from '@nuclearplayer/model';
import {
  TrackTable,
  TrackTableActions,
  TrackTableProps,
} from '@nuclearplayer/ui';

import { useQueueActions } from '../hooks/useQueueActions';
import { useTrackActions } from '../hooks/useTrackActions';
import { useTrackTableLabels } from '../hooks/useTrackTableLabels';
import { playbackManager } from '../services/playback';
import { playbackSettings } from '../services/playbackSettings';
import { useQueueStore } from '../stores/queue/queueStore';
import { ConnectedTrackContextMenu } from './ConnectedTrackContextMenu';

type ConnectedTrackTableProps = Omit<
  TrackTableProps<Track>,
  'actions' | 'meta' | 'labels'
> & {
  actions?: Pick<TrackTableActions<Track>, 'onRemove' | 'onReorder'>;
};

export const ConnectedTrackTable: FC<ConnectedTrackTableProps> = (props) => {
  const { actions: externalActions, ...restProps } = props;
  const trackActions = useTrackActions();
  const queueActions = useQueueActions();
  const labels = useTrackTableLabels();

  return (
    <TrackTable
      {...restProps}
      labels={labels}
      display={{
        displayFavorite: true,
        ...restProps.display,
      }}
      actions={{
        onAddToQueue: trackActions.addToQueue,
        onPlayNow: (track: Track) => {
          const allTracks = restProps.tracks;
          const idx = Math.max(0, allTracks.indexOf(track));
          const before = allTracks.slice(0, idx);
          const fromClicked = allTracks.slice(idx);
          queueActions.clearQueue();
          queueActions.addToQueue(fromClicked);
          if (before.length > 0) {
            useQueueStore.getState().addAt(before, 0);
          }
          if (idx > 0 && playbackSettings.shuffleEnabled) {
            useQueueStore.getState().shuffleQueue(false);
          }
          playbackManager.play();
        },
        onPlayNext: trackActions.addNext,
        onToggleFavorite: trackActions.toggleFavorite,
        onRemove: externalActions?.onRemove,
        onReorder: externalActions?.onReorder,
        onPlayAll: () => {
          playbackManager.playTracks(restProps.tracks);
        },
        onAddAllToQueue: () => {
          queueActions.addToQueue(restProps.tracks);
        },
      }}
      meta={{
        isTrackFavorite: trackActions.isFavorite,
        ContextMenuWrapper: ConnectedTrackContextMenu,
      }}
    />
  );
};
