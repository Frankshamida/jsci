'use client';

// Dashboard > Social Media > Sunday Service (Admin and Super Admin): the
// church's Facebook Lives, shown at /sunday-service (each at
// /sunday-service/<slug>) and played right on the page for anyone signed in.
// Paste the live's Embed code (or its link), check the title and the date,
// pick a thumbnail template, and post it - live now, or as a past service.
// End the live, hide or delete it later from Manage.
//
// Built from the same pieces as the Midweek Service tab (./kit), so the two
// work the same. One service is live at a time: putting one live ends the one
// before (the server sees to it).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_TEMPLATE, serviceDate } from '@/lib/serviceVideos';
import { EMBED_HELP, SUNDAY_LABEL, defaultSundayDate, parseLiveEmbed, sundayPath } from '@/lib/sundayService';
import {
  Confirm, Field, ManagerHead, Modal, Notice, Row, RowThumb, Stats, Switch, ThumbnailPanel, Toolbar,
  downloadThumbnail, useSettled,
} from './kit';

const API = '/api/live-streams/manage';
const FORM_ID = 'sms';

const blank = () => ({
  embed: '',
  title: SUNDAY_LABEL,
  speaker: '',
  description: '',
  service_date: defaultSundayDate(),
  thumbnail_template: DEFAULT_TEMPLATE,
  is_live: true,
  is_active: true,
});

const fromStream = (s) => ({
  id: s.id,
  embed: s.iframe_url || '',
  title: s.title || '',
  speaker: s.speaker || '',
  description: s.description || '',
  service_date: s.service_date || defaultSundayDate(),
  thumbnail_template: s.thumbnail_template || DEFAULT_TEMPLATE,
  is_live: !!s.is_live,
  is_active: s.is_active !== false,
});

