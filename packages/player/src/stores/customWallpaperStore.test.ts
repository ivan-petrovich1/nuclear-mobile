import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetInMemoryTauriStore } from '../test/utils/inMemoryTauriStore';
import {
  applyCustomWallpaperToDom,
  initializeCustomWallpaperStore,
  useCustomWallpaperStore,
} from './customWallpaperStore';

describe('customWallpaperStore', () => {
  beforeEach(() => {
    resetInMemoryTauriStore();
    localStorage.clear();
    useCustomWallpaperStore.setState({
      imageDataUrl: null,
      fileName: null,
      enabled: true,
      matchThemeColors: true,
      dim: 0.45,
      blurPx: 2,
      surfaceOpacity: 0.62,
      accentHex: null,
      accentForegroundHex: null,
      loaded: false,
    });
    applyCustomWallpaperToDom(useCustomWallpaperStore.getState());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    applyCustomWallpaperToDom({
      imageDataUrl: null,
      enabled: false,
      matchThemeColors: false,
      dim: 0.45,
      blurPx: 2,
      surfaceOpacity: 0.62,
      accentHex: null,
      accentForegroundHex: null,
    });
  });

  it('injects and clears #custom-wallpaper-theme style and data-custom-wallpaper attribute', () => {
    applyCustomWallpaperToDom({
      imageDataUrl: 'data:image/png;base64,abc123',
      enabled: true,
      matchThemeColors: true,
      dim: 0.5,
      blurPx: 4,
      surfaceOpacity: 0.7,
      accentHex: '#33aa66',
      accentForegroundHex: '#111111',
    });

    expect(document.documentElement.getAttribute('data-custom-wallpaper')).toBe(
      'true',
    );
    const styleEl = document.getElementById('custom-wallpaper-theme');
    expect(styleEl).not.toBeNull();
    expect(styleEl?.textContent).toContain(
      '--wallpaper: url("data:image/png;base64,abc123");',
    );
    expect(styleEl?.textContent).toContain('--custom-wallpaper-blur: 4px;');
    expect(styleEl?.textContent).toContain('--custom-wallpaper-dim: 0.5;');
    expect(styleEl?.textContent).toContain(
      '--custom-wallpaper-surface-alpha: 70%;',
    );
    expect(styleEl?.textContent).toContain('--primary: #33aa66;');

    applyCustomWallpaperToDom({
      imageDataUrl: 'data:image/png;base64,abc123',
      enabled: false,
      matchThemeColors: true,
      dim: 0.5,
      blurPx: 4,
      surfaceOpacity: 0.7,
      accentHex: '#33aa66',
      accentForegroundHex: '#111111',
    });

    expect(
      document.documentElement.getAttribute('data-custom-wallpaper'),
    ).toBeNull();
    expect(document.getElementById('custom-wallpaper-theme')).toBeNull();
  });

  it('uploads an image, persists to store, hydrates on loadFromDisk, and removes cleanly', async () => {
    class MockImage {
      naturalWidth = 800;
      naturalHeight = 600;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', MockImage);

    const file = new File(['hello-image'], 'sunset.png', { type: 'image/png' });
    await useCustomWallpaperStore.getState().uploadImage(file);

    const afterUpload = useCustomWallpaperStore.getState();
    expect(afterUpload.fileName).toBe('sunset.png');
    expect(afterUpload.enabled).toBe(true);
    expect(afterUpload.imageDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(document.documentElement.getAttribute('data-custom-wallpaper')).toBe(
      'true',
    );

    // Reset in-memory state and re-hydrate from LazyStore
    useCustomWallpaperStore.setState({
      imageDataUrl: null,
      fileName: null,
      loaded: false,
    });
    await initializeCustomWallpaperStore();

    const hydrated = useCustomWallpaperStore.getState();
    expect(hydrated.loaded).toBe(true);
    expect(hydrated.fileName).toBe('sunset.png');
    expect(hydrated.imageDataUrl).toBe(afterUpload.imageDataUrl);
    expect(document.getElementById('custom-wallpaper-theme')).not.toBeNull();

    await useCustomWallpaperStore.getState().removeImage();
    expect(useCustomWallpaperStore.getState().imageDataUrl).toBeNull();
    expect(
      document.documentElement.getAttribute('data-custom-wallpaper'),
    ).toBeNull();
    expect(document.getElementById('custom-wallpaper-theme')).toBeNull();
  });
});
