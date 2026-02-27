import './globals.css';

export const metadata = {
  title: 'Joyful Sound Church International - Ministry Portal',
  description: 'Ministry Portal for Joyful Sound Church International',
  icons: {
    icon: '/assets/LOGO.png',
    apple: '/assets/LOGO.png',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
