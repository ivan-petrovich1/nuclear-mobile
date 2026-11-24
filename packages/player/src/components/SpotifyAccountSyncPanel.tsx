import { Loader2, RefreshCw } from 'lucide-react';
import { FC } from 'react';

import { haptic } from '../services/androidMediaBridge';
import { useSpotifyAccountSyncStore } from '../services/spotifyAccountSync';

export const SpotifyAccountSyncPanel: FC = () => {
  const accountInput = useSpotifyAccountSyncStore((s) => s.accountInput);
  const autoSyncOnLaunch = useSpotifyAccountSyncStore(
    (s) => s.autoSyncOnLaunch,
  );
  const syncing = useSpotifyAccountSyncStore((s) => s.syncing);
  const lastSummary = useSpotifyAccountSyncStore((s) => s.lastSummary);
  const lastSyncedIso = useSpotifyAccountSyncStore((s) => s.lastSyncedIso);
  const setAccountInput = useSpotifyAccountSyncStore((s) => s.setAccountInput);
  const setAutoSyncOnLaunch = useSpotifyAccountSyncStore(
    (s) => s.setAutoSyncOnLaunch,
  );
  const syncNow = useSpotifyAccountSyncStore((s) => s.syncNow);

  return (
    <div className="space-y-4">
      <div className="border-border space-y-3 rounded-xl border p-4">
        <div className="flex items-center gap-2">
          <RefreshCw size={18} className={syncing ? 'animate-spin' : ''} />
          <div>
            <h3 className="text-sm font-extrabold">
              Public Spotify Account Sync
            </h3>
            <p className="text-[11px] opacity-70">
              No login needed. Paste your public Spotify profile link or
              username — Nuclear checks all public playlists on that account and
              keeps them updated automatically.
            </p>
          </div>
        </div>

        <input
          type="text"
          value={accountInput}
          onChange={(e) => setAccountInput(e.target.value)}
          placeholder="https://open.spotify.com/user/... or username"
          className="border-border bg-input text-input-foreground w-full rounded-lg border px-3 py-2 text-xs"
        />

        <label className="flex items-center justify-between text-xs font-semibold">
          <span>🔄 Auto-sync public playlists on app launch</span>
          <input
            type="checkbox"
            checked={autoSyncOnLaunch}
            onChange={(e) => setAutoSyncOnLaunch(e.target.checked)}
          />
        </label>

        <button
          type="button"
          disabled={syncing}
          onClick={() => {
            haptic('medium');
            void syncNow(false);
          }}
          className="bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-extrabold shadow transition active:scale-95 disabled:opacity-60"
        >
          {syncing ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <RefreshCw size={15} />
          )}
          <span>
            {syncing
              ? 'Checking Spotify profile...'
              : 'Sync Public Playlists Now'}
          </span>
        </button>

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
        <strong>Tip:</strong> Make sure your playlists on Spotify are set to{' '}
        <em>Public</em> and visible on your profile. Whenever you add or remove
        songs on Spotify, just open Nuclear (or click Sync Now) and your
        playlists update in-place!
      </div>
    </div>
  );
};
