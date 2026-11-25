#!/usr/bin/env node
/**
 * Read-only CLI dashboard combining GitHub Releases download counts
 * with anonymous active-user / install counters (CountAPI /get endpoint only).
 *
 * Usage:
 *   node scripts/check-stats.mjs
 *   pnpm stats
 *   pnpm stats --json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/ivan-petrovich1/nuclear-mobile/releases?per_page=30';
const COUNTAPI_BASE = 'https://countapi.mileshilliard.com/api/v1';
const COUNTAPI_PREFIX = 'ivan-nuclear-mobile-v1';

const OS_LIST = ['android', 'linux', 'windows', 'macos'];

const jsonMode = process.argv.includes('--json');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sanitizeVersion = (raw) =>
  String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^v(?=\d)/, '')
    .replace(/[^a-z0-9_.-]/g, '-')
    .slice(0, 32);

const formatUtcDate = (date) => date.toISOString().slice(0, 10);

const getPreviousUtcMonth = (now) => {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed
  const prev = new Date(Date.UTC(year, month - 1, 1));
  return prev.toISOString().slice(0, 7);
};

const readLocalVersion = () => {
  try {
    const tauriConfPath = path.join(
      REPO_ROOT,
      'packages/player/src-tauri/tauri.conf.json',
    );
    const conf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
    return typeof conf.version === 'string' ? conf.version : null;
  } catch {
    return null;
  }
};

const classifyAssetPlatform = (name) => {
  const lower = String(name ?? '').toLowerCase();
  if (lower.endsWith('.apk')) {
    return 'android';
  }
  if (
    lower.endsWith('.appimage') ||
    lower.endsWith('.deb') ||
    lower.endsWith('.rpm') ||
    lower.endsWith('.tar.gz')
  ) {
    return 'linux';
  }
  if (lower.endsWith('.exe') || lower.endsWith('.msi')) {
    return 'windows';
  }
  if (lower.endsWith('.dmg')) {
    return 'macos';
  }
  return 'other';
};

const fetchGitHubReleases = async () => {
  const res = await fetch(GITHUB_RELEASES_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'nuclear-mobile-stats-script',
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    throw new Error(`GitHub API HTTP ${res.status}`);
  }
  const releases = await res.json();
  if (!Array.isArray(releases)) {
    throw new Error('Unexpected GitHub API payload');
  }
  return releases;
};

// Strictly uses GET /get/... (NEVER /hit/...) so viewing stats never inflates counts.
const fetchCounter = async (key, attempt = 0) => {
  const fullKey = `${COUNTAPI_PREFIX}-${key}`;
  const url = `${COUNTAPI_BASE}/get/${encodeURIComponent(fullKey)}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(6000),
    });
    if (res.status === 404) {
      return { key, value: 0, error: null };
    }
    if (res.status === 429 && attempt < 1) {
      const retryAfterRaw = res.headers.get('retry-after');
      const retryMs = retryAfterRaw
        ? Math.min(8000, Math.max(500, Number(retryAfterRaw) * 1000 || 1500))
        : 1500;
      await sleep(retryMs);
      return fetchCounter(key, attempt + 1);
    }
    if (!res.ok) {
      return { key, value: null, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const parsed = Number(data?.value);
    const value = Number.isFinite(parsed) ? parsed : 0;
    return { key, value, error: null };
  } catch (err) {
    if (attempt < 1) {
      await sleep(300);
      return fetchCounter(key, attempt + 1);
    }
    return { key, value: null, error: err?.message ?? String(err) };
  }
};

const fetchCountersBatched = async (keys, batchSize = 6, delayMs = 80) => {
  const uniqueKeys = Array.from(new Set(keys));
  const out = {};
  const errors = {};

  for (let i = 0; i < uniqueKeys.length; i += batchSize) {
    const batch = uniqueKeys.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((k) => fetchCounter(k)));
    for (const r of results) {
      out[r.key] = r.value;
      if (r.error) {
        errors[r.key] = r.error;
      }
    }
    if (i + batchSize < uniqueKeys.length) {
      await sleep(delayMs);
    }
  }

  return { values: out, errors };
};

const main = async () => {
  const now = new Date();
  const todayUtc = formatUtcDate(now);
  const currentMonthUtc = now.toISOString().slice(0, 7);
  const prevMonthUtc = getPreviousUtcMonth(now);
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getTime() - i * 86_400_000);
    return formatUtcDate(d);
  });

  let releases = [];
  let githubError = null;
  try {
    releases = await fetchGitHubReleases();
  } catch (err) {
    githubError = err?.message ?? String(err);
  }

  const platformTotals = {
    android: 0,
    linux: 0,
    windows: 0,
    macos: 0,
    other: 0,
  };
  let totalDownloads = 0;

  const releaseSummaries = releases.map((r) => {
    const assets = Array.isArray(r.assets) ? r.assets : [];
    let releaseTotal = 0;
    const assetRows = assets.map((a) => {
      const count = Number(a.download_count ?? 0);
      const platform = classifyAssetPlatform(a.name);
      platformTotals[platform] += count;
      releaseTotal += count;
      totalDownloads += count;
      return {
        name: a.name,
        platform,
        downloads: count,
      };
    });
    return {
      tag: r.tag_name ?? 'unknown',
      publishedAt: (r.published_at ?? '').slice(0, 10),
      totalDownloads: releaseTotal,
      assets: assetRows,
    };
  });

  const versionSet = new Set();
  const localVersion = readLocalVersion();
  if (localVersion) {
    versionSet.add(sanitizeVersion(localVersion));
  }
  for (const r of releaseSummaries.slice(0, 4)) {
    const cleaned = sanitizeVersion(r.tag);
    if (cleaned) {
      versionSet.add(cleaned);
    }
  }
  const trackedVersions = Array.from(versionSet).filter(Boolean);

  const counterKeys = [
    'installs-total',
    ...OS_LIST.map((os) => `installs-${os}`),
    `mau-${currentMonthUtc}`,
    `mau-${prevMonthUtc}`,
    ...last7Days.map((day) => `dau-${day}`),
    ...OS_LIST.map((os) => `dau-${os}-${todayUtc}`),
    ...trackedVersions.map((ver) => `ver-${ver}`),
  ];

  const counters = await fetchCountersBatched(counterKeys, 6, 80);

  const summary = {
    generatedAtUtc: now.toISOString(),
    github: {
      error: githubError,
      totalDownloads,
      platformTotals,
      releases: releaseSummaries,
    },
    telemetry: {
      namespace: COUNTAPI_PREFIX,
      errorCount: Object.keys(counters.errors).length,
      installs: {
        total: counters.values['installs-total'] ?? null,
        byOs: Object.fromEntries(
          OS_LIST.map((os) => [os, counters.values[`installs-${os}`] ?? null]),
        ),
      },
      mau: {
        [currentMonthUtc]: counters.values[`mau-${currentMonthUtc}`] ?? null,
        [prevMonthUtc]: counters.values[`mau-${prevMonthUtc}`] ?? null,
      },
      dau: {
        last7Days: Object.fromEntries(
          last7Days.map((day) => [day, counters.values[`dau-${day}`] ?? null]),
        ),
        todayByOs: Object.fromEntries(
          OS_LIST.map((os) => [
            os,
            counters.values[`dau-${os}-${todayUtc}`] ?? null,
          ]),
        ),
      },
      versions: Object.fromEntries(
        trackedVersions.map((ver) => [
          ver,
          counters.values[`ver-${ver}`] ?? null,
        ]),
      ),
    },
  };

  if (jsonMode) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log('\n=== Nuclear Mobile Fork — Downloads & Anonymous Usage Stats ===');
  console.log(`UTC Time: ${summary.generatedAtUtc}\n`);

  console.log('📦 GitHub Releases Downloads:');
  if (githubError) {
    console.log(`  Error fetching GitHub releases: ${githubError}`);
  } else {
    console.log(`  Total across all releases: ${totalDownloads}`);
    console.log(
      `  By platform: Android APK=${platformTotals.android}, Linux=${platformTotals.linux}, Windows=${platformTotals.windows}, macOS=${platformTotals.macos}` +
        (platformTotals.other > 0 ? `, Other=${platformTotals.other}` : ''),
    );
    for (const rel of releaseSummaries) {
      const nonZero = rel.assets
        .filter((a) => a.downloads > 0)
        .map((a) => `${a.name}:${a.downloads}`)
        .join(', ');
      console.log(
        `  - ${rel.tag} (${rel.publishedAt || 'draft'}): ${rel.totalDownloads}` +
          (nonZero ? ` [${nonZero}]` : ''),
      );
    }
  }

  console.log(`\n📊 Anonymous App Usage (${COUNTAPI_PREFIX}, read-only):`);
  if (Object.keys(counters.errors).length > 0) {
    console.log(
      `  Note: ${Object.keys(counters.errors).length} counter request(s) failed; partial values shown.`,
    );
  }
  const fmt = (v) => (v === null || v === undefined ? '?' : String(v));
  console.log(
    `  Installs: total=${fmt(summary.telemetry.installs.total)} | ` +
      OS_LIST.map((os) => `${os}=${fmt(summary.telemetry.installs.byOs[os])}`).join(
        ', ',
      ),
  );
  console.log(
    `  Monthly Active (MAU): ${currentMonthUtc}=${fmt(summary.telemetry.mau[currentMonthUtc])}, ${prevMonthUtc}=${fmt(summary.telemetry.mau[prevMonthUtc])}`,
  );
  console.log(
    `  Today DAU (${todayUtc}): total=${fmt(summary.telemetry.dau.last7Days[todayUtc])} | ` +
      OS_LIST.map(
        (os) => `${os}=${fmt(summary.telemetry.dau.todayByOs[os])}`,
      ).join(', '),
  );
  console.log(
    `  Last 7d DAU: ${last7Days
      .map((d) => `${d.slice(5)}=${fmt(summary.telemetry.dau.last7Days[d])}`)
      .join(' | ')}`,
  );
  console.log(
    `  Active by version: ${trackedVersions
      .map((v) => `v${v}=${fmt(summary.telemetry.versions[v])}`)
      .join(', ')}`,
  );
  console.log('');
};

main().catch((err) => {
  console.error('Stats script failed:', err?.message ?? err);
  process.exit(1);
});
