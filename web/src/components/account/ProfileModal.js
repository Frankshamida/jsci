'use client';

// "My profile" for a Guest, in a window over whatever public page they are
// on - Guests have no dashboard, so their details and password are changed
// here: their name, birthday, and password (or, for a Google account without
// one, a password of its own). The same endpoints as the dashboard's
// My Profile.

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { initialsOf, saveViewer } from '@/lib/viewer';
import './account.css';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return json;
}

export default function ProfileModal({ viewer, onClose }) {
  const titleId = useId();
  const box = useRef(null);
  const [details, setDetails] = useState({ firstname: viewer.firstname || '', lastname: viewer.lastname || '', birthdate: viewer.birthdate || '' });
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [pwOpen, setPwOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null); // { where, type, text }
  const hasPassword = viewer.hasPassword !== false;

  useEffect(() => {
    const before = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    setTimeout(() => box.current?.querySelector('input')?.focus(), 40);
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const all = [...box.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!all.length) return;
      const [a, z] = [all[0], all[all.length - 1]];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, [onClose]);

  const saveDetails = async (e) => {
    e.preventDefault();
    if (!details.firstname.trim() || !details.lastname.trim()) { setMsg({ where: 'details', type: 'bad', text: 'Please enter your first and last name.' }); return; }
    setBusy('details');
    setMsg(null);
    try {
      const json = await post('/api/profile/update', { email: viewer.email, firstname: details.firstname, lastname: details.lastname, birthdate: details.birthdate || null });
      if (!json.success) throw new Error(json.message || 'Your details could not be saved.');
      const firstname = json.data?.firstname || details.firstname;
      const lastname = json.data?.lastname || details.lastname;
      setDetails((d) => ({ ...d, firstname, lastname }));
      saveViewer({ ...viewer, firstname, lastname, birthdate: details.birthdate || null });
      setMsg({ where: 'details', type: 'ok', text: 'Your details are saved.' });
    } catch (err) {
      setMsg({ where: 'details', type: 'bad', text: err.message });
    } finally {
      setBusy('');
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    if (pw.next.length < 8) { setMsg({ where: 'pw', type: 'bad', text: 'The new password needs at least 8 characters.' }); return; }
    if (pw.next !== pw.again) { setMsg({ where: 'pw', type: 'bad', text: 'The two new passwords are not the same.' }); return; }
    setBusy('pw');
    setMsg(null);
    try {
      if (hasPassword) {
        const ok = await post('/api/profile/verify-password', { email: viewer.email, currentPassword: pw.current });
        if (!ok.success) throw new Error('Your current password is not right.');
        const json = await post('/api/profile/update-password', { email: viewer.email, newPassword: pw.next });
        if (!json.success) throw new Error(json.message || 'Your password could not be changed.');
      } else {
        const json = await post('/api/profile/set-password', { email: viewer.email, newPassword: pw.next });
        if (!json.success) throw new Error(json.message || 'Your password could not be set.');
        saveViewer({ ...viewer, hasPassword: true });
      }
      setPw({ current: '', next: '', again: '' });
      setPwOpen(false);
      setMsg({ where: 'pw', type: 'ok', text: hasPassword ? 'Your password is changed.' : 'Your password is set. You can now sign in with your email too.' });
    } catch (err) {
      setMsg({ where: 'pw', type: 'bad', text: err.message });
    } finally {
      setBusy('');
    }
  };

  const say = (where) => (msg?.where === where ? <p className={`ac-msg ${msg.type}`} role={msg.type === 'bad' ? 'alert' : 'status'}>{msg.text}</p> : null);
  const name = [details.firstname, details.lastname].filter(Boolean).join(' ');

  return createPortal(
    <div className="ac-root">
      <div className="ac-overlay" onClick={() => { if (!busy) onClose(); }} aria-hidden="true"></div>
      <div ref={box} className="ac-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ac-head">
          <span className="ac-avatar" aria-hidden="true">
            {viewer.profile_picture ? <img src={viewer.profile_picture} alt="" referrerPolicy="no-referrer" /> : initialsOf(viewer)}
          </span>
          <div>
            <h2 id={titleId}>{name || 'My profile'}</h2>
            <p>{viewer.email}</p>
          </div>
          <button type="button" className="ac-x" onClick={onClose} disabled={!!busy} aria-label="Close">×</button>
        </div>

        <form className="ac-section" onSubmit={saveDetails} noValidate>
          <h3>Your details</h3>
          <div className="ac-two">
            <label className="ac-field">
              <span>First name</span>
              <input className="ac-input" autoComplete="given-name" maxLength={60} value={details.firstname} onChange={(e) => setDetails((d) => ({ ...d, firstname: e.target.value }))} />
            </label>
            <label className="ac-field">
              <span>Last name</span>
              <input className="ac-input" autoComplete="family-name" maxLength={60} value={details.lastname} onChange={(e) => setDetails((d) => ({ ...d, lastname: e.target.value }))} />
            </label>
          </div>
          <label className="ac-field">
            <span>Birthday <em>optional</em></span>
            <input className="ac-input" type="date" value={details.birthdate || ''} onChange={(e) => setDetails((d) => ({ ...d, birthdate: e.target.value }))} />
          </label>
          {say('details')}
          <div className="ac-actions">
            <button type="submit" className="ac-btn is-primary" disabled={busy === 'details'}>{busy === 'details' ? 'Saving…' : 'Save details'}</button>
          </div>
        </form>

        <div className="ac-section">
          <h3>Password</h3>
          {!pwOpen ? (
            <>
              <p className="ac-note">{hasPassword ? 'Change the password you sign in with.' : 'You sign in with Google. Set a password to sign in with your email too.'}</p>
              {say('pw')}
              <div className="ac-actions">
                <button type="button" className="ac-btn" onClick={() => { setPwOpen(true); setMsg(null); }}>{hasPassword ? 'Change password' : 'Set a password'}</button>
              </div>
            </>
          ) : (
            <form onSubmit={savePassword} noValidate>
              {hasPassword && (
                <label className="ac-field">
                  <span>Current password</span>
                  <input className="ac-input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} />
                </label>
              )}
              <div className="ac-two">
                <label className="ac-field">
                  <span>New password</span>
                  <input className="ac-input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} />
                </label>
                <label className="ac-field">
                  <span>New password again</span>
                  <input className="ac-input" type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw((p) => ({ ...p, again: e.target.value }))} />
                </label>
              </div>
              {say('pw')}
              <div className="ac-actions">
                <button type="button" className="ac-btn is-quiet" onClick={() => { setPwOpen(false); setPw({ current: '', next: '', again: '' }); setMsg(null); }} disabled={busy === 'pw'}>Cancel</button>
                <button type="submit" className="ac-btn is-primary" disabled={busy === 'pw'}>{busy === 'pw' ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
