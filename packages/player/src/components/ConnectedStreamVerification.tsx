import { openUrl } from '@tauri-apps/plugin-opener';
import { FC } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import { StreamVerification } from '@nuclearplayer/ui';

import { useStreamVerification } from '../hooks/useStreamVerification';

export const ConnectedStreamVerification: FC = () => {
  const { t } = useTranslation('queue');
  const { isVisible, ...verification } = useStreamVerification();

  if (!isVisible) {
    return null;
  }

  return (
    <StreamVerification
      {...verification}
      onLearnMore={() => {
        const url =
          'https://docs.nuclearplayer.com/nuclear/core-concepts/stream-verification';
        const androidBridge = (
          window as Window & {
            NuclearAndroid?: { openExternalUrl?: (target: string) => void };
          }
        ).NuclearAndroid;
        if (androidBridge?.openExternalUrl) {
          androidBridge.openExternalUrl(url);
        } else {
          void openUrl(url);
        }
      }}
      labels={{
        unverified: t('streamVerification.unverified'),
        weaklyVerified: t('streamVerification.weaklyVerified'),
        verified: t('streamVerification.verified'),
        verifiedByUser: t('streamVerification.verifiedByUser'),
        verify: t('streamVerification.verify'),
        unverify: t('streamVerification.unverify'),
        help: t('streamVerification.help'),
        explanation: t('streamVerification.explanation'),
        learnMore: t('streamVerification.learnMore'),
      }}
    />
  );
};
