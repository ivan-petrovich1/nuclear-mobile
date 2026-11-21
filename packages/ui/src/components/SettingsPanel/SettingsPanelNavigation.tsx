import { FC, ReactNode } from 'react';

import { ScrollableArea } from '../ScrollableArea/ScrollableArea';
import { SettingsNavigationSection } from './SettingsPanel';
import { SettingsPanelNavigationSection } from './SettingsPanelNavigationSection';

type SettingsPanelNavigationProps = {
  sections: SettingsNavigationSection[];
  footer?: ReactNode;
};

export const SettingsPanelNavigation: FC<SettingsPanelNavigationProps> = ({
  sections,
  footer,
}) => (
  <nav className="border-border flex w-full shrink-0 flex-col border-b-(length:--border-width) pr-10 md:w-56 md:border-r-(length:--border-width) md:border-b-0 md:pr-0">
    <ScrollableArea viewportClassName="gap-1 px-3 py-2 md:gap-4 md:p-4">
      {sections.map((section) => (
        <SettingsPanelNavigationSection key={section.id} section={section} />
      ))}
      {footer && <div className="mt-auto hidden md:block">{footer}</div>}
    </ScrollableArea>
  </nav>
);
