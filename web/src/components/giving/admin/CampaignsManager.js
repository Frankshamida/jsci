'use client';

// Dashboard > Giving > Donation drives: what the church asks people to
// donate to - "Typhoon Relief", "Building Fund". Each has its own page
// (/donation/<slug>) with up to 8 photos, its story, and its jar, which fills
// toward the goal as donations are confirmed. A featured drive is also shown,
// like a quiet advertisement, beside the News articles, in the Community Hub
// and on the home page, until the day it ends.
//
// The window shows the card exactly as people will see it while it is typed.

import { useCallback, useEffect, useMemo, useState } from 'react';
import GivingCard from '@/components/giving/GivingCard';
import { campaignEnds, campaignOpen, campaignPath, peso } from '@/lib/giving';

const MAX_PHOTOS = 8;
import { Confirm, Field, ManageMenu, Modal, Notice, Switch } from '@/components/social/kit';
import { DeskHead, JAR_IMAGE, Pill, Strip, Tabs, sized } from '@/components/giving/desk';

const plural = (n, one, many = `${one}s`) => `${Number(n || 0).toLocaleString('en-US')} ${n === 1 ? one : many}`;

const API = '/api/giving/manage/campaigns';
const FORM_ID = 'gva';

const blank = () => ({ title: '', summary: '', story: '', images: [], goal_amount: '', ends_on: '', is_published: true, is_featured: true });
const fromCampaign = (c) => ({
  id: c.id,
  title: c.title || '',
  summary: c.summary || '',
  story: c.story || '',
  images: Array.isArray(c.images) && c.images.length ? c.images : c.image_url ? [c.image_url] : [],
  goal_amount: c.goal_amount != null ? String(c.goal_amount) : '',
  ends_on: c.ends_on || '',
  is_published: c.is_published !== false,
  is_featured: c.is_featured !== false,
});

// Where a drive stands, said once.
const standing = (c) => {
  if (!c.is_published) return { tone: 'of', label: 'Hidden' };
  if (!campaignOpen(c)) return { tone: 'of', label: 'Ended' };
  return c.is_featured ? { tone: 'wa', label: 'Featured' } : { tone: 'ok', label: 'Taking gifts' };
};

// A phone photo is 3-10 MB; a serverless request takes 4.5 MB.
async function shrink(file) {
  if (file.size <= 1.5 * 1024 * 1024) return file;
  try {
    const imageCompression = (await import('browser-image-compression')).default;
    return await imageCompression(file, { maxSizeMB: 1.5, maxWidthOrHeight: 1600, useWebWorker: true });
  } catch { return file; }
}

