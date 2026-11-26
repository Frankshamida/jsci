import { Playfair_Display as PlayfairDisplay, Poppins } from 'next/font/google';

// The fonts the poster editor supplies to templates, besides Outfit (root
// layout): Poppins (credit, subtext, footer) and Playfair Display (the
// Elegant Dark templates' headline). They are only on the posters, so they
// are loaded here and nowhere else on the site. The editor reads the family
// names from these CSS variables, waits for them before drawing, and embeds
// them in the poster it draws.
const poppins = Poppins({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-poppins',
});

const playfair = PlayfairDisplay({
  weight: ['400', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-playfair',
});

export const metadata = {
  title: 'News poster',
  robots: { index: false, follow: false },
};

export default function PosterLayout({ children }) {
  return <div className={`${poppins.variable} ${playfair.variable}`}>{children}</div>;
}
