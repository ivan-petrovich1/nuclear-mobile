import { toast } from 'sonner';

import type { Track } from '@nuclearplayer/model';

import { playbackManager } from './playback';

const HAVA_NAGILA_TRACK: Track = {
  title: 'Hava Nagila',
  artists: [{ name: 'Hava Nagila Original', roles: [] }],
  source: {
    provider: 'easter-egg',
    id: 'hava-nagila',
  },
};

export const maybeTriggerSearchEasterEgg = (query: string): boolean => {
  if (query.trim().toLowerCase() !== 'jew') {
    return false;
  }

  playbackManager.playTracks([HAVA_NAGILA_TRACK]);
  toast.success('🎉 Mazel Tov! Now playing Hava Nagila!');
  return true;
};
