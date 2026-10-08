// The door's screen as an app of its own: installable from the browser
// ("Install app" / Add to Home Screen), it opens full screen, sideways, with
// its own icon and name - see public/checkin-display.webmanifest and
// public/checkin-sw.js.
export const metadata = {
  title: 'Check-in Display',
  description: 'The welcome screen at the door: every RFID card tapped turns the ID over to that delegate\'s name.',
  applicationName: 'JSCI Check-in',
  manifest: '/checkin-display.webmanifest',
  icons: {
    icon: [
      { url: '/app-icons/checkin-64.png', sizes: '64x64', type: 'image/png' },
      { url: '/app-icons/checkin-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/app-icons/checkin-apple-180.png', sizes: '180x180' }],
  },
  // iPhone and iPad: full screen from the home screen, the status bar over the page.
  appleWebApp: { capable: true, title: 'Check-in', statusBarStyle: 'black-translucent' },
  other: { 'mobile-web-app-capable': 'yes' },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

// Edge to edge, no pinch-zoom on a screen nobody should be zooming.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#1b1405',
};

export default function CheckinDisplayLayout({ children }) {
  return children;
}
