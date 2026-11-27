'use client';

// "Download reports" on the Pastor's Home: donations, the Sunday lineup, the
// care list and Sunday check-ins, as PDF, Word or Excel.

import { useEffect, useRef, useState } from 'react';
import { FORMATS, saveReport, lineupSpec, careSpec, checkinsSpec, donationsSpec } from './reportSpecs';

const REPORTS = [
  { id: 'donations', label: 'Donations', note: 'Confirmed gifts, with donor names' },
  { id: 'lineup', label: 'Sunday lineup', note: 'Who serves and the songs, to print' },
  { id: 'care', label: 'Care list', note: 'Follow-ups, in care, new accounts, birthdays' },
  { id: 'checkins', label: 'Sunday check-ins', note: 'The last 12 Sundays' },
];
const PERIODS = [
  { id: 'month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'year', label: 'This year' },
  { id: '12m', label: 'Last 12 months' },
  { id: 'all', label: 'All time' },
];

export default function PastorReports({ data, userId, byName, onClose, initialReport = 'donations' }) {
  const [report, setReport] = useState(initialReport);
  const [format, setFormat] = useState('pdf');
  const [scope, setScope] = useState('all');
  const [period, setPeriod] = useState('month');
  const [drives, setDrives] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const dialogRef = useRef(null);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Focus moves into the dialog and, when it closes, back to where it was
  // opened from. Escape closes it (not while a file is being made).
  useEffect(() => {
    const returnTo = document.activeElement;
    dialogRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape' && !busyRef.current) closeRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); returnTo?.focus?.(); };
  }, []);

  // The drives, for the Donations picker.
  useEffect(() => {
    if (report !== 'donations' || drives) return;
    let gone = false;
    (async () => {
      try {
        const res = await fetch(`/api/pastor/donations?actorId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!gone) {
          if (json.success) setDrives(json.drives || []);
          else { setDrives([]); setMessage(json.message || 'The donation drives could not be loaded.'); }
        }
      } catch { if (!gone) setDrives([]); }
    })();
    return () => { gone = true; };
  }, [report, drives, userId]);

  const noLineup = !data.sunday.lineup;
  const blocked = (report === 'lineup' && noLineup) || (report === 'checkins' && data.attendance.failed);

  const download = async () => {
    setBusy(true);
    setMessage('');
    try {
      if (report === 'donations') {
        const res = await fetch(`/api/pastor/donations?actorId=${encodeURIComponent(userId)}&scope=${encodeURIComponent(scope)}&period=${period}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!json.success) throw new Error(json.message || 'The donations could not be loaded.');
        if (!json.gifts.length) { setMessage(`No confirmed gifts for ${json.scopeLabel.toLowerCase()} in ${json.periodLabel.toLowerCase()}.`); return; }
        await saveReport(donationsSpec(json, byName), format, ['Donations', json.scopeLabel, json.periodLabel]);
      } else if (report === 'lineup') {
        await saveReport(lineupSpec(data.sunday, byName), format, ['Sunday-lineup', data.sunday.date]);
      } else if (report === 'care') {
        await saveReport(careSpec(data.care, data.cares, data.today, byName), format, ['Care-list', data.today]);
      } else {
        await saveReport(checkinsSpec(data.attendance, byName), format, ['Sunday-check-ins', data.today]);
      }
      onClose();
    } catch (e) {
      setMessage(e.message || 'The file could not be made.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="po-modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="po-modal" role="dialog" aria-modal="true" aria-labelledby="po-rep-title" tabIndex={-1}
        ref={dialogRef} onClick={(e) => e.stopPropagation()}>
        <h3 id="po-rep-title" className="po-card-title">Download a report</h3>

        <fieldset className="po-field">
          <legend>Report</legend>
          <div className="po-choices">
            {REPORTS.map((r) => (
              <label key={r.id} className={`po-choice ${report === r.id ? 'is-on' : ''}`}>
                <input type="radio" name="po-report" value={r.id} checked={report === r.id} onChange={() => { setReport(r.id); setMessage(''); }} />
                <span><strong>{r.label}</strong><span>{r.note}</span></span>
              </label>
            ))}
          </div>
        </fieldset>

        {report === 'donations' && (
          <div className="po-field-row">
            <label className="po-select">
              <span>For</span>
              <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={!drives}>
                <option value="all">All gifts</option>
                <option value="tithes">Tithes and offerings</option>
                <option value="drives">All donation drives</option>
                {(drives || []).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </label>
            <label className="po-select">
              <span>Period</span>
              <select value={period} onChange={(e) => setPeriod(e.target.value)}>
                {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
          </div>
        )}
        {report === 'donations' && (
          <p className="po-card-foot">The file names who gave. Keep it private. Each download is recorded in the audit log.</p>
        )}
        {report === 'lineup' && noLineup && <p className="po-empty">There is no lineup for this Sunday yet.</p>}

        <fieldset className="po-field">
          <legend>File</legend>
          <div className="po-formats">
            {FORMATS.map((f) => (
              <label key={f.id} className={`po-format ${format === f.id ? 'is-on' : ''}`}>
                <input type="radio" name="po-format" value={f.id} checked={format === f.id} onChange={() => setFormat(f.id)} />
                {f.label}
              </label>
            ))}
          </div>
        </fieldset>

        {message && <p className="po-modal-msg" role="status">{message}</p>}

        <div className="po-modal-actions">
          <button type="button" className="po-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="po-btn po-btn-primary" onClick={download} disabled={busy || blocked}>
            {busy ? 'Making the file…' : 'Download'}
          </button>
        </div>
      </div>
    </div>
  );
}
