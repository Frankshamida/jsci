// ============================================================
// Look and feel: the JSCI website's colours (web/src/app/dashboard/
// dashboard.css), its Outfit font, in light and dark mode.
//   useTheme()     the current palette, and the Light / Dark / System choice
//   makeStyles()   a screen's styles, built once per mode
// ============================================================
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Scheme = 'light' | 'dark';
export type ThemePref = 'system' | Scheme;

export interface Palette {
  scheme: Scheme;
  background: string;   // the page
  surface: string;      // header, tab bar
  card: string;
  cardRaised: string;   // a card that stands out (cream in light mode)
  input: string;
  border: string;
  borderStrong: string;

  primary: string;      // website --primary   #926C15
  secondary: string;    // website --secondary #C9980B
  accent: string;       // website --accent    #FFC300
  goldText: string;     // gold that reads well on this background
  goldMuted: string;    // gold tint behind gold text
  gradient: [string, string]; // buttons and the active item, as on the website
  hero: [string, string, string]; // the website's welcome card

  text: string;
  textSecondary: string;
  textMuted: string;
  onGold: string;       // text on the gold gradient

  success: string;
  danger: string;
  warning: string;
  info: string;

  // One colour per part on a lineup, as in the Monthly Planner.
  leader: string;
  backup: string;
  band: string;
  dance: string;
}

const brand = { primary: '#926C15', secondary: '#C9980B', accent: '#FFC300' };
const hero: [string, string, string] = ['#1a1a2e', '#16213e', '#0f3460'];

const light: Palette = {
  scheme: 'light',
  background: '#f8f9fa',
  surface: '#ffffff',
  card: '#ffffff',
  cardRaised: '#faf7f0',
  input: '#f7f7fb',
  border: '#e0e0e0',
  borderStrong: '#cfcfd8',
  ...brand,
  goldText: '#926C15',
  goldMuted: 'rgba(146, 108, 21, 0.10)',
  gradient: [brand.primary, brand.secondary],
  hero,
  text: '#333333',
  textSecondary: '#6c757d',
  textMuted: '#9a9aa6',
  onGold: '#ffffff',
  success: '#28a745',
  danger: '#dc3545',
  warning: '#c68a00',
  info: '#138496',
  leader: '#926c15',
  backup: '#128193',
  band: '#6f42c1',
  dance: '#d63384',
};

const dark: Palette = {
  scheme: 'dark',
  background: '#1a1a2e',
  surface: '#1e1e2e',
  card: '#252540',
  cardRaised: '#2d2d44',
  input: '#2d2d44',
  border: '#3a3a5c',
  borderStrong: '#4a4a70',
  ...brand,
  goldText: '#FFC300',
  goldMuted: 'rgba(201, 152, 11, 0.16)',
  gradient: [brand.primary, brand.secondary],
  hero,
  text: '#e0e0e0',
  textSecondary: '#a0a0b8',
  textMuted: '#76769a',
  onGold: '#ffffff',
  success: '#3cc463',
  danger: '#f0596a',
  warning: '#ffc107',
  info: '#3fc1d6',
  leader: '#ffc300',
  backup: '#4fc3d7',
  band: '#a98ae6',
  dance: '#f06aa8',
};

export const palettes: Record<Scheme, Palette> = { light, dark };

// Outfit, the website's font. Each weight is its own family on the phone.
export const fonts = {
  regular: 'Outfit_400Regular',
  medium: 'Outfit_500Medium',
  semibold: 'Outfit_600SemiBold',
  bold: 'Outfit_700Bold',
  heavy: 'Outfit_800ExtraBold',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 10, lg: 14, xl: 20, pill: 999 };
export const font = { xs: 11, sm: 13, md: 15, lg: 17, xl: 20, xxl: 26, hero: 30 };

// The colour of a part on a lineup ("Song Leader", "Backup Singer", "Keyboard", "Dancer", ...).
export function partColor(c: Palette, part: string): string {
  if (part === 'Song Leader') return c.leader;
  if (part === 'Backup Singer') return c.backup;
  if (part === 'Dancer') return c.dance;
  return c.band;
}

// A colour with transparency: tint('#926C15', 0.12).
export function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// ---- Light / Dark / System ----

const THEME_KEY = 'jsci_ministry_theme';

interface Theme {
  colors: Palette;
  scheme: Scheme;
  pref: ThemePref;
  ready: boolean;
  setPref: (pref: ThemePref) => void;
  toggle: () => void;
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY)
      .then((v) => { if (v === 'light' || v === 'dark' || v === 'system') setPrefState(v); })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const scheme: Scheme = pref === 'system' ? (system === 'dark' ? 'dark' : 'light') : pref;

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next);
    AsyncStorage.setItem(THEME_KEY, next).catch(() => {});
  }, []);
  const toggle = useCallback(() => setPref(scheme === 'dark' ? 'light' : 'dark'), [scheme, setPref]);

  const value = useMemo<Theme>(() => ({ colors: palettes[scheme], scheme, pref, ready, setPref, toggle }), [scheme, pref, ready, setPref, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be inside <ThemeProvider>');
  return value;
}

// A screen's styles from the palette, made once per mode and reused:
//   const useStyles = makeStyles((c) => ({ title: { color: c.text } }));
//   ... const s = useStyles();
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(build: (c: Palette) => T): () => T {
  const made: Partial<Record<Scheme, T>> = {};
  return function useStyles() {
    const { colors } = useTheme();
    return (made[colors.scheme] ??= StyleSheet.create(build(colors)));
  };
}
