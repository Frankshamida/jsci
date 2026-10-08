// Find your room - the attendees' own accommodation lookup (page.js). Kept
// out of search engines: it is for the people at the event.
export const metadata = {
  title: 'Find your room',
  description: 'Search your name or tap your RFID card to see your room and who you share it with.',
  robots: { index: false, follow: false },
};

export default function AccommodationLayout({ children }) {
  return children;
}
