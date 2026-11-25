import { ImagePlus, Loader2, Palette, Trash2 } from 'lucide-react';
import { ChangeEvent, FC, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useCustomWallpaperStore } from '../stores/customWallpaperStore';

type CustomWallpaperSectionProps = {
  compact?: boolean;
};

export const CustomWallpaperSection: FC<CustomWallpaperSectionProps> = ({
  compact = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const {
    imageDataUrl,
    fileName,
    enabled,
    matchThemeColors,
    dim,
    blurPx,
    surfaceOpacity,
    accentHex,
    uploadImage,
    removeImage,
    setEnabled,
    setMatchThemeColors,
    setDim,
    setBlurPx,
    setSurfaceOpacity,
  } = useCustomWallpaperStore();

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) {
      return;
    }

    setUploading(true);
    try {
      await uploadImage(file);
      toast.success?.('Custom picture theme applied');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.error?.(`Failed to load picture: ${msg}`);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    await removeImage();
    toast.info?.('Custom picture background removed');
  };

  return (
    <div
      data-testid="custom-wallpaper-section"
      className={
        compact
          ? 'border-border bg-muted/40 space-y-2.5 rounded-xl border p-3'
          : 'border-border bg-muted/40 mt-4 space-y-3 rounded-xl border p-4'
      }
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="custom-wallpaper-input"
        onChange={(e) => void handleFileChange(e)}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-extrabold sm:text-sm">
            🖼️ Custom Picture Theme &amp; Background
          </div>
          <div className="text-[11px] opacity-70">
            Upload any photo, artwork, or GIF as your app theme background
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            data-testid="custom-wallpaper-upload-btn"
            className="bg-primary text-primary-foreground inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold shadow transition active:scale-95 disabled:opacity-60"
          >
            {uploading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <ImagePlus size={13} />
            )}
            <span>{imageDataUrl ? 'Change Picture' : 'Upload Picture'}</span>
          </button>
          {imageDataUrl && (
            <button
              type="button"
              onClick={() => void handleRemove()}
              data-testid="custom-wallpaper-remove-btn"
              className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-1.5 text-xs font-bold text-rose-400 transition active:scale-95"
              aria-label="Remove custom picture"
            >
              <Trash2 size={13} />
              <span>Remove</span>
            </button>
          )}
        </div>
      </div>

      {imageDataUrl && (
        <div className="space-y-3 pt-1">
          <div className="border-border relative h-24 w-full overflow-hidden rounded-lg border">
            <div
              className="absolute inset-0 bg-cover bg-center transition-all"
              style={{
                backgroundImage: `url("${imageDataUrl.replace(/["\\\r\n]/g, '')}")`,
                filter: enabled ? `blur(${blurPx}px)` : 'grayscale(100%)',
                transform: 'scale(1.06)',
              }}
            />
            <div
              className="absolute inset-0"
              style={{
                backgroundColor: `rgba(0, 0, 0, ${enabled ? dim : 0.65})`,
              }}
            />
            <div className="relative z-10 flex h-full items-end justify-between p-2.5 text-white">
              <div className="min-w-0">
                <div className="truncate text-xs font-bold drop-shadow">
                  {fileName || 'Custom Background'}
                </div>
                <div className="text-[10px] opacity-80">
                  {enabled ? 'Active' : 'Paused'}
                </div>
              </div>
              {accentHex && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold backdrop-blur-xs">
                  <Palette size={11} />
                  <span
                    className="inline-block size-2.5 rounded-full border border-white/50"
                    style={{ backgroundColor: accentHex }}
                  />
                  {accentHex}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex cursor-pointer items-center justify-between text-xs font-semibold">
              <span>Enable Picture Background</span>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => void setEnabled(e.target.checked)}
              />
            </label>
            <label className="flex cursor-pointer items-center justify-between text-xs font-semibold">
              <span>Match Theme Accent Color to Picture</span>
              <input
                type="checkbox"
                checked={matchThemeColors}
                onChange={(e) => void setMatchThemeColors(e.target.checked)}
              />
            </label>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-3">
            <label className="space-y-1 text-[11px] font-semibold">
              <div className="flex justify-between">
                <span>Darkness / Dim</span>
                <span className="font-mono opacity-75">
                  {Math.round(dim * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={85}
                value={Math.round(dim * 100)}
                onChange={(e) => void setDim(Number(e.target.value) / 100)}
                className="w-full accent-current"
              />
            </label>

            <label className="space-y-1 text-[11px] font-semibold">
              <div className="flex justify-between">
                <span>Background Blur</span>
                <span className="font-mono opacity-75">{blurPx}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={24}
                value={blurPx}
                onChange={(e) => void setBlurPx(Number(e.target.value))}
                className="w-full accent-current"
              />
            </label>

            <label className="space-y-1 text-[11px] font-semibold">
              <div className="flex justify-between">
                <span>Panel Opacity</span>
                <span className="font-mono opacity-75">
                  {Math.round(surfaceOpacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={20}
                max={95}
                value={Math.round(surfaceOpacity * 100)}
                onChange={(e) =>
                  void setSurfaceOpacity(Number(e.target.value) / 100)
                }
                className="w-full accent-current"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
};
