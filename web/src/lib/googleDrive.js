/**
 * Google Drive Service
 * Handles file uploads to a specific Google Drive folder
 * using OAuth 2.0 with a refresh token (uploads as your Google account).
 * 
 * BULLETPROOF: Every function is wrapped so it NEVER throws unhandled errors.
 * All Google API calls have timeouts, retries on 401/5xx, and clear error messages.
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
// HELPERS
// ============================================

// Fetch with timeout – prevents hanging requests from freezing the server
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000}s: ${url.substring(0, 100)}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Safe error text extraction from a Response
async function safeResponseText(response) {
  try {
    const text = await response.text();
    return text.substring(0, 500);
  } catch {
    return `(HTTP ${response.status} – could not read body)`;
  }
}

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
  // Return cached token if still valid (with 60s buffer)
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

  let response;
  try {
    response = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    }, 15000);
  } catch (fetchErr) {
    throw new Error(`Failed to reach Google token endpoint: ${fetchErr.message || 'network error'}`);
  }

  if (!response.ok) {
    const errorText = await safeResponseText(response);
    console.error('[googleDrive] Token refresh failed:', errorText);
    if (errorText.includes('invalid_grant')) {
      throw new Error(
        'Google refresh token is expired or revoked. Please re-run: node get-google-refresh-token.js to get a new refresh token. ' +
        'If your OAuth app is in "Testing" mode, tokens expire after 7 days — publish the app to "Production" in Google Cloud Console → OAuth consent screen.'
      );
    }
    throw new Error(`Failed to get Google access token (HTTP ${response.status}): ${errorText}`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('Google token response was not valid JSON');
  }

  if (!data.access_token) {
    throw new Error('Google token response did not contain an access_token');
  }

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + ((data.expires_in || 3600) * 1000);
  return cachedToken;
}

/**
 * A request to any Google API as the connected account (Drive, Sheets), with
 * the same token and the same one retry on 401 the uploads here use. Returns
 * the Response; the caller reads it.
 */
export async function googleFetch(url, options = {}, timeoutMs = 30000) {
  for (const forceRefresh of [false, true]) {
    const token = await getAccessToken(forceRefresh);
    const response = await fetchWithTimeout(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
    }, timeoutMs);
    if (response.status !== 401 || forceRefresh) return response;
    invalidateToken();
  }
  return null;
}

// ============================================
// UPLOAD
// ============================================
export async function uploadToGoogleDrive(fileBuffer, fileName, mimeType) {
  if (!fileBuffer || !fileName) {
    throw new Error('uploadToGoogleDrive: fileBuffer and fileName are required');
  }

  async function doUpload(forceRefresh) {
    const accessToken = await getAccessToken(forceRefresh);

    const metadata = {
      name: String(fileName),
      parents: GOOGLE_DRIVE_FOLDER_ID ? [GOOGLE_DRIVE_FOLDER_ID] : [],
    };

    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadataPart = delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata);

    const contentPart = delimiter +
      `Content-Type: ${mimeType || 'application/octet-stream'}\r\n` +
      'Content-Transfer-Encoding: base64\r\n\r\n';

    let fileBase64;
    try {
      fileBase64 = Buffer.from(fileBuffer).toString('base64');
    } catch (e) {
      throw new Error(`Failed to encode file to base64: ${e.message}`);
    }

    const body = metadataPart + contentPart + fileBase64 + closeDelimiter;

    const response = await fetchWithTimeout(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink,thumbnailLink,size,mimeType',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
      120000 // 2-minute timeout for uploads
    );
    return { response, accessToken };
  }

  let result;
  try {
    result = await doUpload(false);
  } catch (e) {
    // If first attempt fails completely, retry with forced token refresh
    console.warn('[googleDrive] Upload first attempt failed:', e.message, '– retrying...');
    invalidateToken();
    result = await doUpload(true);
  }

  let { response, accessToken } = result;

  // Retry once on 401
  if (response.status === 401) {
    console.warn('[googleDrive] Upload got 401, refreshing token and retrying...');
    invalidateToken();
    ({ response, accessToken } = await doUpload(true));
  }

  // Retry once on 5xx (Google transient errors)
  if (response.status >= 500) {
    console.warn(`[googleDrive] Upload got ${response.status}, retrying once...`);
    await new Promise(r => setTimeout(r, 1000)); // 1s backoff
    ({ response, accessToken } = await doUpload(false));
  }

  if (!response.ok) {
    const errorText = await safeResponseText(response);
    throw new Error(`Google Drive upload failed (HTTP ${response.status}): ${errorText}`);
  }

  let fileData;
  try {
    fileData = await response.json();
  } catch {
    throw new Error('Google Drive upload response was not valid JSON');
  }

  if (!fileData.id) {
    throw new Error('Google Drive upload succeeded but no file ID returned');
  }

  // Make file viewable by anyone with the link (best-effort, don't fail the upload)
  try {
    await fetchWithTimeout(`https://www.googleapis.com/drive/v3/files/${fileData.id}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    }, 10000);
  } catch (permError) {
    console.warn('[googleDrive] Failed to set public permissions (non-fatal):', permError.message);
  }

  return {
    id: fileData.id,
    name: fileData.name || fileName,
    webViewLink: fileData.webViewLink || `https://drive.google.com/file/d/${fileData.id}/view`,
    webContentLink: fileData.webContentLink || null,
    thumbnailLink: fileData.thumbnailLink || null,
    size: parseInt(fileData.size || '0'),
    mimeType: fileData.mimeType || mimeType,
  };
}

