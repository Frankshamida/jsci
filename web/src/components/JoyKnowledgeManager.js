'use client';

// Dashboard > System Configuration > Joy's Knowledge (Super Admin only).
//
// Documents Joy, the assistant on the public home page, answers from: drop a
// PDF, Word or text file (or write a note), and when a visitor asks something
// the matching parts are given to her with the question. Each document can be
// switched off without deleting it, opened to see the text Joy actually got
// out of it, or removed. "Try it" shows which parts a question would find, so
// the admin can check a document is being used before a visitor relies on it.
// Server side: src/app/api/joy-knowledge, src/lib/joyKnowledge.js.

import { useCallback, useEffect, useRef, useState } from 'react';
import { linkMeta, linkPlatform } from '@/lib/linkMeta';

const API = '/api/joy-knowledge';
const ACCEPT = '.pdf,.docx,.txt,.md,.csv';
const ACCEPTED = ['pdf', 'docx', 'txt', 'md', 'csv'];
const MAX_BYTES = 4 * 1024 * 1024;
const TYPE_LABEL = { pdf: 'PDF', docx: 'Word', txt: 'Text', md: 'Text', csv: 'CSV', note: 'Note', link: 'Link' };

const extOf = (name) => String(name || '').toLowerCase().split('.').pop();
const sizeLabel = (bytes) => {
  if (!bytes) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};
const dayLabel = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';
};

