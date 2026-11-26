'use client';

// Dashboard > Social Media > Midweek Service (Admin and Super Admin): the
// Facebook videos of the Online Midweek Service, listed at /midweek (each at
// /midweek/<slug>) for signed-in visitors, who open them on Facebook. Paste the
// video's link, give it a title and a date, pick one of the five thumbnail
// templates, and post it; hide or delete it later from Manage.
//
// The thumbnail is never a stored picture: it is drawn from the video's own
// title, date and speaker by its template, so a renamed video shows its new
// title everywhere at once. Built from the same pieces as the Sunday Service
// tab (./kit), so the two work the same.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_CATEGORY, DEFAULT_TEMPLATE, categoryLabel, defaultDateFor, midweekPath, parseFacebookLink, serviceDate,
} from '@/lib/serviceVideos';
import {
  Confirm, Field, ManagerHead, Modal, Notice, Row, RowThumb, Stats, Switch, ThumbnailPanel, Toolbar,
  downloadThumbnail, useSettled,
} from './kit';

const API = '/api/service-videos/manage';
const FORM_ID = 'smw';

const blank = () => ({
  video_url: '',
  title: categoryLabel(DEFAULT_CATEGORY),
  speaker: '',
  description: '',
  category: DEFAULT_CATEGORY,
  service_date: defaultDateFor(DEFAULT_CATEGORY),
  thumbnail_template: DEFAULT_TEMPLATE,
  is_published: true,
});

const fromVideo = (v) => ({
  id: v.id,
  video_url: v.video_url,
  title: v.title || '',
  speaker: v.speaker || '',
  description: v.description || '',
  category: v.category || DEFAULT_CATEGORY, // kept as it is; Sunday has its own tab
  service_date: v.service_date,
  thumbnail_template: v.thumbnail_template || DEFAULT_TEMPLATE,
  is_published: v.is_published,
});

const thumbOf = (v) => ({
  title: v.title?.trim() || categoryLabel(v.category),
  date: v.service_date,
  speaker: (v.speaker || '').trim(),
  label: categoryLabel(v.category),
});

