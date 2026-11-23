import { Poppins } from 'next/font/google';

// The poster editor's own font. Poppins is only on the posters (credit,
// subtext, footer), so it is loaded here and nowhere else on the site.
// Outfit comes from the root layout. The editor reads both family names from
// these CSS variables and waits for them before drawing.
const poppins = Poppins({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-poppins',
});

export const metadata = {
  title: 'News poster',
  robots: { index: false, follow: false },
};

export default function PosterLayout({ children }) {
  return <div className={poppins.variable}>{children}</div>;
}
