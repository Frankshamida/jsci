// The News pages' reading type, next to the site's Outfit:
//   Playfair Display  headlines, pull quotes, the drop cap - formal and warm
//   Source Serif 4    the story itself - a serif drawn for reading on screens
// Served from this site by next/font (no request to Google from the reader's
// browser), and exposed as CSS variables so news.css can use them by name.

import { Playfair_Display, Source_Serif_4 } from 'next/font/google';

const display = Playfair_Display({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-news-display',
  display: 'swap',
});

const serif = Source_Serif_4({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-news-serif',
  display: 'swap',
});

export const newsFonts = `${display.variable} ${serif.variable}`;
