import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { LazyStore } from '@tauri-apps/plugin-store';

import { getSetting } from '../stores/settingsStore';
import { CURRENT_RELEASE_VERSION } from '../stores/updaterStore';
import { errorMessage } from '../utils/errorMessage';
import { httpHost } from './httpHost';
import { Logger } from './logger';

export const TELEMETRY_API_BASE = 'https://countapi.mileshilliard.com/api/v1';
export const TELEMETRY_NAMESPACE = 'ivan-nuclear-mobile-v1';

const TELEMETRY_STORE_FILE = 'telemetry.json';
const TELEMETRY_STATE_KEY = 'state';
const LOCAL_STORAGE_KEY = 'nuclear-telemetry-state';
const VALID_KEY_PATTERN = /^[A-Za-z0-9_.-]{3,64}$/;

const store = new LazyStore(TELEMETRY_STORE_FILE);

export type TelemetryLocalState = {
  installCounted?: boolean;
  lastDauDate?: string;
  lastMauMonth?: string;
  countedVersions?: string[];
};

export type TelemetryPingPlan = {
  todayUtc: string;
  monthUtc: string;
  osSegment: string;
  versionSegment: string;
  installKeys: string[];
  dauKeys: string[];
  mauKeys: string[];
  versionKeys: string[];
  allKeys: string[];
};

export type TelemetryDeps = {
  enabled?: boolean;
  os?: string;
  version?: string;
  now?: Date;
  loadState?: () => Promise<TelemetryLocalState>;
  saveState?: (state: TelemetryLocalState) => Promise<void>;
  hit?: (key: string) => Promise<boolean>;
};

export const normalizePlatformOs = (rawOs?: string | null): string => {
  const os = (rawOs ?? '').trim().toLowerCase();
  if (os === 'android') {
    return 'android';
  }
  if (os === 'windows' || os === 'win32') {
    return 'windows';
  }
  if (os === 'macos' || os === 'darwin' || os === 'mac') {
    return 'macos';
  }
  if (os === 'linux') {
    return 'linux';
  }
  if (os === 'ios') {
    return 'ios';
  }
  return 'other';
};

export const sanitizeCounterSegment = (raw: string): string => {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^v(?=\d)/, '')
    .replace(/[^a-z0-9_.-]/g, '-');
  return cleaned.slice(0, 32) || 'unknown';
};

export const buildTelemetryKeysToPing = (params: {
  state: TelemetryLocalState;
  os: string;
  version: string;
  now?: Date;
}): TelemetryPingPlan => {
  const now = params.now ?? new Date();
  const iso = now.toISOString();
  const todayUtc = iso.slice(0, 10);
  const monthUtc = iso.slice(0, 7);
  const osSegment = normalizePlatformOs(params.os);
  const versionSegment = sanitizeCounterSegment(params.version);

  const installKeys = !params.state.installCounted
    ? ['installs-total', `installs-${osSegment}`]
    : [];

  const dauKeys =
    params.state.lastDauDate !== todayUtc
      ? [`dau-${todayUtc}`, `dau-${osSegment}-${todayUtc}`]
      : [];

  const mauKeys =
    params.state.lastMauMonth !== monthUtc ? [`mau-${monthUtc}`] : [];

  const countedVersions = Array.isArray(params.state.countedVersions)
    ? params.state.countedVersions
    : [];
  const versionKeys = !countedVersions.includes(versionSegment)
    ? [`ver-${versionSegment}`]
    : [];

  const allKeys = [
    ...installKeys,
    ...dauKeys,
    ...mauKeys,
    ...versionKeys,
  ].filter((key) => VALID_KEY_PATTERN.test(key));

  return {
    todayUtc,
    monthUtc,
    osSegment,
    versionSegment,
    installKeys,
    dauKeys,
    mauKeys,
    versionKeys,
    allKeys,
  };
};

const readLocalStorageFallback = (): TelemetryLocalState | null => {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as TelemetryLocalState)
      : null;
  } catch {
    return null;
  }
};

const writeLocalStorageFallback = (state: TelemetryLocalState): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // Ignore storage quota/availability errors
  }
};

const defaultLoadState = async (): Promise<TelemetryLocalState> => {
  try {
    const fromStore = await store.get<TelemetryLocalState>(TELEMETRY_STATE_KEY);
    if (fromStore && typeof fromStore === 'object') {
      return fromStore;
    }
  } catch {
    // Fallback to localStorage when LazyStore is unavailable
  }
  return readLocalStorageFallback() ?? {};
};

const defaultSaveState = async (state: TelemetryLocalState): Promise<void> => {
  writeLocalStorageFallback(state);
  try {
    await store.set(TELEMETRY_STATE_KEY, state);
    await store.save();
  } catch {
    // Ignore LazyStore errors when localStorage fallback succeeded
  }
};

