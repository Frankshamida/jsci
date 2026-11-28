'use client';

// A signed-in Guest on the home page: one slim line under "This week" - who
// is signed in, and the way to their dashboard, where their events, giving,
// the services and the announcements are (components/guest/GuestOverview).
// The home page itself stays the public page every visitor sees.
//
// It also asks the server whether the account is still only a Guest: one
// promoted to member since signing in gets the right navbar at once.

import { useEffect } from 'react';
import { initialsOf, isGuestOnly, saveViewer } from '@/lib/viewer';
import './guestHome.css';

export default function GuestHome({ viewer }) {
  const first = String(viewer.firstname || '').trim().split(/\s+/)[0];

  // Still only a Guest? (An Admin may have made them a member since.)
  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/users?action=get-event-permissions&userId=${encodeURIComponent(viewer.id)}`)
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        if (!alive || !j.success) return;
        const fresh = { ...(j.account || {}), allowed_event_types: j.allowed_event_types || [] };
        const changed = Object.keys(fresh).some((k) => JSON.stringify(fresh[k] ?? null) !== JSON.stringify(viewer[k] ?? null));
        if (changed) saveViewer({ ...viewer, ...fresh });
      })
      .catch(() => { /* the saved account stands */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer.id]);

  if (!isGuestOnly(viewer)) return null;

  return (
    <section id="my-home" className="gh" aria-label="Your account">
      <div className="gh-inner">
        <span className="gh-avatar" aria-hidden="true">
          {viewer.profile_picture ? <img src={viewer.profile_picture} alt="" referrerPolicy="no-referrer" /> : initialsOf(viewer)}
        </span>
        <p className="gh-text">
          <strong>Signed in as {first || 'you'}</strong>
          <span className="gh-role">Guest</span>
          <span className="gh-sub">Your events, giving and our services are in your dashboard.</span>
        </p>
        <a href="/dashboard" className="gh-btn">Go to my dashboard</a>
      </div>
    </section>
  );
}
