import { FC } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import { ViewShell } from '@nuclearplayer/ui';

import { useStartupStore } from '../../stores/startupStore';
import { DashboardStartupSkeleton } from './components/DashboardStartupSkeleton';
import { PersonalizedDashboard } from './components/PersonalizedDashboard';

export const Dashboard: FC = () => {
  const { t } = useTranslation('dashboard');
  const isStartingUp = useStartupStore((state) => state.isStartingUp);

  return (
    <ViewShell data-testid="dashboard-view" title={t('title')}>
      {isStartingUp ? <DashboardStartupSkeleton /> : <PersonalizedDashboard />}
    </ViewShell>
  );
};
