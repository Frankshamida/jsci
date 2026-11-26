'use client';

// The small interactive pieces of the article page: sharing, reading
// progress, counting a view, and "More news". (The /news list is in
// NewsBrowser.js.) Everything else on those pages is drawn on the server.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { articlePath, newsDate, newsImage } from '@/lib/news';

// variant: 'icons' - a row of round buttons
//          'rail'  - the same, standing up, beside the story on wide screens
//          'full'  - labelled buttons, for the end of the story
export function ShareBar({ title, path, variant = 'icons' }) {
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState(path);
  useEffect(() => { setUrl(`${window.location.origin}${path}`); }, [path]);
  const enc = encodeURIComponent;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked: the other buttons still work */ }
  };
  const label = (text) => (variant === 'full' ? <span>{text}</span> : null);
  return (
    <div className={`nw-share ${variant}`} aria-label="Share this article">
      {variant === 'rail' && <span className="nw-share-title">Share</span>}
      <a href={`https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`} target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook" title="Facebook" className="fb"><i className="fab fa-facebook-f"></i>{label('Facebook')}</a>
      <a href={`https://wa.me/?text=${enc(`${title} ${url}`)}`} target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp" title="WhatsApp" className="wa"><i className="fab fa-whatsapp"></i>{label('WhatsApp')}</a>
      <a href={`https://x.com/intent/post?text=${enc(title)}&url=${enc(url)}`} target="_blank" rel="noopener noreferrer" aria-label="Share on X" title="X" className="x"><i className="fab fa-x-twitter"></i>{label('X')}</a>
      <a href={`mailto:?subject=${enc(title)}&body=${enc(`${title}\n\n${url}`)}`} aria-label="Share by email" title="Email"><i className="fas fa-envelope"></i>{label('Email')}</a>
      <button type="button" onClick={copy} aria-label="Copy link" title={copied ? 'Link copied' : 'Copy link'} className={copied ? 'done' : ''}>
        <i className={`fas ${copied ? 'fa-check' : 'fa-link'}`}></i>{label(copied ? 'Copied' : 'Copy link')}
      </button>
      {copied && variant !== 'full' && <span className="nw-share-note" role="status">Link copied</span>}
    </div>
  );
}

// A thin gold bar under the navbar that fills as the story is read.
export function ReadingProgress({ target = '.nw-read' }) {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const el = document.querySelector(target);
    if (!el) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const total = r.height - window.innerHeight * 0.6;
      const done = Math.min(1, Math.max(0, (window.innerHeight * 0.3 - r.top) / (total || 1)));
      setPct(done * 100);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [target]);
  return <div className="nw-progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>;
}

// Counted once per visit to an article (sessionStorage), and the server only
// counts one per address per half hour on top of that.
export function ViewPing({ id }) {
  useEffect(() => {
    const key = `news-viewed-${id}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { /* count anyway */ }
    fetch('/api/news/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => {});
  }, [id]);
  return null;
}

export function StoryCard({ article, size = 'md' }) {
  return (
    <Link href={articlePath(article.slug)} className={`nw-card nw-card-${size}`}>
      <span className="nw-card-img">
        {article.featured_image_url
          ? <img src={newsImage(article.featured_image_url, size === 'lg' ? 760 : 440)} alt="" loading="lazy" decoding="async" />
          : <span className="nw-noimg" aria-hidden="true">{article.category}</span>}
      </span>
      <span className="nw-card-body">
        <span className="nw-kicker">{article.category}</span>
        <strong>{article.title}</strong>
        {size !== 'sm' && article.summary && <span className="nw-card-sum">{article.summary}</span>}
        <span className="nw-card-date">{newsDate(article.published_at)}</span>
      </span>
    </Link>
  );
}

// "More news" under an article: suggestions picked for this story (same
// topic, shared tags, then the newest), the latest stories, or any one topic.
// Each tab is fetched once and kept, so switching back is instant.
export function MoreNews({ currentId, suggested = [], latest = [], counts = {}, categories = [] }) {
  const [tab, setTab] = useState('for-you');
  const [lists, setLists] = useState(() => ({ 'for-you': suggested, latest }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const pick = async (key) => {
    setTab(key);
    setError('');
    if (lists[key]) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: '7', category: key });
      const res = await fetch(`/api/news?${qs}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Could not load these stories.');
      const items = (json.data || []).filter((a) => a.id !== currentId).slice(0, 6);
      setLists((l) => ({ ...l, [key]: items }));
    } catch (err) {
      setError(err.message || 'Could not load these stories.');
    } finally {
      setLoading(false);
    }
  };

  const items = lists[tab] || [];
  const isTopic = tab !== 'for-you' && tab !== 'latest';
  const seeAll = isTopic ? `/news?category=${encodeURIComponent(tab)}` : '/news';
  const tabs = [
    { key: 'for-you', label: 'For you', icon: 'fa-wand-magic-sparkles' },
    { key: 'latest', label: 'Latest', icon: 'fa-clock' },
    ...categories.filter((c) => counts[c] > 0 || c === tab).map((c) => ({ key: c, label: c, count: counts[c] || 0 })),
  ];

  return (
    <section className="nw-keep nw-more-news" aria-label="More news">
      <div className="nw-wrap">
        <div className="nw-section-head">
          <div>
            <span className="nw-eyebrow">Keep reading</span>
            <h2>More news</h2>
          </div>
          <Link href={seeAll}>{isTopic ? `All ${tab} stories` : 'See all news'}</Link>
        </div>

        <div className="nw-chips" role="tablist" aria-label="Choose what to read next">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`${tab === t.key ? 'on' : ''} ${t.count === 0 ? 'empty' : ''}`}
              onClick={() => pick(t.key)}
            >
              {t.icon && <i className={`fas ${t.icon}`} aria-hidden="true"></i>}
              {t.label}
              {t.count !== undefined && <span className="nw-chip-count">{t.count}</span>}
            </button>
          ))}
        </div>

        <div className="nw-more-body" role="tabpanel" aria-busy={loading}>
          {loading && (
            <div className="nw-grid nw-more-grid" aria-hidden="true">
              {[0, 1, 2].map((i) => <div key={i} className="nw-card-skel"><span /><span /><span /></div>)}
            </div>
          )}
          {!loading && error && <p className="nw-more-error" role="alert">{error}</p>}
          {!loading && !error && items.length > 0 && (
            <div className="nw-grid nw-more-grid" key={tab}>
              {items.map((a, i) => (
                <div key={a.id} className="nw-rise" style={{ '--i': i }}>
                  <StoryCard article={a} />
                </div>
              ))}
            </div>
          )}
          {!loading && !error && items.length === 0 && (
            <div className="nw-more-empty" key={`empty-${tab}`}>
              <i className="fas fa-feather-pointed" aria-hidden="true"></i>
              <strong>
                {isTopic ? `No other ${tab} stories yet` : 'You are all caught up'}
              </strong>
              <p>
                {isTopic
                  ? 'Pick another topic above, or see everything the church has shared.'
                  : 'This is our newest story. New ones are on the way, so check back soon.'}
              </p>
              <div className="nw-more-empty-actions">
                <Link href="/news" className="nw-btn">See all news</Link>
                <Link href="/#news" className="nw-btn-soft">Upcoming events</Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
