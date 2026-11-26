'use client';

// /news, the two interactive parts:
//
//   FeaturedRow  the stories an Admin featured (Dashboard > News > Feature),
//                in one row: side by side on a computer, swiped on a phone,
//                with arrows when there are more than fit.
//   NewsBrowser  every story: search, topics with how many stories each has,
//                newest / most read / oldest, a grid or a list, and "Load
//                more". The choices are kept in the address (?category=&q=
//                &sort=), so a filtered list can be shared and the back
//                button works; the topic links still work without JavaScript.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { articlePath, newsDate, newsImage, timeAgo } from '@/lib/news';

const PAGE = 12;
const SORTS = [
  { key: 'newest', label: 'Newest first' },
  { key: 'popular', label: 'Most read' },
  { key: 'oldest', label: 'Oldest first' },
];

const srcSet = (url, widths) => widths.map((w) => `${newsImage(url, w)} ${w}w`).join(', ');

// ---- Featured row ----

function FeaturedCard({ article, wide }) {
  const a = article;
  return (
    <Link href={articlePath(a.slug)} className={`nf-card ${wide ? 'wide' : ''}`}>
      <span className="nf-img">
        {a.featured_image_url
          ? <img src={newsImage(a.featured_image_url, wide ? 1400 : 760)} srcSet={srcSet(a.featured_image_url, [480, 760, 1100, 1400])} sizes={wide ? '(max-width: 760px) 90vw, 1150px' : '(max-width: 760px) 85vw, 400px'} alt="" decoding="async" />
          : <span className="nw-noimg" aria-hidden="true">{a.category}</span>}
      </span>
      <span className="nf-shade" aria-hidden="true" />
      <span className="nf-top">
        <span className="nf-pill"><i className="fas fa-star" aria-hidden="true"></i> Featured</span>
        <span className="nf-cat">{a.category}</span>
      </span>
      <span className="nf-body">
        <span className="nf-date">{newsDate(a.published_at)}</span>
        <strong className="nf-title">{a.title}</strong>
        {a.summary && <span className="nf-sum">{a.summary}</span>}
        <span className="nf-read">Read story <i className="fas fa-arrow-right" aria-hidden="true"></i></span>
      </span>
    </Link>
  );
}

export function FeaturedRow({ articles = [], latest = false }) {
  const row = useRef(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = row.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    const el = row.current;
    if (!el) return undefined;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => { el.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); };
  }, [measure]);

  const go = (dir) => {
    const el = row.current;
    const card = el?.querySelector('.nf-card');
    if (!el) return;
    const step = card ? card.getBoundingClientRect().width + 20 : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * step, behavior: 'smooth' });
  };

  if (!articles.length) return null;
  const n = Math.min(articles.length, 3);
  const scrolls = !(edges.start && edges.end);

  return (
    <section className="nf" aria-label={latest ? 'Top stories' : 'Featured stories'}>
      <div className="nw-wrap">
        <div className="nf-head">
          <div>
            <span className="nw-eyebrow">{latest ? 'Latest' : 'Handpicked'}</span>
            <h2>{latest ? 'Top stories' : 'Featured stories'}</h2>
          </div>
          {scrolls && (
            <div className="nf-arrows">
              <button type="button" onClick={() => go(-1)} disabled={edges.start} aria-label="Previous stories"><i className="fas fa-chevron-left"></i></button>
              <button type="button" onClick={() => go(1)} disabled={edges.end} aria-label="More stories"><i className="fas fa-chevron-right"></i></button>
            </div>
          )}
        </div>
        <div className={`nf-row n${n}`} ref={row}>
          {articles.map((a) => <FeaturedCard key={a.id} article={a} wide={articles.length === 1} />)}
        </div>
      </div>
    </section>
  );
}

// ---- All news ----

// The words being searched for, marked in a headline or summary.
function Marked({ text, term }) {
  if (!term || !text) return text || null;
  const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = String(text).split(new RegExp(`(${safe})`, 'ig'));
  return parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
}

