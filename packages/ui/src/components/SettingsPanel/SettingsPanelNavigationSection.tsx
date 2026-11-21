import { FC } from 'react';

import { SettingsNavigationSection } from './SettingsPanel';
import { SettingsPanelNavigationItem } from './SettingsPanelNavigationItem';

type SettingsPanelNavigationSectionProps = {
  section: SettingsNavigationSection;
};

export const SettingsPanelNavigationSection: FC<
  SettingsPanelNavigationSectionProps
> = ({ section }) => (
  <div
    data-testid={`settings-navigation-section-${section.id}`}
    className="flex flex-col gap-1"
  >
    <div className="font-heading text-foreground px-1 pt-1 text-xs font-extrabold tracking-tight uppercase md:px-2 md:pt-3 md:pb-1 md:text-sm">
      {section.label}
    </div>
    <div className="flex flex-row gap-1.5 overflow-x-auto pb-1 md:flex-col md:gap-1 md:overflow-visible md:pb-0">
      {section.items.map((item) => (
        <SettingsPanelNavigationItem
          key={item.id}
          id={item.id}
          label={item.label}
          icon={item.icon}
          isActive={section.activeItemId === item.id}
          onClick={() => section.onSelect(item.id)}
        />
      ))}
    </div>
  </div>
);
