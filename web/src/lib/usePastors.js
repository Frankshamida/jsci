'use client';

// "Our Pastors" from their accounts (/api/pastors): the Pastor accounts
// marked to be shown on the website, in order. Until that is set up
// (supabase/migrations/pastors_on_website.sql), or if the request fails, the
// page's own list is shown instead, so the section is never empty by mistake.
// Asked once per page load, however many places show the pastors.

import { useEffect, useState } from 'react';

let asked = null;
function ask() {
  if (!asked) {
    asked = fetch('/api/pastors')
      .then((r) => r.json())
      .catch(() => ({ fallback: true, pastors: [] }));
  }
  return asked;
}

/**
 * @param {Array<{name,title,photo}>} fallback the page's own list
 * @returns {Array<{name,title,photo}>} the pastors to show (fallback until known)
 */
export function usePastors(fallback) {
  const [pastors, setPastors] = useState(fallback);
  useEffect(() => {
    let alive = true;
    ask().then((j) => {
      if (!alive) return;
      if (j && j.fallback === false && Array.isArray(j.pastors)) setPastors(j.pastors);
    });
    return () => { alive = false; };
  }, []);
  return pastors;
}
