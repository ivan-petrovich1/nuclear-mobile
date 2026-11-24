import {
  ArrowLeftRight,
  Check,
  Download,
  Loader2,
  Maximize2,
  Moon,
  Send,
  Sliders,
} from 'lucide-react';
import { FC, useEffect, useState } from 'react';

import { PlayerBar } from '@nuclearplayer/ui';

import { useCurrentQueueItem } from '../../hooks/useCurrentQueueItem';
import { useMobileEnhancementsStore } from '../../services/mobileEnhancements';
import { useP2pSyncStore } from '../../services/p2pSync';
import {
  getTrackDownloadKey,
  useDownloadStore,
} from '../../stores/downloadStore';
import { ConnectedControls } from './ConnectedControls';
import { ConnectedNowPlaying } from './ConnectedNowPlaying';
import { ConnectedSeekBar } from './ConnectedSeekBar';
import { ConnectedVolume } from './ConnectedVolume';

export const ConnectedPlayerBar: FC = () => {
  const currentItem = useCurrentQueueItem();
  const track = currentItem?.track;
  const dlKey = track ? getTrackDownloadKey(track) : '';
  const downloadedItems = useDownloadStore((s) => s.items);
  const downloadingKeys = useDownloadStore((s) => s.downloadingKeys);
  const downloadTrack = useDownloadStore((s) => s.downloadTrack);
  const removeDownload = useDownloadStore((s) => s.removeDownload);
  const isTrackDownloaded = Boolean(dlKey && downloadedItems[dlKey]);
  const isTrackDownloading = Boolean(dlKey && downloadingKeys[dlKey]);

  const sleepEndAt = useMobileEnhancementsStore((s) => s.sleepEndAt);
  const cycleSleepTimer = useMobileEnhancementsStore((s) => s.cycleSleepTimer);
  const openDesktopHub = useMobileEnhancementsStore((s) => s.openDesktopHub);
  const setDesktopStreamPickerOpen = useMobileEnhancementsStore(
    (s) => s.setDesktopStreamPickerOpen,
  );
  const setNowPlayingOpen = useMobileEnhancementsStore(
    (s) => s.setNowPlayingOpen,
  );
  const dspActive = useMobileEnhancementsStore(
    (s) =>
      s.playbackSpeed !== 1 ||
      s.bassBoostDb > 0 ||
      s.loudnessBoostDb > 0 ||
      s.spatial8dEnabled ||
      s.karaokeEnabled ||
      s.ambientSpace !== 'off' ||
      s.eqBands.some((g) => Math.abs(g) > 0.1),
  );

  const p2pPeerAddress = useP2pSyncStore((s) => s.peerAddress);
  const sendHandoffToPeer = useP2pSyncStore((s) => s.sendHandoffToPeer);
  const [sleepMin, setSleepMin] = useState<number | null>(null);

  useEffect(() => {
    if (!sleepEndAt) {
      setSleepMin(null);
      return;
    }
    const tick = () => {
      const left = sleepEndAt - Date.now();
      setSleepMin(left > 0 ? Math.max(1, Math.ceil(left / 60_000)) : null);
    };
    tick();
    const id = window.setInterval(tick, 10_000);
    return () => window.clearInterval(id);
  }, [sleepEndAt]);

  return (
    <>
      <ConnectedSeekBar />
      <PlayerBar
        left={<ConnectedNowPlaying />}
        center={<ConnectedControls />}
        right={
          <div className="flex items-center gap-1.5">
            {track && (
              <button
                type="button"
                onClick={() => {
                  if (isTrackDownloading) {
                    return;
                  }
                  if (isTrackDownloaded) {
                    void removeDownload(track);
                  } else {
                    void downloadTrack(track);
                  }
                }}
                title={
                  isTrackDownloaded
                    ? 'Remove offline download'
                    : 'Download offline'
                }
                aria-label="Download current track"
                className="hover:bg-muted flex size-8 items-center justify-center rounded-md opacity-80 transition hover:opacity-100"
              >
                {isTrackDownloading ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : isTrackDownloaded ? (
                  <Check size={15} className="text-emerald-400" />
                ) : (
                  <Download size={15} />
                )}
              </button>
            )}
            {track && (
              <button
                type="button"
                onClick={() => setDesktopStreamPickerOpen(true)}
                title="Switch Audio Stream"
                aria-label="Switch Audio Stream"
                className="hover:bg-muted flex size-8 items-center justify-center rounded-md opacity-80 transition hover:opacity-100"
              >
                <ArrowLeftRight size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={cycleSleepTimer}
              title={
                sleepMin ? `Sleep Timer (${sleepMin}m left)` : 'Sleep Timer'
              }
              aria-label="Sleep Timer"
              className={`hover:bg-muted flex h-8 items-center gap-1 rounded-md px-1.5 text-xs font-bold transition ${
                sleepMin
                  ? 'text-primary opacity-100'
                  : 'opacity-80 hover:opacity-100'
              }`}
            >
              <Moon size={15} />
              {sleepMin ? <span>{sleepMin}m</span> : null}
            </button>
            <button
              type="button"
              onClick={() => openDesktopHub('dsp')}
              title="Audio DSP & Smart Engine"
              aria-label="Open Audio DSP"
              className={`hover:bg-muted flex size-8 items-center justify-center rounded-md transition ${
                dspActive
                  ? 'text-primary opacity-100'
                  : 'opacity-80 hover:opacity-100'
              }`}
            >
              <Sliders size={15} />
            </button>
            {p2pPeerAddress.trim() && track && (
              <button
                type="button"
                onClick={() => void sendHandoffToPeer()}
                title="Handoff Playback to Paired Device"
                aria-label="Handoff to Paired Device"
                className="hover:bg-muted flex size-8 items-center justify-center rounded-md opacity-80 transition hover:opacity-100"
              >
                <Send size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setNowPlayingOpen(true)}
              title="Expanded Now Playing & Visualizer"
              aria-label="Open Expanded Now Playing"
              className="hover:bg-muted flex size-8 items-center justify-center rounded-md opacity-80 transition hover:opacity-100"
            >
              <Maximize2 size={15} />
            </button>
            <ConnectedVolume />
          </div>
        }
      />
    </>
  );
};
