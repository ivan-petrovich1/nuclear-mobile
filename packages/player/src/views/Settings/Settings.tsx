import { Fragment } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import { ScrollableArea, ViewShell } from '@nuclearplayer/ui';

import { SettingsSection } from './SettingsSection';
import { useSettingsGroups } from './useSettingsGroups';
import { useSettingsScrollSpy } from './useSettingsScrollSpy';

export const Settings = () => {
  const { t } = useTranslation('preferences');
  const groups = useSettingsGroups();
  const { viewportRef, registerSection } = useSettingsScrollSpy();

  return (
    <ViewShell title={t('general.title')}>
      <div className="flex w-full min-w-0 flex-1 flex-col items-center overflow-hidden">
        <ScrollableArea
          className="w-full max-w-[696px] flex-1 overflow-hidden md:min-w-[300px]"
          viewportRef={viewportRef}
        >
          <div className="px-2 pb-10 break-words [overflow-wrap:anywhere]">
            {groups.map((group, index) => (
              <Fragment key={group.name}>
                {index > 0 && <hr className="border-foreground/10 my-10" />}
                <div
                  ref={registerSection(group.name)}
                  data-testid={`settings-section-${group.name}`}
                >
                  <SettingsSection
                    title={t(`${group.name}.title`, group.name)}
                    settings={group.settings}
                  />
                </div>
              </Fragment>
            ))}
          </div>
        </ScrollableArea>
      </div>
    </ViewShell>
  );
};