export default function CampaignsManager({ actorId, onSeeGifts }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [setupNote, setSetupNote] = useState('');
  const [notice, setNotice] = useState(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [form, setForm] = useState(null);
  const [pristine, setPristine] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    if (!actorId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}?actorId=${encodeURIComponent(actorId)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (res.status === 503) { setSetupNote(json.message); setList([]); return; }
      if (!json.success) throw new Error(json.message || 'Could not load the donation drives.');
      setSetupNote('');
      setList(json.data || []);
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, [actorId]);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    running: list.filter((c) => c.is_published && campaignOpen(c)).length,
    featured: list.filter((c) => c.is_published && c.is_featured && campaignOpen(c)).length,
    hidden: list.filter((c) => !c.is_published).length,
    ended: list.filter((c) => c.is_published && !campaignOpen(c)).length,
    raised: list.reduce((t, c) => t + (Number(c.raised) || 0), 0),
    gifts: list.reduce((t, c) => t + (Number(c.gifts) || 0), 0),
  }), [list]);

  const shown = list.filter((c) => {
    if (filter === 'running' && !(c.is_published && campaignOpen(c))) return false;
    if (filter === 'hidden' && c.is_published) return false;
    if (filter === 'ended' && !(c.is_published && !campaignOpen(c))) return false;
    const q = query.trim().toLowerCase();
    return !q || `${c.title} ${c.summary || ''} ${c.story || ''}`.toLowerCase().includes(q);
  });

  const openForm = (c = null) => {
    const f = c ? fromCampaign(c) : blank();
    setForm(f);
    setPristine(JSON.stringify(f));
    setFormError('');
    setNotice(null);
  };
  const set = (k, v) => { setFormError(''); setForm((f) => ({ ...f, [k]: v })); };
  const dirty = !!form && JSON.stringify(form) !== pristine;

  // Photos, one after another, up to 8 in all.
  const upload = async (files) => {
    const list = [...(files || [])];
    if (!list.length) return;
    const room = MAX_PHOTOS - (form?.images.length || 0);
    if (room <= 0) { setFormError(`A drive can have up to ${MAX_PHOTOS} photos.`); return; }
    const pick = list.slice(0, room);
    if (pick.some((f) => !/^image\/(jpeg|png|webp)$/.test(f.type))) { setFormError('Use JPG, PNG or WebP photos.'); return; }
    setUploading(true);
    setFormError(list.length > room ? `Only ${room} more ${room === 1 ? 'photo fits' : 'photos fit'}; the rest were left out.` : '');
    try {
      for (const file of pick) {
        const small = await shrink(file);
        const body = new FormData();
        body.append('actorId', actorId);
        body.append('file', small, small.name || file.name || 'drive.jpg');
        const res = await fetch('/api/giving/upload', { method: 'POST', body });
        const json = await res.json().catch(() => ({}));
        if (!json.success) throw new Error(json.message || 'A photo could not be uploaded.');
        setForm((f) => ({ ...f, images: [...f.images, json.data.url].slice(0, MAX_PHOTOS) }));
      }
    } catch (err) {
      setFormError(err.message);
    } finally {
      setUploading(false);
    }
  };
  const removePhoto = (url) => setForm((f) => ({ ...f, images: f.images.filter((u) => u !== url) }));
  const makeCover = (url) => setForm((f) => ({ ...f, images: [url, ...f.images.filter((u) => u !== url)] }));

  const save = async () => {
    if (!form) return;
    if (form.title.trim().length < 3) { setFormError('Give the drive a title.'); return; }
    setSaving(true);
    setFormError('');
    try {
      const res = await fetch(API, {
        method: form.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, id: form.id, campaign: form }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Could not save the drive.');
      const saved = json.data;
      const before = list.find((c) => c.id === saved.id);
      setList((l) => (before ? l.map((c) => (c.id === saved.id ? saved : c)) : [saved, ...l]));
      const where = saved.is_published ? `at ${campaignPath(saved.slug)}${saved.is_featured ? ', and shows beside the News and in the Community Hub within a minute' : ''}` : 'hidden, until you show it';
      setNotice({ type: 'ok', text: before ? `"${saved.title}" is saved.${before.slug !== saved.slug ? ` Its address is now ${campaignPath(saved.slug)}.` : ''}` : `"${saved.title}" is up, ${where}.` });
      setForm(null);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const act = async (c, action) => {
    setBusyId(c.id);
    setNotice(null);
    try {
      const res = await fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorId, id: c.id, action }) });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Could not do that.');
      setList((l) => l.map((x) => (x.id === c.id ? json.data : x)));
      setNotice({
        type: 'ok',
        text: {
          publish: `"${c.title}" is on the website again.`,
          hide: `"${c.title}" is hidden from the website.`,
          feature: `"${c.title}" is featured. It shows beside the News, in the Community Hub and on the home page within a minute.`,
          unfeature: `"${c.title}" is no longer featured. It stays on the Donate page.`,
        }[action],
      });
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    const c = confirm;
    setBusyId(c.id);
    try {
      const res = await fetch(API, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorId, id: c.id }) });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Could not delete it.');
      setList((l) => l.filter((x) => x.id !== c.id));
      setNotice({ type: 'ok', text: `"${c.title}" is deleted. Its gifts are kept, with its name on them.` });
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  };

  const copyLink = async (c) => {
    const url = `${window.location.origin}${campaignPath(c.slug)}`;
    try { await navigator.clipboard.writeText(url); setNotice({ type: 'ok', text: `The link to "${c.title}" is copied.` }); } catch { setNotice({ type: 'warn', text: url }); }
  };

  // The card as it will look, from what is typed.
  const preview = form ? {
    slug: 'preview',
    title: form.title.trim() || 'Your drive\'s title',
    summary: form.summary.trim(),
    image_url: form.images[0] || null,
    goal_amount: Number(String(form.goal_amount).replace(/[^\d.]/g, '')) || null,
    ends_on: form.ends_on || null,
    raised: list.find((c) => c.id === form.id)?.raised || 0,
    gifts: list.find((c) => c.id === form.id)?.gifts || 0,
  } : null;

  const canCreate = !setupNote && !loading;

  return (
    <div className="gd gd-page">
      <DeskHead title="Donation drives" sub="Each drive gets its own page and a jar that fills toward the goal.">
        <a className="gd-btn" href="/donation" target="_blank" rel="noopener noreferrer">View the giving page</a>
        <button type="button" className="gd-btn is-primary" onClick={() => openForm()} disabled={!canCreate}>Create a drive</button>
      </DeskHead>

      {setupNote && <Notice notice={{ type: 'warn', text: setupNote }} />}

      {!setupNote && (
        <Strip
          stats={[
            { k: 'Taking gifts now', v: counts.running, s: `${counts.featured} featured on the website` },
            {
              k: 'Raised by all drives',
              v: peso(counts.raised),
              s: <>{plural(counts.gifts, 'gift')}{onSeeGifts && <button type="button" className="gd-link" onClick={() => onSeeGifts('drives')}>See gifts</button>}</>,
            },
            { k: 'Ended or hidden', v: counts.ended + counts.hidden, s: `${counts.ended} ended · ${counts.hidden} hidden` },
          ]}
        />
      )}

      <div className="gd-tools-bar is-flat">
        <Tabs
          label="Show"
          value={filter}
          onChange={setFilter}
          items={[
            { key: 'all', label: 'All', count: list.length },
            { key: 'running', label: 'Taking gifts', count: counts.running },
            { key: 'ended', label: 'Ended', count: counts.ended },
            { key: 'hidden', label: 'Hidden', count: counts.hidden },
          ]}
        />
        <div className="gd-tools">
          <input className="gd-input gd-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search drives" aria-label="Search drives" />
        </div>
      </div>

      <Notice notice={notice} onClose={() => setNotice(null)} />

      {loading ? (
        <div className="gd-card gd-empty">Loading…</div>
      ) : (
        <>
          <div className="gd-grid">
            {canCreate && (filter === 'all' || filter === 'running') && !query.trim() && (
              <button type="button" className="gd-new" onClick={() => openForm()}>
                <span className="gd-new-plus" aria-hidden="true">+</span>
                <strong>Create a drive</strong>
                <span>Photos, a goal and an end date.</span>
              </button>
            )}
            {shown.map((c) => {
              const st = standing(c);
              const goal = Number(c.goal_amount) || 0;
              const raised = Number(c.raised) || 0;
              const pct = goal ? Math.round((raised / goal) * 100) : null;
              const img = c.image_url || c.images?.[0] || null;
              const open = campaignOpen(c);
              return (
                <article key={c.id} className={`gd-card gd-drive ${!c.is_published || !open ? 'is-off' : ''}`} aria-busy={busyId === c.id}>
                  <div className="gd-cover">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img ? sized(img, 720, 316) : JAR_IMAGE} className={img ? '' : 'is-jar'} alt="" loading="lazy" decoding="async" />
                    <Pill tone={st.tone}>{st.label}</Pill>
                  </div>
                  <div className="gd-drive-body">
                    <h3>{c.title}</h3>
                    {pct != null && (
                      <span className="gd-meter" role="img" aria-label={`${pct}% of the goal`}><span style={{ width: `${Math.min(100, pct)}%` }}></span></span>
                    )}
                    <div className="gd-mrow">
                      <span><b>{peso(raised)}</b>{goal ? ` of ${peso(goal)}` : ' raised'}</span>
                      {pct != null && <b>{pct}%</b>}
                    </div>
                    <div className="gd-mrow">
                      <span>{plural(Number(c.gifts) || 0, 'gift')}</span>
                      <span>{open ? (campaignEnds(c) || 'No end date') : c.ends_on ? 'Ended' : ''}</span>
                    </div>
                    <div className="gd-drive-acts">
                      {onSeeGifts && <button type="button" className="gd-btn is-small" onClick={() => onSeeGifts(c.id)}>Gifts</button>}
                      <button type="button" className="gd-btn is-small" onClick={() => openForm(c)} disabled={busyId === c.id}>Edit</button>
                      <ManageMenu
                        label="More"
                        disabled={busyId === c.id}
                        items={[
                          c.is_published && { label: 'View on the website', href: campaignPath(c.slug) },
                          c.is_published && { label: 'Copy the link', onClick: () => copyLink(c) },
                          { divider: true },
                          c.is_published && open && (c.is_featured
                            ? { label: 'Stop featuring it', onClick: () => act(c, 'unfeature') }
                            : { label: 'Feature it beside the News', onClick: () => act(c, 'feature') }),
                          c.is_published
                            ? { label: 'Hide from the website', onClick: () => act(c, 'hide') }
                            : { label: 'Show on the website', onClick: () => act(c, 'publish') },
                          { label: 'Delete', danger: true, onClick: () => setConfirm(c) },
                        ]}
                      />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {shown.length === 0 && list.length > 0 && (
            <div className="gd-card gd-empty"><strong>No drives here</strong>Try another tab, or clear the search.</div>
          )}
          {list.length === 0 && !setupNote && filter !== 'all' && filter !== 'running' && (
            <div className="gd-card gd-empty"><strong>No donation drives yet</strong>Create one, and it is on the Donate page at once, with its jar.</div>
          )}
        </>
      )}

      {form && (
        <Modal
          title={form.id ? 'Edit donation drive' : 'Create a donation drive'}
          subtitle={form.id ? form.title : 'It goes on the Donate page, with its jar, as soon as it is created.'}
          onClose={() => { if (!saving && !uploading) setForm(null); }}
          busy={saving || uploading}
          dirty={dirty}
          initialFocus={`#${FORM_ID}-title`}
          footer={(
            <>
              {formError && <p className="sm-foot-error" role="alert">{formError}</p>}
              <button type="button" className="sm-btn" onClick={() => setForm(null)} disabled={saving || uploading}>Cancel</button>
              <button type="button" className="sm-btn is-primary" onClick={save} disabled={saving || uploading}>
                {saving ? 'Saving…' : form.id ? 'Save changes' : form.is_published ? 'Create drive' : 'Save as hidden'}
              </button>
            </>
          )}
        >
          <div className="sm-form">
            <div className="sm-fields">
              <Field id={`${FORM_ID}-title`} label="Title" required>
                <input id={`${FORM_ID}-title`} className="sm-input" maxLength={120} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Typhoon Relief for Bantayan" />
              </Field>
              <Field id={`${FORM_ID}-summary`} label="One line about it" below={<p className="sm-hint">On the card beside the News. {200 - form.summary.length} characters left.</p>}>
                <input id={`${FORM_ID}-summary`} className="sm-input" maxLength={200} value={form.summary} onChange={(e) => set('summary', e.target.value)} placeholder="e.g. Rice, water and roofing for 120 families" />
              </Field>
              <Field id={`${FORM_ID}-story`} label="The story" optional>
                <textarea id={`${FORM_ID}-story`} className="sm-input" rows={5} maxLength={5000} value={form.story} onChange={(e) => set('story', e.target.value)} placeholder="What it is for, who it helps, and how the gifts will be used" />
              </Field>

              <Field id={`${FORM_ID}-pic`} label={`Photos (${form.images.length} of ${MAX_PHOTOS})`} below={<p className="sm-hint">The first one is the cover. Add at least 5, so people can see the need.</p>}>
                <div className="gvm-photos">
                  {form.images.map((u, i) => (
                    <div key={u} className="gvm-photo">
                      <img src={u} alt={`Photo ${i + 1}`} />
                      {i === 0 ? <span className="gvm-cover">Cover</span> : <button type="button" className="gvm-photo-btn is-cover" onClick={() => makeCover(u)}>Make cover</button>}
                      <button type="button" className="gvm-photo-btn is-x" onClick={() => removePhoto(u)} aria-label={`Remove photo ${i + 1}`}>×</button>
                    </div>
                  ))}
                  {form.images.length < MAX_PHOTOS && (
                    <label className="gvm-photo gvm-add">
                      <input id={`${FORM_ID}-pic`} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} disabled={uploading} />
                      <span>{uploading ? 'Uploading…' : '+ Add photos'}</span>
                    </label>
                  )}
                </div>
              </Field>

              <div className="sm-two">
                <Field id={`${FORM_ID}-goal`} label="Goal" below={<p className="sm-hint">The jar is full at the goal. Without one, each donation is a heart.</p>}>
                  <input id={`${FORM_ID}-goal`} className="sm-input" inputMode="decimal" value={form.goal_amount} onChange={(e) => set('goal_amount', e.target.value.replace(/[^\d.,]/g, ''))} placeholder="₱ 50,000" />
                </Field>
                <Field id={`${FORM_ID}-ends`} label="Ends on" optional>
                  <input id={`${FORM_ID}-ends`} type="date" className="sm-input" value={form.ends_on} onChange={(e) => set('ends_on', e.target.value)} />
                </Field>
              </div>

              <Switch
                checked={form.is_published}
                onChange={(v) => set('is_published', v)}
                title="Show on the website"
                text={form.is_published ? 'On the Donate page, with its own page and jar.' : 'Kept here, hidden, until you show it.'}
              />
              <Switch
                checked={form.is_featured}
                onChange={(v) => set('is_featured', v)}
                title="Feature it"
                text="Beside the News articles, in the Community Hub and on the home page, until it ends."
              />
            </div>

            <div className="sm-preview">
              <div className="sm-preview-head"><span className="sm-label">How it looks beside the News</span></div>
              <div className="gvm-card-preview">
                <GivingCard campaign={preview} variant="rail" preview />
              </div>
              <p className="sm-hint">The whole card is a link to the drive&apos;s page, with its jar.</p>
            </div>
          </div>
        </Modal>
      )}

      {confirm && (
        <Confirm
          title="Delete this donation drive?"
          text={`"${confirm.title}" is taken off the website.${confirm.gifts ? ` Its ${confirm.gifts} ${confirm.gifts === 1 ? 'gift stays' : 'gifts stay'} in Gifts, with its name on them.` : ''}`}
          confirmLabel="Delete"
          busy={busyId === confirm.id}
          onConfirm={remove}
          onCancel={() => { if (busyId !== confirm.id) setConfirm(null); }}
        />
      )}
    </div>
  );
}
