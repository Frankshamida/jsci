// Crawlers ask for /robots.txt before they fetch anything else - including the
// ones that build a link preview, which read it before they will scrape a page
// for its title and image. The site never had one, so the request used to 404
// (harmless: no file means no restrictions). It stopped being harmless when
// src/app/[eventSlug]/page.js began answering every unclaimed path, because
// /robots.txt started coming back as 32 KB of home page with a 200 on it, which
// is a file a crawler has every reason to distrust.
//
// That route turns those paths down now, and this says out loud what was only
// ever implied: the public pages are open, the parts of the app that need a
// login are not worth a crawler's time.

export default function robots() {
  return {
    rules: [{
      userAgent: '*',
      allow: '/',
      // Not a security measure - anything behind these needs a session anyway.
      // It keeps crawlers out of pages that are empty without one, so the search
      // results for the church are its own pages rather than a row of login
      // screens.
      disallow: ['/api/', '/dashboard', '/auth/', '/event-committee/'],
    }],
  };
}
