'use client';

// System Configuration > Homepage Sections (Super Admin): a switch for each
// section of the public homepage. A section turned off is left out of the
// page, and its links in the menu and the footers go with it
// (lib/homeSections.js). Saved through /api/home-sections, which checks the
// role on the server.

import { useEffect, useState } from 'react';
import { HOME_SECTIONS } from '@/lib/homeSections';
import { useSetHomeSections } from '@/components/HomeSectionsProvider';
import './homeSections.css';

const same = (a, b) => a.length === b.length && a.every((k) => b.includes(k));

/**
 * @param {string}   actorId    the signed-in Super Admin
 * @param {Function} showToast  the dashboard's toast: (message, type)
 */
export default function HomeSectionsCard({ actorId, showToast }) {
  const setSiteHidden = useSetHomeSections();
  const [saved, setSaved] = useState(null); // what the server has
  const [hidden, setHidden] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/home-sections', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const h = j?.data?.hidden || [];
        setSaved(h);
        setHidden(h);
      })
      .catch(() => { if (alive) setError('The homepage sections could not be loaded. Refresh to try again.'); });
    return () => { alive = false; };
  }, []);

  const toggle = (key) => setHidden((h) => (h.includes(key) ? h.filter((k) => k !== key) : [...h, key]));
  const dirty = saved !== null && !same(hidden, saved);
  const showing = HOME_SECTIONS.length - hidden.length;

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/home-sections', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, hidden }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) throw new Error(j.message || 'The homepage sections could not be saved.');
      const h = j.data?.hidden || [];
      setSaved(h);
      setHidden(h);
      setSiteHidden(h);
      showToast?.('✅ Homepage sections saved', 'success');
    } catch (e) {
      showToast?.(`❌ ${e.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="hero-cfg hs-cfg">
      <div className="hero-cfg-head">
        <div>
          <h3><i className="fas fa-table-list"></i> Homepage Sections</h3>
          <p>Turn a section off to take it off the public home page. Its links in the menu and the footer go with it.</p>
        </div>
        {saved !== null && (
          <span className="hero-cfg-live hs-count">
            <i className="fas fa-eye"></i> Showing {showing} of {HOME_SECTIONS.length}
          </span>
        )}
      </div>

      {error ? (
        <p className="hero-cfg-empty"><i className="fas fa-triangle-exclamation"></i> {error}</p>
      ) : saved === null ? (
        <div className="hs-loading" aria-label="Loading"><span></span><span></span><span></span></div>
      ) : (
        <ul className="hs-list">
          {HOME_SECTIONS.map((s) => {
            const on = !hidden.includes(s.key);
            return (
              <li key={s.key} className={on ? '' : 'is-off'}>
                <span className="hs-ic" aria-hidden="true"><i className={`fas ${s.icon}`}></i></span>
                <span className="hs-text">
                  <b>{s.label}</b>
                  <small>{s.hint}</small>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  className="hs-switch"
                  onClick={() => toggle(s.key)}
                  aria-label={`Show ${s.label} on the home page`}
                >
                  <span aria-hidden="true"></span>
                  <em>{on ? 'Shown' : 'Hidden'}</em>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="hs-note">
        <i className="fas fa-circle-info"></i> The top banner, About SanctuaryHub and the footer always show.
      </p>

      <div className="hero-cfg-foot">
        <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}>
          {saving ? <><i className="fas fa-spinner fa-spin"></i> Saving…</> : <><i className="fas fa-check"></i> Save sections</>}
        </button>
        {dirty && !saving && (
          <>
            <span className="hero-cfg-dirty">Unsaved changes</span>
            <button type="button" className="hs-undo" onClick={() => setHidden(saved)}>Undo</button>
          </>
        )}
        <a href="/" target="_blank" rel="noopener noreferrer" className="brand-cfg-view">
          <i className="fas fa-arrow-up-right-from-square"></i> View home page
        </a>
      </div>
    </div>
  );
}
