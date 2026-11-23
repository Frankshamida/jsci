'use client';

// Dashboard > News (Admin and Super Admin). Every article, drafts included:
// open one in the editor, publish or unpublish it, make it the top story, or
// delete it. Writing happens in the full-screen editor at /news-studio.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { articlePath, newsImage, timeAgo } from '@/lib/news';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'published', label: 'Published' },
  { key: 'draft', label: 'Drafts' },
];

export default function NewsManager({ actorId }) {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [setupNote, setSetupNote] = useState('');
  const [notice, setNotice] = useState(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!actorId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/news/manage?actorId=${encodeURIComponent(actorId)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (res.status === 503) { setSetupNote(json.message); setArticles([]); return; }
      if (!json.success) throw new Error(json.message || 'Could not load the articles.');
      setSetupNote('');
      setArticles(json.data || []);
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, [actorId]);

  useEffect(() => { load(); }, [load]);

  const act = async (article, action) => {
    setBusyId(article.id);
    setNotice(null);
    try {
      const res = await fetch('/api/news/manage', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, id: article.id, action }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Could not do that.');
      const words = { publish: 'published', unpublish: 'moved to drafts', feature: 'is now the top story', unfeature: 'is no longer the top story' };
      setNotice({ type: 'ok', text: `"${article.title}" ${words[action]}.` });
      load();
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (article) => {
    if (!window.confirm(`Delete "${article.title}"? Its pictures are deleted too. This cannot be undone.`)) return;
    setBusyId(article.id);
    setNotice(null);
    try {
      const res = await fetch('/api/news/manage', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, id: article.id }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Could not delete it.');
      setArticles((list) => list.filter((a) => a.id !== article.id));
      setNotice({ type: 'ok', text: `"${article.title}" deleted.` });
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const counts = useMemo(() => ({
    published: articles.filter((a) => a.status === 'published').length,
    draft: articles.filter((a) => a.status !== 'published').length,
    views: articles.reduce((n, a) => n + (a.views || 0), 0),
  }), [articles]);

  const shown = articles.filter((a) => {
    if (filter === 'published' && a.status !== 'published') return false;
    if (filter === 'draft' && a.status === 'published') return false;
    const q = query.trim().toLowerCase();
    return !q || `${a.title} ${a.category} ${a.author_name || ''}`.toLowerCase().includes(q);
  });

  return (
    <div className="nm">
      <div className="nm-head">
        <div>
          <h3>Church News</h3>
          <p>Write, publish and feature articles for the News page. Drafts are only seen here.</p>
        </div>
        <div className="nm-head-actions">
          <a href="/news" target="_blank" rel="noopener noreferrer" className="nm-link">View News page</a>
          <a href="/news-studio/new" className="nm-create"><i className="fas fa-plus"></i> Create New Article</a>
        </div>
      </div>

      {setupNote && <p className="nm-setup">{setupNote}</p>}

      {!setupNote && (
        <div className="nm-stats">
          <div><strong>{counts.published}</strong><span>Published</span></div>
          <div><strong>{counts.draft}</strong><span>Drafts</span></div>
          <div><strong>{counts.views.toLocaleString()}</strong><span>Total views</span></div>
        </div>
      )}

      <div className="nm-bar">
        <div className="nm-filters" role="tablist">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={filter === f.key ? 'on' : ''} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search articles" aria-label="Search articles" />
      </div>

      {notice && <p className={`nm-notice ${notice.type}`}>{notice.text}</p>}

      {loading ? (
        <p className="nm-empty"><i className="fas fa-spinner fa-spin"></i> Loading…</p>
      ) : shown.length === 0 ? (
        <div className="nm-empty">
          {articles.length === 0 && !setupNote ? (
            <>
              <strong>No articles yet</strong>
              <span>Write the first one yourself, or give the AI Writer your notes and let it draft it.</span>
              <a href="/news-studio/new" className="nm-create"><i className="fas fa-plus"></i> Create New Article</a>
            </>
          ) : !setupNote && <span>No articles match.</span>}
        </div>
      ) : (
        <ul className="nm-list">
          {shown.map((a) => {
            const live = a.status === 'published';
            return (
              <li key={a.id} className={busyId === a.id ? 'busy' : ''}>
                <a href={`/news-studio/${a.id}`} className="nm-thumb" aria-hidden="true" tabIndex={-1}>
                  {a.featured_image_url ? <img src={newsImage(a.featured_image_url, 240)} alt="" loading="lazy" /> : <span>{a.category}</span>}
                </a>
                <div className="nm-main">
                  <div className="nm-badges">
                    <span className={`nm-status ${live ? 'live' : ''}`}>{live ? 'Published' : 'Draft'}</span>
                    {a.is_featured && <span className="nm-star">Top story</span>}
                    <span className="nm-cat">{a.category}</span>
                  </div>
                  <a href={`/news-studio/${a.id}`} className="nm-title">{a.title}</a>
                  <span className="nm-meta">
                    {[
                      `Updated ${timeAgo(a.updated_at)}`,
                      a.author_name ? `by ${a.author_name}` : null,
                      live ? `${(a.views || 0).toLocaleString()} views` : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div className="nm-actions">
                  <a href={`/news-studio/${a.id}`} className="nm-btn primary">Edit</a>
                  {live && <a href={articlePath(a.slug)} target="_blank" rel="noopener noreferrer" className="nm-btn">View</a>}
                  {live
                    ? <button type="button" className="nm-btn" disabled={busyId === a.id} onClick={() => act(a, a.is_featured ? 'unfeature' : 'feature')}>{a.is_featured ? 'Unfeature' : 'Make top story'}</button>
                    : <button type="button" className="nm-btn" disabled={busyId === a.id} onClick={() => act(a, 'publish')}>Publish</button>}
                  {live && <button type="button" className="nm-btn" disabled={busyId === a.id} onClick={() => act(a, 'unpublish')}>Unpublish</button>}
                  <button type="button" className="nm-btn danger" disabled={busyId === a.id} onClick={() => remove(a)}>Delete</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
