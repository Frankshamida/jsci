'use client';

// Dashboard > Developers (Admin and Super Admin): the website's "Meet the
// Developers" window.
//   A  Live preview   the real window, light or dark, desktop or phone,
//                     changing as the words and the developer being edited change
//   B  Developers     in display order: drag (or the arrows) to reorder, show or
//                     hide, edit, delete
//   C  Add / Edit     surname, given names, role, role icon, photo (cropped to
//                     the card's 7:10 frame), shown
//   D  Window         badge, headline, description, auto-show on the homepage
// Everything goes through /api/developers, which checks the role.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBranding } from '@/components/BrandingProvider';
import {
  DEV_MAX, DEV_PHOTO, DEV_LIMITS, DEV_ROLE_ICONS, DEV_ROLE_SUGGESTIONS, DEFAULT_DEV_SETTINGS, roleIconFa,
} from '@/lib/developers';
import DeveloperWelcome, { DeveloperCard } from './DeveloperWelcome';
import PhotoCropper from './PhotoCropper';
import './developersManager.css';

const EMPTY_DEV = { id: null, surname: '', givenNames: '', role: '', roleIcon: 'code', active: true, photoUrl: null };
const DEVICES = { desktop: 920, phone: 390 };

// Add or change a developer, with upload progress.
function sendDeveloper(form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/developers');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let json = {};
      try { json = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && json.success) resolve(json);
      else reject(new Error(json.message || 'The developer could not be saved. Please try again.'));
    };
    xhr.onerror = () => reject(new Error('No connection. Check your internet and try again.'));
    xhr.send(form);
  });
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    const err = new Error(json.message || 'Something went wrong. Please try again.');
    err.code = json.code;
    throw err;
  }
  return json;
}

