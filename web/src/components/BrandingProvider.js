'use client';

// Hands the saved branding to every client page.
//
// The root layout reads the setting on the server and passes it in here, so a
// page's first render - the HTML the visitor sees before any JavaScript runs -
// already says the right name. Pages read it with `useBranding()`.
//
// The System Configuration card calls `setBranding` after a save, so the
// dashboard the Super Admin is looking at changes with it instead of waiting
// for the next page load.

import { createContext, useContext, useMemo, useState } from 'react';
import { BRANDING_DEFAULT, brandFor, normalizeBranding } from '@/lib/branding';

const BrandingContext = createContext({
  brand: brandFor(BRANDING_DEFAULT),
  setBranding: () => {},
});

export default function BrandingProvider({ initial, children }) {
  const [setting, setSetting] = useState(() => normalizeBranding(initial));
  const value = useMemo(() => ({
    brand: brandFor(setting),
    setBranding: (next) => setSetting(normalizeBranding(next)),
  }), [setting]);
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

// { mode, name, sub, navSub, full, siteTitle, owner, church, platform, isPlatform, ... }
export const useBranding = () => useContext(BrandingContext).brand;

export const useSetBranding = () => useContext(BrandingContext).setBranding;
