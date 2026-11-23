'use client';

// The small interactive pieces of the News pages: sharing, counting a view,
// and loading more stories. Everything else on those pages is drawn on the
// server.

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

// "Load more" under the Latest Stories grid.
export function LoadMore({ offset, total, category }) {
  const [items, setItems] = useState([]);
  const [next, setNext] = useState(offset);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  if (next >= total) {
    return items.length ? <div className="nw-grid">{items.map((a) => <StoryCard key={a.id} article={a} />)}</div> : null;
  }
  const more = async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ limit: '12', offset: String(next) });
      if (category) qs.set('category', category);
      const res = await fetch(`/api/news?${qs}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Could not load more.');
      setItems((list) => [...list, ...json.data]);
      setNext((n) => n + json.data.length + (json.data.length ? 0 : total));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      {items.length > 0 && <div className="nw-grid">{items.map((a) => <StoryCard key={a.id} article={a} />)}</div>}
      <div className="nw-more">
        <button type="button" onClick={more} disabled={loading}>{loading ? 'Loading…' : 'Load more stories'}</button>
        {error && <p role="alert">{error}</p>}
      </div>
    </>
  );
}
