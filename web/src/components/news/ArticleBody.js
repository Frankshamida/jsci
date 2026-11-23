// An article's blocks, drawn for reading. No hooks and no browser APIs, so the
// public article page renders it on the server and the editor's preview draws
// exactly the same thing. Text is cleaned again here (sanitizeHtml) even
// though it was cleaned when it was saved - the page never trusts a row.
//
// `events` (optional) is the live copy of any events the article links to,
// by id: { slug, title, when, place, image }. Without it an Event block shows
// the copy it took when it was added.

import { blockImages, newsImage, safeHref, sanitizeHtml } from '@/lib/news';

const WIDE = '(max-width: 1000px) 100vw, 980px';
const srcSet = (url) => [480, 760, 1200, 1600].map((w) => `${newsImage(url, w)} ${w}w`).join(', ');

function Figure({ image, className = '', sizes = WIDE, eager = false }) {
  if (!image?.url) return null;
  return (
    <figure className={`na-figure ${className}`}>
      <img
        src={newsImage(image.url, 1200)}
        srcSet={srcSet(image.url)}
        sizes={sizes}
        alt={image.alt || image.caption || ''}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
      {image.caption && <figcaption>{image.caption}</figcaption>}
    </figure>
  );
}

const Html = ({ html, className }) => {
  const clean = sanitizeHtml(html);
  return clean ? <div className={className} dangerouslySetInnerHTML={{ __html: clean }} /> : null;
};

function EventCard({ block, live }) {
  const e = { ...block, ...(live || {}) };
  if (!e.slug && !e.title) return null;
  const href = e.slug ? `/${e.slug}` : null;
  const Wrap = href ? 'a' : 'div';
  return (
    <Wrap className="na-event" {...(href ? { href } : {})}>
      <span className="na-event-img">
        {e.image
          ? <img src={newsImage(e.image, 480)} alt="" loading="lazy" decoding="async" />
          : <span className="na-event-noimg" aria-hidden="true"><i className="fas fa-calendar-check"></i></span>}
      </span>
      <span className="na-event-body">
        <span className="na-event-kicker">Church event</span>
        <strong>{e.title}</strong>
        {e.when && <span className="na-event-line"><i className="far fa-calendar" aria-hidden="true"></i> {e.when}</span>}
        {e.place && <span className="na-event-line"><i className="fas fa-location-dot" aria-hidden="true"></i> {e.place}</span>}
        {href && <span className="na-event-go">{block.label || 'View event'} <i className="fas fa-arrow-right" aria-hidden="true"></i></span>}
      </span>
    </Wrap>
  );
}

function LinkButton({ block }) {
  const href = safeHref(block.url);
  if (!href || !block.label) return null;
  const external = /^https?:/i.test(href);
  return (
    <div className="na-button-row">
      <a
        href={href}
        className={`na-button ${block.style === 'outline' ? 'outline' : 'gold'}`}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {block.label}
        <i className={`fas ${external ? 'fa-arrow-up-right-from-square' : 'fa-arrow-right'}`} aria-hidden="true"></i>
      </a>
    </div>
  );
}

export default function ArticleBody({ blocks = [], events = {} }) {
  return (
    <div className="na-body">
      {blocks.map((b) => {
        switch (b.type) {
          case 'text':
            return <Html key={b.id} html={b.html} className="na-text" />;
          case 'centered':
            return <Html key={b.id} html={b.html} className="na-text na-centered" />;
          case 'quote':
            return (
              <blockquote key={b.id} className="na-quote">
                <Html html={b.html} className="na-quote-text" />
                {b.cite && <cite>{b.cite}</cite>}
              </blockquote>
            );
          case 'image':
            return <Figure key={b.id} image={b.image} className="na-wide" />;
          case 'grid': {
            const imgs = blockImages(b);
            if (!imgs.length) return null;
            return (
              <div key={b.id} className={`na-grid n${Math.min(imgs.length, 4)}`}>
                {imgs.map((img, i) => <Figure key={`${b.id}-${i}`} image={img} sizes="(max-width: 1000px) 50vw, 490px" />)}
              </div>
            );
          }
          case 'stack': {
            const imgs = blockImages(b);
            if (!imgs.length) return null;
            return (
              <div key={b.id} className="na-stack">
                {imgs.map((img, i) => <Figure key={`${b.id}-${i}`} image={img} className="na-wide" />)}
              </div>
            );
          }
          case 'media-left':
          case 'media-right':
            if (!b.image?.url) return <Html key={b.id} html={b.html} className="na-text" />;
            return (
              <div key={b.id} className={`na-media ${b.type === 'media-right' ? 'right' : 'left'}`}>
                <Figure image={b.image} sizes="(max-width: 760px) 100vw, 460px" />
                <Html html={b.html} className="na-text" />
              </div>
            );
          case 'divider':
            return <hr key={b.id} className="na-divider" />;
          case 'event':
            return <EventCard key={b.id} block={b} live={b.eventId ? events[b.eventId] : null} />;
          case 'button':
            return <LinkButton key={b.id} block={b} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
