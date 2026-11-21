import { toast } from 'sonner';

import {
  computeListeningPersona,
  computeListeningStreak,
  useWrappedStatsStore,
} from './wrappedStats';

const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};

const wrapText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] => {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines - 1) {
        break;
      }
    } else {
      line = test;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines.slice(0, maxLines);
};

const loadImageSafe = (url: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });

const shareOrDownloadPng = (
  canvas: HTMLCanvasElement,
  fileName: string,
  caption: string,
) => {
  const dataUrl = canvas.toDataURL('image/png');
  if (window.NuclearAndroid?.shareImageBase64) {
    const res = window.NuclearAndroid.shareImageBase64(
      dataUrl,
      fileName,
      caption,
    );
    if (res === 'OK') {
      toast.success('✨ Saved to Pictures/Nuclear & opened Share Sheet!');
      return;
    }
  }
  // Fallback for desktop / browser
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName;
  a.click();
  toast.success('✨ Vibe Card downloaded!');
};

export const shareTrackVibeCard = async (opts: {
  title: string;
  artist: string;
  coverUrl?: string;
  dominantColor: string;
  lyricLine?: string;
}) => {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  // Rich dynamic background gradient
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, opts.dominantColor || '#4f46e5');
  grad.addColorStop(0.55, '#111118');
  grad.addColorStop(1, '#050508');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Subtle glow orb
  const orb = ctx.createRadialGradient(W * 0.5, 360, 40, W * 0.5, 360, 560);
  orb.addColorStop(0, `${opts.dominantColor || '#8b5cf6'}66`);
  orb.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = orb;
  ctx.fillRect(0, 0, W, H);

  // Inner glass card
  drawRoundedRect(ctx, 72, 72, W - 144, H - 144, 48);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.stroke();

  // Album artwork
  const artSize = 620;
  const artX = (W - artSize) / 2;
  const artY = 148;
  ctx.save();
  drawRoundedRect(ctx, artX, artY, artSize, artSize, 36);
  ctx.clip();
  const img = opts.coverUrl ? await loadImageSafe(opts.coverUrl) : null;
  if (img) {
    ctx.drawImage(img, artX, artY, artSize, artSize);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(artX, artY, artSize, artSize);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = 'bold 160px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('♪', W / 2, artY + artSize / 2 + 56);
  }
  ctx.restore();

  // Track title & artist
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 54px sans-serif';
  const titleLines = wrapText(ctx, opts.title, W - 220, 2);
  let y = artY + artSize + 88;
  for (const line of titleLines) {
    ctx.fillText(line, W / 2, y);
    y += 64;
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.font = '600 36px sans-serif';
  ctx.fillText(opts.artist.slice(0, 44), W / 2, y + 6);

  // Optional lyric quote
  if (opts.lyricLine && opts.lyricLine.trim()) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.font = 'italic 700 34px sans-serif';
    const quoteLines = wrapText(ctx, `“${opts.lyricLine.trim()}”`, W - 240, 2);
    let qy = y + 86;
    for (const ql of quoteLines) {
      ctx.fillText(ql, W / 2, qy);
      qy += 46;
    }
  }

  // Decorative waveform bars
  const barCount = 34;
  const barW = 10;
  const barGap = 12;
  const totalBarW = barCount * (barW + barGap);
  const startX = (W - totalBarW) / 2;
  const waveY = H - 205;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  for (let i = 0; i < barCount; i++) {
    const h = 16 + Math.abs(Math.sin(i * 0.65 + 1.2)) * 44;
    drawRoundedRect(ctx, startX + i * (barW + barGap), waveY - h / 2, barW, h, 5);
    ctx.fill();
  }

  // Footer badge
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.font = '700 26px monospace';
  ctx.fillText('NUCLEAR • NOW PLAYING', W / 2, H - 115);

  const safe = opts.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 32) || 'track';
  shareOrDownloadPng(
    canvas,
    `nuclear-vibe-${safe}.png`,
    `Listening to ${opts.title} by ${opts.artist} on Nuclear 🎧`,
  );
};

export const shareWrappedCard = (dominantColor: string) => {
  const stats = useWrappedStatsStore.getState();
  const persona = computeListeningPersona(stats.hourBuckets);
  const streak = computeListeningStreak(stats.activeDays);
  const topArtists = Object.values(stats.artistStats)
    .sort((a, b) => b.seconds - a.seconds || b.plays - a.plays)
    .slice(0, 3);
  const mins = Math.max(1, Math.round(stats.totalSeconds / 60));

  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, dominantColor || '#7c3aed');
  grad.addColorStop(0.5, '#181028');
  grad.addColorStop(1, '#050509');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  drawRoundedRect(ctx, 72, 72, W - 144, H - 144, 48);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '700 32px monospace';
  ctx.fillText('NUCLEAR • WRAPPED ANYTIME', W / 2, 165);

  ctx.font = '130px sans-serif';
  ctx.fillText(persona.emoji, W / 2, 330);

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 68px sans-serif';
  ctx.fillText(persona.title, W / 2, 430);

  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = '500 30px sans-serif';
  ctx.fillText(persona.subtitle, W / 2, 485);

  // Big stat tiles
  const tiles = [
    { label: 'MINUTES', val: String(mins) },
    { label: 'PLAYS', val: String(stats.totalPlays) },
    { label: 'STREAK', val: `${streak}d 🔥` },
  ];
  tiles.forEach((t, i) => {
    const tx = 128 + i * 282;
    drawRoundedRect(ctx, tx, 555, 256, 175, 28);
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 54px sans-serif';
    ctx.fillText(t.val, tx + 128, 645);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '700 24px monospace';
    ctx.fillText(t.label, tx + 128, 695);
  });

  // Top Artists
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = '700 28px monospace';
  ctx.fillText('TOP ARTISTS', 136, 825);

  topArtists.forEach((artist, i) => {
    const ry = 860 + i * 96;
    drawRoundedRect(ctx, 128, ry, W - 256, 78, 22);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 36px sans-serif';
    ctx.fillText(`${i + 1}. ${artist.name.slice(0, 26)}`, 160, ry + 51);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.68)';
    ctx.font = '600 28px monospace';
    ctx.fillText(`${artist.plays} plays`, W - 160, ry + 50);
    ctx.textAlign = 'left';
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '700 24px monospace';
  ctx.fillText('100% ON-DEVICE • ZERO TRACKING', W / 2, H - 115);

  shareOrDownloadPng(
    canvas,
    'nuclear-wrapped.png',
    `My Nuclear Listening Vibe: ${persona.emoji} ${persona.title} (${mins} min, ${streak}d streak)!`,
  );
};
