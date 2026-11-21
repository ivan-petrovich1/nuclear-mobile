import { FC, useEffect, useRef } from 'react';

import { getAudioAnalyser } from '../services/mobileEnhancements';

type BeatVisualizerProps = {
  playing: boolean;
  color: string;
};

const BAR_COUNT = 24;

export const BeatVisualizer: FC<BeatVisualizerProps> = ({ playing, color }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    let rafId = 0;
    const freqData = new Uint8Array(64);
    let phase = 0;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const analyser = playing ? getAudioAnalyser() : null;
      let hasSignal = false;
      if (analyser) {
        analyser.getByteFrequencyData(freqData);
        for (let i = 0; i < 16; i++) {
          if (freqData[i] > 2) {
            hasSignal = true;
            break;
          }
        }
      }

      phase += playing ? 0.09 : 0.015;
      const gap = 4;
      const barW = Math.max(3, (w - gap * (BAR_COUNT - 1)) / BAR_COUNT);
      const half = BAR_COUNT / 2;

      for (let i = 0; i < BAR_COUNT; i++) {
        // Mirror from center for a balanced, modern look
        const distFromCenter = Math.abs(i - (half - 0.5));
        const binIdx = Math.min(28, Math.floor(distFromCenter * 2));
        let amp: number;
        if (!playing) {
          amp = 0.12;
        } else if (hasSignal) {
          amp = Math.max(0.14, (freqData[binIdx] ?? 0) / 255);
        } else {
          // Smooth organic fallback when audio element isn't routed through Web Audio
          const wave =
            0.42 +
            0.32 * Math.sin(phase * 1.4 - distFromCenter * 0.55) +
            0.22 * Math.cos(phase * 2.1 + distFromCenter * 0.9);
          amp = Math.max(0.15, Math.min(0.95, wave));
        }

        const barH = Math.max(4, amp * (h - 4));
        const x = i * (barW + gap);
        const y = (h - barH) / 2;

        ctx.fillStyle = color || '#a855f7';
        ctx.globalAlpha = playing ? 0.45 + amp * 0.55 : 0.25;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, barW / 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (playing) {
        rafId = window.requestAnimationFrame(draw);
      }
    };

    draw();
    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [playing, color]);

  return (
    <canvas
      ref={canvasRef}
      width={260}
      height={32}
      className="mt-3 h-7 w-56 max-w-[70vw] opacity-90"
      aria-hidden="true"
    />
  );
};
