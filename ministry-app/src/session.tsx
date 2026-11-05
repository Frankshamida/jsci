// ============================================================
// Session: sign-in, the cached dashboard, and the fingerprint lock.
//   token     the signed session from /api/ministry/login, in the phone's
//             secure storage (Keychain / Keystore)
//   home      the whole dashboard from one /api/ministry/home call, kept on
//             the phone so the app opens instantly and offline; fetched again
//             only when stale, on pull-to-refresh, or after a change
//   lock      optional fingerprint / Face ID lock, asked on open and when
//             coming back after RELOCK_AFTER_MS in the background
//   remember  "Keep me signed in": on, the token and the dashboard are kept on
//             the phone; off, they live in memory only and closing the app
//             signs out. The email is remembered for next time when on.
// ============================================================
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { api, setApiToken, setSessionEndedHandler } from './api';
import { DASHBOARD_STALE_MS, RELOCK_AFTER_MS } from './config';
import type { HomeData, Profile } from './types';

const TOKEN_KEY = 'jsci_ministry_token';
const LOCK_KEY = 'jsci_ministry_lock';
const CACHE_KEY = 'jsci_ministry_home';
const REMEMBER_KEY = 'jsci_ministry_remember';
const EMAIL_KEY = 'jsci_ministry_email';

export interface SignInError { message: string; field: 'email' | 'password' | null }

type Status = 'loading' | 'signedOut' | 'signedIn';

// Shown on the sign-in screen: why the app signed out ('warn'), or a goodbye
// after signing out on purpose ('farewell').
export type NoticeTone = 'warn' | 'farewell';
export interface Notice { text: string; tone: NoticeTone }

interface Session {
  status: Status;
  profile: Profile | null;
  home: HomeData | null;
  refreshing: boolean;
  loadError: string | null;
  lastUpdated: number | null;
  notice: Notice | null;
  welcome: boolean; // just signed in: Home greets them once
  dismissWelcome: () => void;
  signIn: (email: string, password: string, remember: boolean) => Promise<SignInError | null>;
  rememberedEmail: string;  // last email signed in with "Keep me signed in"
  rememberChoice: boolean;  // the last "Keep me signed in" choice
  signOut: (notice?: string, tone?: NoticeTone) => Promise<void>;
  refresh: (force?: boolean) => Promise<void>;
  lockEnabled: boolean;
  locked: boolean;
  biometricLabel: string;
  setLockEnabled: (on: boolean) => Promise<string | null>;
  unlock: () => Promise<boolean>;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be inside <SessionProvider>');
  return value;
}

