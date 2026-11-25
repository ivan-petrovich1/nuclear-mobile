import { LazyStore } from '@tauri-apps/plugin-store';
import { create } from 'zustand';

const STORE_FILE = 'custom-wallpaper.json';
const LOCAL_STORAGE_KEY = 'nuclear-custom-wallpaper-v1';
const STYLE_ELEMENT_ID = 'custom-wallpaper-theme';
const MAX_DIMENSION_PX = 1920;
const MAX_GIF_BYTES = 8 * 1024 * 1024;

const store = new LazyStore(STORE_FILE);

export type CustomWallpaperConfig = {
  imageDataUrl: string | null;
  fileName: string | null;
  enabled: boolean;
  matchThemeColors: boolean;
  dim: number;
  blurPx: number;
  surfaceOpacity: number;
  accentHex: string | null;
  accentForegroundHex: string | null;
};

type CustomWallpaperState = CustomWallpaperConfig & {
  loaded: boolean;
  loadFromDisk: () => Promise<void>;
  uploadImage: (file: File) => Promise<void>;
  removeImage: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setMatchThemeColors: (match: boolean) => Promise<void>;
  setDim: (dim: number) => Promise<void>;
  setBlurPx: (blurPx: number) => Promise<void>;
  setSurfaceOpacity: (opacity: number) => Promise<void>;
};

const DEFAULT_CONFIG: CustomWallpaperConfig = {
  imageDataUrl: null,
  fileName: null,
  enabled: true,
  matchThemeColors: true,
  dim: 0.45,
  blurPx: 2,
  surfaceOpacity: 0.62,
  accentHex: null,
  accentForegroundHex: null,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const toHex = (n: number): string =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0');

const computeContrastForeground = (r: number, g: number, b: number): string => {
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#111111' : '#ffffff';
};

const extractAccentFromCanvas = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): { accentHex: string; accentForegroundHex: string } | null => {
  try {
    const data = ctx.getImageData(0, 0, width, height).data;
    let bestScore = -1;
    let bestR = 0;
    let bestG = 0;
    let bestB = 0;

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 128) {
        continue;
      }
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      sumR += r;
      sumG += g;
      sumB += b;
      count += 1;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

      // Prefer vivid mid-tone colors over muddy darks or washed-out whites.
      if (lum > 0.18 && lum < 0.85 && sat > 0.2) {
        const score = sat * (1 - Math.abs(lum - 0.55));
        if (score > bestScore) {
          bestScore = score;
          bestR = r;
          bestG = g;
          bestB = b;
        }
      }
    }

    if (bestScore < 0) {
      if (count === 0) {
        return null;
      }
      bestR = sumR / count;
      bestG = sumG / count;
      bestB = sumB / count;
    }

    return {
      accentHex: `#${toHex(bestR)}${toHex(bestG)}${toHex(bestB)}`,
      accentForegroundHex: computeContrastForeground(bestR, bestG, bestB),
    };
  } catch {
    return null;
  }
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read image file'));
      }
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });

const loadHtmlImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = src;
  });

