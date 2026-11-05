// Where the app is running. The same code is the Android app and the web app
// at sanctuaryhub.vercel.app/ministrysystem (for iPhone: Add to Home Screen).
import { Platform } from 'react-native';

export const IS_WEB = Platform.OS === 'web';

// Animations run on the phone's UI thread; browsers have no such driver.
export const NATIVE_DRIVER = !IS_WEB;

// The browser's objects, without pulling the DOM types into the app.
const browser = globalThis as unknown as {
  navigator?: { userAgent?: string; platform?: string; maxTouchPoints?: number; standalone?: boolean };
  matchMedia?: (q: string) => { matches: boolean };
};

/** An iPhone or iPad browser. */
export function isIosWeb(): boolean {
  if (!IS_WEB || !browser.navigator) return false;
  const ua = browser.navigator.userAgent || '';
  return /iphone|ipad|ipod/i.test(ua) || (browser.navigator.platform === 'MacIntel' && (browser.navigator.maxTouchPoints || 0) > 1);
}

/** An Android phone's browser. */
export const isAndroidWeb = () => IS_WEB && /android/i.test(browser.navigator?.userAgent || '');

/** Opened from the Home Screen icon (full screen, no browser bars). */
export function isStandalone(): boolean {
  if (!IS_WEB) return true;
  return !!browser.matchMedia?.('(display-mode: standalone)').matches || browser.navigator?.standalone === true;
}
