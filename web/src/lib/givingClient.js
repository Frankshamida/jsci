'use client';

// Giving in the browser: gifts sent before signing in, added to the account
// once somebody signs in (only those sent with the account's own email - see
// /api/giving/claim), and the signed-in account's own gifts.

import { useCallback, useEffect, useState } from 'react';
import { forgetGifts, phYear, rememberedGifts } from '@/lib/giving';

export async function claimRememberedGifts(viewer) {
  const tokens = rememberedGifts();
  if (!viewer?.id || !tokens.length) return 0;
  try {
    const res = await fetch('/api/giving/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: viewer.id, tokens }),
    });
    const json = await res.json().catch(() => ({}));
    if (json.success && Array.isArray(json.tokens)) forgetGifts(json.tokens);
    return json.linked || 0;
  } catch { return 0; }
}

// { gifts, loading, error, reload } for the signed-in account.
export function useMyGifts(viewer) {
  const [state, setState] = useState({ gifts: [], loading: true, error: '' });
  const id = viewer?.id;
  const email = viewer?.email;
  const load = useCallback(async () => {
    if (!id) { setState({ gifts: [], loading: false, error: '' }); return; }
    setState((s) => ({ ...s, loading: true, error: '' }));
    await claimRememberedGifts({ id });
    try {
      const res = await fetch(`/api/giving/gifts?userId=${encodeURIComponent(id)}&email=${encodeURIComponent(email || '')}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Your giving could not be loaded.');
      setState({ gifts: json.data || [], loading: false, error: '' });
    } catch (err) {
      setState({ gifts: [], loading: false, error: err.message });
    }
  }, [id, email]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

// The featured campaigns (or none), for the cards drawn in the browser.
export function useFeaturedCampaigns() {
  const [campaigns, setCampaigns] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/giving?featured=1')
      .then((r) => (r.ok ? r.json() : { campaigns: [] }))
      .then((j) => { if (alive) setCampaigns(Array.isArray(j.campaigns) ? j.campaigns : []); })
      .catch(() => { if (alive) setCampaigns([]); });
    return () => { alive = false; };
  }, []);
  return campaigns;
}

// Totals a giver cares about: confirmed this year, and how many are waiting.
export function givingTotals(gifts, year) {
  let given = 0;
  let pending = 0;
  (gifts || []).forEach((g) => {
    if (g.status === 'successful' && g.given_at && phYear(g.given_at) === String(year)) given += Number(g.amount) || 0;
    if (g.status === 'pending') pending += 1;
  });
  return { given: Math.round(given * 100) / 100, pending };
}