// ---- A: the live preview, drawn at its real size and scaled to fit ----
function Preview({ developers, settings, platform }) {
  const [theme, setTheme] = useState('dark');
  const [device, setDevice] = useState('desktop');
  const stage = useRef(null);
  const canvas = useRef(null);
  const [fit, setFit] = useState({ scale: 1, height: 0 });
  const width = DEVICES[device];

  useLayoutEffect(() => {
    const s = stage.current;
    const c = canvas.current;
    if (!s || !c) return undefined;
    c.setAttribute('inert', ''); // a picture of the window: nothing in it takes focus
    const measure = () => {
      const scale = Math.min(1, s.clientWidth / width);
      setFit({ scale, height: Math.ceil(c.offsetHeight * scale) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(s);
    ro.observe(c);
    return () => ro.disconnect();
  }, [width]);

  return (
    <section className="dvm-card" aria-labelledby="dvm-preview-h">
      <div className="dvm-head">
        <div>
          <h3 id="dvm-preview-h">Live preview</h3>
          <p>The window as visitors see it. It changes as you edit.</p>
        </div>
        <div className="dvm-segs">
          <div className="dvm-seg" role="group" aria-label="Theme">
            {['light', 'dark'].map((t) => (
              <button key={t} type="button" aria-pressed={theme === t} onClick={() => setTheme(t)}>
                <i className={`fas ${t === 'light' ? 'fa-sun' : 'fa-moon'}`} aria-hidden="true"></i>{t === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
          <div className="dvm-seg" role="group" aria-label="Screen">
            {Object.keys(DEVICES).map((d) => (
              <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)}>
                <i className={`fas ${d === 'desktop' ? 'fa-display' : 'fa-mobile-screen'}`} aria-hidden="true"></i>{d === 'desktop' ? 'Desktop' : 'Phone'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className={`dvm-stage is-${theme}`} ref={stage} style={{ height: fit.height || undefined }}>
        <div className="dvm-canvas" ref={canvas} style={{ width, transform: `scale(${fit.scale})` }}>
          <DeveloperWelcome inline theme={theme} developers={developers} settings={settings} status="ready" onClose={() => {}} platform={platform} titleId={undefined} />
        </div>
      </div>
    </section>
  );
}

// ---- C: add or edit one developer ----
function Editor({ initial, actorId, onClose, onSaved, onDraft }) {
  const [dev, setDev] = useState(initial);
  const [photo, setPhoto] = useState(null); // { blob, url, lowRes } once cropped
  const [removePhoto, setRemovePhoto] = useState(false);
  const [cropSrc, setCropSrc] = useState(null);
  const [errors, setErrors] = useState({});
  const [fileError, setFileError] = useState('');
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [serverError, setServerError] = useState('');
  const fileInput = useRef(null);
  const box = useRef(null);
  const adding = !initial.id;

  const shownPhoto = photo ? photo.url : removePhoto ? null : dev.photoUrl;
  useEffect(() => { onDraft({ ...dev, photoUrl: shownPhoto }); }, [dev, shownPhoto, onDraft]);
  useEffect(() => () => { if (photo?.url) URL.revokeObjectURL(photo.url); }, [photo]);
  useEffect(() => () => { if (cropSrc) URL.revokeObjectURL(cropSrc); }, [cropSrc]);

  // A dialog: Esc closes (unless saving; while cropping it leaves the
  // cropper), focus starts inside and stays there, and goes back after.
  const live = useRef({});
  live.current = { saving, onClose, cropping: !!cropSrc };
  useEffect(() => {
    const prev = document.activeElement;
    (box.current?.querySelector('input') || box.current?.querySelector('button'))?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape' && !live.current.saving) {
        e.stopPropagation();
        if (live.current.cropping) setCropSrc(null);
        else live.current.onClose();
        return;
      }
      if (e.key !== 'Tab' || !box.current) return;
      const items = [...box.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select, textarea, [tabindex="0"]')].filter((el) => el.getClientRects().length);
      if (!items.length) return;
      if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === items[items.length - 1]) { e.preventDefault(); items[0].focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); try { prev?.focus?.(); } catch { /* gone */ } };
  }, []);

  const set = (k) => (e) => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; setDev((d) => ({ ...d, [k]: v })); setErrors((x) => ({ ...x, [k]: '' })); };

  const pick = (file) => {
    setFileError('');
    if (!file) return;
    if (!DEV_PHOTO.accept.includes(file.type)) { setFileError('That file is not a JPG, PNG or WebP image.'); return; }
    if (file.size > DEV_PHOTO.maxSourceBytes) { setFileError('That photo is over 10 MB. Pick a smaller one.'); return; }
    setCropSrc(URL.createObjectURL(file));
  };

  const save = async () => {
    const errs = {};
    if (!dev.surname.trim()) errs.surname = 'Type the surname.';
    if (!dev.role.trim()) errs.role = 'Type the role, for example Full Stack Developer.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const form = new FormData();
    form.append('actorId', actorId);
    if (dev.id) form.append('id', dev.id);
    form.append('surname', dev.surname);
    form.append('givenNames', dev.givenNames);
    form.append('role', dev.role);
    form.append('roleIcon', dev.roleIcon);
    form.append('active', String(!!dev.active));
    if (photo) form.append('photo', photo.blob, `photo.${photo.blob.type === 'image/webp' ? 'webp' : 'jpg'}`);
    else if (removePhoto) form.append('removePhoto', 'true');
    setSaving(true);
    setServerError('');
    setProgress(0);
    try {
      const json = await sendDeveloper(form, setProgress);
      onSaved(json.developer, adding);
    } catch (e) {
      setServerError(e.message);
      setSaving(false);
    }
  };

  return (
    <div className="dvm-modal" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving && !cropSrc) onClose(); }}>
      <div className={`dvm-dialog${cropSrc ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dvm-editor-h" ref={box}>
        <div className="dvm-dialog-head">
          <h3 id="dvm-editor-h">{cropSrc ? 'Crop the photo' : adding ? 'Add a developer' : `Edit ${initial.surname}`}</h3>
          <button type="button" className="dvm-x" onClick={onClose} disabled={saving} aria-label="Close"><i className="fas fa-xmark" aria-hidden="true"></i></button>
        </div>

        {cropSrc ? (
          <PhotoCropper
            src={cropSrc}
            dev={dev}
            onCancel={() => setCropSrc(null)}
            onDone={(p) => { setPhoto(p); setRemovePhoto(false); setCropSrc(null); }}
          />
        ) : (
          <div className="dvm-form">
            <div className="dvm-fields">
              <label className="dvm-field">
                <span>Surname</span>
                <input type="text" value={dev.surname} onChange={set('surname')} maxLength={DEV_LIMITS.surname} placeholder="GOMEZ" aria-invalid={!!errors.surname} autoComplete="off" />
                {errors.surname && <small className="dvm-error">{errors.surname}</small>}
              </label>
              <label className="dvm-field">
                <span>Given names</span>
                <input type="text" value={dev.givenNames} onChange={set('givenNames')} maxLength={DEV_LIMITS.givenNames} placeholder="Frank Dweezel" autoComplete="off" />
              </label>
              <label className="dvm-field">
                <span>Role</span>
                <input type="text" value={dev.role} onChange={set('role')} maxLength={DEV_LIMITS.role} list="dvm-roles" placeholder="Full Stack Developer" aria-invalid={!!errors.role} autoComplete="off" />
                <datalist id="dvm-roles">{DEV_ROLE_SUGGESTIONS.map((r) => <option key={r} value={r} />)}</datalist>
                {errors.role && <small className="dvm-error">{errors.role}</small>}
              </label>
              <fieldset className="dvm-field dvm-icons">
                <legend>Role icon</legend>
                <div>
                  {DEV_ROLE_ICONS.map((i) => (
                    <label key={i.key} className={dev.roleIcon === i.key ? 'is-on' : ''}>
                      <input type="radio" name="dvm-icon" value={i.key} checked={dev.roleIcon === i.key} onChange={set('roleIcon')} />
                      <i className={`fas ${i.fa}`} aria-hidden="true"></i>
                      <span>{i.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="dvm-check">
                <input type="checkbox" checked={!!dev.active} onChange={set('active')} />
                <span>Show on the website</span>
              </label>
            </div>

            <div className="dvm-photo">
              <span className="dvm-label">Photo</span>
              <ul className="dw-tokens dvm-card-preview">
                <DeveloperCard dev={{ ...dev, id: 'draft', photoUrl: shownPhoto, surname: dev.surname || 'SURNAME', givenNames: dev.givenNames || 'Given names', role: dev.role || 'Role' }} />
              </ul>
              <div
                className="dvm-drop"
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}
              >
                <button type="button" className="dvm-btn" onClick={() => fileInput.current?.click()} disabled={saving}>
                  <i className="fas fa-image" aria-hidden="true"></i> {shownPhoto ? 'Change photo' : 'Choose a photo'}
                </button>
                {shownPhoto && (
                  <button type="button" className="dvm-btn is-quiet" disabled={saving} onClick={() => { setPhoto(null); setRemovePhoto(!!initial.photoUrl); }}>
                    Remove
                  </button>
                )}
                <input ref={fileInput} type="file" accept={DEV_PHOTO.accept.join(',')} hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
                <small>JPG, PNG or WebP, up to 10 MB. You can also drop a file here.</small>
              </div>
              {fileError && <p className="dvm-error" role="alert">{fileError}</p>}
              {photo?.lowRes && <p className="dvm-warn"><i className="fas fa-triangle-exclamation" aria-hidden="true"></i> This photo is low resolution and may look blurry.</p>}
            </div>

            <div className="dvm-dialog-foot">
              {serverError && <p className="dvm-error" role="alert">{serverError}</p>}
              {saving && (
                <div className="dvm-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Uploading">
                  <i style={{ width: `${photo ? progress : 100}%` }}></i>
                </div>
              )}
              <div className="dvm-actions">
                <button type="button" className="dvm-btn" onClick={onClose} disabled={saving}>Cancel</button>
                <button type="button" className="dvm-btn is-primary" onClick={save} disabled={saving}>
                  {saving ? <><i className="fas fa-spinner fa-spin" aria-hidden="true"></i> {photo && progress < 100 ? `Uploading ${progress}%` : 'Saving…'}</> : 'Save developer'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- The page ----
export default function DevelopersManager({ actorId, active, showToast }) {
  const brand = useBranding();
  const toast = useCallback((msg, type = 'success') => { if (showToast) showToast(msg, type); }, [showToast]);
  const [list, setList] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_DEV_SETTINGS);
  const [form, setForm] = useState(DEFAULT_DEV_SETTINGS);
  const [state, setState] = useState({ loading: true, error: '', needsMigration: false });
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const load = useCallback(async () => {
    if (!actorId) return;
    try {
      const json = await api('GET', `/api/developers?manage=1&actorId=${encodeURIComponent(actorId)}`);
      setList(json.developers || []);
      setSettings(json.settings || DEFAULT_DEV_SETTINGS);
      setForm(json.settings || DEFAULT_DEV_SETTINGS);
      setState({ loading: false, error: '', needsMigration: false });
    } catch (e) {
      setState({ loading: false, error: e.message, needsMigration: e.code === 'NEEDS_MIGRATION' });
    }
  }, [actorId]);
  useEffect(() => { if (active) load(); }, [active, load]);

  // The preview: the developers shown, with the one being edited as it is now.
  const previewDevs = useMemo(() => {
    let devs = list;
    if (editing && draft) {
      const d = { ...draft, id: draft.id || 'new', surname: draft.surname || 'SURNAME', givenNames: draft.givenNames, role: draft.role || 'Role' };
      devs = draft.id ? list.map((x) => (x.id === draft.id ? d : x)) : [...list, d];
    }
    return devs.filter((d) => d.active);
  }, [list, editing, draft]);
  const onDraft = useCallback((d) => setDraft(d), []);

  const settingsDirty = ['badge', 'headline', 'description', 'autoShow'].some((k) => form[k] !== settings[k]);

  // ---- B: order, shown, delete ----
  const saveOrder = async (next, before) => {
    setList(next);
    try {
      await api('PATCH', '/api/developers', { actorId, action: 'reorder', ids: next.map((d) => d.id) });
    } catch (e) {
      setList(before);
      toast(e.message, 'error');
    }
  };
  const move = (id, to) => {
    const from = list.findIndex((d) => d.id === id);
    if (from < 0 || to < 0 || to >= list.length || from === to) return;
    const next = list.slice();
    const [d] = next.splice(from, 1);
    next.splice(to, 0, d);
    saveOrder(next, list);
  };
  const toggle = async (dev) => {
    const before = list;
    if (dev.active && list.filter((d) => d.active).length === 1) toast('With nobody shown, the window will not open by itself.', 'warning');
    setList(list.map((d) => (d.id === dev.id ? { ...d, active: !d.active } : d)));
    try {
      await api('PATCH', '/api/developers', { actorId, action: 'active', id: dev.id, active: !dev.active });
    } catch (e) {
      setList(before);
      toast(e.message, 'error');
    }
  };
  const remove = async (dev) => {
    setConfirm(null);
    try {
      await api('DELETE', `/api/developers?actorId=${encodeURIComponent(actorId)}&id=${encodeURIComponent(dev.id)}`);
      setList((l) => l.filter((d) => d.id !== dev.id));
      toast(`${dev.surname} was removed`);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const saveSettings = async () => {
    if (!String(form.headline || '').trim()) { toast('Type a headline first.', 'warning'); return; }
    setSavingSettings(true);
    try {
      const json = await api('PATCH', '/api/developers', { actorId, action: 'settings', ...form });
      setSettings(json.settings);
      setForm(json.settings);
      toast('Window settings saved');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const closeEditor = useCallback(() => { setEditing(null); setDraft(null); }, []);
  const saved = (dev, added) => {
    setList((l) => (added ? [...l, dev] : l.map((d) => (d.id === dev.id ? dev : d))));
    setEditing(null);
    setDraft(null);
    toast('Developer saved');
  };

  const setF = (k) => (e) => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; setForm((f) => ({ ...f, [k]: v })); };

  return (
    <div className="dvm">
      <header className="dvm-top">
        <div>
          <h2>Developers</h2>
          <p>The &ldquo;Meet the Developers&rdquo; window on the website. Changes reach visitors within a minute.</p>
        </div>
        <button type="button" className="dvm-btn is-primary" disabled={state.loading || !!state.error || list.length >= DEV_MAX} onClick={() => setEditing({ ...EMPTY_DEV })}>
          <i className="fas fa-plus" aria-hidden="true"></i> Add developer
        </button>
      </header>

      {state.error ? (
        <div className="dvm-card dvm-notice" role="alert">
          <i className={`fas ${state.needsMigration ? 'fa-database' : 'fa-cloud-arrow-down'}`} aria-hidden="true"></i>
          <div>
            <b>{state.needsMigration ? 'One step left: set up the database' : 'The developers did not load'}</b>
            <p>{state.error}</p>
          </div>
          <button type="button" className="dvm-btn" onClick={load}>Try again</button>
        </div>
      ) : (
        <>
          <Preview developers={previewDevs} settings={form} platform={brand?.platform || 'SanctuaryHub'} />

          <div className="dvm-cols">
            <section className="dvm-card" aria-labelledby="dvm-list-h">
              <div className="dvm-head">
                <div>
                  <h3 id="dvm-list-h">Developers</h3>
                  <p>In the order they appear. Drag a row, or use the arrows, to reorder. Up to {DEV_MAX}.</p>
                </div>
              </div>
              {state.loading ? (
                <div className="dvm-skel" aria-label="Loading"><span></span><span></span><span></span></div>
              ) : list.length === 0 ? (
                <div className="dvm-empty">
                  <i className="fas fa-users" aria-hidden="true"></i>
                  <p>No developers yet. Add the first one; the window opens by itself once someone is shown.</p>
                </div>
              ) : (
                <ol className="dvm-list">
                  {list.map((d, i) => (
                    <li
                      key={d.id}
                      className={`dvm-row${dragId === d.id ? ' is-dragging' : ''}${overId === d.id && dragId !== d.id ? ' is-over' : ''}${d.active ? '' : ' is-hidden'}`}
                      draggable
                      onDragStart={(e) => { setDragId(d.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', d.id); } catch { /* IE */ } }}
                      onDragOver={(e) => { if (!dragId) return; e.preventDefault(); if (overId !== d.id) setOverId(d.id); }}
                      onDrop={(e) => { e.preventDefault(); if (dragId) move(dragId, i); setDragId(null); setOverId(null); }}
                      onDragEnd={() => { setDragId(null); setOverId(null); }}
                    >
                      <span className="dvm-grip" aria-hidden="true"><i className="fas fa-grip-vertical"></i></span>
                      <span className="dvm-thumb">
                        {d.photoUrl ? <img src={d.photoUrl} alt="" width={42} height={60} loading="lazy" /> : <i className="fas fa-user" aria-hidden="true"></i>}
                      </span>
                      <span className="dvm-who">
                        <b>{d.surname}</b>
                        <small>{d.givenNames}</small>
                        <span className="dvm-role"><i className={`fas ${roleIconFa(d.roleIcon)}`} aria-hidden="true"></i>{d.role}</span>
                      </span>
                      <span className="dvm-row-tools">
                        <button type="button" role="switch" aria-checked={d.active} className="dvm-switch" onClick={() => toggle(d)} aria-label={`Show ${d.surname} on the website`}>
                          <span aria-hidden="true"></span><em>{d.active ? 'Shown' : 'Hidden'}</em>
                        </button>
                        <button type="button" className="dvm-icon" onClick={() => move(d.id, i - 1)} disabled={i === 0} aria-label={`Move ${d.surname} up`}><i className="fas fa-arrow-up" aria-hidden="true"></i></button>
                        <button type="button" className="dvm-icon" onClick={() => move(d.id, i + 1)} disabled={i === list.length - 1} aria-label={`Move ${d.surname} down`}><i className="fas fa-arrow-down" aria-hidden="true"></i></button>
                        <button type="button" className="dvm-icon" onClick={() => setEditing({ ...d })} aria-label={`Edit ${d.surname}`}><i className="fas fa-pen" aria-hidden="true"></i></button>
                        <button type="button" className="dvm-icon is-danger" onClick={() => setConfirm(d)} aria-label={`Delete ${d.surname}`}><i className="fas fa-trash" aria-hidden="true"></i></button>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="dvm-card" aria-labelledby="dvm-settings-h">
              <div className="dvm-head">
                <div>
                  <h3 id="dvm-settings-h">Window</h3>
                  <p>The words above the cards, and when the window opens.</p>
                </div>
              </div>
              <div className="dvm-settings">
                <label className="dvm-field">
                  <span>Badge</span>
                  <input type="text" value={form.badge} onChange={setF('badge')} maxLength={DEV_LIMITS.badge} placeholder="Capstone Project 2026" />
                </label>
                <label className="dvm-field">
                  <span>Headline</span>
                  <input type="text" value={form.headline} onChange={setF('headline')} maxLength={DEV_LIMITS.headline} />
                  <small>&ldquo;{brand?.platform || 'SanctuaryHub'}&rdquo; shows in gold; without it, the last word does.</small>
                </label>
                <label className="dvm-field">
                  <span>Description</span>
                  <textarea rows={4} value={form.description} onChange={setF('description')} maxLength={DEV_LIMITS.description}></textarea>
                  <small>{String(form.description || '').length} / {DEV_LIMITS.description}. Two lines read best.</small>
                </label>
                <label className="dvm-check">
                  <input type="checkbox" checked={!!form.autoShow} onChange={setF('autoShow')} />
                  <span><b>Auto-show on homepage</b><small>Once per browser session, 2 seconds after the homepage opens. The footer&apos;s &ldquo;Meet the Developers&rdquo; always opens it.</small></span>
                </label>
                <div className="dvm-actions">
                  <button type="button" className="dvm-btn" disabled={!settingsDirty || savingSettings} onClick={() => setForm(settings)}>Undo changes</button>
                  <button type="button" className="dvm-btn is-primary" disabled={!settingsDirty || savingSettings} onClick={saveSettings}>
                    {savingSettings ? <><i className="fas fa-spinner fa-spin" aria-hidden="true"></i> Saving…</> : 'Save window'}
                  </button>
                </div>
              </div>
            </section>
          </div>
        </>
      )}

      {editing && createPortal(<Editor initial={editing} actorId={actorId} onClose={closeEditor} onSaved={saved} onDraft={onDraft} />, document.body)}

      {confirm && createPortal(
        <div className="dvm-modal" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirm(null); }}>
          <div className="dvm-dialog is-small" role="alertdialog" aria-modal="true" aria-labelledby="dvm-del-h" aria-describedby="dvm-del-p">
            <h3 id="dvm-del-h">Delete {confirm.surname}?</h3>
            <p id="dvm-del-p">{confirm.givenNames} {confirm.surname} leaves the window{confirm.photoUrl ? ', and their photo is deleted' : ''}. This cannot be undone. To take them off for now, hide them instead.</p>
            <div className="dvm-actions">
              <button type="button" className="dvm-btn" onClick={() => setConfirm(null)} autoFocus>Cancel</button>
              <button type="button" className="dvm-btn is-danger" onClick={() => remove(confirm)}>Delete</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
