import {
  Laptop,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Smartphone,
  Volume2,
  X,
} from 'lucide-react';
import { FC, useState } from 'react';

import { Button } from '@nuclearplayer/ui';

import { useP2pSyncStore } from '../services/p2pSync';
import { useSettingsModalStore } from '../stores/settingsModalStore';
import { useSoundStore } from '../stores/soundStore';

export const ConnectDevicesButton: FC = () => {
  const [open, setOpen] = useState(false);
  const {
    peerAddress,
    remoteState,
    pollRemoteState,
    sendHandoffToPeer,
    pullHandoffFromPeer,
    sendRemoteControl,
  } = useP2pSyncStore();
  const localPlaying = useSoundStore((s) => s.status === 'playing');
  const openSettings = useSettingsModalStore((s) => s.open);
  const selectSettingsItem = useSettingsModalStore((s) => s.selectItem);

  const isConnected = Boolean(remoteState);

  return (
    <div className="relative">
      <Button
        size="icon"
        variant={isConnected ? 'tertiary' : 'default'}
        onClick={() => {
          setOpen((v) => !v);
          void pollRemoteState();
        }}
        aria-label="Connect Devices"
        title="Nuclear Connect (Switch Device / Remote Control)"
        className="relative"
      >
        <Smartphone size={16} />
        {isConnected && (
          <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-400 ring-2 ring-black" />
        )}
      </Button>

      {open && (
        <div className="border-border bg-popover text-popover-foreground fixed top-14 right-4 z-50 w-80 rounded-xl border p-4 shadow-2xl">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-extrabold">
              <Laptop size={15} />
              <span>Nuclear Connect</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded p-1 opacity-70 hover:opacity-100"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          {!peerAddress.trim() ? (
            <div className="space-y-2 text-xs">
              <p className="opacity-75">
                Link your phone once in P2P Sync to switch playback and control
                songs between your PC and phone!
              </p>
              <button
                onClick={() => {
                  setOpen(false);
                  selectSettingsItem('p2p-sync');
                  openSettings();
                }}
                className="bg-primary text-primary-foreground w-full rounded-lg py-2 font-bold"
              >
                Open P2P Sync Setup
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Device Picker */}
              <div className="space-y-1.5">
                <div className="text-[10px] font-bold uppercase opacity-65">
                  Play Audio On
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => void pullHandoffFromPeer(false)}
                    className={`rounded-lg border px-2.5 py-2 text-xs font-bold ${
                      localPlaying
                        ? 'bg-primary text-primary-foreground border-transparent'
                        : 'border-border bg-black/20'
                    }`}
                  >
                    💻 This PC
                  </button>
                  <button
                    onClick={() => void sendHandoffToPeer(false)}
                    className={`rounded-lg border px-2.5 py-2 text-xs font-bold ${
                      remoteState?.isPlaying
                        ? 'bg-primary text-primary-foreground border-transparent'
                        : 'border-border bg-black/20'
                    }`}
                  >
                    📱 {remoteState?.deviceName || 'Phone'}
                  </button>
                </div>
              </div>

              {/* Remote Control */}
              {remoteState ? (
                <div className="space-y-2 rounded-lg bg-black/20 p-2.5">
                  <div className="truncate text-xs font-bold">
                    {remoteState.title || 'Phone is idle'}
                  </div>
                  <div className="truncate text-[11px] opacity-70">
                    {remoteState.artist || remoteState.deviceName}
                  </div>
                  <div className="flex items-center justify-center gap-3 pt-1">
                    <button
                      onClick={() => void sendRemoteControl('previous')}
                      className="flex size-8 items-center justify-center rounded-full bg-black/25"
                    >
                      <SkipBack size={15} />
                    </button>
                    <button
                      onClick={() => void sendRemoteControl('toggle')}
                      className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-full"
                    >
                      {remoteState.isPlaying ? (
                        <Pause size={16} />
                      ) : (
                        <Play size={16} />
                      )}
                    </button>
                    <button
                      onClick={() => void sendRemoteControl('next')}
                      className="flex size-8 items-center justify-center rounded-full bg-black/25"
                    >
                      <SkipForward size={15} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 pt-1 text-[11px]">
                    <Volume2 size={13} />
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
                  </div>
                </div>
              ) : (
                <div className="rounded-lg bg-black/15 p-2.5 text-center text-[11px] opacity-70">
                  Phone is offline or Nuclear isn’t open on it.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
