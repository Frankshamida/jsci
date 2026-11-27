'use client';

// Dashboard > Sermons. Pastors upload the slides or notes behind a sermon (a
// PowerPoint or a PDF, up to 10 MB); every signed-in member can read and
// download them. The file goes from the browser straight to Cloudinary with a
// signature from /api/sermons, then the sermon is saved there.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SERMON_ACCEPT, SERMON_MAX_BYTES, LIMITS, sermonFormat, formatLabel, sizeLabel, downloadUrl, officeViewerUrl,
} from '@/lib/sermons';
import './sermons.css';

const TZ = 'Asia/Manila';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
// The Sunday just gone (today, on a Sunday): the usual day to upload for.
function lastSunday() {
  const t = today();
  const d = new Date(`${t}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
const day = (ymd, opts) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });

const EMPTY = { title: '', preachedOn: '', preacher: '', passage: '', summary: '' };

// Upload to Cloudinary with progress. Resolves with Cloudinary's answer.
function uploadFile(uploadUrl, fields, file, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    Object.entries(fields).forEach(([k, v]) => form.append(k, v));
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let json = {};
      try { json = JSON.parse(xhr.responseText); } catch { /* keep {} */ }
      if (xhr.status >= 200 && xhr.status < 300 && json.secure_url) resolve(json);
      else reject(new Error(json.error?.message ? `The upload was refused: ${json.error.message}` : 'The upload did not go through. Check the connection and try again.'));
    };
    xhr.onerror = () => reject(new Error('The upload did not go through. Check the connection and try again.'));
    xhr.send(form);
  });
}

function SermonForm({ editing, preachers, defaultPreacher, onCancel, onSaved, actorId }) {
  const [form, setForm] = useState(() => (editing
    ? { title: editing.title, preachedOn: editing.preachedOn, preacher: editing.preacher, passage: editing.passage, summary: editing.summary }
    : { ...EMPTY, preachedOn: lastSunday(), preacher: defaultPreacher }));
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const titleRef = useRef(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const pickFile = (e) => {
    const f = e.target.files?.[0] || null;
    setError('');
    if (!f) { setFile(null); return; }
    if (!sermonFormat(f.name)) { setError('Choose a PowerPoint (.pptx or .ppt) or a PDF.'); e.target.value = ''; return; }
    if (f.size > SERMON_MAX_BYTES) {
      setError(`That file is ${sizeLabel(f.size)}; the most is 10 MB. Save the slides as a PDF, or make the pictures in them smaller, and try again.`);
      e.target.value = '';
      return;
    }
    setFile(f);
    // A title from the file name, when none is typed yet.
    if (!form.title.trim()) setForm((x) => ({ ...x, title: f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, LIMITS.title) }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.title.trim()) { setError('Give the sermon a title.'); return; }
    if (!form.preachedOn) { setError('Pick the day it was preached.'); return; }
    if (!editing && !file) { setError('Choose the PowerPoint or PDF to upload.'); return; }
    setBusy(true);
    try {
      if (editing) {
        const res = await fetch('/api/sermons', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actorId, id: editing.id, ...form }),
        });
        const json = await res.json().catch(() => ({}));
        if (!json.success) throw new Error(json.message || 'The sermon could not be saved.');
        onSaved(json.sermon, 'Sermon saved.');
        return;
      }
      const signRes = await fetch('/api/sermons', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sign', actorId, fileName: file.name, bytes: file.size }),
      });
      const sign = await signRes.json().catch(() => ({}));
      if (!sign.success) throw new Error(sign.message || 'The upload could not be started.');
      setProgress(0);
      const uploaded = await uploadFile(sign.uploadUrl, sign.fields, file, setProgress);
      const res = await fetch('/api/sermons', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create', actorId, ...form,
          file: { publicId: uploaded.public_id, url: uploaded.secure_url, bytes: uploaded.bytes || file.size, name: file.name },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'The sermon could not be saved.');
      onSaved(json.sermon, 'Sermon uploaded.');
    } catch (err) {
      setError(err.message || 'Something went wrong.');
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="sm-card sm-form" onSubmit={submit} aria-labelledby="sm-form-title" noValidate>
      <h3 id="sm-form-title" className="sm-card-title">{editing ? 'Edit sermon' : 'Upload a sermon'}</h3>

      {!editing && (
        <div className="sm-file">
          <label htmlFor="sm-file-input">PowerPoint or PDF <span className="sm-hint">up to 10 MB</span></label>
          <input id="sm-file-input" type="file" accept={SERMON_ACCEPT} onChange={pickFile} disabled={busy} />
          {file && <span className="sm-hint">{formatLabel(sermonFormat(file.name))} · {sizeLabel(file.size)}</span>}
        </div>
      )}

      <div className="sm-grid">
        <label className="sm-input sm-span-2">
          <span>Title</span>
          <input ref={titleRef} value={form.title} onChange={set('title')} maxLength={LIMITS.title} required disabled={busy} />
        </label>
        <label className="sm-input">
          <span>Preached on</span>
          <input type="date" value={form.preachedOn} onChange={set('preachedOn')} max={today()} required disabled={busy} />
        </label>
        <label className="sm-input">
          <span>Preacher</span>
          <input value={form.preacher} onChange={set('preacher')} maxLength={LIMITS.preacher} list="sm-preachers" disabled={busy} />
          <datalist id="sm-preachers">{preachers.map((p) => <option key={p} value={p} />)}</datalist>
        </label>
        <label className="sm-input sm-span-2">
          <span>Bible passage <span className="sm-hint">optional</span></span>
          <input value={form.passage} onChange={set('passage')} maxLength={LIMITS.passage} placeholder="e.g. Psalm 28:7" disabled={busy} />
        </label>
        <label className="sm-input sm-span-2">
          <span>Summary <span className="sm-hint">optional</span></span>
          <textarea value={form.summary} onChange={set('summary')} maxLength={LIMITS.summary} rows={3} disabled={busy} />
        </label>
      </div>

      {progress != null && busy && (
        <div className="sm-progress" role="progressbar" aria-label="Uploading" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
      {error && <p className="sm-error" role="alert">{error}</p>}

      <div className="sm-actions">
        <button type="button" className="sm-btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="sm-btn sm-btn-primary" disabled={busy}>
          {busy ? (progress != null && progress < 100 ? `Uploading ${progress}%` : 'Saving…') : editing ? 'Save' : 'Upload'}
        </button>
      </div>
    </form>
  );
}

export default function SermonsSection({ userData, active }) {
  const [sermons, setSermons] = useState(null);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [formFor, setFormFor] = useState(null); // null | 'new' | sermon
  const [confirmId, setConfirmId] = useState(null);
  const [notice, setNotice] = useState('');
  const actorId = userData?.id;

  const load = useCallback(async () => {
    if (!actorId) return;
    try {
      const res = await fetch(`/api/sermons?actorId=${encodeURIComponent(actorId)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'The sermons could not be loaded.');
      setSermons(json.sermons);
      setCanManage(!!json.canManage);
      setError('');
    } catch (e) {
      setError(e.message);
      setSermons((s) => s || []);
    }
  }, [actorId]);

  useEffect(() => { if (active) load(); }, [active, load]);

  const myName = [userData?.firstname, userData?.lastname].filter(Boolean).join(' ');
  const preachers = useMemo(() => [...new Set([myName, ...(sermons || []).map((s) => s.preacher)].filter(Boolean))], [sermons, myName]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sermons || [];
    return (sermons || []).filter((s) => [s.title, s.preacher, s.passage, s.summary].join(' ').toLowerCase().includes(q));
  }, [sermons, query]);

  const saved = (sermon, message) => {
    setSermons((list) => {
      const rest = (list || []).filter((s) => s.id !== sermon.id);
      return [...rest, sermon].sort((a, b) => (a.preachedOn < b.preachedOn ? 1 : a.preachedOn > b.preachedOn ? -1 : (a.createdAt < b.createdAt ? 1 : -1)));
    });
    setFormFor(null);
    setNotice(message);
  };

  const remove = async (s) => {
    setNotice('');
    try {
      const res = await fetch(`/api/sermons?actorId=${encodeURIComponent(actorId)}&id=${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'The sermon could not be deleted.');
      setSermons((list) => list.filter((x) => x.id !== s.id));
      setNotice(`"${s.title}" was deleted.`);
    } catch (e) {
      setNotice(e.message);
    } finally {
      setConfirmId(null);
    }
  };

  return (
    <div className="sm">
      {/* The dashboard's own page title, as on every other page. */}
      <h2 className="section-title">Sermons</h2>
      <div className="sm-head">
        <p className="sm-sub">Slides and notes from the pulpit, to read again or share.</p>
        {canManage && !formFor && (
          <button type="button" className="sm-btn sm-btn-primary" onClick={() => { setFormFor('new'); setNotice(''); }}>
            <i className="fas fa-upload" aria-hidden="true"></i>Upload a sermon
          </button>
        )}
      </div>

      {formFor && (
        <SermonForm key={formFor === 'new' ? 'new' : formFor.id} editing={formFor === 'new' ? null : formFor}
          preachers={preachers} defaultPreacher={myName} actorId={actorId}
          onCancel={() => setFormFor(null)} onSaved={saved} />
      )}

      {notice && <p className="sm-notice" role="status">{notice}</p>}

      {sermons && sermons.length > 0 && (
        <label className="sm-search">
          <span className="sm-visually-hidden">Search sermons</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title, preacher or passage" />
        </label>
      )}

      {error && <p className="sm-error" role="alert">{error}</p>}

      {sermons === null && !error ? (
        <div className="sm-loading" aria-busy="true"><span /><span /><span /></div>
      ) : shown.length === 0 && !error ? (
        <p className="sm-empty">
          {query ? 'No sermon matches that search.' : canManage ? 'No sermons yet. Upload the first one with the button above.' : 'No sermons have been uploaded yet.'}
        </p>
      ) : (
        <ul className="sm-list">
          {shown.map((s) => (
            <li key={s.id} className="sm-card sm-item">
              <span className="sm-date" aria-hidden="true">
                <span>{day(s.preachedOn, { month: 'short' }).toUpperCase()}</span>
                <strong>{day(s.preachedOn, { day: 'numeric' })}</strong>
                <span>{day(s.preachedOn, { year: 'numeric' })}</span>
              </span>
              <div className="sm-item-body">
                <h3 className="sm-item-title">{s.title}</h3>
                <p className="sm-item-meta">
                  {[day(s.preachedOn, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), s.preacher, s.passage].filter(Boolean).join(' · ')}
                </p>
                {s.summary && <p className="sm-item-summary">{s.summary}</p>}
                <div className="sm-item-actions">
                  <span className={`sm-badge sm-badge-${s.format === 'pdf' ? 'pdf' : 'ppt'}`}>{formatLabel(s.format)} · {sizeLabel(s.bytes)}</span>
                  <a className="sm-btn sm-btn-small" href={s.format === 'pdf' ? s.url : officeViewerUrl(s.url)} target="_blank" rel="noopener noreferrer">
                    View<span className="sm-visually-hidden"> {s.title} (opens in a new tab)</span>
                  </a>
                  <a className="sm-btn sm-btn-small" href={downloadUrl(s.url)}>
                    Download<span className="sm-visually-hidden"> {s.title}</span>
                  </a>
                  {canManage && confirmId !== s.id && (
                    <>
                      <button type="button" className="sm-btn sm-btn-small sm-btn-quiet" onClick={() => { setFormFor(s); setNotice(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                        Edit<span className="sm-visually-hidden"> {s.title}</span>
                      </button>
                      <button type="button" className="sm-btn sm-btn-small sm-btn-quiet" onClick={() => setConfirmId(s.id)}>
                        Delete<span className="sm-visually-hidden"> {s.title}</span>
                      </button>
                    </>
                  )}
                  {canManage && confirmId === s.id && (
                    <span className="sm-confirm" role="group" aria-label="Confirm delete">
                      <span>Delete this sermon and its file?</span>
                      <button type="button" className="sm-btn sm-btn-small sm-btn-danger" onClick={() => remove(s)}>Yes, delete</button>
                      <button type="button" className="sm-btn sm-btn-small" onClick={() => setConfirmId(null)}>Keep it</button>
                    </span>
                  )}
                </div>
                {s.uploadedBy && <p className="sm-item-by">Uploaded by {s.uploadedBy}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
