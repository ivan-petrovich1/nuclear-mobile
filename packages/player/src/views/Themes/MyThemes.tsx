import { ScrollableArea } from '@nuclearplayer/ui';

import { AdvancedThemeSelect } from './AdvancedThemeSelect';
import { BasicThemes } from './BasicThemes';
import { MarketplaceThemeSelect } from './MarketplaceThemeSelect';

export const MyThemes = () => {
  return (
    <ScrollableArea className="overflow-hidden">
      <BasicThemes />
      <div className="flex flex-col gap-4 md:flex-row">
        <AdvancedThemeSelect />
        <MarketplaceThemeSelect />
      </div>
    </ScrollableArea>
  );
};
