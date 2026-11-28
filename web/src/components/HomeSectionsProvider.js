'use client';

// Hands the hidden homepage sections (lib/homeSections.js) to every client
// page: the homepage leaves them out, and the menu and footers drop their
// links. The root layout reads the setting on the server and passes it in,
// so the first HTML is already right. The System Configuration card calls
// `setHidden` after a save.

import { createContext, useContext, useMemo, useState } from 'react';
import { hiddenAnchors, anchorOf } from '@/lib/homeSections';

const Ctx = createContext({ hidden: [], setHidden: () => {} });

export default function HomeSectionsProvider({ initial, children }) {
  const [hidden, setHidden] = useState(() => initial?.hidden || []);
  const value = useMemo(() => ({ hidden, setHidden }), [hidden]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * { hidden, shown(key), linkShown(href) }
 *   shown('isom')          is the ISOM section on the homepage?
 *   linkShown('/#isom')    does a link to it still lead anywhere?
 */
export function useHomeSections() {
  const { hidden } = useContext(Ctx);
  return useMemo(() => {
    const keys = new Set(hidden);
    const anchors = hiddenAnchors(hidden);
    return {
      hidden,
      shown: (key) => !keys.has(key),
      linkShown: (href) => { const a = anchorOf(href); return !a || !anchors.has(a); },
      anchorShown: (anchor) => !anchors.has(anchor),
    };
  }, [hidden]);
}

export const useSetHomeSections = () => useContext(Ctx).setHidden;
