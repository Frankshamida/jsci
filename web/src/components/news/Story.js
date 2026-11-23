'use client';

// One article, in the reader's language: the header (blurred photo, topic,
// headline, author), the story, and the end (topics, sharing, author).
//
// English is drawn on the server; Tagalog and Bisaya are already in the page
// (article.translations), so switching is instant - no reload, no request.
// The choice is remembered for the next article, and ?lang=tl / ?lang=ceb in
// a link opens it in that language. Anything a translation lacks shows in
// English.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { NEWS_LANGS, articleIn, articleLangs } from '@/lib/news';
import ArticleBody from '@/components/news/ArticleBody';
import { ShareBar } from '@/components/news/NewsClient';

const LANG_KEY = 'news-lang';

const UI = {
  en: { brief: 'In brief', read: 'min read', topics: 'Topics', share: 'Share this story', published: 'Published', source: 'Read the original source', readIn: 'Read in' },
  tl: { brief: 'Buod', read: 'minutong basa', topics: 'Mga Paksa', share: 'Ibahagi ang balitang ito', published: 'Inilathala', source: 'Basahin ang orihinal na pinagmulan', readIn: 'Basahin sa' },
  ceb: { brief: 'Mubo nga sumada', read: 'minutos nga basa', topics: 'Mga Hilisgutan', share: 'Ipaambit kining balita', published: 'Gipatik', source: 'Basaha ang orihinal nga tinubdan', readIn: 'Basaha sa' },
};

export default function Story({ article, events, path, minutes, labels, cover }) {
  const langs = useMemo(() => articleLangs(article), [article]);
  const [lang, setLang] = useState('en');

  // The language asked for in the link, or the one this reader chose before.
  useEffect(() => {
    let want = null;
    try { want = new URLSearchParams(window.location.search).get('lang') || localStorage.getItem(LANG_KEY); } catch { /* storage blocked */ }
    if (want && want !== 'en' && langs.some((l) => l.code === want)) setLang(want);
  }, [langs]);

  const choose = (code) => {
    setLang(code);
    try { localStorage.setItem(LANG_KEY, code); } catch { /* not remembered */ }
    try {
      const url = new URL(window.location.href);
      if (code === 'en') url.searchParams.delete('lang'); else url.searchParams.set('lang', code);
      window.history.replaceState(window.history.state, '', url.toString());
    } catch { /* address bar unchanged */ }
  };

  const view = useMemo(() => articleIn(article, lang), [article, lang]);
  const t = UI[lang] || UI.en;
  const info = NEWS_LANGS.find((l) => l.code === lang);
  const topicHref = `/news?category=${encodeURIComponent(article.category)}`;
  const shareTitle = view.title;
  const sharePath = lang === 'en' ? path : `${path}?lang=${lang}`;

  return (
    <div lang={lang === 'ceb' ? 'ceb' : lang === 'tl' ? 'tl' : 'en'}>
      {/* ---- Header ---- */}
      <header className={`nw-story-hero ${cover ? 'has-cover' : ''}`}>
        <div className="nw-story-bg" aria-hidden="true">
          {cover && <div className="nw-story-blur" style={{ backgroundImage: `url("${cover.blur}")` }} />}
        </div>
        <div className="nw-story-head">
          <nav className="nw-crumbs" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <i className="fas fa-chevron-right" aria-hidden="true"></i>
            <Link href="/news">News</Link>
            <i className="fas fa-chevron-right" aria-hidden="true"></i>
            <Link href={topicHref}>{article.category}</Link>
          </nav>
          <div className="nw-story-kicker">
            <Link href={topicHref} className="nw-story-topic">{article.category}</Link>
            <span>{minutes} {t.read}</span>
          </div>
          <h1>{view.title}</h1>
          <div className="nw-story-byline">
            <span className="nw-avatar" aria-hidden="true">{labels.initials}</span>
            <span className="nw-story-who">
              <strong>{article.author}</strong>
              <span>{labels.dateLine}</span>
            </span>
          </div>

          {langs.length > 1 && (
            <div className="nw-langs" role="group" aria-label={t.readIn}>
              <span className="nw-langs-label"><i className="fas fa-language" aria-hidden="true"></i> {t.readIn}</span>
              {langs.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  className={lang === l.code ? 'on' : ''}
                  aria-pressed={lang === l.code}
                  onClick={() => choose(l.code)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {cover && (
          <figure className="nw-story-cover">
            <img src={cover.src} srcSet={cover.srcSet} sizes="(max-width: 1000px) 100vw, 980px" alt="" fetchPriority="high" />
          </figure>
        )}
      </header>

      {/* ---- The story ---- */}
      <div className="nw-read-layout">
        <aside className="nw-rail" aria-label="Share">
          <ShareBar title={shareTitle} path={sharePath} variant="rail" />
        </aside>

        <article className="nw-read">
          {lang !== 'en' && info?.note && (
            <p className="nw-measure nw-lang-note">
              {info.note}{' '}
              <button type="button" onClick={() => choose('en')}>Read in English</button>
            </p>
          )}

          {view.summary && (
            <div className="nw-measure nw-brief">
              <span className="nw-eyebrow">{t.brief}</span>
              <p>{view.summary}</p>
            </div>
          )}

          <div className={view.content[0]?.type === 'text' ? 'nw-dropcap' : ''}>
            <ArticleBody blocks={view.content} events={events} />
          </div>

          <div className="nw-measure nw-story-end">
            <span className="nw-end-mark" aria-hidden="true">✦</span>

            <div className="nw-end-row">
              <span className="nw-end-label">{t.topics}</span>
              <div className="nw-tags">
                <Link href={topicHref} className="nw-tag main">{article.category}</Link>
                {(article.tags || []).map((tag) => <span key={tag} className="nw-tag">{tag}</span>)}
              </div>
            </div>

            <div className="nw-end-row">
              <span className="nw-end-label">{t.share}</span>
              <ShareBar title={shareTitle} path={sharePath} variant="full" />
            </div>

            <div className="nw-author">
              <span className="nw-avatar lg" aria-hidden="true">{labels.initials}</span>
              <div>
                <strong>{article.author}</strong>
                <span>{t.published} {labels.published}{labels.updated ? ` · ${labels.updated}` : ''}</span>
                {article.source && (
                  <a href={article.source} target="_blank" rel="noopener noreferrer" className="nw-source">
                    {t.source} <i className="fas fa-arrow-up-right-from-square" aria-hidden="true"></i>
                  </a>
                )}
              </div>
            </div>
          </div>
        </article>
        <div className="nw-rail-spacer" aria-hidden="true" />
      </div>
    </div>
  );
}