function StoryTile({ article, view, term, index }) {
  const a = article;
  const date = newsDate(a.published_at);
  const ago = timeAgo(a.published_at);
  return (
    <Link href={articlePath(a.slug)} className={`nb-card ${view} nb-rise`} style={{ '--i': index % PAGE }}>
      <span className="nb-img">
        {a.featured_image_url
          ? <img src={newsImage(a.featured_image_url, view === 'list' ? 440 : 640)} srcSet={srcSet(a.featured_image_url, [320, 440, 640])} sizes={view === 'list' ? '(max-width: 640px) 110px, 240px' : '(max-width: 640px) 92vw, 380px'} alt="" loading="lazy" decoding="async" />
          : <span className="nw-noimg" aria-hidden="true">{a.category}</span>}
        <span className="nb-cat">{a.category}</span>
        {a.is_featured && <span className="nb-star" title="Featured"><i className="fas fa-star" aria-hidden="true"></i><span className="sr-only">Featured</span></span>}
      </span>
      <span className="nb-body">
        <span className="nb-meta">
          <time dateTime={a.published_at || undefined}>{date}</time>
          {ago && ago !== date && <><span aria-hidden="true">·</span><span>{ago}</span></>}
        </span>
        <strong className="nb-title"><Marked text={a.title} term={term} /></strong>
        {a.summary && <span className="nb-sum"><Marked text={a.summary} term={term} /></span>}
        <span className="nb-foot">
          <span className="nb-read">Read story <i className="fas fa-arrow-right" aria-hidden="true"></i></span>
          {a.views > 0 && <span className="nb-views"><i className="far fa-eye" aria-hidden="true"></i> {a.views.toLocaleString()}</span>}
        </span>
      </span>
    </Link>
  );
}

function Skeletons({ view, count = 6 }) {
  return Array.from({ length: count }, (_, i) => (
    <div key={`sk-${i}`} className={`nb-card ${view} nb-skel`} aria-hidden="true">
      <span className="nb-img" />
      <span className="nb-body"><span /><span /><span /></span>
    </div>
  ));
}