export default function MidweekManager({ actorId }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [setupNote, setSetupNote] = useState('');
  const [notice, setNotice] = useState(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [form, setForm] = useState(null); // the video being added or edited
  const [pristine, setPristine] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [confirm, setConfirm] = useState(null); // the video to delete

  const load = useCallback(async () => {
    if (!actorId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}?actorId=${encodeURIComponent(actorId)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (res.status === 503) { setSetupNote(json.message); setVideos([]); return; }
      if (!json.success) throw new Error(json.message || 'Could not load the videos.');
      setSetupNote('');
      setVideos(json.data || []);
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, [actorId]);

  useEffect(() => { load(); }, [load]);

  const videoUrl = form?.video_url || '';
  const parsed = useMemo(() => (videoUrl.trim() ? parseFacebookLink(videoUrl) : null), [videoUrl]);
  const thumbData = useSettled(form ? thumbOf(form) : null);
  const dirty = !!form && JSON.stringify(form) !== pristine;

  const openForm = (video = null) => {
    const f = video ? fromVideo(video) : blank();
    setForm(f);
    setPristine(JSON.stringify(f));
    setFormError('');
    setShowHelp(false);
    setNotice(null);
  };
  const closeForm = () => { if (!saving) setForm(null); };
  const set = (key, value) => { setFormError(''); setForm((f) => ({ ...f, [key]: value })); };

  const save = async () => {
    if (!form) return;
    if (!parsed || parsed.error) { setFormError(parsed?.error || 'Paste the video\'s link from Facebook.'); return; }
    if (!form.service_date) { setFormError('Pick the date of the service.'); return; }
    setSaving(true);
    setFormError('');
    try {
      const res = await fetch(API, {
        method: form.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, id: form.id, video: form }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Could not save the video.');
      const saved = json.data;
      const before = videos.find((v) => v.id === form.id);
      const moved = form.id && before?.slug && saved.slug && before.slug !== saved.slug;
      setNotice({
        type: 'ok',
        text: form.id
          ? moved
            ? `"${saved.title}" saved. Its address is now ${midweekPath(saved.slug)}; links to the old one still arrive there.`
            : `"${saved.title}" saved.`
          : saved.is_published
            ? `"${saved.title}" is posted at ${midweekPath(saved.slug)}. Signed-in visitors can open it now.`
            : `"${saved.title}" is saved, hidden. Choose Manage, then Show on the website, when it should be on the website.`,
      });
      setForm(null);
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const act = async (video, action) => {
    setBusyId(video.id);
    setNotice(null);
    try {
      const res = await fetch(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, id: video.id, action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Could not do that.');
      setVideos((list) => list.map((v) => (v.id === video.id ? json.data : v)));
      setNotice({ type: 'ok', text: action === 'hide' ? `"${video.title}" is hidden from the website.` : `"${video.title}" is on the website again.` });
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    const video = confirm;
    setBusyId(video.id);
    try {
      const res = await fetch(API, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, id: video.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Could not delete it.');
      setVideos((list) => list.filter((v) => v.id !== video.id));
      setNotice({ type: 'ok', text: `"${video.title}" deleted.` });
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  };

  const download = async (video) => {
    try { await downloadThumbnail(video.thumbnail_template || DEFAULT_TEMPLATE, thumbOf(video), video.service_date); } catch (err) {
      setNotice({ type: 'error', text: err.message || 'The picture could not be made.' });
    }
  };

  const counts = useMemo(() => ({
    published: videos.filter((v) => v.is_published).length,
    hidden: videos.filter((v) => !v.is_published).length,
    latest: videos.find((v) => v.is_published)?.service_date || null,
  }), [videos]);

  const shown = videos.filter((v) => {
    if (filter === 'published' && !v.is_published) return false;
    if (filter === 'hidden' && v.is_published) return false;
    const q = query.trim().toLowerCase();
    return !q || `${v.title} ${v.speaker || ''} ${v.description || ''} ${v.service_date} ${serviceDate(v.service_date)?.long || ''}`.toLowerCase().includes(q);
  });

  const postButton = (
    <button type="button" className="sm-btn is-primary" onClick={() => openForm()} disabled={!!setupNote}>Post a video</button>
  );

  return (
    <div className="sm-card">
      <ManagerHead
        title="Midweek Service"
        text="Post the Facebook video of each Online Midweek Service. It is listed on the Midweek Service page with a thumbnail made from its title, and anyone signed in (a free Guest account is enough) opens it on Facebook."
        pageHref="/midweek"
        pageLabel="View the page"
        action={postButton}
      />

      {setupNote && <Notice notice={{ type: 'warn', text: setupNote }} />}

      {!setupNote && (
        <Stats
          items={[
            { value: counts.published, label: 'On the website' },
            { value: counts.hidden, label: 'Hidden' },
            { value: counts.latest ? serviceDate(counts.latest)?.medium : '—', label: 'Latest service' },
          ]}
        />
      )}

      <Toolbar
        filters={[
          { key: 'all', label: 'All', count: videos.length },
          { key: 'published', label: 'On the website', count: counts.published },
          { key: 'hidden', label: 'Hidden', count: counts.hidden },
        ]}
        filter={filter}
        onFilter={setFilter}
        query={query}
        onQuery={setQuery}
        placeholder="Search videos"
      />

      <Notice notice={notice} onClose={() => setNotice(null)} />

      {loading ? (
        <div className="sm-empty">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="sm-empty">
          {videos.length === 0 && !setupNote ? (
            <>
              <strong>No videos yet</strong>
              <span>Post the latest Midweek Service from Facebook, and it is on the Midweek Service page at once.</span>
              {postButton}
            </>
          ) : !setupNote && <span>No videos match.</span>}
        </div>
      ) : (
        <ul className="sm-list">
          {shown.map((v) => (
            <Row
              key={v.id}
              busy={busyId === v.id}
              off={!v.is_published}
              thumb={<RowThumb template={v.thumbnail_template || DEFAULT_TEMPLATE} {...thumbOf(v)} />}
              status={v.is_published ? { tone: 'on', label: 'On the website' } : { tone: 'off', label: 'Hidden' }}
              title={v.title}
              meta={[serviceDate(v.service_date)?.long, v.speaker, v.posted_by_name ? `posted by ${v.posted_by_name}` : null].filter(Boolean).join(' · ')}
              onEdit={() => openForm(v)}
              menu={[
                v.is_published && { label: 'View on the website', href: midweekPath(v.slug) },
                { label: 'Open on Facebook', href: v.video_url },
                { label: 'Download thumbnail', onClick: () => download(v) },
                { divider: true },
                v.is_published
                  ? { label: 'Hide from the website', onClick: () => act(v, 'hide') }
                  : { label: 'Show on the website', onClick: () => act(v, 'publish') },
                { label: 'Delete', danger: true, onClick: () => setConfirm(v) },
              ]}
            />
          ))}
        </ul>
      )}

      {form && (
        <Modal
          title={form.id ? 'Edit video' : 'Post a Midweek Service video'}
          subtitle={form.id ? form.title : 'It goes on the Midweek Service page as soon as it is posted.'}
          onClose={closeForm}
          busy={saving}
          dirty={dirty}
          initialFocus={`#${FORM_ID}-url`}
          footer={(
            <>
              {formError && <p className="sm-foot-error" role="alert">{formError}</p>}
              <button type="button" className="sm-btn" onClick={closeForm} disabled={saving}>Cancel</button>
              <button type="button" className="sm-btn is-primary" onClick={save} disabled={saving || !parsed?.url}>
                {saving ? 'Saving…' : form.id ? 'Save changes' : form.is_published ? 'Post video' : 'Save as hidden'}
              </button>
            </>
          )}
        >
          <div className="sm-form">
            <div className="sm-fields">
              <Field
                id={`${FORM_ID}-url`}
                label="Facebook link of the video"
                required
                below={parsed?.url ? (
                  <p className="sm-check ok">
                    Facebook link found. <a href={parsed.url} target="_blank" rel="noopener noreferrer">Open it to check it is the right video</a>
                  </p>
                ) : parsed?.error ? (
                  <p className="sm-check bad">{parsed.error}</p>
                ) : (
                  <>
                    <p className="sm-check">
                      On Facebook: open the video, then <strong>Share</strong> → <strong>Copy link</strong>.{' '}
                      <button type="button" className="sm-link" onClick={() => setShowHelp((v) => !v)}>{showHelp ? 'Hide the steps' : 'Show me how'}</button>
                    </p>
                    {showHelp && (
                      <ol className="sm-help">
                        <li>Open the service video on the church&apos;s Facebook page.</li>
                        <li>Tap <strong>Share</strong>, then <strong>Copy link</strong>. (On a computer, the address in the browser bar works too.)</li>
                        <li>Paste it in the box above.</li>
                        <li>Keep the video <strong>Public</strong> on Facebook, so everyone who opens it can watch it.</li>
                      </ol>
                    )}
                  </>
                )}
              >
                <input
                  id={`${FORM_ID}-url`}
                  className="sm-input is-code"
                  value={form.video_url}
                  onChange={(e) => set('video_url', e.target.value)}
                  placeholder="https://www.facebook.com/reel/… or https://www.facebook.com/share/v/…"
                  spellCheck={false}
                  autoComplete="off"
                />
              </Field>

              <div className="sm-two">
                <Field id={`${FORM_ID}-date`} label="Date of the service" required>
                  <input id={`${FORM_ID}-date`} type="date" className="sm-input" value={form.service_date || ''} onChange={(e) => set('service_date', e.target.value)} />
                </Field>
                <Field id={`${FORM_ID}-speaker`} label="Speaker" optional>
                  <input id={`${FORM_ID}-speaker`} className="sm-input" value={form.speaker} maxLength={100} onChange={(e) => set('speaker', e.target.value)} placeholder="e.g. Ptr. Eldan Gambe" />
                </Field>
              </div>

              <Field id={`${FORM_ID}-title`} label="Title">
                <input id={`${FORM_ID}-title`} className="sm-input" value={form.title} maxLength={140} onChange={(e) => set('title', e.target.value)} placeholder={categoryLabel(form.category)} />
              </Field>

              <Field id={`${FORM_ID}-desc`} label="The message" optional>
                <textarea id={`${FORM_ID}-desc`} className="sm-input" rows={3} maxLength={1500} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="The sermon title, a Bible passage, or a short note for the viewers" />
              </Field>

              <Switch
                checked={form.is_published}
                onChange={(v) => set('is_published', v)}
                title="Show on the website"
                text={form.is_published ? 'Listed on the Midweek Service page for signed-in visitors.' : 'Kept here, hidden, until you show it.'}
              />
            </div>

            <ThumbnailPanel
              template={form.thumbnail_template}
              onTemplate={(key) => set('thumbnail_template', key)}
              data={thumbData}
              date={form.service_date}
              pageName="Midweek Service"
            />
          </div>
        </Modal>
      )}

      {confirm && (
        <Confirm
          title="Delete this video?"
          text={`"${confirm.title}" (${serviceDate(confirm.service_date)?.medium || confirm.service_date}) is taken off the website. The video stays on Facebook.`}
          confirmLabel="Delete"
          busy={busyId === confirm.id}
          onConfirm={remove}
          onCancel={() => { if (busyId !== confirm.id) setConfirm(null); }}
        />
      )}
    </div>
  );
}
