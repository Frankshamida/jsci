import { Outfit } from 'next/font/google';
import './globals.css';

// Outfit is a variable font (100-900) — Next.js self-hosts it, so every
// existing font-weight in the app maps to a real weight with no extra requests.
const outfit = Outfit({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-outfit',
  fallback: ['Segoe UI', 'Tahoma', 'Geneva', 'Verdana', 'sans-serif'],
  adjustFontFallback: true,
});

export const metadata = {
  title: 'Joyful Sound Church International',
  description: 'Ministry Portal - Joyful Sound Church International',
  icons: {
    icon: '/assets/LOGO.png',
    shortcut: '/assets/LOGO.png',
    apple: '/assets/LOGO.png',
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
