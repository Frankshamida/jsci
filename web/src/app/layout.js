import { Outfit } from 'next/font/google';
import './globals.css';
import { DEFAULT_CARD_IMAGE, OG_HEIGHT, OG_WIDTH, SITE_NAME, SITE_TAGLINE, siteOrigin } from '@/lib/socialCard';

// Outfit is a variable font (100-900) — Next.js self-hosts it, so every
// existing font-weight in the app maps to a real weight with no extra requests.
const outfit = Outfit({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-outfit',
  fallback: ['Segoe UI', 'Tahoma', 'Geneva', 'Verdana', 'sans-serif'],
  adjustFontFallback: true,
});

// Every page inherits this, and any page that says more (an event link, see
// src/app/[eventSlug]/page.js) overrides only the parts it names.
//
// `metadataBase` is what makes the rest work: Open Graph images have to be
// absolute URLs, and without a base Next has no way to turn "/opengraph-image"
// into one a crawler can fetch. Set NEXT_PUBLIC_SITE_URL to the live domain.
export const metadata = {
  metadataBase: new URL(siteOrigin()),
  title: SITE_NAME,
  description: SITE_TAGLINE,
  applicationName: SITE_NAME,
  icons: {
    icon: '/assets/LOGO.png',
    shortcut: '/assets/LOGO.png',
    apple: '/assets/LOGO.png',
  },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    url: '/',
    title: SITE_NAME,
    description: SITE_TAGLINE,
    locale: 'en_PH',
    images: [{
      url: DEFAULT_CARD_IMAGE,
      width: OG_WIDTH,
      height: OG_HEIGHT,
      alt: SITE_NAME,
      type: 'image/jpeg',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: SITE_TAGLINE,
    images: [DEFAULT_CARD_IMAGE],
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={outfit.variable}>
      <head>
        <meta name="google-site-verification" content="3FH6FYrBm5O341ms_WFVZZVyo5Ymve05DCUEzfeGM0A" />
        <meta name="google-site-verification" content="myEhbUdaSVVxNVCyKVKTXT9pNcDceMiRKw8h_0ssLR0" />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
          integrity="sha512-DTOQO9RWCH3ppGqcWaEA1BIZOC6xxalwEsw9c2QQeAIftl+Vegovlnee1c9QX4TctnWMn13TZye+giMm8e2LwA=="
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