export const processUploadedImage = async (
  file: File,
): Promise<{
  imageDataUrl: string;
  accentHex: string | null;
  accentForegroundHex: string | null;
}> => {
  const rawDataUrl = await readFileAsDataUrl(file);
  const keepOriginalGif =
    file.type === 'image/gif' && file.size <= MAX_GIF_BYTES;

  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return {
      imageDataUrl: rawDataUrl,
      accentHex: null,
      accentForegroundHex: null,
    };
  }

  try {
    const img = await loadHtmlImage(rawDataUrl);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) {
      return {
        imageDataUrl: rawDataUrl,
        accentHex: null,
        accentForegroundHex: null,
      };
    }

    let finalDataUrl = rawDataUrl;
    if (!keepOriginalGif) {
      const scale = Math.min(1, MAX_DIMENSION_PX / Math.max(width, height));
      const targetW = Math.max(1, Math.round(width * scale));
      const targetH = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const webpUrl = canvas.toDataURL('image/webp', 0.86);
        if (webpUrl.startsWith('data:image/webp')) {
          finalDataUrl = webpUrl;
        } else {
          const jpegUrl = canvas.toDataURL('image/jpeg', 0.88);
          if (jpegUrl.startsWith('data:image/')) {
            finalDataUrl = jpegUrl;
          }
        }
      }
    }

    let accentHex: string | null = null;
    let accentForegroundHex: string | null = null;
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = 64;
    sampleCanvas.height = 64;
    const sampleCtx = sampleCanvas.getContext('2d');
    if (sampleCtx) {
      sampleCtx.drawImage(img, 0, 0, 64, 64);
      const extracted = extractAccentFromCanvas(sampleCtx, 64, 64);
      if (extracted) {
        accentHex = extracted.accentHex;
        accentForegroundHex = extracted.accentForegroundHex;
      }
    }

    return {
      imageDataUrl: finalDataUrl,
      accentHex,
      accentForegroundHex,
    };
  } catch {
    return {
      imageDataUrl: rawDataUrl,
      accentHex: null,
      accentForegroundHex: null,
    };
  }
};

export const applyCustomWallpaperToDom = (
  state: Pick<
    CustomWallpaperConfig,
    | 'imageDataUrl'
    | 'enabled'
    | 'matchThemeColors'
    | 'dim'
    | 'blurPx'
    | 'surfaceOpacity'
    | 'accentHex'
    | 'accentForegroundHex'
  >,
): void => {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;
  const existing = document.getElementById(STYLE_ELEMENT_ID);

  if (!state.enabled || !state.imageDataUrl) {
    root.removeAttribute('data-custom-wallpaper');
    if (existing?.parentNode) {
      existing.parentNode.removeChild(existing);
    }
    return;
  }

  const safeUrl = state.imageDataUrl.replace(/["\\\r\n]/g, '').trim();
  const dim = clamp(state.dim, 0, 0.85);
  const blurPx = clamp(state.blurPx, 0, 24);
  const surfaceAlphaPct = Math.round(
    clamp(state.surfaceOpacity, 0.2, 0.95) * 100,
  );

  const decls = [
    `--wallpaper: url("${safeUrl}");`,
    `--custom-wallpaper-blur: ${blurPx}px;`,
    `--custom-wallpaper-dim: ${dim};`,
    `--custom-wallpaper-surface-alpha: ${surfaceAlphaPct}%;`,
  ];

  if (state.matchThemeColors && state.accentHex) {
    const fg = state.accentForegroundHex ?? '#ffffff';
    decls.push(
      `--primary: ${state.accentHex};`,
      `--primary-foreground: ${fg};`,
      `--seekbar: ${state.accentHex};`,
      `--ring: ${state.accentHex};`,
      `--border: color-mix(in srgb, ${state.accentHex} 45%, var(--foreground));`,
    );
  }

  const css = `html[data-custom-wallpaper='true'], html[data-custom-wallpaper='true'][data-theme='dark'], html[data-custom-wallpaper='true'][data-oled='true'], html[data-custom-wallpaper='true'][data-oled='true'][data-theme='dark'] { ${decls.join(' ')} }`;

  let styleEl = existing as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = STYLE_ELEMENT_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
  root.setAttribute('data-custom-wallpaper', 'true');
};

const pickConfig = (state: CustomWallpaperConfig): CustomWallpaperConfig => ({
  imageDataUrl: state.imageDataUrl,
  fileName: state.fileName,
  enabled: state.enabled,
  matchThemeColors: state.matchThemeColors,
  dim: state.dim,
  blurPx: state.blurPx,
  surfaceOpacity: state.surfaceOpacity,
  accentHex: state.accentHex,
  accentForegroundHex: state.accentForegroundHex,
});

const persistConfig = async (config: CustomWallpaperConfig): Promise<void> => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config));
    }
  } catch {
    // Ignore localStorage quota/availability errors
  }

  try {
    await store.set('config', config);
    await store.save();
  } catch {
    // Ignore Tauri store errors in non-Tauri / test environments
  }
};