export default function JoyKnowledgeManager({ actorId }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [setupNote, setSetupNote] = useState('');
  const [notice, setNotice] = useState(null); // { type: 'ok' | 'error', text }
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState([]); // { key, name, state: 'waiting' | 'reading' | 'done' | 'error', text }
  const [noteTitle, setNoteTitle] = useState('');
  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkAbout, setLinkAbout] = useState('');
  const [linkSaving, setLinkSaving] = useState(false);
  const [titleLoading, setTitleLoading] = useState(false);
  const titleTouched = useRef(false); // the admin typed a title: leave it alone
  const [busyId, setBusyId] = useState(null);
  const [preview, setPreview] = useState({ id: null, text: '', more: false, loading: false });
  const [testQ, setTestQ] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState(null);
  const fileInput = useRef(null);

  const load = useCallback(async () => {
    if (!actorId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}?actorId=${encodeURIComponent(actorId)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (res.status === 503) { setSetupNote(json.message); setDocs([]); return; }
      if (!json.success) throw new Error(json.message || "Could not load Joy's knowledge.");
      setSetupNote('');
      setDocs(json.data || []);
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, [actorId]);

  useEffect(() => { load(); }, [load]);

  const patchUpload = (key, patch) => setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...patch } : u)));

  // One file at a time: each request stays under the server's size limit, and
  // a bad file does not stop the good ones after it.
  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length || !actorId) return;
    setNotice(null);
    const queued = files.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, file: f }));
    setUploads((list) => [
      ...queued.map(({ key, file }) => ({ key, name: file.name, state: 'waiting', text: 'Waiting…' })),
      ...list.filter((u) => u.state !== 'done'),
    ]);
    for (const { key, file } of queued) {
      if (!ACCEPTED.includes(extOf(file.name))) {
        patchUpload(key, { state: 'error', text: 'Joy reads PDF, Word (.docx), text, Markdown and CSV files.' });
        continue;
      }
      if (file.size > MAX_BYTES) {
        patchUpload(key, { state: 'error', text: 'Larger than 4 MB. Split it, or save the PDF without pictures.' });
        continue;
      }
      patchUpload(key, { state: 'reading', text: 'Reading…' });
      try {
        const form = new FormData();
        form.append('actorId', actorId);
        form.append('file', file);
        const res = await fetch(API, { method: 'POST', body: form });
        const json = await res.json().catch(() => ({}));
        if (res.status === 503) setSetupNote(json.message);
        if (!json.success) throw new Error(json.message || 'Could not add that file.');
        patchUpload(key, {
          state: 'done',
          text: `Added · ${json.data.chunk_count} ${json.data.chunk_count === 1 ? 'section' : 'sections'}${json.replaced ? ' · replaced the older copy' : ''}`,
        });
      } catch (err) {
        patchUpload(key, { state: 'error', text: err.message });
      }
    }
    load();
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    uploadFiles(e.dataTransfer?.files);
  };

  const addNote = async (e) => {
    e.preventDefault();
    if (noteSaving) return;
    setNoteSaving(true);
    setNotice(null);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, title: noteTitle, text: noteText }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 503) setSetupNote(json.message);
      if (!json.success) throw new Error(json.message || 'Could not add the note.');
      setNoteTitle('');
      setNoteText('');
      setNotice({ type: 'ok', text: `"${json.data.title}" added. Joy can use it right away.` });
      load();
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setNoteSaving(false);
    }
  };

  // A title for the pasted address: the platform and account for social media,
  // otherwise the page's own title (read by the server).
  const suggestTitle = async (url) => {
    const meta = linkMeta(url);
    if (!meta || titleTouched.current) return;
    setLinkTitle(meta.title);
    if (meta.key !== 'web') return;
    setTitleLoading(true);
    try {
      const res = await fetch(`${API}?actorId=${encodeURIComponent(actorId)}&titleFor=${encodeURIComponent(url)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (json.success && json.data?.title && !titleTouched.current) setLinkTitle(json.data.title);
    } catch { /* keep the one made from the address */ } finally {
      setTitleLoading(false);
    }
  };

  const addLink = async (e) => {
    e.preventDefault();
    if (linkSaving) return;
    setLinkSaving(true);
    setNotice(null);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, kind: 'link', url: linkUrl, title: linkTitle, about: linkAbout }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 503) setSetupNote(json.message);
      if (!json.success) throw new Error(json.message || 'Could not add the link.');
      setLinkUrl('');
      setLinkTitle('');
      setLinkAbout('');
      titleTouched.current = false;
      setNotice({ type: 'ok', text: `"${json.data.title}" added. Joy can share it right away.` });
      load();
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setLinkSaving(false);
    }
  };

  const toggle = async (doc) => {
    setBusyId(doc.id);
    setNotice(null);
    try {
      const res = await fetch(API, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, id: doc.id, is_active: !doc.is_active }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Could not save that change.');
      setDocs((list) => list.map((d) => (d.id === doc.id ? json.data : d)));
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (doc) => {
    if (!window.confirm(`Remove "${doc.title}"? Joy will stop using it. This cannot be undone.`)) return;
    setBusyId(doc.id);
    setNotice(null);
    try {
      const res = await fetch(API, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, id: doc.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Could not remove that document.');
      setDocs((list) => list.filter((d) => d.id !== doc.id));
      if (preview.id === doc.id) setPreview({ id: null, text: '', more: false, loading: false });
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const showPreview = async (doc) => {
    if (preview.id === doc.id) { setPreview({ id: null, text: '', more: false, loading: false }); return; }
    setPreview({ id: doc.id, text: '', more: false, loading: true });
    try {
      const res = await fetch(`${API}?actorId=${encodeURIComponent(actorId)}&docId=${encodeURIComponent(doc.id)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Could not open that document.');
      setPreview({ id: doc.id, text: json.data.text, more: json.data.more, loading: false });
    } catch (err) {
      setPreview({ id: doc.id, text: err.message, more: false, loading: false });
    }
  };

  const runTest = async (e) => {
    e.preventDefault();
    const q = testQ.trim();
    if (!q || testing) return;
    setTesting(true);
    try {
      const res = await fetch(`${API}?actorId=${encodeURIComponent(actorId)}&q=${encodeURIComponent(q)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Could not search.');
      setTestResults(json.data || []);
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
      setTestResults(null);
    } finally {
      setTesting(false);
    }
  };

  const activeCount = docs.filter((d) => d.is_active).length;

  return (
    <div className="hero-cfg jk">
      <div className="hero-cfg-head">
        <div>
          <h3><i className="fas fa-book-open"></i> Joy&apos;s Knowledge</h3>
          <p>
            Give Joy, the assistant on the public home page, documents to answer from: a church
            handbook, ministry guides, ISOM details, frequently asked questions.
          </p>
        </div>
        {activeCount > 0 && (
          <span className="hero-cfg-live">{activeCount} {activeCount === 1 ? 'document' : 'documents'} in use</span>
        )}
      </div>

      <p className="jk-warn">
        Joy can repeat anything in these documents to any visitor. Leave out private information
        such as members&apos; phone numbers, addresses or giving records.
      </p>

      {setupNote && <p className="hero-cfg-empty">{setupNote}</p>}

      <label
        className={`jk-drop ${dragging ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(e) => { uploadFiles(e.target.files); e.target.value = ''; }}
        />
        <i className="fas fa-cloud-arrow-up" aria-hidden="true"></i>
        <strong>Drop documents here, or click to choose</strong>
        <span>PDF, Word (.docx), text, Markdown or CSV · up to 4 MB each · several at once</span>
      </label>

      {uploads.length > 0 && (
        <ul className="jk-uploads">
          {uploads.map((u) => (
            <li key={u.key} className={u.state}>
              <span className="jk-upload-name">{u.name}</span>
              <span className="jk-upload-state">
                {u.state === 'reading' && <i className="fas fa-spinner fa-spin"></i>} {u.text}
              </span>
            </li>
          ))}
        </ul>
      )}

      <details className="jk-note">
        <summary>Or write a note for Joy</summary>
        <form onSubmit={addNote}>
          <input
            type="text"
            value={noteTitle}
            onChange={(e) => setNoteTitle(e.target.value)}
            placeholder="Title, e.g. Church office hours"
            maxLength={120}
            required
          />
          <textarea
            rows={5}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Write what Joy should know, in plain sentences. For example: The church office is open Tuesday to Saturday, 9:00 AM to 5:00 PM."
            required
          />
          <button type="submit" className="btn btn-primary" disabled={noteSaving}>
            {noteSaving ? <><i className="fas fa-spinner fa-spin"></i> Adding…</> : 'Add note'}
          </button>
        </form>
      </details>

      <details className="jk-note">
        <summary>Add a link Joy can share</summary>
        <p className="jk-hint">
          Facebook, Instagram, X, TikTok, YouTube, a sign-up form, a website… Joy shows it as a
          button with its icon. Your Facebook page, Messenger and YouTube channel are already built in.
        </p>
        <form onSubmit={addLink}>
          <input
            type="text"
            inputMode="url"
            autoComplete="off"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onBlur={() => suggestTitle(linkUrl)}
            onPaste={(e) => { const v = e.clipboardData.getData('text'); setTimeout(() => suggestTitle(v), 0); }}
            placeholder="https://www.instagram.com/yourchurch"
            required
          />
          <input
            type="text"
            value={linkTitle}
            onChange={(e) => { titleTouched.current = true; setLinkTitle(e.target.value); }}
            placeholder={titleLoading ? 'Finding the title…' : 'Title (filled in from the address)'}
            maxLength={120}
          />
          <input
            type="text"
            value={linkAbout}
            onChange={(e) => setLinkAbout(e.target.value)}
            placeholder="What is it for? e.g. Youth ministry updates and photos (optional)"
            maxLength={300}
          />
          {linkMeta(linkUrl) && (
            <p className="jk-link-preview">
              <span>Joy will show:</span>
              <span className={`jk-chip is-${linkMeta(linkUrl).key}`}>
                <i className={linkMeta(linkUrl).icon} aria-hidden="true"></i>
                {linkTitle || linkMeta(linkUrl).title}
              </span>
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={linkSaving || !linkUrl.trim()}>
            {linkSaving ? <><i className="fas fa-spinner fa-spin"></i> Adding…</> : 'Add link'}
          </button>
        </form>
      </details>

      {notice && <p className={`jk-notice ${notice.type}`}>{notice.text}</p>}

      <div className="jk-list">
        <div className="jk-list-head">
          <h4>Documents</h4>
          {!loading && docs.length > 0 && <span>{docs.length} total</span>}
        </div>
        {loading && <p className="jk-empty"><i className="fas fa-spinner fa-spin"></i> Loading…</p>}
        {!loading && docs.length === 0 && !setupNote && (
          <p className="jk-empty">
            No documents yet. Until you add some, Joy answers from the church&apos;s basic details and its events.
          </p>
        )}
        {!loading && docs.map((doc) => (
          <div key={doc.id} className={`jk-doc-wrap ${doc.is_active ? '' : 'off'}`}>
            <div className="jk-doc">
              <span className={`jk-type ${doc.file_type}`}>
                {doc.file_type === 'link' && doc.url
                  ? <><i className={linkPlatform(doc.url).icon} aria-hidden="true"></i> {linkPlatform(doc.url).key === 'web' ? 'Link' : linkPlatform(doc.url).name}</>
                  : (TYPE_LABEL[doc.file_type] || 'File')}
              </span>
              <div className="jk-doc-main">
                <strong>{doc.title}</strong>
                {doc.file_type === 'link' && doc.url ? (
                  <small>
                    <a href={doc.url} target="_blank" rel="noopener noreferrer" className="jk-url">{doc.url}</a>
                    {` · added ${dayLabel(doc.created_at)}`}
                  </small>
                ) : (
                  <small>
                    {[
                      `${doc.chunk_count} ${doc.chunk_count === 1 ? 'section' : 'sections'}`,
                      sizeLabel(doc.file_size),
                      `added ${dayLabel(doc.created_at)}${doc.uploaded_by_name ? ` by ${doc.uploaded_by_name}` : ''}`,
                    ].filter(Boolean).join(' · ')}
                  </small>
                )}
              </div>
              <label className="jk-switch" title={doc.is_active ? 'Joy uses this document' : 'Joy ignores this document'}>
                <input type="checkbox" checked={doc.is_active} disabled={busyId === doc.id} onChange={() => toggle(doc)} />
                <span className="jk-switch-track" aria-hidden="true"></span>
                <span className="jk-switch-label">{doc.is_active ? 'In use' : 'Off'}</span>
              </label>
              {doc.file_type !== 'link' && (
                <button type="button" className="jk-link" onClick={() => showPreview(doc)}>
                  {preview.id === doc.id ? 'Hide text' : 'View text'}
                </button>
              )}
              <button type="button" className="jk-link danger" disabled={busyId === doc.id} onClick={() => remove(doc)}>
                Remove
              </button>
            </div>
            {preview.id === doc.id && (
              <div className="jk-preview">
                {preview.loading
                  ? <p><i className="fas fa-spinner fa-spin"></i> Opening…</p>
                  : <pre>{preview.text}{preview.more ? '\n\n… (the rest of the document continues)' : ''}</pre>}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="jk-test">
        <h4>Try it</h4>
        <p>Type a question a visitor might ask to see which parts of your documents Joy would read before answering.</p>
        <form onSubmit={runTest}>
          <input
            type="text"
            value={testQ}
            onChange={(e) => setTestQ(e.target.value)}
            placeholder="e.g. How do I join the worship team?"
          />
          <button type="submit" className="btn btn-primary" disabled={testing || !testQ.trim()}>
            {testing ? <i className="fas fa-spinner fa-spin"></i> : 'Search'}
          </button>
        </form>
        {testResults && testResults.length === 0 && (
          <p className="jk-empty">Nothing in the documents matches that. Joy would answer from her general details, or say she doesn&apos;t know.</p>
        )}
        {testResults && testResults.length > 0 && (
          <ol className="jk-results">
            {testResults.map((r) => (
              <li key={r.id}>
                <span className="jk-result-from">From &ldquo;{r.title}&rdquo;</span>
                <p>{r.content.length > 600 ? `${r.content.slice(0, 600)}…` : r.content}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
