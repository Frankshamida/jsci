/**
 * Google Drive Service
 * Handles file uploads to a specific Google Drive folder
 * using OAuth 2.0 with a refresh token (uploads as your Google account).
 * 
 * SETUP:
 * 1. Go to https://console.cloud.google.com → your project
 * 2. Enable the Google Drive API
 * 3. Create OAuth 2.0 credentials (Web application type)
 * 4. Run: node get-google-refresh-token.js <CLIENT_ID> <CLIENT_SECRET>
 * 5. Set environment variables below
 * 
 * ENV VARIABLES:
 *   GOOGLE_DRIVE_FOLDER_ID=your-folder-id
 *   GOOGLE_CLIENT_ID=your-oauth-client-id
 *   GOOGLE_CLIENT_SECRET=your-oauth-client-secret
 *   GOOGLE_REFRESH_TOKEN=your-refresh-token
 */

const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN || '';

// ============================================
// ACCESS TOKEN (OAuth 2.0 Refresh Token Flow)
// ============================================
let cachedToken = null;
let tokenExpiry = 0;

function invalidateToken() {
  cachedToken = null;
  tokenExpiry = 0;
}

async function getAccessToken(forceRefresh = false) {
  if (!forceRefresh && cachedToken && Date.now() < tokenExpiry - 60000) {
    return cachedToken;
  }

  // Clear stale cache
  invalidateToken();

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error(
      'Google OAuth credentials not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN env variables.'
    );
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Token refresh failed:', error);
    throw new Error(`Failed to get Google access token: ${error}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000);
  return cachedToken;
}

// ============================================
// UPLOAD
// ============================================
export async function uploadToGoogleDrive(fileBuffer, fileName, mimeType) {
  async function doUpload(forceRefresh) {
    const accessToken = await getAccessToken(forceRefresh);

    const metadata = {
      name: fileName,
      parents: [GOOGLE_DRIVE_FOLDER_ID],
    };

    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadataPart = delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata);

    const contentPart = delimiter +
      `Content-Type: ${mimeType}\r\n` +
      'Content-Transfer-Encoding: base64\r\n\r\n';

    const fileBase64 = Buffer.from(fileBuffer).toString('base64');
    const body = metadataPart + contentPart + fileBase64 + closeDelimiter;

    const response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink,thumbnailLink,size,mimeType',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );
    return { response, accessToken };
  }

  let { response, accessToken } = await doUpload(false);

  // Retry once on 401
  if (response.status === 401) {
    console.warn('Upload got 401, refreshing token and retrying...');
    invalidateToken();
    ({ response, accessToken } = await doUpload(true));
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google Drive upload failed: ${error}`);
  }

  const fileData = await response.json();

  // Make file viewable by anyone with the link
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileData.id}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });

  return {
    id: fileData.id,
    name: fileData.name,
    webViewLink: fileData.webViewLink || `https://drive.google.com/file/d/${fileData.id}/view`,
    webContentLink: fileData.webContentLink,
    thumbnailLink: fileData.thumbnailLink,
    size: parseInt(fileData.size || '0'),
    mimeType: fileData.mimeType,
  };
}

// ============================================
// STREAM FILE (proxy for in-browser playback)
// ============================================
export async function streamFromGoogleDrive(fileId, rangeHeader) {
  async function attempt(forceRefresh) {
    const accessToken = await getAccessToken(forceRefresh);
    const headers = { Authorization: `Bearer ${accessToken}` };
    if (rangeHeader) headers['Range'] = rangeHeader;

    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers }
    );
    return response;
  }

  let response = await attempt(false);

  // If 401, token was stale — force refresh and retry once
  if (response.status === 401) {
    console.warn('Stream got 401, refreshing token and retrying...');
    invalidateToken();
    response = await attempt(true);
  }

  if (!response.ok && response.status !== 206) {
    const error = await response.text();
    throw new Error(`Google Drive stream failed: ${error}`);
  }

  return {
    body: response.body,
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
      'Content-Length': response.headers.get('content-length'),
      'Content-Range': response.headers.get('content-range'),
      'Accept-Ranges': 'bytes',
    },
  };
}

// ============================================
// DELETE
// ============================================
export async function deleteFromGoogleDrive(fileId) {
  if (!fileId) return;
  async function attempt(forceRefresh) {
    const accessToken = await getAccessToken(forceRefresh);
    return fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }
  let response = await attempt(false);
  if (response.status === 401) { invalidateToken(); response = await attempt(true); }
  if (!response.ok && response.status !== 404) {
    const error = await response.text();
    throw new Error(`Google Drive delete failed: ${error}`);
  }
}

// ============================================
// GET FILE METADATA
// ============================================
export async function getGoogleDriveFile(fileId) {
  async function attempt(forceRefresh) {
    const accessToken = await getAccessToken(forceRefresh);
    return fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,webViewLink,webContentLink,thumbnailLink,size,mimeType,videoMediaMetadata`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
  }
  let response = await attempt(false);
  if (response.status === 401) { invalidateToken(); response = await attempt(true); }
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google Drive fetch failed: ${error}`);
  }
  return response.json();
}

// ============================================
// LIST FILES IN FOLDER
// ============================================
export async function listGoogleDriveFiles(pageSize = 50, pageToken = null) {
  async function attempt(forceRefresh) {
    const accessToken = await getAccessToken(forceRefresh);
    let url = `https://www.googleapis.com/drive/v3/files?q='${GOOGLE_DRIVE_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name,webViewLink,webContentLink,thumbnailLink,size,mimeType,createdTime,videoMediaMetadata)&orderBy=createdTime+desc&pageSize=${pageSize}`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    return fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  }
  let response = await attempt(false);
  if (response.status === 401) { invalidateToken(); response = await attempt(true); }
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google Drive list failed: ${error}`);
  }
  return response.json();
}
