import { FC, ReactNode } from 'react';

import { Button } from '../Button';

type SettingsPanelNavigationItemProps = {
  id: string;
  label: string;
  icon?: ReactNode;
  isActive: boolean;
  onClick: () => void;
};

export const SettingsPanelNavigationItem: FC<
  SettingsPanelNavigationItemProps
> = ({ id, label, icon, isActive, onClick }) => (
  <Button
    data-testid={`settings-navigation-item-${id}`}
    onClick={onClick}
    variant={isActive ? 'default' : 'text'}
    size="default"
    className="h-8 shrink-0 justify-start gap-2 px-2.5 py-1 text-xs whitespace-nowrap md:h-10 md:w-full md:px-4 md:py-2 md:text-sm"
  >
    {icon && <span>{icon}</span>}
    {label}
  </Button>
);
