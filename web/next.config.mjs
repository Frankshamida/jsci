/** @type {import('next').NextConfig} */

// Dashboard section slugs that should be reachable as clean top-level URLs
// (e.g. /bible-reader). They all render the single dashboard page, which reads
// the pathname to open the matching section. Keep in sync with dashboard sections.
const DASHBOARD_SECTIONS = [
  'accommodation',
  'announcements',
  'announcements-management',
  'attendance-management',
  'audit-logs',
  'bible-reader',
  'cloudinary-usage',
  'community-events',
  'community-hub',
  'create-lineup',
  'daily-quote',
  'events',
  'events-management',
  'isom-management',
  'live-stream-management',
  'messages',
  'ministry-management',
  'ministry-meetings',
  'ministry-oversight',
  'my-created-events',
  'my-profile',
  'payment-methods',
  'permissions-control',
  'praise-worship',
  'recordings',
  'reports',
  'roles-permissions',
  'spiritual-assistant',
  'system-config',
  'terms-conditions',
  'user-events-oversight',
  'user-management',
  'weekly-schedule',
];

const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['img.youtube.com', 'i.ytimg.com', 'res.cloudinary.com'],
  },
  async rewrites() {
    return {
      // afterFiles: only apply when no real page/file matches the path,
      // so /login, /signup, /live, /dashboard, etc. keep working.
      afterFiles: [
        ...DASHBOARD_SECTIONS.map((section) => ({
          source: `/${section}`,
          destination: '/dashboard',
        })),
        // Event "magic links": /miracle-working-god-cebu-event and the like.
        // The home page reads the slug back off the address bar and opens that
        // event's registration (see lib/eventSlug.js).
        //
        // Deliberately LAST: rewrites are matched in order, so every dashboard
        // section above still wins, and afterFiles itself only runs once real
        // pages and /public files have had their chance. The pattern is one
        // segment of letters, digits and hyphens with no dot in it, which
        // keeps /_next, /api, /assets and files like /favicon.ico well clear.
        // Capitals are allowed through because links get retyped by hand off
        // posters and chat apps; the page lower-cases before matching.
        { source: '/:eventSlug([A-Za-z0-9][A-Za-z0-9-]*)', destination: '/' },
      ],
    };
  },
};

export default nextConfig;
