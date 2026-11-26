/** @type {import('next').NextConfig} */

// Dashboard section slugs that should be reachable as clean top-level URLs
// (e.g. /bible-reader). They all render the single dashboard page, which reads
// the pathname to open the matching section. Keep in sync with dashboard sections.
const DASHBOARD_SECTIONS = [
  // The Accommodation section. /accommodation itself is the attendees' Find
  // your room page (src/app/accommodation) - see SECTION_PATHS in the dashboard.
  'accommodation-desk',
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
  // Dashboard > Giving. /giving itself is the public giving page.
  'giving-management',
  'isom-management',
  'messages',
  'ministry-management',
  'ministry-meetings',
  'ministry-oversight',
  'my-created-events',
  'my-profile',
  'news-management',
  'payment-methods',
  'permissions-control',
  'praise-worship',
  'recordings',
  'reports',
  'roles-permissions',
  'social-media',
  'spiritual-assistant',
  'system-config',
  'terms-conditions',
  'user-events-oversight',
  'user-management',
  'weekly-schedule',
];

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Read PDFs on the server (Accommodation > Import). pdf.js loads its own
    // worker file at run time, which only works when it is required from
    // node_modules as it is, not bundled.
    serverComponentsExternalPackages: ['pdfjs-dist'],
  },
  images: {
    domains: ['img.youtube.com', 'i.ytimg.com', 'res.cloudinary.com'],
  },
  // Addresses that moved. Old links - shared, bookmarked - keep working.
  async redirects() {
    return [
      // Dashboard > Live & Videos is Dashboard > Social Media.
      { source: '/live-stream-management', destination: '/social-media', permanent: true },
    ];
  },
  async rewrites() {
    return {
      // afterFiles: only apply when no real page/file matches the path,
      // so /login, /signup, /sunday-service, /dashboard, etc. keep working.
      afterFiles: [
        ...DASHBOARD_SECTIONS.map((section) => ({
          source: `/${section}`,
          destination: '/dashboard',
        })),
        // JSCI Ministry, the web app (built by ministry-app/scripts/build-web.mjs
        // into public/ministrysystem). Its files are served as they are; every
        // other /ministrysystem address (/ministrysystem/lineup/..., a reload,
        // the Home Screen icon) opens the app, which shows the right screen.
        { source: '/ministrysystem', destination: '/ministrysystem/index.html' },
        { source: '/ministrysystem/:path*', destination: '/ministrysystem/index.html' },
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
