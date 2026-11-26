'use client';

// /news-studio/new and /news-studio/<id> - writing a news article.
// Admin and Super Admin only (the page checks, and so does every API call).
//
//   Left:    Library (blocks to add - click, or drag onto the page) and
//            Settings (title, summary, topic, tags, address, source, featured
//            picture, featured, author).
//   Middle:  the page as it will read: headline, summary, picture, blocks.
//   Top:     undo/redo, desktop/tablet/phone width, text formatting, AI.
//
// Drafts save themselves every 20 seconds. A published article is only
// changed when "Update" is pressed, so half-finished edits never go live.
// The AI tools (write a draft, suggest a title or summary, polish/shorten/
// expand/simplify a paragraph) are on this page only, which only Admins and
// Super Admins can open.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import '../../news/news.css';
import '../news-studio.css';
import {
  BLOCK_LIBRARY, NEWS_CATEGORIES, NEWS_LANGS, TEXT_BLOCKS, TRANSLATION_LANGS, articleIn, articlePath, blocksToText,
  hasContent, htmlToMarkup, htmlToText, markupToHtml, newBlock, newsDate, sanitizeHtml, slugify, sourceHash,
  textToHtml, translatableItems,
} from '@/lib/news';
import { getUserRoles } from '@/lib/permissions';
import { eventSlugFor } from '@/lib/eventSlug';
import { ImageLink } from '@/components/news/ImageLink';
import { evtDate } from '@/lib/eventWhen';
import ArticleBody from '@/components/news/ArticleBody';
import { uploadNewsImage as uploadImage } from '@/lib/newsUpload';

const EDITOR_ROLES = ['Admin', 'Super Admin'];
const EMPTY = {
  title: '', summary: '', category: 'Church News', tags: [], slug: '', slugTouched: false,
  source_url: '', featured_image: null, is_featured: false, author_name: '', content: [], status: 'draft',
  translations: {},
};
const LANG_NAME = Object.fromEntries(NEWS_LANGS.map((l) => [l.code, l.label]));
const AI_MODES = [
  { key: 'polish', label: 'Polish', hint: 'Fix grammar and make it read smoothly' },
  { key: 'natural', label: 'Natural', hint: 'Make it sound like a person wrote it, not an AI' },
  { key: 'shorten', label: 'Shorten', hint: 'About half as long' },
  { key: 'expand', label: 'Expand', hint: 'Fuller, without adding new facts' },
  { key: 'simplify', label: 'Simplify', hint: 'Plain, simple English' },
];

// The words the AI picked, made bold where they first appear in the block -
// only in plain text (never inside a link, a heading or what is bold already),
// so nothing else in the paragraph changes.
function boldPhrases(html, phrases) {
  if (typeof window === 'undefined' || !phrases?.length) return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstChild;
  phrases.forEach((phrase) => {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (!node.parentElement.closest('strong, b, a, h2, h3, h4')) {
        const at = node.data.indexOf(phrase);
        if (at >= 0) {
          const hit = node.splitText(at);
          hit.splitText(phrase.length);
          const strong = doc.createElement('strong');
          hit.parentNode.replaceChild(strong, hit);
          strong.appendChild(hit);
          return;
        }
      }
      node = walker.nextNode();
    }
  });
  return sanitizeHtml(root.innerHTML);
}

// "October 2–3, 2026" for an event card.
const eventWhen = (start, end) => {
  const s = evtDate(start);
  if (!s) return '';
  const e = evtDate(end);
  const opt = { month: 'long', day: 'numeric', year: 'numeric' };
  if (!e || s.toDateString() === e.toDateString()) return s.toLocaleDateString('en-US', opt);
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
    return `${s.toLocaleDateString('en-US', { month: 'long' })} ${s.getDate()}–${e.getDate()}, ${s.getFullYear()}`;
  }
  return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', opt)}`;
};

// The article's text in small batches for the translator: each request
// stays well inside what the AI takes in one go and answers within the
// server's time limit.
const batchItems = (items, maxChars = 2800, maxItems = 12) => {
  const batches = [];
  let cur = [];
  let size = 0;
  items.forEach((it) => {
    if (cur.length && (size + it.text.length > maxChars || cur.length >= maxItems)) { batches.push(cur); cur = []; size = 0; }
    cur.push(it);
    size += it.text.length;
  });
  if (cur.length) batches.push(cur);
  return batches;
};
const DEVICES = [
  { key: 'desktop', icon: 'fas fa-desktop', label: 'Desktop', width: 860 },
  { key: 'tablet', icon: 'fas fa-tablet-screen-button', label: 'Tablet', width: 640 },
  { key: 'mobile', icon: 'fas fa-mobile-screen-button', label: 'Phone', width: 390 },
];
const COLORS = ['#1a1a2e', '#926C15', '#C9980B', '#4b5563', '#b91c1c', '#15803d', '#1d4ed8'];
// How many photos a block can hold.
const maxImages = (type) => (type === 'carousel' ? 20 : 12);

const BLOCK_NAMES = Object.fromEntries(BLOCK_LIBRARY.flatMap((g) => g.items.map((i) => [i.type, i.label])));

const rowToDoc = (a) => ({
  title: a.title || '',
  summary: a.summary || '',
  category: a.category || 'Church News',
  tags: a.tags || [],
  slug: a.slug || '',
  slugTouched: true,
  source_url: a.source_url || '',
  featured_image: a.featured_image_url ? { url: a.featured_image_url, publicId: a.featured_image_public_id || null } : null,
  is_featured: !!a.is_featured,
  author_name: a.author_name || '',
  content: Array.isArray(a.content) ? a.content : [],
  status: a.status || 'draft',
  translations: a.translations && typeof a.translations === 'object' ? a.translations : {},
});

const savedLabel = (t) => {
  if (!t) return null;
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  return m === 1 ? 'a minute ago' : `${m} minutes ago`;
};

// A contentEditable whose HTML is set once, when it appears. Typing never
// re-renders it (that would throw the cursor to the start); an outside change
// - undo, the AI - gives it a new key, so it is drawn again from the state.
function Editable({ html, onChange, onFocus, className, placeholder, tag = 'div' }) {
  const ref = useRef(null);
  useLayoutEffect(() => { if (ref.current) ref.current.innerHTML = html || ''; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const Tag = tag;
  return (
    <Tag
      ref={ref}
      className={`ns-editable ${className || ''}`}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onInput={(e) => onChange(e.currentTarget.innerHTML)}
      onFocus={onFocus}
      onPaste={(e) => {
        // Pasted from Word or a web page: keep the words and simple
        // formatting, drop everything else.
        e.preventDefault();
        const html = e.clipboardData.getData('text/html');
        const text = e.clipboardData.getData('text/plain');
        document.execCommand('insertHTML', false, html ? sanitizeHtml(html) : textToHtml(text) || '');
      }}
    />
  );
}

function AutoTextarea({ value, onChange, className, placeholder, maxLength }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={className}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// The "See more" link under a picture: pick one of the church's events (the
// link and its text fill themselves in) or write any link and text.
function ImageLinkEditor({ image, onChange, links }) {
  const [open, setOpen] = useState(Boolean(image.link || image.linkLabel));
  const { load } = links;
  useEffect(() => { if (open) load(); }, [open, load]);
  if (!open) {
    return (
      <button type="button" className="ns-imglink-add" onClick={() => setOpen(true)}>
        <i className="fas fa-link"></i> Add a &ldquo;See more&rdquo; link
      </button>
    );
  }
  const pick = (id) => {
    const evt = (links.events || []).find((e) => e.id === id);
    if (evt) onChange({ ...image, link: `/${eventSlugFor(evt, links.events)}`, linkLabel: `See more: ${evt.title}` });
  };
  const clear = () => { onChange({ ...image, link: undefined, linkLabel: undefined }); setOpen(false); };
  return (
    <div className="ns-imglink">
      <div className="ns-imglink-head">
        <span><i className="fas fa-link"></i> See more link</span>
        <button type="button" onClick={clear} title="Remove the link" aria-label="Remove the link"><i className="fas fa-xmark"></i></button>
      </div>
      <select value="" onFocus={links.load} onChange={(e) => pick(e.target.value)}>
        <option value="">{links.events === null ? 'Loading events…' : 'Link to an event…'}</option>
        {(links.events || []).map((e) => (
          <option key={e.id} value={e.id}>{e.title} · {eventWhen(e.event_date, e.end_date)}</option>
        ))}
      </select>
      <input
        value={image.linkLabel || ''}
        maxLength={160}
        placeholder="Link text, e.g. See more: Youth Camp 2026"
        onChange={(e) => onChange({ ...image, linkLabel: e.target.value })}
      />
      <input
        value={image.link || ''}
        maxLength={600}
        placeholder="Link: /youth-camp-2026 or https://…"
        onChange={(e) => onChange({ ...image, link: e.target.value.trim() })}
      />
      {image.link && (
        <div className="ns-inert ns-imglink-preview" onClickCapture={(e) => e.preventDefault()}>
          <ImageLink image={image} />
        </div>
      )}
    </div>
  );
}

function ImageSlot({ image, onPick, onChange, onRemove, onMove, links, busy, label = 'Add a photo', compact = false }) {
  const input = useRef(null);
  if (!image) {
    return (
      <button type="button" className={`ns-imgslot ${compact ? 'compact' : ''}`} onClick={() => input.current?.click()} disabled={busy}>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f); }} />
        {busy ? <i className="fas fa-spinner fa-spin"></i> : <i className="far fa-image"></i>}
        <span>{busy ? 'Uploading…' : label}</span>
      </button>
    );
  }
  return (
    <figure className="ns-img">
      <img src={image.url} alt="" />
      <div className="ns-img-tools">
        {onMove && <button type="button" onClick={() => onMove(-1)} title="Move earlier"><i className="fas fa-arrow-left"></i></button>}
        {onMove && <button type="button" onClick={() => onMove(1)} title="Move later"><i className="fas fa-arrow-right"></i></button>}
        <button type="button" onClick={() => input.current?.click()} title="Replace photo"><i className="fas fa-arrows-rotate"></i></button>
        <button type="button" onClick={onRemove} title="Remove photo"><i className="fas fa-trash"></i></button>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f); }} />
      </div>
      {onChange && (
        <input
          className="ns-caption"
          value={image.caption || ''}
          placeholder="Caption (optional)"
          maxLength={300}
          onChange={(e) => onChange({ ...image, caption: e.target.value })}
        />
      )}
      {onChange && links && <ImageLinkEditor image={image} onChange={onChange} links={links} />}
    </figure>
  );
}

