import {
  Copy,
  Laptop,
  Link2,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Send,
  SkipBack,
  SkipForward,
  Smartphone,
  Volume2,
} from 'lucide-react';
import { FC, useEffect } from 'react';
import { toast } from 'sonner';

import { haptic } from '../services/androidMediaBridge';
import { useP2pSyncStore } from '../services/p2pSync';
import { useSoundStore } from '../stores/soundStore';

export const P2pSyncPanel: FC = () => {
  const {
    enabled,
    pin,
    peerAddress,
    autoSyncOnLaunch,
    seamlessHandoff,
    syncing,
    localInfo,
    remoteState,
    lastSyncedIso,
    lastSummary,
    setEnabled,
    setPin,
    setPeerAddress,
    setAutoSyncOnLaunch,
    setSeamlessHandoff,
    refreshLocalInfo,
    pollRemoteState,
    syncWithPeer,
    sendHandoffToPeer,
    pullHandoffFromPeer,
    sendRemoteControl,
  } = useP2pSyncStore();
  const localPlaying = useSoundStore((s) => s.status === 'playing');

  useEffect(() => {
    void refreshLocalInfo();
    void pollRemoteState();
  }, [refreshLocalInfo, pollRemoteState]);

  const pairingCode = localInfo
    ? `${localInfo.ip}:${localInfo.port}|${pin}`
    : `Detecting...|${pin}`;

  const copyPairingCode = async () => {
    haptic('light');
    try {
      await navigator.clipboard.writeText(pairingCode);
      toast.success('📋 Pairing code copied!');
    } catch {
      toast.info(`Your code: ${pairingCode}`);
    }
  };

  return (
    <div className="space-y-4">
      {/* Live Nuclear Connect: Choose Playback Device & Remote Control */}
      {peerAddress.trim() && (
        <div className="border-border space-y-3 rounded-xl border p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone size={17} />
              <h3 className="text-sm font-extrabold">
                Nuclear Connect — Choose Device & Control
              </h3>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                remoteState
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-black/20 opacity-60'
              }`}
            >
              {remoteState ? '● Connected' : 'Offline'}
            </span>
          </div>

          {/* Device Switcher */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                haptic('medium');
                void pullHandoffFromPeer(false);
              }}
              className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-extrabold transition active:scale-95 ${
                localPlaying
                  ? 'bg-primary text-primary-foreground border-transparent shadow'
                  : 'border-border bg-black/20'
              }`}
            >
              <span>{localPlaying ? '● ' : ''}This Device</span>
            </button>
            <button
              onClick={() => {
                haptic('medium');
                void sendHandoffToPeer(false);
              }}
              className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-extrabold transition active:scale-95 ${
                remoteState?.isPlaying
                  ? 'bg-primary text-primary-foreground border-transparent shadow'
                  : 'border-border bg-black/20'
              }`}
            >
              <span>
                {remoteState?.isPlaying ? '● ' : ''}
                {remoteState?.deviceName || 'Other Device'}
              </span>
            </button>
          </div>

          {/* Live Remote Control of Other Device */}
          {remoteState && (
            <div className="space-y-2 rounded-lg bg-black/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-bold">
                    {remoteState.title || 'Idle on other device'}
                  </div>
                  <div className="truncate text-[11px] opacity-70">
                    {remoteState.artist || remoteState.deviceName}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      haptic('light');
                      void sendRemoteControl('previous');
                    }}
                    className="flex size-8 items-center justify-center rounded-full bg-black/25 active:scale-90"
                    aria-label="Remote Previous"
                  >
                    <SkipBack size={15} />
                  </button>
                  <button
                    onClick={() => {
                      haptic('medium');
                      void sendRemoteControl('toggle');
                    }}
                    className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-full shadow active:scale-90"
                    aria-label="Remote Play/Pause"
                  >
                    {remoteState.isPlaying ? (
                      <Pause size={16} />
                    ) : (
                      <Play size={16} />
                    )}
                  </button>
                  <button
                    onClick={() => {
                      haptic('light');
                      void sendRemoteControl('next');
                    }}
                    className="flex size-8 items-center justify-center rounded-full bg-black/25 active:scale-90"
                    aria-label="Remote Next"
                  >
                    <SkipForward size={15} />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 text-[11px]">
                <Volume2 size={14} className="opacity-75" />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={remoteState.volume ?? 1}
                  onChange={(e) =>
                    void sendRemoteControl('volume', Number(e.target.value))
                  }
                  className="accent-primary flex-1"
                />
                <span className="w-8 text-right font-mono">
                  {Math.round((remoteState.volume ?? 1) * 100)}%
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* This Device Card */}
      <div className="border-border space-y-3 rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Laptop size={18} />
            <div>
              <h3 className="text-sm font-extrabold">
                This Device ({localInfo?.deviceName ?? 'Nuclear Peer'})
              </h3>
              <p className="text-[11px] opacity-70">
                Serverless 2-way sync — both your PC & phone store everything
                locally and merge changes safely.
              </p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              haptic('light');
              setEnabled(e.target.checked);
            }}
            aria-label="Enable P2P Sync"
          />
        </div>

        <div className="space-y-1">
          <div className="text-[11px] font-bold opacity-75">
            Your Pairing Code (paste on your other device):
          </div>
          <div className="flex items-center gap-2">
            <code className="border-border bg-input text-input-foreground flex-1 truncate rounded-lg border px-3 py-2 font-mono text-xs font-bold">
              {pairingCode}
            </code>
            <button
              onClick={() => void copyPairingCode()}
              className="bg-primary text-primary-foreground flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold active:scale-95"
            >
              <Copy size={14} /> Copy
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="font-bold opacity-75">PIN:</span>
          <input
            type="text"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            maxLength={12}
            className="border-border bg-input text-input-foreground w-28 rounded-md border px-2 py-1 font-mono text-xs"
          />
          <button
            onClick={() => {
              haptic('light');
              void refreshLocalInfo();
            }}
            className="rounded-md border px-2 py-1 text-[11px] font-bold opacity-80 active:scale-95"
          >
            Refresh IP
          </button>
        </div>
      </div>

      {/* Connect to Peer Card */}
      <div className="border-border space-y-3 rounded-xl border p-4">
        <div className="flex items-center gap-2">
          <Link2 size={18} />
          <div>
            <h3 className="text-sm font-extrabold">Link Other Device</h3>
            <p className="text-[11px] opacity-70">
              Paste your PC or phone’s Pairing Code (works on home Wi-Fi or
              Tailscale).
            </p>
          </div>
        </div>

        <input
          type="text"
          value={peerAddress}
          onChange={(e) => setPeerAddress(e.target.value)}
          placeholder="192.168.1.42:37371|424242"
          className="border-border bg-input text-input-foreground w-full rounded-lg border px-3 py-2 font-mono text-xs"
        />

        <label className="flex items-center justify-between text-xs font-semibold">
          <span>🔄 Auto-sync with peer on app launch</span>
          <input
            type="checkbox"
            checked={autoSyncOnLaunch}
            onChange={(e) => setAutoSyncOnLaunch(e.target.checked)}
          />
        </label>

        <label className="flex items-center justify-between text-xs font-semibold">
          <span>⚡ Seamless Auto-Handoff (auto-switch when opening app)</span>
          <input
            type="checkbox"
            checked={seamlessHandoff}
            onChange={(e) => setSeamlessHandoff(e.target.checked)}
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <button
            disabled={syncing}
            onClick={() => {
              haptic('medium');
              void syncWithPeer(false);
            }}
            className="bg-primary text-primary-foreground flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-extrabold shadow transition active:scale-95 disabled:opacity-60"
          >
            {syncing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            <span>{syncing ? 'Merging...' : '2-Way Sync'}</span>
          </button>

          <button
            onClick={() => {
              haptic('medium');
              void sendHandoffToPeer();
            }}
            className="border-border flex items-center justify-center gap-1.5 rounded-lg border bg-black/25 py-2.5 text-xs font-extrabold transition active:scale-95"
          >
            <Send size={14} />
            <span>Handoff Song</span>
          </button>
        </div>

        {lastSummary && (
          <div className="rounded-lg bg-black/15 px-3 py-2 text-[11px]">
            <div className="font-bold">{lastSummary}</div>
            {lastSyncedIso && (
              <div className="opacity-65">
                Last synced: {new Date(lastSyncedIso).toLocaleString()}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-border rounded-xl border p-3 text-[11px] opacity-75">
        <strong>Safe 2-Way Merge:</strong> Playlists, tracks, favorites, Drop
        bookmarks, and streaks are merged from both sides — nothing on either
        device gets overwritten!
      </div>
    </div>
  );
};
