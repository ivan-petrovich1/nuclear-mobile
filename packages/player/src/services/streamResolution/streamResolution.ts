import { invoke } from '@tauri-apps/api/core';
import { omit } from 'lodash-es';

import type { QueueItem, StreamCandidate } from '@nuclearplayer/model';
import { stripResolutionState } from '@nuclearplayer/model';

import { useDownloadStore } from '../../stores/downloadStore';
import { useQueueStore } from '../../stores/queue/queueStore';
import { useSoundStore } from '../../stores/soundStore';
import { playbackManager } from '../playback';
import { hasActiveStreamingProvider, streamingHost } from '../streamingHost';
import { AudioSourceFactory } from './audioSource';
import { candidatesForTrack } from './candidateSource';
import { isOfflineBypassed } from './offlineBypass';

export type ResolveOptions = {
  autoPlay: boolean;
  startPositionSeconds?: number;
};

export class StreamResolution {
  private activeController: AbortController | null = null;
  private activeItemId: string | null = null;

  constructor(private readonly audioSourceFactory = new AudioSourceFactory()) {}

  async resolve(item: QueueItem, options: ResolveOptions): Promise<void> {
    const signal = this.supersedeActiveResolution(item.id);
    const { updateItemState } = useQueueStore.getState();
    playbackManager.beginTrackLoad();

    if (options.autoPlay) {
      useSoundStore.getState().stop();
      useSoundStore.getState().setSrc(null);
    }
    updateItemState(item.id, { status: 'loading', error: undefined });

    // Check if track is downloaded locally for instant offline playback
    const downloaded = !isOfflineBypassed(item.id)
      ? useDownloadStore.getState().getDownloadedInfo(item.track)
      : undefined;
    if (downloaded) {
      try {
        const port = await invoke<number>('stream_server_port');
        if (!signal.aborted) {
          const localUrl = `http://127.0.0.1:${port}/local/${encodeURIComponent(downloaded.fileName)}`;
          const localBaseStream = {
            url: localUrl,
            protocol: 'http' as const,
            durationMs: downloaded.durationMs,
            container: downloaded.container,
            codec: downloaded.codec,
          };
          let nextTrack = item.track;
          if (
            item.track.streamCandidates &&
            item.track.streamCandidates.length > 0
          ) {
            const [head, ...rest] = item.track.streamCandidates;
            nextTrack = {
              ...item.track,
              streamCandidates: [
                head.stream
                  ? head
                  : {
                      ...head,
                      failed: false,
                      stream: { ...localBaseStream, source: head.source },
                    },
                ...rest,
              ],
            };
          } else if (downloaded.streamId) {
            const candidateSource = {
              provider: downloaded.provider || 'youtube',
              id: downloaded.streamId,
            };
            nextTrack = {
              ...item.track,
              streamCandidates: [
                {
                  id: downloaded.streamId,
                  title: downloaded.candidateTitle || item.track.title,
                  durationMs: downloaded.durationMs,
                  failed: false,
                  source: candidateSource,
                  stream: { ...localBaseStream, source: candidateSource },
                },
              ],
            };
          }
          updateItemState(item.id, { status: 'success', track: nextTrack });
          this.activeItemId = null;
          playbackManager.startTrack(
            { ...item, track: nextTrack },
            {
              url: localUrl,
              protocol: 'http',
              startPositionSeconds: options.startPositionSeconds,
            },
            { autoPlay: options.autoPlay },
          );
          return;
        }
      } catch {
        // Fall through to online resolution if local stream server failed
      }
    }

    if (!hasActiveStreamingProvider()) {
      this.failItem(item.id, 'streaming:errors.noProviderAvailable');
      return;
    }

    const candidates = await candidatesForTrack(item.track);
    if (signal.aborted) {
      return;
    }
    if (!candidates) {
      this.failItem(item.id, 'streaming:errors.noCandidatesFound');
      return;
    }

    updateItemState(item.id, {
      track: { ...item.track, streamCandidates: candidates },
    });
    await this.tryCandidatesInOrder(item, candidates, signal, options);
  }

  async resolveWithFreshStreams(
    item: QueueItem,
    options: ResolveOptions,
  ): Promise<void> {
    const track = {
      ...item.track,
      streamCandidates: item.track.streamCandidates?.map((candidate) =>
        omit(candidate, ['stream', 'lastResolvedAtIso']),
      ),
    };
    useQueueStore.getState().updateItemState(item.id, { track });
    return this.resolve({ ...item, track }, options);
  }

  private async tryCandidatesInOrder(
    item: QueueItem,
    candidates: StreamCandidate[],
    signal: AbortSignal,
    options: ResolveOptions,
  ): Promise<void> {
    if (signal.aborted) {
      return;
    }

    const candidate = candidates.find((current) => !current.failed);
    if (!candidate) {
      this.failItem(item.id, 'streaming:errors.allCandidatesFailed');
      return;
    }

    const resolved = await streamingHost.resolveStreamForCandidate(candidate);
    if (signal.aborted) {
      return;
    }
    if (!resolved) {
      this.failItem(item.id, 'streaming:errors.noProviderAvailable');
      return;
    }

    if (resolved.failed || !resolved.stream?.url?.trim()) {
      useQueueStore.getState().removeCandidate(item.id, candidate.id);
      const remaining = candidates.filter(
        (current) => current.id !== candidate.id,
      );
      await this.tryCandidatesInOrder(item, remaining, signal, options);
      return;
    }

    useQueueStore.getState().updateCandidate(item.id, resolved);
    await this.startPlayback(item, resolved, signal, options);
  }

  private async startPlayback(
    item: QueueItem,
    candidate: StreamCandidate,
    signal: AbortSignal,
    options: ResolveOptions,
  ): Promise<void> {
    const audioSource = await this.audioSourceFactory.fromCandidate(candidate);
    if (signal.aborted) {
      return;
    }

    if (options.startPositionSeconds !== undefined) {
      audioSource.startPositionSeconds = options.startPositionSeconds;
    }

    useQueueStore.getState().updateItemState(item.id, { status: 'success' });
    this.activeItemId = null;
    playbackManager.startTrack(item, audioSource, {
      autoPlay: options.autoPlay,
    });
  }

  private failItem(itemId: string, errorKey: string): void {
    playbackManager.clearPendingPlayback(itemId);
    useQueueStore.getState().updateItemState(itemId, {
      status: 'error',
      error: errorKey,
    });
  }

  private supersedeActiveResolution(itemId: string): AbortSignal {
    const previousController = this.activeController;
    const previousItemId = this.activeItemId;
    const controller = new AbortController();
    this.activeController = controller;
    this.activeItemId = itemId;

    previousController?.abort();
    if (previousItemId && previousItemId !== itemId) {
      this.resetAbandonedItem(previousItemId);
    }
    return controller.signal;
  }

  private resetAbandonedItem(itemId: string): void {
    const { getItemById, updateItemState } = useQueueStore.getState();
    const item = getItemById(itemId);
    if (item) {
      updateItemState(itemId, {
        status: undefined,
        error: undefined,
        track: stripResolutionState(item.track),
      });
    }
  }
}

export const streamResolution = new StreamResolution();
