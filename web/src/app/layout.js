import './globals.css';

export const metadata = {
  title: 'SanctuaryHub',
  description: 'Ministry Portal - SanctuaryHub',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
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
