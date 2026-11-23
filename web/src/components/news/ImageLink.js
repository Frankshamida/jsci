// The link under a picture, as text: "See more: Youth Camp 2026 →". The
// words before a colon are set lighter and the title after it bold, so it
// reads as a label and a title. Plain markup, usable on the server and in the
// browser.

import { imageLinkParts, safeHref } from '@/lib/news';

export function ImageLink({ image }) {
  const href = image?.link ? safeHref(image.link) : null;
  if (!href) return null;
  const { lead, title } = imageLinkParts(image.linkLabel);
  const external = /^https?:/i.test(href);
  return (
    <a
      href={href}
      className="na-img-link"
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      <i className="fas fa-images" aria-hidden="true"></i>
      {lead && <span>{lead}</span>}
      <strong>{title}</strong>
      <i className={`fas ${external ? 'fa-arrow-up-right-from-square' : 'fa-arrow-right'} na-img-link-go`} aria-hidden="true"></i>
    </a>
  );
}
