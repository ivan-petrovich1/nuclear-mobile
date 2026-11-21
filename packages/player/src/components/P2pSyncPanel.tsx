import { Copy, Laptop, Link2, Loader2, RefreshCw, Send } from 'lucide-react';
import { FC, useEffect } from 'react';
import { toast } from 'sonner';

import { haptic } from '../services/androidMediaBridge';
import { useP2pSyncStore } from '../services/p2pSync';

export const P2pSyncPanel: FC = () => {
  const {
    enabled,
    pin,
    peerAddress,
    autoSyncOnLaunch,
    syncing,
    localInfo,
    lastSyncedIso,
    lastSummary,
    setEnabled,
    setPin,
    setPeerAddress,
    setAutoSyncOnLaunch,
    refreshLocalInfo,
    syncWithPeer,
    sendHandoffToPeer,
  } = useP2pSyncStore();

  useEffect(() => {
    void refreshLocalInfo();
  }, [refreshLocalInfo]);

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
            className="border-border bg-black/25 flex items-center justify-center gap-1.5 rounded-lg border py-2.5 text-xs font-extrabold transition active:scale-95"
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
