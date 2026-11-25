import { ScrollableArea } from '@nuclearplayer/ui';

import { CustomWallpaperSection } from '../../components/CustomWallpaperSection';
import { AdvancedThemeSelect } from './AdvancedThemeSelect';
import { BasicThemes } from './BasicThemes';
import { MarketplaceThemeSelect } from './MarketplaceThemeSelect';

export const MyThemes = () => {
  return (
    <ScrollableArea className="overflow-hidden">
      <BasicThemes />
      <CustomWallpaperSection />
      <div className="flex flex-col gap-4 md:flex-row">
        <AdvancedThemeSelect />
        <MarketplaceThemeSelect />
      </div>
    </ScrollableArea>
  );
};
