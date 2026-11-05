// ============================================================
// JSCI Ministry app releases
// Every version of the Android app is a GitHub Release of this repository,
// tagged "ministry-app-v1.2.0", with the APK attached as
// "jsci-ministry-app-1.2.0.apk" (ministry-app/scripts/release.mjs does this).
// The download page, /ministrymobileapp/download and the app's "new version"
// notice all read them here, so a new release shows everywhere by itself.
//
// Read from the GitHub API (sizes and download counts). Without a token the
// API allows 60 calls an hour per server address, and Vercel's addresses are
// shared, so when the API says no, the public releases feed is read instead.
// Set GITHUB_TOKEN in Vercel to always use the API.
// ============================================================

export const RELEASE_REPO = process.env.MINISTRY_APP_REPO || 'Frankshamida/jsci';
export const RELEASES_TAG = 'ministry-app-releases'; // cache tag, refreshed by /api/ministry/app-release
export const TAG_PREFIX = 'ministry-app-v';
const REFRESH_SECONDS = 300;
const cacheOptions = { next: { revalidate: REFRESH_SECONDS, tags: [RELEASES_TAG] } };

export const apkFileName = (version) => `jsci-ministry-app-${version}.apk`;
const apkUrlFor = (tag, version) => `https://github.com/${RELEASE_REPO}/releases/download/${tag}/${apkFileName(version)}`;

/**
 * @typedef {{ version: string, tag: string, title: string, notes: string, publishedAt: string,
 *   apk: { name: string, url: string, size: number, downloads: number } }} AppRelease
 */

/** All published releases of the app, newest first. Empty if GitHub cannot be reached. */
export async function getMinistryAppReleases() {
  const list = (await fromApi()) || (await fromFeed()) || [];
  return list.sort((a, b) => compareVersions(b.version, a.version));
}

/** The newest release, or null. */
export async function getLatestMinistryApp() {
  return (await getMinistryAppReleases())[0] || null;
}

// ---- GitHub API ----
async function fromApi() {
  try {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'sanctuaryhub-ministry-app' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${RELEASE_REPO}/releases?per_page=30`, { headers, ...cacheOptions });
    if (!res.ok) return null;
    const list = await res.json();
    if (!Array.isArray(list)) return null;
    return list
      .filter((r) => !r.draft && !r.prerelease && String(r.tag_name || '').startsWith(TAG_PREFIX))
      .map((r) => {
        const apk = (r.assets || []).find((a) => /\.apk$/i.test(a.name));
        if (!apk) return null;
        const version = r.tag_name.slice(TAG_PREFIX.length);
        return {
          version,
          tag: r.tag_name,
          title: r.name || `JSCI Ministry ${version}`,
          notes: r.body || '',
          publishedAt: r.published_at || r.created_at,
          apk: { name: apk.name, url: apk.browser_download_url, size: apk.size, downloads: apk.download_count || 0 },
        };
      })
      .filter(Boolean);
  } catch {
    return null;
  }
}

// ---- Public releases feed (no API limit) ----
async function fromFeed() {
  try {
    const res = await fetch(`https://github.com/${RELEASE_REPO}/releases.atom`, { headers: { 'User-Agent': 'sanctuaryhub-ministry-app' }, ...cacheOptions });
    if (!res.ok) return null;
    const xml = await res.text();
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
    const releases = entries.map((entry) => {
      const tag = (entry.match(/<id>[^<]*\/([^/<]+)<\/id>/) || [])[1] || '';
      if (!tag.startsWith(TAG_PREFIX)) return null;
      const version = tag.slice(TAG_PREFIX.length);
      return {
        version,
        tag,
        title: decode((entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || `JSCI Ministry ${version}`),
        notes: htmlToNotes(decode((entry.match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1] || '')),
        publishedAt: (entry.match(/<updated>([^<]+)<\/updated>/) || [])[1] || new Date().toISOString(),
        apk: { name: apkFileName(version), url: apkUrlFor(tag, version), size: 0, downloads: 0 },
      };
    }).filter(Boolean);
    // The feed has no file sizes: ask for the newest one's.
    const newest = releases.sort((a, b) => compareVersions(b.version, a.version))[0];
    if (newest) newest.apk.size = await fileSize(newest.apk.url);
    return releases;
  } catch {
    return null;
  }
}

async function fileSize(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', ...cacheOptions });
    return Number(res.headers.get('content-length')) || 0;
  } catch {
    return 0;
  }
}

const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// The feed's notes are HTML; the page shows "- bullets", "## headings" and lines.
const htmlToNotes = (html) => decode(html
  .replace(/<li[^>]*>/gi, '\n- ')
  .replace(/<h[1-6][^>]*>/gi, '\n## ')
  .replace(/<\/(p|h[1-6]|ul|ol)>/gi, '\n')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, ''))
  .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');

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