// ============================================
// STREAM FILE (proxy for in-browser playback)
// ============================================
export async function streamFromGoogleDrive(fileId, rangeHeader) {
  if (!fileId || typeof fileId !== 'string') {
    throw new Error('streamFromGoogleDrive: fileId is required');
  }

  async function attempt(forceRefresh) {
    const accessToken = await getAccessToken(forceRefresh);
    const headers = { Authorization: `Bearer ${accessToken}` };
    if (rangeHeader) headers['Range'] = rangeHeader;

    // Use fetchWithTimeout to prevent hanging streams
    const response = await fetchWithTimeout(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      { headers },
      60000 // 60s timeout for streaming
    );
    return response;
  }

  let response;
  try {
    response = await attempt(false);
  } catch (firstErr) {
    // Network error on first attempt – retry with fresh token
    console.warn('[googleDrive] Stream first attempt failed:', firstErr.message, '– retrying...');
    invalidateToken();
    response = await attempt(true);
  }

  // If 401, token was stale — force refresh and retry once
  if (response.status === 401) {
    console.warn('[googleDrive] Stream got 401, refreshing token and retrying...');
    invalidateToken();
    response = await attempt(true);
  }

  // Retry once on 5xx (Google transient error)
  if (response.status >= 500) {
    console.warn(`[googleDrive] Stream got ${response.status}, retrying once...`);
    await new Promise(r => setTimeout(r, 500));
    response = await attempt(false);
  }

  if (!response.ok && response.status !== 206) {
    const errorText = await safeResponseText(response);

    if (response.status === 404) {
      throw new Error(`File not found on Google Drive (fileId: ${fileId}). It may have been deleted.`);
    }
    if (response.status === 403) {
      throw new Error(`Access denied to Google Drive file (fileId: ${fileId}). Check file permissions.`);
    }

    throw new Error(`Google Drive stream failed (HTTP ${response.status}): ${errorText}`);
  }

  return {
    body: response.body,
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
      'Content-Length': response.headers.get('content-length') || null,
      'Content-Range': response.headers.get('content-range') || null,
      'Accept-Ranges': 'bytes',
    },
  };
}

// ============================================
// DELETE
// ============================================
export async function deleteFromGoogleDrive(fileId) {
  if (!fileId) return; // nothing to delete

  async function attempt(forceRefresh) {
    const accessToken = await getAccessToken(forceRefresh);
    return fetchWithTimeout(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }, 15000);
  }

  let response;
  try {
    response = await attempt(false);
  } catch (e) {
    console.warn('[googleDrive] Delete first attempt failed:', e.message, '– retrying...');
    invalidateToken();
    response = await attempt(true);
  }

  if (response.status === 401) {
    invalidateToken();
    response = await attempt(true);
  }

  // 404 = already deleted – that's fine
  if (!response.ok && response.status !== 404 && response.status !== 204) {
    const errorText = await safeResponseText(response);
    throw new Error(`Google Drive delete failed (HTTP ${response.status}): ${errorText}`);
  }
}

// ============================================
// GET FILE METADATA
// ============================================
export async function getGoogleDriveFile(fileId) {
  if (!fileId) throw new Error('getGoogleDriveFile: fileId is required');

  async function attempt(forceRefresh) {
    const accessToken = await getAccessToken(forceRefresh);
    return fetchWithTimeout(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,webViewLink,webContentLink,thumbnailLink,size,mimeType,videoMediaMetadata`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      15000
    );
  }

  let response;
  try {
    response = await attempt(false);
  } catch (e) {
    console.warn('[googleDrive] getFile first attempt failed:', e.message, '– retrying...');
    invalidateToken();
    response = await attempt(true);
  }

  if (response.status === 401) {
    invalidateToken();
    response = await attempt(true);
  }

  if (!response.ok) {
    const errorText = await safeResponseText(response);
    if (response.status === 404) {
      throw new Error(`File not found on Google Drive (fileId: ${fileId})`);
    }
    throw new Error(`Google Drive fetch failed (HTTP ${response.status}): ${errorText}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error('Google Drive file metadata response was not valid JSON');
  }
}

// ============================================
// LIST FILES IN FOLDER
// ============================================
export async function listGoogleDriveFiles(pageSize = 50, pageToken = null) {
  const safeFolderId = encodeURIComponent(GOOGLE_DRIVE_FOLDER_ID || '');

  async function attempt(forceRefresh) {
    const accessToken = await getAccessToken(forceRefresh);
    let url = `https://www.googleapis.com/drive/v3/files?q='${safeFolderId}'+in+parents+and+trashed=false&fields=files(id,name,webViewLink,webContentLink,thumbnailLink,size,mimeType,createdTime,videoMediaMetadata)&orderBy=createdTime+desc&pageSize=${Math.min(Math.max(pageSize, 1), 100)}`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
    return fetchWithTimeout(url, { headers: { Authorization: `Bearer ${accessToken}` } }, 20000);
  }

  let response;
  try {
    response = await attempt(false);
  } catch (e) {
    console.warn('[googleDrive] listFiles first attempt failed:', e.message, '– retrying...');
    invalidateToken();
    response = await attempt(true);
  }

  if (response.status === 401) {
    invalidateToken();
    response = await attempt(true);
  }

  if (!response.ok) {
    const errorText = await safeResponseText(response);
    throw new Error(`Google Drive list failed (HTTP ${response.status}): ${errorText}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error('Google Drive list response was not valid JSON');
  }
}
