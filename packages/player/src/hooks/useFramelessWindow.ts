import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';

import { useCoreSetting } from './useCoreSetting';

export const useFramelessWindow = () => {
  const [frameless] = useCoreSetting<boolean>('appearance.framelessWindow');
  const [customTitleBar] = useCoreSetting<boolean>('appearance.customTitleBar');

  useEffect(() => {
    try {
      const window = getCurrentWindow();

      if (customTitleBar) {
        window.setDecorations(false).catch(() => {});
        // Removing decorations causes the window to become unminimizable
        // We need to explicitly add the attribute back
        window.setMinimizable(true).catch(() => {});
      }

      if (!customTitleBar && frameless !== undefined) {
        window.setDecorations(!frameless).catch(() => {});
        window.setMinimizable(true).catch(() => {});
      }
    } catch {
      // Ignore on mobile WebView
    }
  }, [frameless, customTitleBar]);

  return Boolean(frameless);
};
