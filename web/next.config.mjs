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
        // Event "magic links" (/miracle-working-god-cebu-event) used to be
        // rewritten to "/" here as well. They are a real route now -
        // src/app/[eventSlug]/page.js - because a rewrite cannot give a link
        // its own <title> and preview image, and so every event shared into a
        // group chat came back looking like the home page. That route renders
        // exactly this same home page, so the behaviour for a person opening
        // the link is unchanged.
        //
        // The dashboard sections above still win over it: Next checks
        // `afterFiles` rewrites BEFORE dynamic routes.
      ],
    };
  },
};

export default nextConfig;
