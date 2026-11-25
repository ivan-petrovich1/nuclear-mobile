import { toast } from 'sonner';

import type { Track } from '@nuclearplayer/model';

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const formatArtists = (track: Track): string =>
  track.artists
    ?.map((a) => a.name)
    .filter(Boolean)
    .join(', ') || 'Unknown Artist';

export const getTrackShareUrl = (track: Track): string => {
  const candidates = track.streamCandidates ?? [];
  const ytCandidate = candidates.find(
    (c) =>
      !c.failed &&
      (c.source?.provider === 'youtube' ||
        c.source?.provider === 'nucleartube' ||
        YOUTUBE_ID_RE.test(c.id)),
  );
  if (ytCandidate) {
    const vid = ytCandidate.source?.id || ytCandidate.id;
    if (vid.startsWith('http://') || vid.startsWith('https://')) {
      return vid;
    }
    if (YOUTUBE_ID_RE.test(vid)) {
      return `https://www.youtube.com/watch?v=${vid}`;
    }
  }

  const provider = track.source?.provider?.toLowerCase() ?? '';
  const sourceId = track.source?.id ?? '';

  if (sourceId.startsWith('http://') || sourceId.startsWith('https://')) {
    return sourceId;
  }
  if (provider === 'spotify' && sourceId) {
    return `https://open.spotify.com/track/${sourceId}`;
  }
  if (
    (provider === 'youtube' || provider === 'nucleartube') &&
    YOUTUBE_ID_RE.test(sourceId)
  ) {
    return `https://www.youtube.com/watch?v=${sourceId}`;
  }

  const query = `${formatArtists(track)} - ${track.title}`.trim();
  return `https://music.youtube.com/search?q=${encodeURIComponent(query)}`;
};

export const buildTrackSharePayload = (track: Track) => {
  const artist = formatArtists(track);
  const title = `${artist} - ${track.title}`;
  const url = getTrackShareUrl(track);
  const text = `🎵 ${title}\n${url}`;
  return { title, url, text };
};

export const buildPlaylistSharePayload = (name: string, tracks: Track[]) => {
  const heading = name.trim() || 'Nuclear Playlist';
  const title = `${heading} (${tracks.length} tracks)`;
  const preview = tracks
    .slice(0, 25)
    .map((track, idx) => `${idx + 1}. ${formatArtists(track)} - ${track.title}`)
    .join('\n');
  const overflow =
    tracks.length > 25 ? `\n...and ${tracks.length - 25} more` : '';
  const text = `🎶 ${title}\n${preview}${overflow}`;
  return { title, text };
};

const copyTextToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback to execCommand below for restricted WebViews (e.g. WebKitGTK)
  }

  if (typeof document === 'undefined') {
    return false;
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
};

export const shareTextContent = async (opts: {
  title: string;
  text: string;
  url?: string;
  successLabel?: string;
}): Promise<boolean> => {
  // 1. Native Android Share Sheet
  if (typeof window !== 'undefined' && window.NuclearAndroid?.shareText) {
    const res = window.NuclearAndroid.shareText(opts.title, opts.text);
    if (res === 'OK') {
      return true;
    }
  }

  // 2. Native Web Share API (macOS WKWebView / modern browsers)
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function'
  ) {
    try {
      await navigator.share({
        title: opts.title,
        text: opts.url ? `🎵 ${opts.title}` : opts.text,
        ...(opts.url ? { url: opts.url } : {}),
      });
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return false;
      }
      // Fall through to clipboard copy on unsupported environments
    }
  }

  // 3. Universal Desktop Clipboard (Linux / Windows / macOS fallback)
  const copied = await copyTextToClipboard(opts.text);
  if (copied) {
    toast.success(opts.successLabel ?? `🔗 Copied to clipboard: ${opts.title}`);
    return true;
  }

  toast.error('Could not share or copy to clipboard');
  return false;
};

export const shareTrack = async (track: Track): Promise<boolean> => {
  const { title, url, text } = buildTrackSharePayload(track);
  return shareTextContent({
    title,
    text,
    url,
    successLabel: `🔗 Share link copied: ${title}`,
  });
};

export const sharePlaylist = async (
  name: string,
  tracks: Track[],
): Promise<boolean> => {
  if (tracks.length === 0) {
    toast.info('Nothing to share yet');
    return false;
  }
  const { title, text } = buildPlaylistSharePayload(name, tracks);
  return shareTextContent({
    title,
    text,
    successLabel: `🔗 Copied playlist to clipboard: ${title}`,
  });
};