export function NewsBrowser({ initial = [], total: firstTotal = 0, counts = {}, categories = [], start = {} }) {
  const [category, setCategory] = useState(start.category || null);
  const [text, setText] = useState(start.q || '');
  const [term, setTerm] = useState(start.q || '');
  const [sort, setSort] = useState(start.sort || 'newest');
  const [view, setView] = useState('grid');
  const [items, setItems] = useState(initial);
  const [total, setTotal] = useState(firstTotal);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const top = useRef(null);
  const search = useRef(null);
  const request = useRef(null);
  const first = useRef(true);

  const allCount = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0), [counts]);
  const topics = categories.filter((c) => counts[c] > 0 || c === category);

  // The reader's grid / list choice, remembered on this device.
  useEffect(() => {
    try { const v = localStorage.getItem('news-view'); if (v === 'list' || v === 'grid') setView(v); } catch { /* default */ }
  }, []);
  const chooseView = (v) => {
    setView(v);
    try { localStorage.setItem('news-view', v); } catch { /* not kept */ }
  };

  // Typing searches after a short pause.
  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), 320);
    return () => clearTimeout(t);
  }, [text]);

  // "/" jumps to the search box, as on most news sites.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const load = useCallback(async (offset) => {
    request.current?.abort();
    const ctrl = new AbortController();
    request.current = ctrl;
    const qs = new URLSearchParams({ limit: String(PAGE), offset: String(offset), sort });
    if (category) qs.set('category', category);
    if (term) qs.set('q', term);
    const res = await fetch(`/api/news?${qs}`, { signal: ctrl.signal });
    const json = await res.json();
    if (!json.success) throw new Error(json.message || 'Could not load the news.');
    return json;
  }, [category, term, sort]);

  // A new topic, search or order: the list starts again, and the address
  // follows so the view can be shared.
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    let live = true;
    const qs = new URLSearchParams();
    if (category) qs.set('category', category);
    if (term) qs.set('q', term);
    if (sort !== 'newest') qs.set('sort', sort);
    window.history.replaceState(null, '', `/news${qs.toString() ? `?${qs}` : ''}${window.location.hash}`);
    setLoading(true);
    setError('');
    load(0)
      .then((json) => { if (live) { setItems(json.data || []); setTotal(json.total || 0); } })
      .catch((err) => { if (live && err.name !== 'AbortError') setError(err.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [category, term, sort, load]);

  const loadMore = async () => {
    setMore(true);
    setError('');
    try {
      const json = await load(items.length);
      setItems((list) => [...list, ...(json.data || []).filter((a) => !list.some((b) => b.id === a.id))]);
      setTotal(json.total || 0);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setMore(false);
    }
  };

  const pickTopic = (e, c) => {
    e.preventDefault();
    setCategory(c);
    const r = top.current?.getBoundingClientRect();
    if (r && r.top < 0) top.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const clear = () => { setText(''); setTerm(''); setCategory(null); setSort('newest'); };
  const filtered = Boolean(category || term);

  return (
    <section className="nb" id="all-news" ref={top} aria-label="All news">
      <div className="nb-head">
        <div>
          <span className="nw-eyebrow">Browse</span>
          <h2>All news</h2>
          <p className="nb-count" aria-live="polite">
            {loading ? 'Looking…' : (
              <>
                <strong>{total.toLocaleString()}</strong> {total === 1 ? 'story' : 'stories'}
                {category && <> in <strong>{category}</strong></>}
                {term && <> matching &ldquo;<strong>{term}</strong>&rdquo;</>}
                {filtered && <button type="button" className="nb-clear" onClick={clear}>Clear filters</button>}
              </>
            )}
          </p>
        </div>
        <div className="nb-tools">
          <label className="nb-search">
            <i className="fas fa-magnifying-glass" aria-hidden="true"></i>
            <input
              ref={search}
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setText(''); }}
              placeholder="Search the news"
              aria-label="Search the news"
              maxLength={80}
            />
            {text ? (
              <button type="button" onClick={() => { setText(''); search.current?.focus(); }} aria-label="Clear the search"><i className="fas fa-xmark"></i></button>
            ) : <kbd aria-hidden="true">/</kbd>}
          </label>
          <label className="nb-sort">
            <span className="sr-only">Order</span>
            <i className="fas fa-arrow-down-wide-short" aria-hidden="true"></i>
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Order the stories">
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <div className="nb-view" role="group" aria-label="Show as">
            <button type="button" className={view === 'grid' ? 'on' : ''} aria-pressed={view === 'grid'} onClick={() => chooseView('grid')} title="Grid"><i className="fas fa-grip"></i></button>
            <button type="button" className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} onClick={() => chooseView('list')} title="List"><i className="fas fa-list"></i></button>
          </div>
        </div>
      </div>

      <nav className="nb-chips" aria-label="Topics">
        <a href="/news" className={!category ? 'on' : ''} aria-current={!category ? 'true' : undefined} onClick={(e) => pickTopic(e, null)}>
          All <span>{allCount}</span>
        </a>
        {topics.map((c) => (
          <a key={c} href={`/news?category=${encodeURIComponent(c)}`} className={category === c ? 'on' : ''} aria-current={category === c ? 'true' : undefined} onClick={(e) => pickTopic(e, c)}>
            {c} <span>{counts[c] || 0}</span>
          </a>
        ))}
      </nav>

      {error && <p className="nb-error" role="alert"><i className="fas fa-triangle-exclamation"></i> {error}</p>}

      {loading ? (
        <div className={view === 'list' ? 'nb-list' : 'nb-grid'}><Skeletons view={view} /></div>
      ) : items.length ? (
        <div className={view === 'list' ? 'nb-list' : 'nb-grid'} key={`${category}|${term}|${sort}|${view}`}>
          {items.map((a, i) => <StoryTile key={a.id} article={a} view={view} term={term} index={i} />)}
          {more && <Skeletons view={view} count={3} />}
        </div>
      ) : (
        <div className="nb-empty">
          <i className="fas fa-newspaper" aria-hidden="true"></i>
          <strong>{term ? `Nothing matches “${term}”` : category ? `No ${category} stories yet` : 'No stories yet'}</strong>
          <p>{filtered ? 'Try other words or another topic.' : 'Stories from the church will appear here soon.'}</p>
          {filtered && <button type="button" className="nw-btn" onClick={clear}>See all news</button>}
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="nb-more">
          <div className="nb-progress" aria-hidden="true"><span style={{ width: `${Math.min(100, (items.length / Math.max(1, total)) * 100)}%` }} /></div>
          <span>Showing {items.length.toLocaleString()} of {total.toLocaleString()}</span>
          {items.length < total && (
            <button type="button" onClick={loadMore} disabled={more}>
              {more ? <><i className="fas fa-spinner fa-spin"></i> Loading…</> : <>Load more stories <i className="fas fa-chevron-down"></i></>}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
