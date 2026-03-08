/**
 * ONE-TIME SCRIPT: Get a Google OAuth 2.0 Refresh Token
 * 
 * STEPS:
 * 1. Go to https://console.cloud.google.com/apis/credentials
 * 2. Click "Create Credentials" → "OAuth client ID" (or use existing one)
 * 3. Application type: "Web application"
 * 4. Add http://localhost:3333 to "Authorized redirect URIs"
 * 5. Copy the Client ID and Client Secret
 * 6. Run:  node get-google-refresh-token.js YOUR_CLIENT_ID YOUR_CLIENT_SECRET
 * 7. Open the URL in your browser, sign in with your Google account
 * 8. Copy the refresh token printed in the terminal
 * 9. Add to your Vercel env variables:
 *      GOOGLE_CLIENT_ID=...
 *      GOOGLE_CLIENT_SECRET=...
 *      GOOGLE_REFRESH_TOKEN=...
 *      GOOGLE_DRIVE_FOLDER_ID=...
 */

const http = require('http');
const url = require('url');

const CLIENT_ID = process.argv[2];
const CLIENT_SECRET = process.argv[3];
const REDIRECT_URI = 'http://localhost:3333';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n❌ Usage: node get-google-refresh-token.js <CLIENT_ID> <CLIENT_SECRET>\n');
  console.error('Get these from: https://console.cloud.google.com/apis/credentials');
  console.error('Create an OAuth 2.0 Client ID (Web application type)');
  console.error('Add http://localhost:3333 as an Authorized redirect URI\n');
  process.exit(1);
}

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log('\n🔗 Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n⏳ Waiting for authorization...\n');

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const code = parsedUrl.query.code;

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h1>Error: No authorization code received</h1>');
    return;
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error('❌ Error:', tokenData.error_description || tokenData.error);
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`<h1>Error</h1><p>${tokenData.error_description || tokenData.error}</p>`);
      server.close();
      return;
    }

    console.log('✅ SUCCESS!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`GOOGLE_CLIENT_ID=${CLIENT_ID}`);
    console.log(`GOOGLE_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`GOOGLE_REFRESH_TOKEN=${tokenData.refresh_token}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n👉 Add these 3 env variables + GOOGLE_DRIVE_FOLDER_ID to Vercel.\n');

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<html><body style="font-family:sans-serif;text-align:center;padding:50px;">
      <h1>✅ Success!</h1><p>Refresh token printed in terminal. You can close this tab.</p>
    </body></html>`);
  } catch (err) {
    console.error('❌ Error:', err.message);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h1>Error</h1><p>${err.message}</p>`);
  }
  server.close();
});

server.listen(3333, () => {
  console.log('🖥️  Listening on http://localhost:3333');
});
