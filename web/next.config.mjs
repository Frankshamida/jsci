/** @type {import('next').NextConfig} */

// Dashboard section slugs that should be reachable as clean top-level URLs
// (e.g. /bible-reader). They all render the single dashboard page, which reads
// the pathname to open the matching section. Keep in sync with dashboard sections.
const DASHBOARD_SECTIONS = [
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
      afterFiles: DASHBOARD_SECTIONS.map((section) => ({
        source: `/${section}`,
        destination: '/dashboard',
      })),
    };
  },
};

export default nextConfig;