const normalizeConfig = (
  raw?: Partial<CustomWallpaperConfig> | null,
): CustomWallpaperConfig => ({
  imageDataUrl:
    typeof raw?.imageDataUrl === 'string' && raw.imageDataUrl.length > 0
      ? raw.imageDataUrl
      : null,
  fileName: typeof raw?.fileName === 'string' ? raw.fileName : null,
  enabled:
    typeof raw?.enabled === 'boolean' ? raw.enabled : DEFAULT_CONFIG.enabled,
  matchThemeColors:
    typeof raw?.matchThemeColors === 'boolean'
      ? raw.matchThemeColors
      : DEFAULT_CONFIG.matchThemeColors,
  dim: clamp(raw?.dim ?? DEFAULT_CONFIG.dim, 0, 0.85),
  blurPx: clamp(raw?.blurPx ?? DEFAULT_CONFIG.blurPx, 0, 24),
  surfaceOpacity: clamp(
    raw?.surfaceOpacity ?? DEFAULT_CONFIG.surfaceOpacity,
    0.2,
    0.95,
  ),
  accentHex: typeof raw?.accentHex === 'string' ? raw.accentHex : null,
  accentForegroundHex:
    typeof raw?.accentForegroundHex === 'string'
      ? raw.accentForegroundHex
      : null,
});

export const useCustomWallpaperStore = create<CustomWallpaperState>(
  (set, get) => {
    const updateAndPersist = async (
      partial: Partial<CustomWallpaperConfig>,
    ): Promise<void> => {
      const next = normalizeConfig({ ...pickConfig(get()), ...partial });
      set(next);
      applyCustomWallpaperToDom(next);
      await persistConfig(next);
    };

    return {
      ...DEFAULT_CONFIG,
      loaded: false,

      loadFromDisk: async () => {
        let loadedRaw: Partial<CustomWallpaperConfig> | null | undefined;
        try {
          loadedRaw = await store.get<Partial<CustomWallpaperConfig>>('config');
        } catch {
          // Fall back to localStorage below
        }

        if (!loadedRaw && typeof localStorage !== 'undefined') {
          try {
            const rawJson = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (rawJson) {
              loadedRaw = JSON.parse(rawJson) as Partial<CustomWallpaperConfig>;
            }
          } catch {
            // Ignore malformed localStorage value
          }
        }

        const next = normalizeConfig(loadedRaw);
        set({ ...next, loaded: true });
        applyCustomWallpaperToDom(next);
      },

      uploadImage: async (file: File) => {
        const processed = await processUploadedImage(file);
        await updateAndPersist({
          imageDataUrl: processed.imageDataUrl,
          fileName: file.name || 'Custom Background',
          enabled: true,
          accentHex: processed.accentHex,
          accentForegroundHex: processed.accentForegroundHex,
        });
      },

      removeImage: async () => {
        await updateAndPersist({
          imageDataUrl: null,
          fileName: null,
          accentHex: null,
          accentForegroundHex: null,
        });
      },

      setEnabled: async (enabled: boolean) => {
        await updateAndPersist({ enabled });
      },

      setMatchThemeColors: async (matchThemeColors: boolean) => {
        await updateAndPersist({ matchThemeColors });
      },

      setDim: async (dim: number) => {
        await updateAndPersist({ dim: clamp(dim, 0, 0.85) });
      },

      setBlurPx: async (blurPx: number) => {
        await updateAndPersist({ blurPx: clamp(blurPx, 0, 24) });
      },

      setSurfaceOpacity: async (surfaceOpacity: number) => {
        await updateAndPersist({
          surfaceOpacity: clamp(surfaceOpacity, 0.2, 0.95),
        });
      },
    };
  },
);

export const initializeCustomWallpaperStore = async (): Promise<void> => {
  await useCustomWallpaperStore.getState().loadFromDisk();
};