const detectOsFromNavigator = (): string => {
  if (typeof navigator === 'undefined') {
    return 'other';
  }
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) {
    return 'android';
  }
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return 'ios';
  }
  if (/Win/i.test(ua)) {
    return 'windows';
  }
  if (/Mac/i.test(ua)) {
    return 'macos';
  }
  if (/Linux|X11/i.test(ua)) {
    return 'linux';
  }
  return 'other';
};

const defaultDetectOs = async (): Promise<string> => {
  try {
    const platform = await invoke<{ os?: string }>('get_runtime_platform');
    if (platform?.os) {
      return normalizePlatformOs(platform.os);
    }
  } catch {
    // Fallback to navigator userAgent
  }
  return detectOsFromNavigator();
};

const defaultDetectVersion = async (): Promise<string> => {
  try {
    const version = await getVersion();
    if (version) {
      return version;
    }
  } catch {
    // Fallback to bundled CURRENT_RELEASE_VERSION
  }
  return CURRENT_RELEASE_VERSION;
};

const defaultHitCounter = async (key: string): Promise<boolean> => {
  if (!VALID_KEY_PATTERN.test(key)) {
    return false;
  }
  const fullKey = `${TELEMETRY_NAMESPACE}-${key}`;
  const url = `${TELEMETRY_API_BASE}/hit/${encodeURIComponent(fullKey)}`;
  try {
    const response = await httpHost.fetch(url, { method: 'GET' });
    return response.status >= 200 && response.status < 300;
  } catch {
    try {
      if (typeof globalThis.fetch === 'function') {
        const res = await globalThis.fetch(url, { method: 'GET' });
        return res.ok;
      }
    } catch {
      // Ignore network errors and retry on next launch
    }
    return false;
  }
};

let inflightReport: Promise<void> | null = null;

const runReportAnonymousUsage = async (deps?: TelemetryDeps): Promise<void> => {
  if (!deps && import.meta.env.MODE === 'test') {
    return;
  }

  const enabled =
    deps?.enabled ?? getSetting('core.updates.anonymousStats') !== false;
  if (!enabled) {
    return;
  }

  const loadState = deps?.loadState ?? defaultLoadState;
  const saveState = deps?.saveState ?? defaultSaveState;
  const hit = deps?.hit ?? defaultHitCounter;

  const state = await loadState().catch(() => ({}) as TelemetryLocalState);
  const os = deps?.os ?? (await defaultDetectOs());
  const version = deps?.version ?? (await defaultDetectVersion());
  const plan = buildTelemetryKeysToPing({
    state,
    os,
    version,
    now: deps?.now,
  });

  if (plan.allKeys.length === 0) {
    return;
  }

  const results = new Map<string, boolean>();
  for (const key of plan.allKeys) {
    try {
      const ok = await hit(key);
      results.set(key, Boolean(ok));
    } catch (error) {
      Logger.updates.debug(
        `Anonymous telemetry ping failed for ${key}: ${errorMessage(error)}`,
      );
      results.set(key, false);
    }
  }

  const installsSucceeded =
    plan.installKeys.length > 0 && results.get(plan.installKeys[0]) === true;
  const dauSucceeded =
    plan.dauKeys.length > 0 && results.get(plan.dauKeys[0]) === true;
  const mauSucceeded =
    plan.mauKeys.length > 0 && results.get(plan.mauKeys[0]) === true;
  const versionSucceeded =
    plan.versionKeys.length > 0 && results.get(plan.versionKeys[0]) === true;

  if (
    !installsSucceeded &&
    !dauSucceeded &&
    !mauSucceeded &&
    !versionSucceeded
  ) {
    return;
  }

  const nextState: TelemetryLocalState = {
    installCounted: state.installCounted || installsSucceeded,
    lastDauDate: dauSucceeded ? plan.todayUtc : state.lastDauDate,
    lastMauMonth: mauSucceeded ? plan.monthUtc : state.lastMauMonth,
    countedVersions: versionSucceeded
      ? Array.from(
          new Set([
            ...(Array.isArray(state.countedVersions)
              ? state.countedVersions
              : []),
            plan.versionSegment,
          ]),
        )
      : state.countedVersions,
  };

  await saveState(nextState);
};

export const reportAnonymousUsage = async (
  deps?: TelemetryDeps,
): Promise<void> => {
  if (deps) {
    await runReportAnonymousUsage(deps);
    return;
  }
  if (inflightReport) {
    return inflightReport;
  }
  inflightReport = runReportAnonymousUsage().finally(() => {
    inflightReport = null;
  });
  return inflightReport;
};
