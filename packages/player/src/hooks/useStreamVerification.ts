import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from '@nuclearplayer/i18n';
import type { StreamVerificationStatus } from '@nuclearplayer/model';

import { streamVerificationApi } from '../apis/streamVerificationApi';
import { Logger } from '../services/logger';
import type { VerifiedStream } from '../services/streamVerification';
import { streamVerification } from '../services/streamVerification';
import { useProvidersStore } from '../stores/providersStore';
import { useStreamVerificationStore } from '../stores/streamVerificationStore';
import { useCoreSetting } from './useCoreSetting';
import { useCurrentQueueItem } from './useCurrentQueueItem';

export const useStreamVerification = () => {
  const { t } = useTranslation('queue');
  const [isEnabled] = useCoreSetting<boolean>('playback.streamVerification');
  const [isServiceEnabled] = useCoreSetting<boolean>(
    'playback.streamVerificationService',
  );
  const currentItem = useCurrentQueueItem();
  const activeStreamingId = useProvidersStore(
    (state) => state.active.streaming,
  );
  const headCandidate = currentItem?.track.streamCandidates?.[0];
  const hasCandidates = Boolean(headCandidate);

  let verificationKey: string | undefined;
  if (currentItem && activeStreamingId) {
    try {
      verificationKey = streamVerificationApi.verificationKey(
        currentItem.track,
      );
    } catch {
      verificationKey = undefined;
    }
  }

  const localStreamId = useStreamVerificationStore((state) =>
    verificationKey ? state.verifications[verificationKey] : undefined,
  );
  const revision = useStreamVerificationStore((state) => state.revision);
  const isBusy = useStreamVerificationStore((state) => state.isBusy);
  const [verifiedStream, setVerifiedStream] = useState<VerifiedStream>();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!currentItem || !isEnabled) {
      setIsLoading(true);
      return;
    }
    if (!hasCandidates) {
      if (currentItem.status === 'success') {
        setVerifiedStream(undefined);
        setIsLoading(false);
      } else {
        setIsLoading(true);
      }
      return;
    }

    if (localStreamId) {
      setVerifiedStream({ streamId: localStreamId, status: 'verifiedByUser' });
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    let isCurrent = true;
    streamVerification.getVerifiedStream(currentItem.track).then((next) => {
      if (isCurrent) {
        setVerifiedStream(next);
        setIsLoading(false);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [
    currentItem?.id,
    currentItem?.status,
    headCandidate?.id,
    hasCandidates,
    isEnabled,
    isServiceEnabled,
    activeStreamingId,
    localStreamId,
    revision,
  ]);

  const getStatus = (): StreamVerificationStatus => {
    if (isLoading) {
      return 'loading';
    }
    if (!headCandidate || verifiedStream?.streamId !== headCandidate.id) {
      return 'unverified';
    }
    return verifiedStream.status;
  };

  const submit = async (action: 'verify' | 'unverify') => {
    if (!currentItem || !headCandidate) {
      return;
    }

    useStreamVerificationStore.getState().setBusy(true);
    try {
      const result = await streamVerification[action](
        currentItem.track,
        headCandidate.id,
      );
      if (result === 'failed') {
        toast.warning(t('streamVerification.notShared'));
      }
      setVerifiedStream(
        await streamVerification.getVerifiedStream(currentItem.track),
      );
      useStreamVerificationStore.getState().bumpRevision();
    } catch (error) {
      Logger.streaming.error(
        `Failed to ${action} the stream: ${String(error)}`,
      );
      toast.error(t('streamVerification.failed'));
    } finally {
      useStreamVerificationStore.getState().setBusy(false);
    }
  };

  return {
    isVisible: Boolean(isEnabled && currentItem),
    status: getStatus(),
    isBusy,
    isDisabled: !headCandidate?.stream,
    onVerify: () => submit('verify'),
    onUnverify: () => submit('unverify'),
  };
};
