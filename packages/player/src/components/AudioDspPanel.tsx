import { Gauge, RotateCcw, Sliders, Sparkles } from 'lucide-react';
import { FC } from 'react';
import { toast } from 'sonner';

import { useCoreSetting } from '../hooks/useCoreSetting';
import { haptic } from '../services/androidMediaBridge';
import {
  EQ_LABELS,
  EQ_PRESETS,
  useMobileEnhancementsStore,
} from '../services/mobileEnhancements';
import type { AmbientSpace } from '../services/soundSpaces';

type AudioDspPanelProps = {
  showMobileOnlyControls?: boolean;
};

export const AudioDspPanel: FC<AudioDspPanelProps> = ({
  showMobileOnlyControls = false,
}) => {
  const [autoDownloadPlayed, setAutoDownloadPlayed] = useCoreSetting<boolean>(
    'playback.autoDownloadPlayed',
  );

  const {
    sponsorBlockEnabled,
    preResolveEnabled,
    playbackSpeed,
    preservePitch,
    bassBoostDb,
    loudnessBoostDb,
    eqBands,
    ambientSpace,
    ambientVolume,
    spatial8dEnabled,
    shakeToSkipEnabled,
    shakeSensitivity,
    visualizerEnabled,
    karaokeEnabled,
    crossfadeSeconds,
    silenceTrimEnabled,
    endlessRadioEnabled,
    setSponsorBlockEnabled,
    setPreResolveEnabled,
    setPlaybackSpeed,
    setPreservePitch,
    setBassBoostDb,
    setLoudnessBoostDb,
    setEqBand,
    applyEqPreset,
    resetDsp,
    setAmbientSpace,
    setAmbientVolume,
    setSpatial8dEnabled,
    setShakeToSkipEnabled,
    setShakeSensitivity,
    setVisualizerEnabled,
    setKaraokeEnabled,
    setCrossfadeSeconds,
    setSilenceTrimEnabled,
    setEndlessRadioEnabled,
  } = useMobileEnhancementsStore();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-extrabold">
          <Sliders size={16} /> Audio DSP & Output Engine
        </span>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md bg-black/25 px-2.5 py-1 text-xs font-bold"
          onClick={resetDsp}
        >
          <RotateCcw size={13} /> Reset DSP
        </button>
      </div>

      {/* 1-Tap Mood Mixes */}
      <div className="rounded-xl bg-black/25 p-3">
        <div className="mb-2 text-xs font-bold">✨ 1-Tap Mood Mixes</div>
        <div className="grid grid-cols-2 gap-1.5 text-xs font-bold">
          <button
            type="button"
            onClick={() => {
              haptic('medium');
              setPlaybackSpeed(0.85);
              setPreservePitch(false);
              setAmbientSpace('rain');
              setAmbientVolume(0.35);
              setBassBoostDb(3);
              toast.info('🌙 Late Night Chill activated');
            }}
            className="rounded-lg bg-black/30 px-2.5 py-2 text-left transition active:scale-95"
          >
            🌙 Late Night Chill
            <div className="text-[10px] font-normal opacity-70">
              Slowed + Rain + Warm Bass
            </div>
          </button>
          <button
            type="button"
            onClick={() => {
              haptic('medium');
              setPlaybackSpeed(1.0);
              setPreservePitch(true);
              setAmbientSpace('off');
              setBassBoostDb(8);
              setLoudnessBoostDb(4);
              applyEqPreset('Bass Boost');
              toast.info('🏋️ Gym Hype activated');
            }}
            className="rounded-lg bg-black/30 px-2.5 py-2 text-left transition active:scale-95"
          >
            🏋️ Gym Hype
            <div className="text-[10px] font-normal opacity-70">
              Max Bass + Loudness Punch
            </div>
          </button>
          <button
            type="button"
            onClick={() => {
              haptic('medium');
              setPlaybackSpeed(1.0);
              setPreservePitch(true);
              setAmbientSpace('vinyl');
              setAmbientVolume(0.3);
              setBassBoostDb(2);
              applyEqPreset('Acoustic');
              toast.info('☕ Vinyl Study activated');
            }}
            className="rounded-lg bg-black/30 px-2.5 py-2 text-left transition active:scale-95"
          >
            ☕ Vinyl Study
            <div className="text-[10px] font-normal opacity-70">
              Vinyl Crackle + Cozy Acoustic
            </div>
          </button>
          <button
            type="button"
            onClick={() => {
              haptic('light');
              resetDsp();
              toast.info('✨ Reset to Normal Studio sound');
            }}
            className="rounded-lg bg-black/30 px-2.5 py-2 text-left transition active:scale-95"
          >
            🎛 Normal Studio
            <div className="text-[10px] font-normal opacity-70">
              Clean flat playback
            </div>
          </button>
        </div>
      </div>

      {/* EQ Presets */}
      <div className="flex flex-wrap gap-1.5">
        {Object.keys(EQ_PRESETS).map((presetName) => (
          <button
            key={presetName}
            type="button"
            className="rounded-full border border-white/20 bg-black/25 px-3 py-1 text-xs font-bold"
            onClick={() => applyEqPreset(presetName)}
          >
            {presetName}
          </button>
        ))}
      </div>

      {/* 5-Band Multi-Band Equalizer */}
      <div className="rounded-xl bg-black/25 p-3">
        <div className="mb-2 text-xs font-bold">
          5-Band Equalizer (-12 dB to +12 dB)
        </div>
        <div className="space-y-2">
          {EQ_LABELS.map((label, idx) => (
            <div key={label} className="flex items-center gap-2 text-xs">
              <span className="w-12 font-mono">{label}</span>
              <input
                type="range"
                min={-12}
                max={12}
                step={1}
                value={eqBands[idx]}
                onChange={(e) => setEqBand(idx, Number(e.target.value))}
                className="accent-primary flex-1"
              />
              <span className="w-10 text-right font-mono">
                {eqBands[idx] > 0 ? `+${eqBands[idx]}` : eqBands[idx]} dB
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Bass Boost & Loudness Enhancer */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-xl bg-black/25 p-3">
          <div className="mb-1 flex justify-between text-xs font-bold">
            <span>Bass Boost</span>
            <span>+{bassBoostDb} dB</span>
          </div>
          <input
            type="range"
            min={0}
            max={12}
            step={1}
            value={bassBoostDb}
            onChange={(e) => setBassBoostDb(Number(e.target.value))}
            className="accent-primary w-full"
          />
        </div>
        <div className="rounded-xl bg-black/25 p-3">
          <div className="mb-1 flex justify-between text-xs font-bold">
            <span>Loudness</span>
            <span>+{loudnessBoostDb} dB</span>
          </div>
          <input
            type="range"
            min={0}
            max={12}
            step={1}
            value={loudnessBoostDb}
            onChange={(e) => setLoudnessBoostDb(Number(e.target.value))}
            className="accent-primary w-full"
          />
        </div>
      </div>

      {/* Speed & Pitch Control (Slowed+Reverb / Nightcore) */}
      <div className="rounded-xl bg-black/25 p-3">
        <div className="mb-2 flex items-center justify-between text-xs font-bold">
          <span className="flex items-center gap-1">
            <Gauge size={14} /> Speed & Pitch ({playbackSpeed}x)
          </span>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={preservePitch}
              onChange={(e) => setPreservePitch(e.target.checked)}
            />
            <span>Preserve Pitch</span>
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            [0.75, '0.75x'],
            [0.85, '0.85x (Slowed)'],
            [1.0, '1.0x (Normal)'],
            [1.15, '1.15x (Nightcore)'],
            [1.25, '1.25x'],
            [1.5, '1.5x'],
          ].map(([spd, lbl]) => (
            <button
              key={String(spd)}
              type="button"
              onClick={() => setPlaybackSpeed(Number(spd))}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold ${
                playbackSpeed === spd
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-black/30 opacity-80'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Sound Spaces (Ambient Mixer + 8D Spatial Pan) */}
      <div className="space-y-2.5 rounded-xl bg-black/25 p-3">
        <div className="flex items-center justify-between text-xs font-bold">
          <span>🌌 Sound Spaces & 8D Audio</span>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={spatial8dEnabled}
              onChange={(e) => {
                haptic('light');
                setSpatial8dEnabled(e.target.checked);
              }}
            />
            <span>🎧 8D Pan</span>
          </label>
        </div>
        <div className="grid grid-cols-4 gap-1.5 text-xs font-bold">
          {(
            [
              ['off', 'Off'],
              ['rain', '🌧 Rain'],
              ['vinyl', '💿 Vinyl'],
              ['fireplace', '🔥 Fire'],
            ] as Array<[AmbientSpace, string]>
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                haptic('light');
                setAmbientSpace(mode);
              }}
              className={`rounded-lg py-1.5 transition active:scale-95 ${
                ambientSpace === mode
                  ? 'bg-primary text-primary-foreground shadow'
                  : 'bg-black/30 opacity-80'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {ambientSpace !== 'off' && (
          <div className="flex items-center gap-2 text-xs">
            <span className="opacity-75">Ambience</span>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={ambientVolume}
              onChange={(e) => setAmbientVolume(Number(e.target.value))}
              className="accent-primary flex-1"
            />
            <span className="w-9 text-right font-mono">
              {Math.round(ambientVolume * 100)}%
            </span>
          </div>
        )}
      </div>

      {/* Smart Audio & Playback Engine Toggles */}
      <div className="space-y-2.5 rounded-xl bg-black/25 p-3 text-xs font-semibold">
        <div className="mb-1 flex items-center gap-1 font-bold">
          <Sparkles size={14} /> Smart Audio Engine
        </div>
        <label className="flex items-center justify-between">
          <span>📊 Live Beat Visualizer in Now Playing</span>
          <input
            type="checkbox"
            checked={visualizerEnabled}
            onChange={(e) => {
              haptic('light');
              setVisualizerEnabled(e.target.checked);
            }}
          />
        </label>
        <label className="flex items-center justify-between">
          <span>🎤 Karaoke Mode (Live Vocal Remover)</span>
          <input
            type="checkbox"
            checked={karaokeEnabled}
            onChange={(e) => {
              haptic('light');
              setKaraokeEnabled(e.target.checked);
            }}
          />
        </label>
        <div className="flex items-center justify-between">
          <span>🎚 DJ Auto-Crossfade</span>
          <div className="flex gap-1 text-[11px]">
            {[0, 3, 5, 8].map((sec) => (
              <button
                key={sec}
                type="button"
                onClick={() => {
                  haptic('light');
                  setCrossfadeSeconds(sec);
                }}
                className={`rounded px-2 py-0.5 font-bold ${
                  crossfadeSeconds === sec
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-black/30 opacity-75'
                }`}
              >
                {sec === 0 ? 'Off' : `${sec}s`}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center justify-between">
          <span>✂️ Silence Trimmer (Skip Silent Intros/Outros)</span>
          <input
            type="checkbox"
            checked={silenceTrimEnabled}
            onChange={(e) => {
              haptic('light');
              setSilenceTrimEnabled(e.target.checked);
            }}
          />
        </label>
        <label className="flex items-center justify-between">
          <span>📻 Endless Vibe Radio (Auto-Queue Similar)</span>
          <input
            type="checkbox"
            checked={endlessRadioEnabled}
            onChange={(e) => {
              haptic('light');
              setEndlessRadioEnabled(e.target.checked);
            }}
          />
        </label>
        {showMobileOnlyControls && (
          <>
            <label className="flex items-center justify-between">
              <span>📳 Shake Phone to Skip Track</span>
              <input
                type="checkbox"
                checked={shakeToSkipEnabled}
                onChange={(e) => {
                  haptic('light');
                  setShakeToSkipEnabled(e.target.checked);
                }}
              />
            </label>
            {shakeToSkipEnabled && (
              <div className="flex items-center justify-between pl-2 text-[11px]">
                <span className="opacity-75">Shake sensitivity:</span>
                <div className="flex gap-1">
                  {(['low', 'medium', 'high'] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => {
                        haptic('light');
                        setShakeSensitivity(level);
                      }}
                      className={`rounded px-2 py-0.5 font-bold capitalize ${
                        shakeSensitivity === level
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-black/30 opacity-75'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        <label className="flex items-center justify-between">
          <span>⚡ Pre-Resolve Next 2 Queue Tracks (Instant Skip)</span>
          <input
            type="checkbox"
            checked={preResolveEnabled}
            onChange={(e) => setPreResolveEnabled(e.target.checked)}
          />
        </label>
        <label className="flex items-center justify-between">
          <span>⏭ SponsorBlock Auto-Skip (Intros/Outros)</span>
          <input
            type="checkbox"
            checked={sponsorBlockEnabled}
            onChange={(e) => setSponsorBlockEnabled(e.target.checked)}
          />
        </label>
        <label className="flex items-center justify-between">
          <span>📥 Auto-download played songs (off by default)</span>
          <input
            type="checkbox"
            checked={Boolean(autoDownloadPlayed)}
            onChange={(e) => {
              haptic('light');
              void setAutoDownloadPlayed(e.target.checked);
            }}
          />
        </label>
      </div>
    </div>
  );
};
