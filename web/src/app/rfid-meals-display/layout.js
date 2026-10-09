// The Meals Counter's screen: full screen from the home screen on an iPhone
// or iPad, no pinch-zoom, never in a search engine - the same as the door's
// screen (rfid-chekin-display/layout.js).
export const metadata = {
  title: 'Meals Display',
  description: 'The screen at the Meals Counter: every RFID card tapped turns the ID over to that delegate\'s name, in the order they tapped.',
  appleWebApp: { capable: true, title: 'Meals', statusBarStyle: 'black-translucent' },
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

export default function MealsDisplayLayout({ children }) {
  return children;
}