const thumbOf = (s) => ({
  title: s.title?.trim() || SUNDAY_LABEL,
  date: s.service_date,
  speaker: (s.speaker || '').trim(),
  label: SUNDAY_LABEL,
});

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export default function SundayManager({ actorId, onLiveChange }) {
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [setupNote, setSetupNote] = useState('');
  const [notice, setNotice] = useState(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [form, setForm] = useState(null); // the stream being added or edited
  const [pristine, setPristine] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState(null); // the stream to delete

  const load = useCallback(async () => {
    if (!actorId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}?actorId=${encodeURIComponent(actorId)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Could not load the services.');
      setSetupNote(json.setupNote || '');
      setStreams(json.data || []);
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, [actorId]);

  useEffect(() => { load(); }, [load]);

  const liveCount = streams.filter((s) => s.is_live && s.is_active).length;
  useEffect(() => { onLiveChange?.(liveCount > 0); }, [liveCount, onLiveChange]);

  const embed = form?.embed || '';
  const parsed = useMemo(() => (embed.trim() ? parseLiveEmbed(embed) : null), [embed]);
  const thumbData = useSettled(form ? thumbOf(form) : null);
  const dirty = !!form && JSON.stringify(form) !== pristine;

  const openForm = (stream = null) => {
    const f = stream ? fromStream(stream) : blank();
    setForm(f);
    setPristine(JSON.stringify(f));
    setFormError('');
    setShowHelp(false);
    setPreview(false);
    setNotice(null);
  };
  const closeForm = () => { if (!saving) setForm(null); };
  const set = (key, value) => { setFormError(''); setForm((f) => ({ ...f, [key]: value })); };

  const endedNote = (ended) => (ended ? ' The service that was live before has ended.' : '');

  const save = async () => {
    if (!form) return;
    if (!parsed || parsed.error) { setFormError(parsed?.error || 'Paste the Facebook Live link or its Embed code.'); return; }
    if (!form.service_date) { setFormError('Pick the date of the service.'); return; }
    setSaving(true);
    setFormError('');
    try {
      const res = await fetch(API, {
        method: form.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, id: form.id, stream: form }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Could not save the service.');
      const saved = json.data;
      const before = streams.find((s) => s.id === form.id);
      const moved = form.id && before?.slug && saved.slug && before.slug !== saved.slug;
      setNotice({
        type: 'ok',
        text: (form.id
          ? moved
            ? `"${saved.title}" saved. Its address is now ${sundayPath(saved.slug)}; links to the old one still arrive there.`
            : `"${saved.title}" saved.`
          : !saved.is_active
            ? `"${saved.title}" is saved, hidden. Choose Manage, then Show on the website, when it should be on the website.`
            : saved.is_live
              ? `"${saved.title}" is live on the Sunday Service page. Signed-in visitors can watch it now.`
              : `"${saved.title}" is posted at ${sundayPath(saved.slug)}.`) + endedNote(json.ended),
      });
      setForm(null);
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const ACTION_TEXT = {
    live: (s) => `"${s.title}" is live now.`,
    end: (s) => `"${s.title}" has ended. It stays on the Sunday Service page with the past services.`,
    hide: (s) => `"${s.title}" is hidden from the website.`,
    publish: (s) => `"${s.title}" is on the website again.`,
  };
  const act = async (stream, action) => {
    setBusyId(stream.id);
    setNotice(null);
    try {
      const res = await fetch(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, id: stream.id, action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Could not do that.');
      setNotice({ type: 'ok', text: ACTION_TEXT[action](stream) + endedNote(json.ended) });
      if (json.ended) load();
      else setStreams((list) => list.map((s) => (s.id === stream.id ? json.data : s)));
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    const stream = confirm;
    setBusyId(stream.id);
    try {
      const res = await fetch(API, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, id: stream.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Could not delete it.');
      setStreams((list) => list.filter((s) => s.id !== stream.id));
      setNotice({ type: 'ok', text: `"${stream.title}" deleted.` });
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  };

  const download = async (stream) => {
    try { await downloadThumbnail(stream.thumbnail_template || DEFAULT_TEMPLATE, thumbOf(stream), stream.service_date); } catch (err) {
      setNotice({ type: 'error', text: err.message || 'The picture could not be made.' });
    }
  };

  const counts = useMemo(() => ({
    live: liveCount,
    published: streams.filter((s) => s.is_active).length,
    hidden: streams.filter((s) => !s.is_active).length,
    latest: streams.find((s) => s.is_active)?.service_date || null,
  }), [streams, liveCount]);

  const shown = streams.filter((s) => {
    if (filter === 'live' && !(s.is_live && s.is_active)) return false;
    if (filter === 'published' && !s.is_active) return false;
    if (filter === 'hidden' && s.is_active) return false;
    const q = query.trim().toLowerCase();
    return !q || `${s.title} ${s.speaker || ''} ${s.description || ''} ${s.service_date} ${serviceDate(s.service_date)?.long || ''}`.toLowerCase().includes(q);
  });

  const postButton = (
    <button type="button" className="sm-btn is-primary" onClick={() => openForm()} disabled={!!setupNote}>Post a live stream</button>
  );

  const statusOf = (s) => (s.is_live && s.is_active
    ? { tone: 'live', label: 'Live now' }
    : s.is_active ? { tone: 'on', label: 'On the website' } : { tone: 'off', label: 'Hidden' });

  return (
    <div className="sm-card">
      <ManagerHead
        title="Sunday Service"
        text="Post the church's Facebook Live of the Sunday Service. It plays on the Sunday Service page for anyone signed in (a free Guest account is enough) - live while it is on, and with the past services after it ends."
        pageHref="/sunday-service"
        pageLabel="View the page"
        action={postButton}
      />

      {setupNote && <Notice notice={{ type: 'warn', text: setupNote }} />}

      <Stats
        items={[
          { value: counts.live ? 'Live now' : 'Not live', label: 'Right now', live: counts.live > 0 },
          { value: counts.published, label: 'On the website' },
          { value: counts.latest ? serviceDate(counts.latest)?.medium : '—', label: 'Latest service' },
        ]}
      />

      <Toolbar
        filters={[
          { key: 'all', label: 'All', count: streams.length },
          { key: 'live', label: 'Live now', count: counts.live },
          { key: 'published', label: 'On the website', count: counts.published },
          { key: 'hidden', label: 'Hidden', count: counts.hidden },
        ]}
        filter={filter}
        onFilter={setFilter}
        query={query}
        onQuery={setQuery}
        placeholder="Search services"
      />

      <Notice notice={notice} onClose={() => setNotice(null)} />

      {loading ? (
        <div className="sm-empty">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="sm-empty">
          {streams.length === 0 ? (
            <>
              <strong>No live streams yet</strong>
              <span>When the Sunday Service goes live on Facebook, post it here and it plays on the Sunday Service page at once.</span>
              {postButton}
            </>
          ) : <span>{filter === 'live' ? 'Nothing is live right now.' : 'No services match.'}</span>}
        </div>
      ) : (
        <ul className="sm-list">
          {shown.map((s) => (
            <Row
              key={s.id}
              busy={busyId === s.id}
              off={!s.is_active}
              thumb={<RowThumb template={s.thumbnail_template || DEFAULT_TEMPLATE} {...thumbOf(s)} />}
              status={statusOf(s)}
              title={s.title}
              meta={[
                serviceDate(s.service_date)?.long,
                s.speaker,
                s.posted_by_name ? `posted by ${s.posted_by_name}` : null,
                s.reactionCount ? plural(s.reactionCount, 'heart', 'hearts') : null,
                s.commentCount ? plural(s.commentCount, 'comment', 'comments') : null,
              ].filter(Boolean).join(' · ')}
              onEdit={() => openForm(s)}
              menu={[
                s.is_live && s.is_active
                  ? { label: 'End the live', onClick: () => act(s, 'end') }
                  : { label: 'Go live', onClick: () => act(s, 'live') },
                s.is_active && { label: 'View on the website', href: sundayPath(s.slug) },
                s.link && { label: 'Open on Facebook', href: s.link },
                { label: 'Download thumbnail', onClick: () => download(s) },
                { divider: true },
                s.is_active
                  ? { label: 'Hide from the website', onClick: () => act(s, 'hide') }
                  : { label: 'Show on the website', onClick: () => act(s, 'publish') },
                { label: 'Delete', danger: true, onClick: () => setConfirm(s) },
              ]}
            />
          ))}
        </ul>
      )}

      {form && (
        <Modal
          title={form.id ? 'Edit live stream' : 'Post a live stream'}
          subtitle={form.id ? form.title : 'The Sunday Service, from the church\'s Facebook Live.'}
          onClose={closeForm}
          busy={saving}
          dirty={dirty}
          initialFocus={`#${FORM_ID}-embed`}
          footer={(
            <>
              {formError && <p className="sm-foot-error" role="alert">{formError}</p>}
              <button type="button" className="sm-btn" onClick={closeForm} disabled={saving}>Cancel</button>
              <button type="button" className="sm-btn is-primary" onClick={save} disabled={saving || !parsed?.src}>
                {saving ? 'Saving…' : form.id ? 'Save changes' : !form.is_active ? 'Save as hidden' : form.is_live ? 'Post and go live' : 'Post'}
              </button>
            </>
          )}
        >
          <div className="sm-form">
            <div className="sm-fields">
              <Field
                id={`${FORM_ID}-embed`}
                label="Facebook Live: Embed code or link"
                required
                below={parsed?.src ? (
                  <>
                    <p className="sm-check ok">
                      Facebook Live found.{' '}
                      <button type="button" className="sm-link" onClick={() => setPreview((v) => !v)}>{preview ? 'Hide the preview' : 'Preview it here'}</button>
                    </p>
                    {preview && (
                      <div className="sm-embed">
                        <iframe src={parsed.src} title="Preview of the live" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" allowFullScreen></iframe>
                      </div>
                    )}
                  </>
                ) : parsed?.error ? (
                  <p className="sm-check bad">{parsed.error}</p>
                ) : (
                  <>
                    <p className="sm-check">
                      {EMBED_HELP}{' '}
                      <button type="button" className="sm-link" onClick={() => setShowHelp((v) => !v)}>{showHelp ? 'Hide the steps' : 'Show me how'}</button>
                    </p>
                    {showHelp && (
                      <ol className="sm-help">
                        <li>On a computer, open the live video on the church&apos;s Facebook page.</li>
                        <li>Click <strong>⋯</strong> (More) on the video, then <strong>Embed</strong>.</li>
                        <li>Click <strong>Copy code</strong>, and paste it in the box above.</li>
                        <li>The video&apos;s own link (…/videos/1234…) works too. Keep the live <strong>Public</strong> on Facebook.</li>
                      </ol>
                    )}
                  </>
                )}
              >
                <textarea
                  id={`${FORM_ID}-embed`}
                  className="sm-input is-code"
                  rows={3}
                  value={form.embed}
                  onChange={(e) => { setPreview(false); set('embed', e.target.value); }}
                  placeholder={'<iframe src="https://www.facebook.com/plugins/video.php?href=…"></iframe>\nor https://www.facebook.com/…/videos/…'}
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
                <input id={`${FORM_ID}-title`} className="sm-input" value={form.title} maxLength={140} onChange={(e) => set('title', e.target.value)} placeholder={SUNDAY_LABEL} />
              </Field>

              <Field id={`${FORM_ID}-desc`} label="The message" optional>
                <textarea id={`${FORM_ID}-desc`} className="sm-input" rows={3} maxLength={1500} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="The sermon title, a Bible passage, or a short note for the viewers" />
              </Field>

              <Switch
                tone="live"
                checked={form.is_live && form.is_active}
                onChange={(v) => setForm((f) => ({ ...f, is_live: v, is_active: v ? true : f.is_active }))}
                title="Live now"
                text={form.is_live && form.is_active
                  ? 'Shown first on the Sunday Service page, marked Live. Any other live service ends.'
                  : 'Listed with the past services, to watch again.'}
              />
              <Switch
                checked={form.is_active}
                onChange={(v) => setForm((f) => ({ ...f, is_active: v, is_live: v ? f.is_live : false }))}
                title="Show on the website"
                text={form.is_active ? 'On the Sunday Service page for signed-in visitors.' : 'Kept here, hidden, until you show it.'}
              />
            </div>

            <ThumbnailPanel
              template={form.thumbnail_template}
              onTemplate={(key) => set('thumbnail_template', key)}
              data={thumbData}
              date={form.service_date}
              pageName="Sunday Service"
            />
          </div>
        </Modal>
      )}

      {confirm && (
        <Confirm
          title="Delete this live stream?"
          text={`"${confirm.title}" (${serviceDate(confirm.service_date)?.medium || ''}) is taken off the website, with its hearts and comments in the Community Hub. The video stays on Facebook.`}
          confirmLabel="Delete"
          busy={busyId === confirm.id}
          onConfirm={remove}
          onCancel={() => { if (busyId !== confirm.id) setConfirm(null); }}
        />
      )}
    </div>
  );
}
