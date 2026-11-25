import { describe, expect, it, vi } from 'vitest';

import {
  buildTelemetryKeysToPing,
  normalizePlatformOs,
  reportAnonymousUsage,
  sanitizeCounterSegment,
  type TelemetryLocalState,
} from './telemetryService';

const ALLOWED_KEY_PREFIXES = ['installs-', 'dau-', 'mau-', 'ver-'];

describe('telemetryService', () => {
  it('normalizes OS and sanitizes version segments cleanly', () => {
    expect(normalizePlatformOs('Android')).toBe('android');
    expect(normalizePlatformOs('win32')).toBe('windows');
    expect(normalizePlatformOs('darwin')).toBe('macos');
    expect(normalizePlatformOs('linux')).toBe('linux');
    expect(normalizePlatformOs('unknown-os')).toBe('other');
    expect(sanitizeCounterSegment('v1.0.9-rc1')).toBe('1.0.9-rc1');
    expect(sanitizeCounterSegment('1.0.8+foo bar')).toBe('1.0.8-foo-bar');
  });

  it('sends install, DAU, MAU, and version counters once on first launch and saves state', async () => {
    let persisted: TelemetryLocalState = {};
    const hitKeys: string[] = [];

    await reportAnonymousUsage({
      enabled: true,
      os: 'linux',
      version: '1.0.8',
      now: new Date('2026-11-25T10:15:00.000Z'),
      loadState: async () => persisted,
      saveState: async (next) => {
        persisted = next;
      },
      hit: async (key) => {
        hitKeys.push(key);
        return true;
      },
    });

    expect(hitKeys).toEqual([
      'installs-total',
      'installs-linux',
      'dau-2026-11-25',
      'dau-linux-2026-11-25',
      'mau-2026-11',
      'ver-1.0.8',
    ]);
    expect(persisted).toEqual({
      installCounted: true,
      lastDauDate: '2026-11-25',
      lastMauMonth: '2026-11',
      countedVersions: ['1.0.8'],
    });
  });

  it('sends zero pings on repeated launches on the same UTC day', async () => {
    const persisted: TelemetryLocalState = {
      installCounted: true,
      lastDauDate: '2026-11-25',
      lastMauMonth: '2026-11',
      countedVersions: ['1.0.8'],
    };
    const hit = vi.fn().mockResolvedValue(true);
    const saveState = vi.fn().mockResolvedValue(undefined);

    await reportAnonymousUsage({
      enabled: true,
      os: 'android',
      version: '1.0.8',
      now: new Date('2026-11-25T23:50:00.000Z'),
      loadState: async () => persisted,
      saveState,
      hit,
    });

    expect(hit).not.toHaveBeenCalled();
    expect(saveState).not.toHaveBeenCalled();
  });

  it('sends only DAU counters on the next UTC day within the same month & version', async () => {
    let persisted: TelemetryLocalState = {
      installCounted: true,
      lastDauDate: '2026-11-25',
      lastMauMonth: '2026-11',
      countedVersions: ['1.0.8'],
    };
    const hitKeys: string[] = [];

    await reportAnonymousUsage({
      enabled: true,
      os: 'windows',
      version: '1.0.8',
      now: new Date('2026-11-26T00:05:00.000Z'),
      loadState: async () => persisted,
      saveState: async (next) => {
        persisted = next;
      },
      hit: async (key) => {
        hitKeys.push(key);
        return true;
      },
    });

    expect(hitKeys).toEqual(['dau-2026-11-26', 'dau-windows-2026-11-26']);
    expect(persisted).toEqual({
      installCounted: true,
      lastDauDate: '2026-11-26',
      lastMauMonth: '2026-11',
      countedVersions: ['1.0.8'],
    });
  });

  it('sends new version counter once when updated within the same day/month', async () => {
    let persisted: TelemetryLocalState = {
      installCounted: true,
      lastDauDate: '2026-11-26',
      lastMauMonth: '2026-11',
      countedVersions: ['1.0.8'],
    };
    const hitKeys: string[] = [];

    await reportAnonymousUsage({
      enabled: true,
      os: 'macos',
      version: '1.0.9',
      now: new Date('2026-11-26T08:00:00.000Z'),
      loadState: async () => persisted,
      saveState: async (next) => {
        persisted = next;
      },
      hit: async (key) => {
        hitKeys.push(key);
        return true;
      },
    });

    expect(hitKeys).toEqual(['ver-1.0.9']);
    expect(persisted.countedVersions).toEqual(['1.0.8', '1.0.9']);
  });

  it('respects user opt-out and sends zero pings when disabled', async () => {
    const hit = vi.fn().mockResolvedValue(true);
    const loadState = vi.fn().mockResolvedValue({});
    const saveState = vi.fn().mockResolvedValue(undefined);

    await reportAnonymousUsage({
      enabled: false,
      os: 'linux',
      version: '1.0.9',
      loadState,
      saveState,
      hit,
    });

    expect(hit).not.toHaveBeenCalled();
    expect(loadState).not.toHaveBeenCalled();
    expect(saveState).not.toHaveBeenCalled();
  });

  it('does not mark buckets as sent when network fails so next launch retries', async () => {
    const saveState = vi.fn().mockResolvedValue(undefined);
    const hit = vi.fn().mockResolvedValue(false);

    await reportAnonymousUsage({
      enabled: true,
      os: 'android',
      version: '1.0.9',
      now: new Date('2026-11-26T09:00:00.000Z'),
      loadState: async () => ({}),
      saveState,
      hit,
    });

    expect(hit).toHaveBeenCalled();
    expect(saveState).not.toHaveBeenCalled();
  });

  it('emits only allowlisted anonymous bucket keys and contains no PII fields', () => {
    const plan = buildTelemetryKeysToPing({
      state: {},
      os: 'android',
      version: '1.0.9',
      now: new Date('2026-12-01T01:02:03.000Z'),
    });

    expect(plan.allKeys.length).toBeGreaterThan(0);
    for (const key of plan.allKeys) {
      expect(
        ALLOWED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)),
      ).toBe(true);
      expect(key).toMatch(/^[A-Za-z0-9_.-]{3,64}$/);
    }
  });
});