async function biometricName(): Promise<string> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'Fingerprint';
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'Face ID';
    if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return 'Iris';
  } catch { /* fall through */ }
  return 'Fingerprint';
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [loginProfile, setLoginProfile] = useState<Profile | null>(null);
  const [home, setHome] = useState<HomeData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [welcome, setWelcome] = useState(false);
  const [lockEnabled, setLockEnabledState] = useState(false);
  const [locked, setLocked] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState('Fingerprint');
  const [rememberedEmail, setRememberedEmail] = useState('');
  const [rememberChoice, setRememberChoice] = useState(true);
  const remembered = useRef(true); // keep this session on the phone

  const lastUpdatedRef = useRef<number | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const backgroundAt = useRef<number | null>(null);

  const refresh = useCallback(async (force = false) => {
    if (inFlight.current) return inFlight.current;
    if (!force && lastUpdatedRef.current && Date.now() - lastUpdatedRef.current < DASHBOARD_STALE_MS) return;
    setRefreshing(true);
    const run = (async () => {
      const res = await api.home();
      if (res.ok) {
        const at = Date.now();
        lastUpdatedRef.current = at;
        setHome(res.data);
        setLastUpdated(at);
        setLoadError(null);
        if (remembered.current) await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ at, data: res.data })).catch(() => {});
      } else {
        setLoadError(res.message);
      }
    })().finally(() => { setRefreshing(false); inFlight.current = null; });
    inFlight.current = run;
    return run;
  }, []);

  const signOut = useCallback(async (why?: string, tone: NoticeTone = 'warn') => {
    setApiToken(null);
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {}),
      SecureStore.deleteItemAsync(LOCK_KEY).catch(() => {}),
      AsyncStorage.removeItem(CACHE_KEY).catch(() => {}),
    ]);
    lastUpdatedRef.current = null;
    setHome(null);
    setLoginProfile(null);
    setLastUpdated(null);
    setLockEnabledState(false);
    setLocked(false);
    setNotice(why ? { text: why, tone } : null);
    setWelcome(false);
    setStatus('signedOut');
  }, []);

  // Open: the saved session and the cached dashboard, before any network call.
  useEffect(() => {
    setSessionEndedHandler((message) => { signOut(message); });
    (async () => {
      setBiometricLabel(await biometricName());
      const [savedToken, lock, cached, rememberPref, email] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY).catch(() => null),
        SecureStore.getItemAsync(LOCK_KEY).catch(() => null),
        AsyncStorage.getItem(CACHE_KEY).catch(() => null),
        AsyncStorage.getItem(REMEMBER_KEY).catch(() => null),
        AsyncStorage.getItem(EMAIL_KEY).catch(() => null),
      ]);
      setRememberChoice(rememberPref !== '0');
      setRememberedEmail(email || '');
      if (!savedToken) { setStatus('signedOut'); return; }
      setApiToken(savedToken);
      if (cached) {
        try {
          const { at, data } = JSON.parse(cached);
          lastUpdatedRef.current = at;
          setLastUpdated(at);
          setHome(data);
        } catch { /* a bad cache is just refetched */ }
      }
      setLockEnabledState(lock === '1');
      setLocked(lock === '1');
      setStatus('signedIn');
    })();
    return () => setSessionEndedHandler(null);
  }, [signOut]);

  // Signed in: bring the dashboard up to date if the cache is stale.
  useEffect(() => { if (status === 'signedIn') refresh(); }, [status, refresh]);

  // Back from the background after a while: lock again, and refresh if stale.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundAt.current = Date.now();
      if (state === 'active') {
        const away = backgroundAt.current ? Date.now() - backgroundAt.current : 0;
        backgroundAt.current = null;
        if (lockEnabled && away > RELOCK_AFTER_MS) setLocked(true);
        if (status === 'signedIn') refresh();
      }
    });
    return () => sub.remove();
  }, [lockEnabled, status, refresh]);

  const signIn = useCallback(async (email: string, password: string, remember: boolean) => {
    const res = await api.login(email.trim(), password);
    if (!res.ok) {
      const field: SignInError['field'] = res.field === 'email' || res.field === 'password' ? res.field : null;
      return { message: res.message, field };
    }
    remembered.current = remember;
    setRememberChoice(remember);
    setApiToken(res.data.token);
    const cleanEmail = email.trim().toLowerCase();
    if (remember) {
      setRememberedEmail(cleanEmail);
      await Promise.all([
        SecureStore.setItemAsync(TOKEN_KEY, res.data.token),
        AsyncStorage.multiSet([[REMEMBER_KEY, '1'], [EMAIL_KEY, cleanEmail]]),
      ]).catch(() => {});
    } else {
      // This session only: nothing of it stays on the phone.
      setRememberedEmail('');
      await Promise.all([
        SecureStore.deleteItemAsync(TOKEN_KEY),
        AsyncStorage.multiRemove([CACHE_KEY, EMAIL_KEY]),
        AsyncStorage.setItem(REMEMBER_KEY, '0'),
      ]).catch(() => {});
    }
    setLoginProfile(res.data.profile);
    setNotice(null);
    setWelcome(true);
    lastUpdatedRef.current = null;
    setStatus('signedIn');
    return null;
  }, []);

  const unlock = useCallback(async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock JSCI Ministry',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });
    if (result.success) setLocked(false);
    return result.success;
  }, []);

  const setLockEnabled = useCallback(async (on: boolean) => {
    if (on) {
      if (!(await LocalAuthentication.hasHardwareAsync())) return 'This phone has no fingerprint or face sensor.';
      if (!(await LocalAuthentication.isEnrolledAsync())) return `Set up ${biometricLabel} in your phone's settings first.`;
      const check = await LocalAuthentication.authenticateAsync({ promptMessage: `Confirm with ${biometricLabel}`, cancelLabel: 'Cancel' });
      if (!check.success) return null; // cancelled: stays off, nothing to report
    }
    await SecureStore.setItemAsync(LOCK_KEY, on ? '1' : '0');
    setLockEnabledState(on);
    return null;
  }, [biometricLabel]);

  const dismissWelcome = useCallback(() => setWelcome(false), []);

  const value = useMemo<Session>(() => ({
    status,
    profile: home?.profile || loginProfile,
    home,
    refreshing,
    loadError,
    lastUpdated,
    notice,
    welcome,
    dismissWelcome,
    signIn,
    rememberedEmail,
    rememberChoice,
    signOut,
    refresh,
    lockEnabled,
    locked: status === 'signedIn' && locked,
    biometricLabel,
    setLockEnabled,
    unlock,
  }), [status, home, loginProfile, refreshing, loadError, lastUpdated, notice, welcome, dismissWelcome, signIn, rememberedEmail, rememberChoice, signOut, refresh, lockEnabled, locked, biometricLabel, setLockEnabled, unlock]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