export default function NewsStudio({ params }) {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [allowed, setAllowed] = useState(null); // null while checking
  const [articleId, setArticleId] = useState(params.id === 'new' ? null : params.id);
  const [doc, setDoc] = useState(EMPTY);
  const docRef = useRef(EMPTY);
  const history = useRef({ past: [], future: [], lastPush: 0 });
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(params.id !== 'new');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [, setTick] = useState(0);
  const [toast, setToast] = useState(null); // { type, text, link? }
  const [panel, setPanel] = useState('library');
  const [panelOpen, setPanelOpen] = useState(true);
  const [device, setDevice] = useState('desktop');
  const [activeId, setActiveId] = useState(null);
  const [busy, setBusy] = useState({}); // uploads / AI in progress, by key
  const [preview, setPreview] = useState(false);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [wholeOpen, setWholeOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiForm, setAiForm] = useState({ topic: '', notes: '', source: '', tone: 'news', length: 'medium', mode: 'replace' });
  const [titleOptions, setTitleOptions] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [dropAt, setDropAt] = useState(null);
  const [aiDrafted, setAiDrafted] = useState(false);

  // ---- Who is writing ----
  useEffect(() => {
    let stored = {};
    try { stored = JSON.parse(sessionStorage.getItem('userData') || localStorage.getItem('userData') || '{}'); } catch { /* signed out */ }
    if (!stored?.id) { router.replace('/login'); return; }
    setUser(stored);
    setAllowed(getUserRoles(stored).some((r) => EDITOR_ROLES.includes(r)));
  }, [router]);

  const notify = useCallback((type, text, link) => {
    setToast({ type, text, link });
    if (type !== 'error') setTimeout(() => setToast((t) => (t && t.text === text ? null : t)), 4000);
  }, []);

  // ---- The article ----
  const replaceDoc = (next) => { docRef.current = next; setDoc(next); setRevision((r) => r + 1); };

  useEffect(() => {
    if (!allowed || !user || !articleId || params.id === 'new') {
      if (allowed && user && params.id === 'new') {
        replaceDoc({ ...EMPTY, author_name: [user.firstname, user.lastname].filter(Boolean).join(' ') });
      }
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/news/manage?actorId=${encodeURIComponent(user.id)}&id=${encodeURIComponent(articleId)}`, { cache: 'no-store' });
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'Could not open the article.');
        replaceDoc(rowToDoc(json.data));
        setLastSaved(new Date(json.data.updated_at).getTime());
      } catch (err) {
        notify('error', err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [allowed, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every change goes through here, so it can be undone. Typing is grouped:
  // one undo step per pause, not per letter.
  const update = useCallback((fn, { typing = false } = {}) => {
    const prev = docRef.current;
    const next = fn(prev);
    if (next === prev) return;
    const h = history.current;
    const now = Date.now();
    if (!typing || now - h.lastPush > 1500) {
      h.past.push(prev);
      if (h.past.length > 100) h.past.shift();
    }
    if (typing) h.lastPush = now; else h.lastPush = 0;
    h.future = [];
    docRef.current = next;
    setDoc(next);
    setDirty(true);
  }, []);

  const set = (field, value, typing = false) => update((d) => {
    const next = { ...d, [field]: value };
    if (field === 'title' && !d.slugTouched) next.slug = slugify(value);
    return next;
  }, { typing });

  const undo = () => {
    const h = history.current;
    if (!h.past.length) return;
    h.future.push(docRef.current);
    replaceDoc(h.past.pop());
    setDirty(true);
  };
  const redo = () => {
    const h = history.current;
    if (!h.future.length) return;
    h.past.push(docRef.current);
    replaceDoc(h.future.pop());
    setDirty(true);
  };

  // ---- Blocks ----
  const setBlock = (id, patch, typing = false) => update((d) => ({
    ...d, content: d.content.map((b) => (b.id === id ? { ...b, ...patch } : b)),
  }), { typing });

  const addBlock = (type, at = null) => {
    const block = newBlock(type);
    update((d) => {
      const list = [...d.content];
      let index = at;
      if (index == null) {
        const active = list.findIndex((b) => b.id === activeId);
        index = active >= 0 ? active + 1 : list.length;
      }
      list.splice(index, 0, block);
      return { ...d, content: list };
    });
    setActiveId(block.id);
    setTimeout(() => {
      const el = document.querySelector(`[data-block="${block.id}"] .ns-editable`) || document.querySelector(`[data-block="${block.id}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (el?.classList.contains('ns-editable')) el.focus();
    }, 60);
  };

  const moveBlock = (id, dir) => {
    update((d) => {
      const list = [...d.content];
      const i = list.findIndex((b) => b.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return d;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...d, content: list };
    });
    setRevision((r) => r + 1);
  };

  const removeBlock = (id) => {
    const b = docRef.current.content.find((x) => x.id === id);
    const filled = b && (htmlToText(b.html || '') || b.image || (b.images || []).length);
    if (filled && !window.confirm(`Remove this ${BLOCK_NAMES[b.type] || 'block'}?`)) return;
    update((d) => ({ ...d, content: d.content.filter((x) => x.id !== id) }));
  };

  // ---- Pictures ----
  const withBusy = async (key, fn) => {
    setBusy((s) => ({ ...s, [key]: true }));
    try { return await fn(); } catch (err) { notify('error', err.message); return null; } finally {
      setBusy((s) => { const n = { ...s }; delete n[key]; return n; });
    }
  };
  const pickFeatured = (file) => withBusy('featured', async () => {
    const img = await uploadImage(file, user.id);
    update((d) => ({ ...d, featured_image: { url: img.url, publicId: img.publicId } }));
  });
  // A new photo in place of the old one keeps the old one's caption and link.
  const keepWords = (up, old) => (old ? { ...up, caption: old.caption || '', link: old.link, linkLabel: old.linkLabel } : up);
  const pickBlockImage = (id, file) => withBusy(id, async () => {
    const img = await uploadImage(file, user.id);
    const old = docRef.current.content.find((b) => b.id === id)?.image;
    setBlock(id, { image: keepWords(img, old) });
  });
  const addBlockImages = (id, files) => withBusy(id, async () => {
    const max = maxImages(docRef.current.content.find((b) => b.id === id)?.type);
    const list = [];
    for (const f of Array.from(files).slice(0, max)) list.push(await uploadImage(f, user.id));
    update((d) => ({ ...d, content: d.content.map((b) => (b.id === id ? { ...b, images: [...(b.images || []), ...list].slice(0, max) } : b)) }));
  });

  // ---- Formatting (the toolbar acts on the text the cursor is in) ----
  // The last place the cursor was inside the article's text. The style
  // dropdown and the link prompt take the focus away; this puts it back, so
  // the formatting lands on the words that were selected.
  const savedRange = useRef(null);
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const node = sel.anchorNode;
      const el = node && (node.nodeType === 1 ? node : node.parentElement);
      if (el?.closest?.('.ns-editable')) savedRange.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);
  const restoreSelection = () => {
    if (document.activeElement?.isContentEditable) return true;
    const r = savedRange.current;
    if (!r) return false;
    const start = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    const host = start?.closest?.('.ns-editable');
    if (!host || !document.contains(host)) return false;
    host.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    return true;
  };
  const exec = (cmd, value = null) => {
    if (!restoreSelection()) { notify('info', 'Click inside the text you want to change first.'); return; }
    if (cmd === 'foreColor') document.execCommand('styleWithCSS', false, true);
    document.execCommand(cmd, false, value);
    if (cmd === 'foreColor') document.execCommand('styleWithCSS', false, false);
  };
  const addLink = () => {
    if (!restoreSelection()) { notify('info', 'Select the words to turn into a link first.'); return; }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { notify('info', 'Select the words to turn into a link first.'); return; }
    const range = sel.getRangeAt(0).cloneRange();
    const url = window.prompt('Link address (https://…)', 'https://');
    if (!url) return;
    if (!/^(https?:\/\/|mailto:|tel:|\/)/i.test(url.trim())) { notify('error', 'Use a full web address starting with https://'); return; }
    savedRange.current = range;
    if (document.activeElement?.isContentEditable) document.activeElement.blur();
    exec('createLink', url.trim());
  };
  const formatBlock = (tag) => exec('formatBlock', tag);

  // ---- Saving ----
  const payload = (status) => {
    const d = docRef.current;
    return {
      title: d.title, summary: d.summary, category: d.category, tags: d.tags, slug: d.slug,
      source_url: d.source_url, featured_image: d.featured_image, is_featured: d.is_featured,
      author_name: d.author_name, content: d.content, status, translations: d.translations || {},
    };
  };

  const save = useCallback(async (status, { silent = false } = {}) => {
    const d = docRef.current;
    if (!d.title.trim()) { if (!silent) notify('error', 'Give the article a title first.'); return false; }
    if (status === 'published') {
      if (!d.summary.trim()) { setPanel('settings'); setPanelOpen(true); notify('error', 'Write a short summary before publishing (Settings).'); return false; }
      if (!hasContent(d.content)) { notify('error', 'Add some text or pictures to the article before publishing.'); return false; }
      if (!d.featured_image && !window.confirm('This article has no featured picture, so it will show without a thumbnail. Publish anyway?')) return false;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/news/manage', {
        method: articleId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: user.id, id: articleId || undefined, article: payload(status) }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Could not save.');
      const saved = json.data;
      if (!articleId) {
        setArticleId(saved.id);
        window.history.replaceState(null, '', `/news-studio/${saved.id}`);
      }
      // Keep what is on screen (the writer may have typed since), but take
      // the server's address and status.
      const nextDoc = { ...docRef.current, slug: saved.slug, slugTouched: true, status: saved.status };
      docRef.current = nextDoc;
      setDoc(nextDoc);
      setDirty(false);
      setLastSaved(Date.now());
      if (json.warning) notify('error', json.warning);
      else if (!silent) {
        if (status === 'published') notify('ok', d.status === 'published' ? 'Article updated.' : 'Article published.', articlePath(saved.slug));
        else notify('ok', d.status === 'published' ? 'Moved back to drafts. It is no longer on the News page.' : 'Draft saved.');
      }
      return saved.id || true;
    } catch (err) {
      notify('error', err.message);
      return false;
    } finally {
      setSaving(false);
    }
  }, [articleId, user, notify]);

  // Drafts save themselves.
  useEffect(() => {
    if (!dirty || saving || doc.status === 'published' || !doc.title.trim()) return undefined;
    const t = setTimeout(() => save('draft', { silent: true }), 20000);
    return () => clearTimeout(t);
  }, [doc, dirty, saving, save]);

  // "Last saved 2 minutes ago" keeps itself current.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Ctrl/Cmd+S saves, Ctrl/Cmd+Z / Shift+Z undo and redo outside the text.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); save(docRef.current.status === 'published' ? 'published' : 'draft'); }
      const inText = e.target?.isContentEditable || /^(INPUT|TEXTAREA)$/.test(e.target?.tagName);
      if (!inText && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const goBack = () => {
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    router.push('/news-management');
  };

  // A Facebook poster of this article (/news-management/poster/<id>). The
  // poster is made from the saved article, so a draft is saved first; a
  // published one is only changed by "Update", so its edits are asked about.
  const makePoster = async () => {
    let id = articleId;
    if (!id || dirty) {
      if (docRef.current.status === 'published' && id) {
        if (!window.confirm('Your latest changes are not live yet, and the poster uses the saved article. Leave them unsaved and make the poster?')) return;
      } else {
        const saved = await save('draft', { silent: true });
        if (!saved) return;
        id = typeof saved === 'string' ? saved : id;
      }
    }
    if (id) router.push(`/news-management/poster/${id}?from=studio`);
  };

  // ---- AI ----
  const ai = async (body) => {
    const res = await fetch('/api/news/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actorId: user.id, ...body }),
    });
    const json = await res.json().catch(() => ({}));
    if (!json.success) throw new Error(json.message || 'The AI could not finish that.');
    return json.data;
  };

  const aiTitle = () => withBusy('ai-title', async () => {
    const d = docRef.current;
    const data = await ai({ action: 'title', title: d.title, summary: d.summary, text: blocksToText(d.content) });
    setTitleOptions(data.titles);
  });
  const aiSummary = () => withBusy('ai-summary', async () => {
    const d = docRef.current;
    const data = await ai({ action: 'summary', title: d.title, text: blocksToText(d.content) });
    set('summary', data.summary);
  });
  // The paragraph the cursor is in, rewritten. It goes to the AI as markup
  // (headings, lists, bold words and links kept) and comes back the same way.
  const aiRewrite = (mode) => {
    const b = docRef.current.content.find((x) => x.id === activeId);
    if (!b || !TEXT_BLOCKS.has(b.type)) { notify('info', 'Click inside a paragraph first, then choose how the AI should rewrite it.'); return; }
    if (!htmlToText(b.html)) { notify('info', 'That block has no text yet.'); return; }
    withBusy(`ai-${b.id}`, async () => {
      const data = await ai({ action: 'rewrite', mode, text: htmlToMarkup(b.html) });
      setBlock(b.id, { html: markupToHtml(data.text) });
      setRevision((r) => r + 1);
      notify('ok', mode === 'natural' ? 'Rewritten to sound natural. Read it through before publishing.' : 'Rewritten by the AI. Read it through before publishing.');
    });
  };

  // The important words of a paragraph - or of every paragraph - in bold.
  // The AI only names words that are already there; nothing is rewritten.
  const textBlocks = () => docRef.current.content.filter((b) => TEXT_BLOCKS.has(b.type) && htmlToText(b.html || ''));
  const applyHighlights = (highlights) => {
    const byId = new Map(highlights.map((h) => [h.key, h.phrases]));
    let count = 0;
    update((d) => ({
      ...d,
      content: d.content.map((b) => {
        const phrases = byId.get(b.id);
        if (!phrases?.length || !b.html) return b;
        const html = boldPhrases(b.html, phrases);
        if (html !== b.html) count += 1;
        return html === b.html ? b : { ...b, html };
      }),
    }));
    setRevision((r) => r + 1);
    return count;
  };
  const aiHighlight = (whole = false) => {
    const targets = whole ? textBlocks() : textBlocks().filter((b) => b.id === activeId);
    if (!targets.length) { notify('info', whole ? 'Write some of the article first.' : 'Click inside a paragraph first.'); return; }
    withBusy(whole ? 'ai-whole' : `ai-${targets[0].id}`, async () => {
      const highlights = [];
      for (let i = 0; i < targets.length; i += 30) {
        const data = await ai({ action: 'highlight', items: targets.slice(i, i + 30).map((b) => ({ key: b.id, text: htmlToText(b.html) })) });
        highlights.push(...data.highlights);
      }
      const n = applyHighlights(highlights);
      notify('ok', n ? `Key words made bold in ${n} ${n === 1 ? 'paragraph' : 'paragraphs'}. Click Undo to take it back.` : 'The AI found nothing that needed highlighting.');
    });
  };

  // Every paragraph made to sound natural, a few at a time.
  const aiNaturalWhole = () => {
    const targets = textBlocks();
    if (!targets.length) { notify('info', 'Write some of the article first.'); return; }
    withBusy('ai-whole', async () => {
      const rewritten = new Map();
      for (let i = 0; i < targets.length; i += 6) {
        const data = await ai({ action: 'rewrite', mode: 'natural', items: targets.slice(i, i + 6).map((b) => ({ key: b.id, text: htmlToMarkup(b.html) })) });
        data.items.forEach((it) => rewritten.set(it.key, it.text));
      }
      update((d) => ({ ...d, content: d.content.map((b) => (rewritten.has(b.id) ? { ...b, html: markupToHtml(rewritten.get(b.id)) } : b)) }));
      setRevision((r) => r + 1);
      notify('ok', `${rewritten.size} ${rewritten.size === 1 ? 'paragraph' : 'paragraphs'} rewritten to sound natural. Read it through, or click Undo.`);
    });
  };

  // ---- Translations ----
  const [translating, setTranslating] = useState(null); // { lang, done, total }
  const [review, setReview] = useState(null); // { lang, fields }
  const [previewLang, setPreviewLang] = useState('en');

  const translate = async (langs) => {
    const d = docRef.current;
    const items = translatableItems(d);
    if (!items.length) { notify('info', 'Write the article first, then translate it.'); return; }
    const batches = batchItems(items);
    const results = {};
    try {
      for (const lang of langs) {
        const fields = {};
        for (let i = 0; i < batches.length; i += 1) {
          setTranslating({ lang, done: i, total: batches.length });
          let data;
          try {
            data = await ai({ action: 'translate', lang, items: batches[i] });
          } catch (err) {
            // A busy minute: wait and try that batch once more.
            if (!/too many|busy|a lot of/i.test(err.message)) throw err;
            await new Promise((r) => setTimeout(r, 20000));
            data = await ai({ action: 'translate', lang, items: batches[i] });
          }
          data.items.forEach((it) => { fields[it.key] = it.text; });
        }
        results[lang] = { fields, sourceHash: sourceHash(d), at: new Date().toISOString(), reviewed: false };
      }
      update((cur) => ({ ...cur, translations: { ...(cur.translations || {}), ...results } }));
      notify('ok', `Translated to ${langs.map((l) => LANG_NAME[l]).join(' and ')}. Open Review to read it through, then save.`);
    } catch (err) {
      notify('error', `Translation stopped: ${err.message}`);
    } finally {
      setTranslating(null);
    }
  };

  const translationState = (lang) => {
    const t = doc.translations?.[lang];
    if (!t?.fields) return 'none';
    return t.sourceHash === sourceHash(doc) ? (t.reviewed ? 'reviewed' : 'ready') : 'stale';
  };

  const openReview = (lang) => setReview({ lang, fields: { ...(doc.translations?.[lang]?.fields || {}) }, reviewed: !!doc.translations?.[lang]?.reviewed });
  const saveReview = () => {
    const { lang, fields, reviewed } = review;
    update((d) => ({
      ...d,
      translations: { ...(d.translations || {}), [lang]: { ...(d.translations?.[lang] || {}), fields, reviewed, sourceHash: d.translations?.[lang]?.sourceHash || sourceHash(d) } },
    }));
    setReview(null);
    notify('ok', `${LANG_NAME[lang]} updated. Save the article to publish the change.`);
  };
  const removeTranslation = (lang) => {
    if (!window.confirm(`Remove the ${LANG_NAME[lang]} translation?`)) return;
    update((d) => {
      const next = { ...(d.translations || {}) };
      delete next[lang];
      return { ...d, translations: next };
    });
  };

  // ---- Events, for the Event block ----
  const [eventList, setEventList] = useState(null);
  const loadEvents = useCallback(async () => {
    if (eventList) return;
    try {
      const res = await fetch('/api/events?limit=200&published=true');
      const json = await res.json();
      const list = (json.data || []).slice().sort((a, b) => String(b.event_date).localeCompare(String(a.event_date)));
      setEventList(list);
    } catch {
      setEventList([]);
    }
  }, [eventList]);
  useEffect(() => {
    if (doc.content.some((b) => b.type === 'event')) loadEvents();
  }, [doc.content, loadEvents]);
  const imageLinks = { events: eventList, load: loadEvents };
  const moveImage = (b, j, dir) => {
    const k = j + dir;
    if (k < 0 || k >= (b.images || []).length) return;
    const imgs = [...b.images];
    [imgs[j], imgs[k]] = [imgs[k], imgs[j]];
    setBlock(b.id, { images: imgs });
  };
  const pickEvent = (blockId, eventId) => {
    const evt = (eventList || []).find((e) => e.id === eventId);
    if (!evt) { setBlock(blockId, { eventId: null }); return; }
    setBlock(blockId, {
      eventId: evt.id,
      slug: eventSlugFor(evt, eventList),
      title: evt.title,
      when: eventWhen(evt.event_date, evt.end_date),
      place: [evt.location, evt.loc_city || evt.loc_province].filter(Boolean).join(', '),
      image: evt.image_url || null,
    });
  };
  const aiDraft = async (e) => {
    e.preventDefault();
    await withBusy('ai-draft', async () => {
      const data = await ai({ action: 'draft', ...aiForm });
      const blocks = data.sections.map((s) => ({
        ...newBlock('text'),
        html: `${s.heading ? `<h2>${s.heading.replace(/[<>&]/g, '')}</h2>` : ''}${textToHtml(s.paragraphs.join('\n\n'))}`,
      }));
      const replace = aiForm.mode === 'replace';
      update((d) => ({
        ...d,
        title: replace || !d.title ? data.title : d.title,
        slug: d.slugTouched && !replace ? d.slug : slugify(replace || !d.title ? data.title : d.title),
        summary: replace || !d.summary ? data.summary : d.summary,
        category: data.category && (replace || d.category === 'Church News') ? data.category : d.category,
        tags: replace ? data.tags : [...new Set([...d.tags, ...data.tags])].slice(0, 8),
        content: replace ? blocks : [...d.content, ...blocks],
      }));
      setRevision((r) => r + 1);
      setAiOpen(false);
      setAiDrafted(true);
      notify('ok', 'Draft written. Check every name, date and fact before publishing.');
    });
  };

  const addTag = (raw) => {
    const t = raw.replace(/,/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
    if (!t || doc.tags.includes(t) || doc.tags.length >= 8) return;
    set('tags', [...doc.tags, t]);
  };

  const deviceWidth = DEVICES.find((d) => d.key === device)?.width || 860;
  const activeBlock = doc.content.find((b) => b.id === activeId);
  const wordCount = useMemo(() => blocksToText(doc.content).split(/\s+/).filter(Boolean).length, [doc.content]);

  // ---- Not allowed / loading ----
  if (allowed === false) {
    return (
      <div className="ns-gate">
        <img src="/assets/LOGO.png" alt="" />
        <h1>News is for Admins</h1>
        <p>Only an Admin or a Super Admin can write and publish news articles.</p>
        <button type="button" onClick={() => router.push('/dashboard')}>Back to the dashboard</button>
      </div>
    );
  }
  if (allowed === null || loading) {
    return <div className="ns-gate"><i className="fas fa-spinner fa-spin"></i><p>Opening the editor…</p></div>;
  }

  const published = doc.status === 'published';
  const pv = articleIn(doc, previewLang);
  const statusLine = published
    ? (dirty ? 'Published · unsaved changes' : `Published · saved ${savedLabel(lastSaved) || ''}`)
    : (saving ? 'Draft · saving…' : dirty ? 'Draft · unsaved changes' : lastSaved ? `Draft · last saved ${savedLabel(lastSaved)}` : 'Draft · not saved yet');

  const blockTools = (b, i) => (
    <div className="ns-block-tools">
      <span>{BLOCK_NAMES[b.type] || b.type}</span>
      <button type="button" onClick={() => moveBlock(b.id, -1)} disabled={i === 0} title="Move up"><i className="fas fa-arrow-up"></i></button>
      <button type="button" onClick={() => moveBlock(b.id, 1)} disabled={i === doc.content.length - 1} title="Move down"><i className="fas fa-arrow-down"></i></button>
      <button type="button" onClick={() => removeBlock(b.id)} title="Remove" className="danger"><i className="fas fa-trash"></i></button>
    </div>
  );

  const dropZone = (index) => (
    <div
      className={`ns-drop ${dropAt === index ? 'over' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('text/x-news-block')) { e.preventDefault(); setDropAt(index); } }}
      onDragLeave={() => setDropAt((v) => (v === index ? null : v))}
      onDrop={(e) => { e.preventDefault(); setDropAt(null); const t = e.dataTransfer.getData('text/x-news-block'); if (t) addBlock(t, index); }}
    />
  );

  const renderBlock = (b) => {
    const key = `${b.id}-${revision}`;
    const focus = () => setActiveId(b.id);
    const working = busy[b.id] || busy[`ai-${b.id}`];
    switch (b.type) {
      case 'text':
        return <Editable key={key} html={b.html} className="na-text" placeholder="Write here… Use the toolbar for headings, lists and links." onFocus={focus} onChange={(html) => setBlock(b.id, { html }, true)} />;
      case 'centered':
        return <Editable key={key} html={b.html} className="na-text na-centered" placeholder="A highlighted passage, centred" onFocus={focus} onChange={(html) => setBlock(b.id, { html }, true)} />;
      case 'quote':
        return (
          <blockquote className="na-quote">
            <Editable key={key} html={b.html} className="na-quote-text" placeholder="The words being quoted" onFocus={focus} onChange={(html) => setBlock(b.id, { html }, true)} />
            <input className="ns-cite" value={b.cite || ''} placeholder="Who said it, e.g. Dr. Weldon Pior, Senior Pastor" maxLength={160} onFocus={focus} onChange={(e) => setBlock(b.id, { cite: e.target.value }, true)} />
          </blockquote>
        );
      case 'image':
        return (
          <ImageSlot
            image={b.image}
            busy={working}
            label="Add a wide photo"
            links={imageLinks}
            onPick={(f) => pickBlockImage(b.id, f)}
            onChange={(img) => setBlock(b.id, { image: img }, true)}
            onRemove={() => setBlock(b.id, { image: null })}
          />
        );
      case 'grid':
      case 'stack':
        return (
          <div className={b.type === 'grid' ? `ns-grid n${Math.min(Math.max((b.images || []).length, 1), 4)}` : 'ns-stack'}>
            {(b.images || []).map((img, j) => (
              <ImageSlot
                key={`${img.url}-${j}`}
                image={img}
                onPick={(f) => withBusy(b.id, async () => {
                  const up = await uploadImage(f, user.id);
                  setBlock(b.id, { images: b.images.map((x, k) => (k === j ? keepWords(up, x) : x)) });
                })}
                onChange={(next) => setBlock(b.id, { images: b.images.map((x, k) => (k === j ? next : x)) }, true)}
                onRemove={() => setBlock(b.id, { images: b.images.filter((_, k) => k !== j) })}
                onMove={b.images.length > 1 ? (dir) => moveImage(b, j, dir) : null}
                links={imageLinks}
              />
            ))}
            {(b.images || []).length < 12 && (
              <label className={`ns-imgslot ${(b.images || []).length ? 'compact' : ''}`}>
                <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" hidden disabled={working} onChange={(e) => { const fs = e.target.files; if (fs?.length) addBlockImages(b.id, fs); e.target.value = ''; }} />
                {working ? <i className="fas fa-spinner fa-spin"></i> : <i className="far fa-images"></i>}
                <span>{working ? 'Uploading…' : (b.type === 'grid' ? 'Add photos (2 to 4 look best)' : 'Add photos')}</span>
              </label>
            )}
          </div>
        );
      case 'carousel': {
        const imgs = b.images || [];
        return (
          <div className="ns-carousel-edit">
            {imgs.length > 0 && (
              <div className="ns-inert ns-carousel-preview" onClickCapture={(e) => { if (e.target.closest('a')) e.preventDefault(); }}>
                <ArticleBody blocks={[b]} />
              </div>
            )}
            <div className="ns-carousel-strip">
              {imgs.map((img, j) => (
                <div key={`${img.url}-${j}`} className="ns-carousel-slot">
                  <span className="ns-carousel-num">{j + 1}</span>
                  <ImageSlot
                    image={img}
                    onPick={(f) => withBusy(b.id, async () => {
                      const up = await uploadImage(f, user.id);
                      setBlock(b.id, { images: b.images.map((x, k) => (k === j ? keepWords(up, x) : x)) });
                    })}
                    onChange={(next) => setBlock(b.id, { images: b.images.map((x, k) => (k === j ? next : x)) }, true)}
                    onRemove={() => setBlock(b.id, { images: b.images.filter((_, k) => k !== j) })}
                    onMove={imgs.length > 1 ? (dir) => moveImage(b, j, dir) : null}
                    links={imageLinks}
                  />
                </div>
              ))}
              {imgs.length < maxImages('carousel') && (
                <label className="ns-imgslot compact">
                  <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" hidden disabled={working} onChange={(e) => { const fs = e.target.files; if (fs?.length) addBlockImages(b.id, fs); e.target.value = ''; }} />
                  {working ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-images"></i>}
                  <span>{working ? 'Uploading…' : (imgs.length ? 'Add more photos' : 'Add photos to slide through')}</span>
                </label>
              )}
            </div>
            {imgs.length > 0 && <p className="ns-carousel-hint"><i className="fas fa-circle-info"></i> Try the arrows above: readers see the photos slide one at a time. Use the arrow buttons on each photo to change the order.</p>}
          </div>
        );
      }
      case 'media-left':
      case 'media-right':
        return (
          <div className={`na-media ${b.type === 'media-right' ? 'right' : 'left'} ns-media`}>
            <ImageSlot
              image={b.image}
              busy={busy[b.id]}
              compact
              links={imageLinks}
              onPick={(f) => pickBlockImage(b.id, f)}
              onChange={(img) => setBlock(b.id, { image: img }, true)}
              onRemove={() => setBlock(b.id, { image: null })}
            />
            <Editable key={key} html={b.html} className="na-text" placeholder="Text beside the photo" onFocus={focus} onChange={(html) => setBlock(b.id, { html }, true)} />
          </div>
        );
      case 'divider':
        return <hr className="na-divider" />;
      case 'event':
        return (
          <div className="ns-event-edit">
            <div className="ns-event-pick">
              <label>
                <span>Event</span>
                <select
                  value={b.eventId || ''}
                  onFocus={() => { focus(); loadEvents(); }}
                  onChange={(e) => pickEvent(b.id, e.target.value)}
                >
                  <option value="">{eventList === null ? 'Loading events…' : 'Choose an event…'}</option>
                  {(eventList || []).map((e) => (
                    <option key={e.id} value={e.id}>{e.title} · {eventWhen(e.event_date, e.end_date)}{e.loc_city ? ` · ${e.loc_city}` : ''}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Button text</span>
                <input value={b.label || ''} maxLength={40} placeholder="View event" onFocus={focus} onChange={(e) => setBlock(b.id, { label: e.target.value }, true)} />
              </label>
            </div>
            {b.eventId
              ? <div className="ns-inert" onClickCapture={(e) => e.preventDefault()}><ArticleBody blocks={[b]} /></div>
              : <p className="ns-event-empty"><i className="fas fa-calendar-check"></i> Choose one of the church&apos;s events. Readers get its poster, date and place, and a button that opens it.</p>}
          </div>
        );
      case 'button':
        return (
          <div className="ns-button-edit">
            <div className="ns-event-pick">
              <label>
                <span>Button text</span>
                <input value={b.label || ''} maxLength={60} placeholder="e.g. Register now" onFocus={focus} onChange={(e) => setBlock(b.id, { label: e.target.value }, true)} />
              </label>
              <label>
                <span>Link</span>
                <input value={b.url || ''} placeholder="https://… or /sunday-service" onFocus={focus} onChange={(e) => setBlock(b.id, { url: e.target.value.trim() }, true)} />
              </label>
              <label className="ns-button-style">
                <span>Style</span>
                <select value={b.style || 'gold'} onChange={(e) => setBlock(b.id, { style: e.target.value })}>
                  <option value="gold">Gold</option>
                  <option value="outline">Outline</option>
                </select>
              </label>
            </div>
            {b.label && b.url
              ? <div className="ns-inert" onClickCapture={(e) => e.preventDefault()}><ArticleBody blocks={[b]} /></div>
              : <p className="ns-event-empty"><i className="fas fa-arrow-pointer"></i> Write the button text and paste the link (a web address, or a page on this site such as /sunday-service).</p>}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`ns-app ${panelOpen ? '' : 'panel-closed'}`}>
      {/* ---- Top bar ---- */}
      <header className="ns-top">
        <button type="button" className="ns-back" onClick={goBack} aria-label="Back to News"><i className="fas fa-arrow-left"></i></button>
        <div className="ns-top-title">
          <strong>{articleId ? 'Edit Article' : 'Create New Article'}</strong>
          <span className={`ns-status ${published ? 'live' : ''}`}>{statusLine}</span>
        </div>
        <div className="ns-top-actions">
          <button type="button" className="ns-ai-btn" onClick={() => setAiOpen(true)}><i className="fas fa-wand-magic-sparkles"></i> AI Writer</button>
          <button type="button" className="ns-ghost" onClick={() => setPreview(true)}><i className="far fa-eye"></i> Preview</button>
          <button type="button" className="ns-ghost" disabled={saving} onClick={makePoster} title="Make a Facebook poster from this article"><i className="far fa-image"></i> Make poster</button>
          {published ? (
            <>
              <button type="button" className="ns-draft" disabled={saving} onClick={() => { if (window.confirm('Take this article off the News page and make it a draft again?')) save('draft'); }}>Unpublish</button>
              <button type="button" className="ns-publish" disabled={saving} onClick={() => save('published')}>{saving ? 'Saving…' : 'Update'}</button>
            </>
          ) : (
            <>
              <button type="button" className="ns-draft" disabled={saving} onClick={() => save('draft')}>Save as Draft</button>
              <button type="button" className="ns-publish" disabled={saving} onClick={() => save('published')}>{saving ? 'Saving…' : 'Publish'}</button>
            </>
          )}
        </div>
      </header>

      {/* ---- Toolbar ---- */}
      <div className="ns-toolbar">
        <div className="ns-tgroup">
          <button type="button" onClick={undo} disabled={!history.current.past.length} title="Undo (Ctrl+Z)"><i className="fas fa-rotate-left"></i></button>
          <button type="button" onClick={redo} disabled={!history.current.future.length} title="Redo (Ctrl+Shift+Z)"><i className="fas fa-rotate-right"></i></button>
          <span className="ns-sep"></span>
          {DEVICES.map((d) => (
            <button key={d.key} type="button" className={device === d.key ? 'on' : ''} onClick={() => setDevice(d.key)} title={d.label}><i className={d.icon}></i></button>
          ))}
        </div>
        <div className="ns-tgroup ns-format" onMouseDown={(e) => { if (e.target.closest('button')) e.preventDefault(); }}>
          <select
            aria-label="Text style"
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => { formatBlock(e.target.value); e.target.value = ''; }}
            defaultValue=""
          >
            <option value="" disabled>Text style</option>
            <option value="p">Paragraph</option>
            <option value="h2">Heading</option>
            <option value="h3">Subheading</option>
            <option value="blockquote">Quote</option>
          </select>
          <span className="ns-sep"></span>
          <button type="button" onClick={() => exec('bold')} title="Bold (Ctrl+B)"><i className="fas fa-bold"></i></button>
          <button type="button" onClick={() => exec('italic')} title="Italic (Ctrl+I)"><i className="fas fa-italic"></i></button>
          <button type="button" onClick={() => exec('underline')} title="Underline (Ctrl+U)"><i className="fas fa-underline"></i></button>
          <span className="ns-colors">
            <button
              type="button"
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setColorsOpen((v) => (v ? false : { top: r.bottom + 6, left: r.left + r.width / 2 })); }}
              title="Text colour"
            >
              <i className="fas fa-palette"></i>
            </button>
            {colorsOpen && (
              <span className="ns-colors-pop" style={{ top: colorsOpen.top, left: colorsOpen.left }}>
                {COLORS.map((c) => (
                  <button key={c} type="button" style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => { exec('foreColor', c); setColorsOpen(false); }} />
                ))}
              </span>
            )}
          </span>
          <button type="button" onClick={addLink} title="Link"><i className="fas fa-link"></i></button>
          <button type="button" onClick={() => exec('unlink')} title="Remove link"><i className="fas fa-link-slash"></i></button>
          <span className="ns-sep"></span>
          <button type="button" onClick={() => exec('justifyLeft')} title="Align left"><i className="fas fa-align-left"></i></button>
          <button type="button" onClick={() => exec('justifyCenter')} title="Centre"><i className="fas fa-align-center"></i></button>
          <button type="button" onClick={() => exec('justifyRight')} title="Align right"><i className="fas fa-align-right"></i></button>
          <button type="button" onClick={() => exec('justifyFull')} title="Justify"><i className="fas fa-align-justify"></i></button>
          <span className="ns-sep"></span>
          <button type="button" onClick={() => exec('insertUnorderedList')} title="Bulleted list"><i className="fas fa-list-ul"></i></button>
          <button type="button" onClick={() => exec('insertOrderedList')} title="Numbered list"><i className="fas fa-list-ol"></i></button>
        </div>
        <div className="ns-tgroup ns-ai-tools">
          <span className="ns-ai-label"><i className="fas fa-wand-magic-sparkles"></i> Paragraph</span>
          {AI_MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              className="ns-ai-chip"
              disabled={!activeBlock || !TEXT_BLOCKS.has(activeBlock.type) || !!busy[`ai-${activeId}`] || !!busy['ai-whole']}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => aiRewrite(m.key)}
              title={`AI: ${m.hint} (the paragraph the cursor is in)`}
            >
              {m.label}
            </button>
          ))}
          <button
            type="button"
            className="ns-ai-chip"
            disabled={!activeBlock || !TEXT_BLOCKS.has(activeBlock.type) || !!busy[`ai-${activeId}`] || !!busy['ai-whole']}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => aiHighlight(false)}
            title="AI: make the important words in this paragraph bold"
          >
            <i className="fas fa-highlighter"></i> Highlight
          </button>
          {busy[`ai-${activeId}`] && <i className="fas fa-spinner fa-spin ns-ai-spin" aria-label="Working"></i>}
          <span className="ns-sep"></span>
          <span className="ns-whole">
            <button type="button" className="ns-ai-chip strong" disabled={!!busy['ai-whole']} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setWholeOpen((v) => (v ? false : { top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })); }} aria-expanded={!!wholeOpen}>
              {busy['ai-whole'] ? <><i className="fas fa-spinner fa-spin"></i> Working…</> : <>Whole article <i className="fas fa-chevron-down"></i></>}
            </button>
            {wholeOpen && (
              <span className="ns-whole-pop" role="menu" style={{ top: wholeOpen.top, right: wholeOpen.right }}>
                <button type="button" role="menuitem" onClick={() => { setWholeOpen(false); aiNaturalWhole(); }}>
                  <i className="fas fa-feather"></i>
                  <span><strong>Make it sound natural</strong><small>Rewrite every paragraph so it reads like a person wrote it</small></span>
                </button>
                <button type="button" role="menuitem" onClick={() => { setWholeOpen(false); aiHighlight(true); }}>
                  <i className="fas fa-highlighter"></i>
                  <span><strong>Highlight key words</strong><small>Bold the names, dates, places and numbers readers look for</small></span>
                </button>
                <button type="button" role="menuitem" onClick={() => { setWholeOpen(false); setPanel('settings'); setPanelOpen(true); setTimeout(() => document.getElementById('ns-translations')?.scrollIntoView({ behavior: 'smooth' }), 80); }}>
                  <i className="fas fa-language"></i>
                  <span><strong>Translate</strong><small>Tagalog and Bisaya, in Settings</small></span>
                </button>
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="ns-body">
        {/* ---- Side panel ---- */}
        <aside className="ns-panel">
          <div className="ns-tabs">
            <button type="button" className={panel === 'library' ? 'on' : ''} onClick={() => setPanel('library')}>Library</button>
            <button type="button" className={panel === 'settings' ? 'on' : ''} onClick={() => setPanel('settings')}>Settings</button>
          </div>

          {panel === 'library' ? (
            <div className="ns-panel-body">
              {BLOCK_LIBRARY.map((g) => (
                <section key={g.group} className="ns-lib-group">
                  <h3>{g.group}</h3>
                  <div className="ns-lib-grid">
                    {g.items.map((it) => (
                      <button
                        key={it.type}
                        type="button"
                        className="ns-lib-item"
                        draggable
                        onDragStart={(e) => { e.dataTransfer.setData('text/x-news-block', it.type); e.dataTransfer.effectAllowed = 'copy'; }}
                        onDragEnd={() => setDropAt(null)}
                        onClick={() => addBlock(it.type)}
                        title={it.hint}
                      >
                        <i className={it.icon}></i>
                        <span>{it.label}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              <p className="ns-hint">Click a block to add it under the one you are in, or drag it onto the page.</p>
            </div>
          ) : (
            <div className="ns-panel-body ns-settings">
              <label className="ns-field">
                <span>Title</span>
                <textarea rows={3} value={doc.title} maxLength={200} onChange={(e) => set('title', e.target.value, true)} placeholder="The headline" />
              </label>
              <button type="button" className="ns-gen" onClick={aiTitle} disabled={!!busy['ai-title']}>
                {busy['ai-title'] ? <><i className="fas fa-spinner fa-spin"></i> Thinking…</> : <><i className="fas fa-wand-magic-sparkles"></i> Generate Title</>}
              </button>
              {titleOptions.length > 0 && (
                <div className="ns-options">
                  <span>Pick one:</span>
                  {titleOptions.map((t) => (
                    <button key={t} type="button" onClick={() => { set('title', t); setTitleOptions([]); }}>{t}</button>
                  ))}
                </div>
              )}

              <label className="ns-field">
                <span>Summary <em>{doc.summary.length}/220</em></span>
                <textarea rows={4} value={doc.summary} maxLength={400} onChange={(e) => set('summary', e.target.value, true)} placeholder="One or two sentences: what happened. Shown under the title and when shared." />
              </label>
              <button type="button" className="ns-gen" onClick={aiSummary} disabled={!!busy['ai-summary']}>
                {busy['ai-summary'] ? <><i className="fas fa-spinner fa-spin"></i> Thinking…</> : <><i className="fas fa-wand-magic-sparkles"></i> Generate Summary</>}
              </button>

              <label className="ns-field">
                <span>Topic</span>
                <select value={doc.category} onChange={(e) => set('category', e.target.value)}>
                  {NEWS_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>

              <div className="ns-field">
                <span>Tags <em>{doc.tags.length}/8</em></span>
                <div className="ns-tags">
                  {doc.tags.map((t) => (
                    <span key={t} className="ns-tag">{t}<button type="button" aria-label={`Remove ${t}`} onClick={() => set('tags', doc.tags.filter((x) => x !== t))}>×</button></span>
                  ))}
                  <input
                    value={tagInput}
                    placeholder={doc.tags.length ? '' : 'e.g. Youth, Cebu'}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput); setTagInput(''); } }}
                    onBlur={() => { if (tagInput.trim()) { addTag(tagInput); setTagInput(''); } }}
                  />
                </div>
              </div>

              <label className="ns-field">
                <span>URL slug</span>
                <div className="ns-slug">
                  <em>/news/</em>
                  <input value={doc.slug} onChange={(e) => update((d) => ({ ...d, slug: slugify(e.target.value) || '', slugTouched: true }), { typing: true })} placeholder="made-from-the-title" />
                </div>
              </label>

              <label className="ns-field">
                <span>
                  Original source (URL)
                  {aiDrafted && !doc.source_url && <em className="ns-need"><i className="fas fa-circle-exclamation"></i> Source needed</em>}
                </span>
                <input className={aiDrafted && !doc.source_url ? 'warn' : ''} value={doc.source_url} onChange={(e) => set('source_url', e.target.value, true)} placeholder="e.g. https://example.com/article" />
                <small>If the story first appeared somewhere else, link it here.</small>
              </label>

              <div className="ns-field">
                <span>Featured image <em>the thumbnail</em></span>
                {doc.featured_image ? (
                  <ImageSlot image={doc.featured_image} busy={busy.featured} onPick={pickFeatured} onRemove={() => set('featured_image', null)} />
                ) : (
                  <label className="ns-featured-drop">
                    <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pickFeatured(f); }} />
                    {busy.featured ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-arrow-up-from-bracket"></i>}
                    <strong>{busy.featured ? 'Uploading…' : 'Click to upload an image'}</strong>
                    <span>JPG, PNG, WebP or GIF · large photos are resized for you</span>
                  </label>
                )}
              </div>

              <label className="ns-check">
                <input type="checkbox" checked={doc.is_featured} onChange={(e) => set('is_featured', e.target.checked)} />
                <span><strong>Featured</strong> Show it in the Featured row at the top of the News page.</span>
              </label>

              <label className="ns-field">
                <span>Author</span>
                <input value={doc.author_name} maxLength={80} onChange={(e) => set('author_name', e.target.value, true)} placeholder="e.g. Church News Desk" />
              </label>

              {/* ---- Translations ---- */}
              <section className="ns-translations" id="ns-translations">
                <div className="ns-field">
                  <span>Translations <em>readers can switch</em></span>
                </div>
                <p className="ns-tr-hint">
                  The AI writes Tagalog and Bisaya versions. Read them through with Review and correct anything
                  before you save; readers then get a language switch on the article.
                </p>
                {TRANSLATION_LANGS.map((lang) => {
                  const state = translationState(lang);
                  const working = translating?.lang === lang;
                  return (
                    <div key={lang} className={`ns-tr-row ${state}`}>
                      <div className="ns-tr-name">
                        <strong>{LANG_NAME[lang]}</strong>
                        <small>
                          {working ? `Translating… ${translating.done + 1} of ${translating.total}`
                            : state === 'none' ? 'Not translated yet'
                              : state === 'stale' ? 'The English changed since - update it'
                                : state === 'reviewed' ? 'Reviewed' : 'Translated - not reviewed yet'}
                        </small>
                      </div>
                      <div className="ns-tr-actions">
                        <button type="button" disabled={!!translating} onClick={() => translate([lang])}>
                          {working ? <i className="fas fa-spinner fa-spin"></i> : state === 'none' ? 'Translate' : 'Update'}
                        </button>
                        {state !== 'none' && <button type="button" disabled={!!translating} onClick={() => openReview(lang)}>Review</button>}
                        {state !== 'none' && <button type="button" className="danger" disabled={!!translating} onClick={() => removeTranslation(lang)} aria-label={`Remove ${LANG_NAME[lang]}`} title="Remove"><i className="fas fa-trash"></i></button>}
                      </div>
                    </div>
                  );
                })}
                <button type="button" className="ns-gen" disabled={!!translating} onClick={() => translate(TRANSLATION_LANGS)}>
                  {translating ? <><i className="fas fa-spinner fa-spin"></i> Translating to {LANG_NAME[translating.lang]}…</> : <><i className="fas fa-language"></i> Translate to Tagalog &amp; Bisaya</>}
                </button>
              </section>
            </div>
          )}
        </aside>

        <button type="button" className="ns-collapse" onClick={() => setPanelOpen((v) => !v)} aria-label={panelOpen ? 'Hide the side panel' : 'Show the side panel'}>
          <i className={`fas fa-chevron-${panelOpen ? 'left' : 'right'}`}></i>
        </button>

        {/* ---- The page ---- */}
        <main className="ns-canvas" onClick={() => { setColorsOpen(false); setWholeOpen(false); }}>
          <div className={`ns-paper nw-page ${device}`} style={{ maxWidth: deviceWidth }}>
            <div className="ns-paper-head">
              <div className="ns-chips">
                <button type="button" className="ns-chip" onClick={() => { setPanel('settings'); setPanelOpen(true); }}>{doc.category}</button>
                {doc.tags.length > 0 && <span className="ns-chip-tags">{doc.tags.join(' · ')}</span>}
              </div>
              <AutoTextarea className="ns-title" value={doc.title} onChange={(v) => set('title', v, true)} placeholder="Article title" maxLength={200} />
              <AutoTextarea className="ns-summary" value={doc.summary} onChange={(v) => set('summary', v, true)} placeholder="A one or two sentence summary…" maxLength={400} />
              <div className="ns-byline">
                <span>By <strong>{doc.author_name || 'Church News Desk'}</strong></span>
                <span><i className="far fa-calendar"></i> {newsDate(new Date().toISOString(), { month: 'long' })}</span>
                <span>{wordCount} words</span>
                <span className="ns-byline-share" aria-hidden="true"><i className="fab fa-facebook-f"></i><i className="fab fa-x-twitter"></i><i className="fas fa-link"></i></span>
              </div>
            </div>

            <div className="ns-hero">
              {doc.featured_image ? (
                <ImageSlot image={doc.featured_image} busy={busy.featured} onPick={pickFeatured} onRemove={() => set('featured_image', null)} />
              ) : (
                <ImageSlot image={null} busy={busy.featured} label="Add the featured picture (the thumbnail)" onPick={pickFeatured} />
              )}
            </div>

            <div className="ns-blocks na-body">
              {doc.content.length === 0 ? (
                <div
                  className={`ns-start ${dropAt === 0 ? 'over' : ''}`}
                  onDragOver={(e) => { if (e.dataTransfer.types.includes('text/x-news-block')) { e.preventDefault(); setDropAt(0); } }}
                  onDragLeave={() => setDropAt(null)}
                  onDrop={(e) => { e.preventDefault(); setDropAt(null); const t = e.dataTransfer.getData('text/x-news-block'); if (t) addBlock(t, 0); }}
                >
                  <strong>Start writing below</strong>
                  <span>Drag blocks from the library, or</span>
                  <div>
                    <button type="button" onClick={() => addBlock('text', 0)}>Add a text block</button>
                    <button type="button" className="ai" onClick={() => setAiOpen(true)}><i className="fas fa-wand-magic-sparkles"></i> Write it with AI</button>
                  </div>
                </div>
              ) : (
                <>
                  {doc.content.map((b, i) => (
                    <div key={b.id}>
                      {dropZone(i)}
                      <div
                        className={`ns-block ${activeId === b.id ? 'active' : ''} ${busy[`ai-${b.id}`] ? 'working' : ''}`}
                        data-block={b.id}
                        onMouseDown={() => setActiveId(b.id)}
                      >
                        {blockTools(b, i)}
                        {renderBlock(b)}
                      </div>
                    </div>
                  ))}
                  {dropZone(doc.content.length)}
                  <button type="button" className="ns-add-end" onClick={() => addBlock('text', doc.content.length)}><i className="fas fa-plus"></i> Add a text block</button>
                </>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* ---- Messages ---- */}
      {toast && (
        <div className={`ns-toast ${toast.type}`} role="status">
          <span>{toast.text}</span>
          {toast.link && <a href={toast.link} target="_blank" rel="noopener noreferrer">View article</a>}
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* ---- Preview ---- */}
      {preview && (
        <div className="ns-modal ns-preview" role="dialog" aria-label="Preview">
          <div className="ns-preview-bar">
            <strong>Preview</strong>
            <div className="ns-preview-tools">
              <div className="ns-tgroup">
                {DEVICES.map((d) => (
                  <button key={d.key} type="button" className={device === d.key ? 'on' : ''} onClick={() => setDevice(d.key)} title={d.label}><i className={d.icon}></i></button>
                ))}
              </div>
              {Object.keys(doc.translations || {}).length > 0 && (
                <div className="ns-tgroup" role="group" aria-label="Preview language">
                  {NEWS_LANGS.filter((l) => l.code === 'en' || doc.translations?.[l.code]).map((l) => (
                    <button key={l.code} type="button" className={previewLang === l.code ? 'on' : ''} onClick={() => setPreviewLang(l.code)}>{l.label}</button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className="ns-ghost" onClick={() => setPreview(false)}>Close</button>
          </div>
          {/* A link in the preview opens in a new tab, so the editor (and any
              unsaved work) stays where it is. */}
          <div
            className="ns-preview-scroll"
            onClickCapture={(e) => {
              const a = e.target.closest('a[href]');
              if (!a) return;
              e.preventDefault();
              window.open(a.href, '_blank', 'noopener');
            }}
          >
            {/* The article page's own header and reading column (news.css), so
                the preview is what readers will get. */}
            <div className="nw-page nw-story ns-preview-page" style={{ maxWidth: deviceWidth + 80 }}>
              <header className={`nw-story-hero ns-preview-hero ${doc.featured_image ? 'has-cover' : ''}`}>
                <div className="nw-story-bg" aria-hidden="true">
                  {doc.featured_image && <div className="nw-story-blur" style={{ backgroundImage: `url("${doc.featured_image.url}")` }} />}
                </div>
                <div className="nw-story-head">
                  <div className="nw-story-kicker">
                    <span className="nw-story-topic">{doc.category}</span>
                    <span>{Math.max(1, Math.round(wordCount / 200))} min read</span>
                  </div>
                  <h1>{pv.title || 'Untitled article'}</h1>
                  <div className="nw-story-byline">
                    <span className="nw-avatar" aria-hidden="true">
                      {(doc.author_name || 'Church News Desk').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                    </span>
                    <span className="nw-story-who">
                      <strong>{doc.author_name || 'Church News Desk'}</strong>
                      <span>{newsDate(new Date().toISOString(), { month: 'long' })}</span>
                    </span>
                  </div>
                </div>
                {doc.featured_image && <figure className="nw-story-cover"><img src={doc.featured_image.url} alt="" /></figure>}
              </header>
              <div className="nw-read ns-preview-read">
                {pv.summary && (
                  <div className="nw-measure nw-brief">
                    <span className="nw-eyebrow">In brief</span>
                    <p>{pv.summary}</p>
                  </div>
                )}
                <div className={doc.content[0]?.type === 'text' ? 'nw-dropcap' : ''}>
                  <ArticleBody blocks={pv.content} />
                </div>
                {doc.tags.length > 0 && (
                  <div className="nw-measure nw-story-end">
                    <div className="nw-end-row">
                      <span className="nw-end-label">Topics</span>
                      <div className="nw-tags">
                        <span className="nw-tag main">{doc.category}</span>
                        {doc.tags.map((t) => <span key={t} className="nw-tag">{t}</span>)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- Review a translation ---- */}
      {review && (
        <div className="ns-modal" role="dialog" aria-label={`Review the ${LANG_NAME[review.lang]} translation`}>
          <div className="ns-review">
            <div className="ns-ai-head">
              <h2><i className="fas fa-language"></i> Review the {LANG_NAME[review.lang]} translation</h2>
              <button type="button" onClick={() => setReview(null)} aria-label="Close">×</button>
            </div>
            <p className="ns-ai-note">
              Read each part next to the English and correct anything that is not right. Keep the ## in front of headings,
              the - in front of bullet points and the **double asterisks** around bold words. A box left empty shows in English.
            </p>
            <div className="ns-review-list">
              {translatableItems(doc).map((it) => {
                const blockAt = it.key.startsWith('b:') ? doc.content.findIndex((b) => b.id === it.key.split(':')[1]) + 1 : 0;
                const label = it.key === 'title' ? 'Title'
                  : it.key === 'summary' ? 'Summary'
                    : it.key.endsWith(':cite') ? `Block ${blockAt} · quote by`
                      : it.key.includes(':cap') ? `Block ${blockAt} · photo caption`
                        : it.key.includes(':link') ? `Block ${blockAt} · photo link`
                        : it.key.endsWith(':label') ? `Block ${blockAt} · button`
                          : `Block ${blockAt} · ${BLOCK_NAMES[doc.content[blockAt - 1]?.type] || 'text'}`;
                return (
                  <div key={it.key} className="ns-review-row">
                    <div className="ns-review-en">
                      <span>{label}</span>
                      <p>{it.text}</p>
                    </div>
                    <textarea
                      value={review.fields[it.key] || ''}
                      rows={Math.min(16, Math.max(2, Math.ceil(it.text.length / 55) + (it.text.match(/\n/g) || []).length))}
                      placeholder="(shows in English)"
                      onChange={(e) => { const v = e.target.value; setReview((r) => ({ ...r, fields: { ...r.fields, [it.key]: v } })); }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="ns-review-foot">
              <label className="ns-check">
                <input type="checkbox" checked={review.reviewed} onChange={(e) => { const v = e.target.checked; setReview((r) => ({ ...r, reviewed: v })); }} />
                <span><strong>I have checked this translation</strong> It is shown as reviewed in the editor.</span>
              </label>
              <div className="ns-ai-foot">
                <button type="button" className="ns-ghost" onClick={() => setReview(null)}>Cancel</button>
                <button type="button" className="ns-publish" onClick={saveReview}>Apply changes</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- AI Writer ---- */}
      {aiOpen && (
        <div className="ns-modal" role="dialog" aria-label="AI Writer" onClick={() => !busy['ai-draft'] && setAiOpen(false)}>
          <form className="ns-ai" onSubmit={aiDraft} onClick={(e) => e.stopPropagation()}>
            <div className="ns-ai-head">
              <h2><i className="fas fa-wand-magic-sparkles"></i> AI Writer</h2>
              <button type="button" onClick={() => setAiOpen(false)} aria-label="Close" disabled={!!busy['ai-draft']}>×</button>
            </div>
            <p className="ns-ai-note">
              Give the AI the facts and it writes a draft: title, summary and the article. It only uses what you give it,
              so include the names, dates and places. Always read the draft and check every fact before publishing.
            </p>
            <label className="ns-field">
              <span>What is the article about?</span>
              <input value={aiForm.topic} maxLength={300} onChange={(e) => setAiForm((f) => ({ ...f, topic: e.target.value }))} placeholder="e.g. Youth Camp 2026 at Camp Tagaytay" autoFocus />
            </label>
            <label className="ns-field">
              <span>Key facts and notes</span>
              <textarea rows={6} value={aiForm.notes} maxLength={8000} onChange={(e) => setAiForm((f) => ({ ...f, notes: e.target.value }))} placeholder={'Who, what, when, where, how many…\ne.g. 120 young people, May 3-5, speaker Ptr. Psalm Gambe, theme "Rooted"'} />
            </label>
            <label className="ns-field">
              <span>Source material <em>optional</em></span>
              <textarea rows={4} value={aiForm.source} maxLength={12000} onChange={(e) => setAiForm((f) => ({ ...f, source: e.target.value }))} placeholder="Paste a Facebook post, a report or a press release to work from" />
            </label>
            <div className="ns-ai-row">
              <label className="ns-field">
                <span>Style</span>
                <select value={aiForm.tone} onChange={(e) => setAiForm((f) => ({ ...f, tone: e.target.value }))}>
                  <option value="news">News report</option>
                  <option value="feature">Feature story</option>
                  <option value="announcement">Announcement</option>
                  <option value="reflection">Reflection</option>
                </select>
              </label>
              <label className="ns-field">
                <span>Length</span>
                <select value={aiForm.length} onChange={(e) => setAiForm((f) => ({ ...f, length: e.target.value }))}>
                  <option value="short">Short (about 300 words)</option>
                  <option value="medium">Medium (about 550 words)</option>
                  <option value="long">Long (about 900 words)</option>
                </select>
              </label>
            </div>
            {doc.content.length > 0 && (
              <div className="ns-ai-mode">
                <label><input type="radio" name="ai-mode" checked={aiForm.mode === 'replace'} onChange={() => setAiForm((f) => ({ ...f, mode: 'replace' }))} /> Replace the article</label>
                <label><input type="radio" name="ai-mode" checked={aiForm.mode === 'append'} onChange={() => setAiForm((f) => ({ ...f, mode: 'append' }))} /> Add below what is there</label>
              </div>
            )}
            <div className="ns-ai-foot">
              <button type="button" className="ns-ghost" onClick={() => setAiOpen(false)} disabled={!!busy['ai-draft']}>Cancel</button>
              <button type="submit" className="ns-publish" disabled={!!busy['ai-draft'] || (!aiForm.topic.trim() && !aiForm.notes.trim() && !aiForm.source.trim())}>
                {busy['ai-draft'] ? <><i className="fas fa-spinner fa-spin"></i> Writing…</> : 'Write the draft'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
