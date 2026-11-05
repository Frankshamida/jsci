// ============================================================
// JSCI Ministry app releases
// Every version of the Android app is a GitHub Release of this repository,
// tagged "ministry-app-v1.2.0", with the APK attached as
// "jsci-ministry-app-1.2.0.apk" (ministry-app/scripts/release.mjs does this).
// The download page, /ministrymobileapp/download and the app's "new version"
// notice all read them here, so a new release shows everywhere by itself.
// ============================================================

const REPO = process.env.MINISTRY_APP_REPO || 'Frankshamida/jsci';
export const TAG_PREFIX = 'ministry-app-v';
// Fetched again at most every few minutes (GitHub allows 60 calls an hour without a token).
const REFRESH_SECONDS = 300;

/**
 * @typedef {{ version: string, tag: string, title: string, notes: string, publishedAt: string,
 *   apk: { name: string, url: string, size: number, downloads: number } }} AppRelease
 */

/** All published releases of the app, newest first. Empty if GitHub cannot be reached. */
export async function getMinistryAppReleases() {
  try {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'sanctuaryhub-ministry-app' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
      headers,
      next: { revalidate: REFRESH_SECONDS, tags: ['ministry-app-releases'] },
    });
    if (!res.ok) return [];
    const list = await res.json();
    return (Array.isArray(list) ? list : [])
      .filter((r) => !r.draft && !r.prerelease && String(r.tag_name || '').startsWith(TAG_PREFIX))
      .map((r) => {
        const apk = (r.assets || []).find((a) => /\.apk$/i.test(a.name));
        if (!apk) return null;
        return {
          version: r.tag_name.slice(TAG_PREFIX.length),
          tag: r.tag_name,
          title: r.name || `JSCI Ministry ${r.tag_name.slice(TAG_PREFIX.length)}`,
          notes: r.body || '',
          publishedAt: r.published_at || r.created_at,
          apk: { name: apk.name, url: apk.browser_download_url, size: apk.size, downloads: apk.download_count || 0 },
        };
      })
      .filter(Boolean)
      .sort((a, b) => compareVersions(b.version, a.version));
  } catch {
    return [];
  }
}

/** The newest release, or null. */
export async function getLatestMinistryApp() {
  return (await getMinistryAppReleases())[0] || null;
}

// "1.10.0" after "1.9.2".
export function compareVersions(a, b) {
  const x = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const y = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  }
  return 0;
}

export const formatSize = (bytes) => (bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '');
