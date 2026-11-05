import Constants from 'expo-constants';

// The JSCI website the app talks to. The app reaches the data only through
// its /api/ministry routes: no database key, no AI or YouTube key lives in the
// app, so nothing in it can run up an API bill.
export const API_BASE_URL = 'https://sanctuaryhub.vercel.app';

// The dashboard is cached on the phone. It is fetched again only when older
// than this, on pull-to-refresh, or after you change something.
export const DASHBOARD_STALE_MS = 5 * 60 * 1000;

// Coming back to the app after this long asks for the fingerprint again.
export const RELOCK_AFTER_MS = 30 * 1000;

// Practice recordings: small mono AAC, so ten minutes stays under the
// server's 4.4 MB upload limit.
export const MAX_RECORDING_SECONDS = 10 * 60;
export const MAX_UPLOAD_BYTES = 4.4 * 1024 * 1024;

// This app's version (app.json "version"), and where the newest one is.
// The dashboard says which version is the latest, so no extra call is made.
export const APP_VERSION: string = Constants.expoConfig?.version || '0.0.0';
export const DOWNLOAD_PAGE_URL = `${API_BASE_URL}/ministrymobileapp`;

// "1.10.0" is newer than "1.9.2".
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = candidate.split('.').map((n) => parseInt(n, 10) || 0);
  const b = current.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}
