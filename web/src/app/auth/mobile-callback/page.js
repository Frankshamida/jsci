'use client';

import { useEffect, useState } from 'react';

const SUPABASE_URL = 'https://okgootzwaklvzywtbwub.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rZ29vdHp3YWtsdnp5d3Rid3ViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNzUxNjEsImV4cCI6MjA4Nzc1MTE2MX0.k0N5q6Xbc5UKyQwBqVkM5vATA0Lvg1dzYJxxh4NRIF8';

export default function MobileCallbackPage() {
  const [status, setStatus] = useState('Processing sign-in…');
  const [error, setError] = useState(null);
  const [deepLink, setDeepLink] = useState(null);

  useEffect(() => {
    handleCallback();
  }, []);

  async function handleCallback() {
    try {
      /* ── 1. Read the app_redirect from query params ── */
      const urlParams = new URLSearchParams(window.location.search);
      const appRedirect = urlParams.get('app_redirect');

      if (!appRedirect) {
        setError('Missing app redirect URL. Please try again from the app.');
        return;
      }

      /* ── 2. Read the access_token from the URL hash ── */
      const hash = window.location.hash.substring(1); // remove leading #
      if (!hash) {
        setError('No authentication data received from Google.');
        return;
      }

      const hashParams = new URLSearchParams(hash);
      const accessToken = hashParams.get('access_token');

      if (!accessToken) {
        setError('No access token received. Please try again.');
        return;
      }

      /* ── 3. Fetch Google user info from Supabase ── */
      setStatus('Getting your Google account info…');

      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
        },
      });

      if (!userRes.ok) {
        setError('Failed to verify your Google account. Please try again.');
        return;
      }

      const googleUser = await userRes.json();

      if (!googleUser || !googleUser.email) {
        setError('Could not get your Google account information.');
        return;
      }

      /* ── 4. Build the deep link back to the mobile app ── */
      setStatus('Redirecting you back to the app…');

      const fullName = googleUser.user_metadata?.full_name || '';
      const nameParts = fullName.split(' ');

      const userParams = new URLSearchParams({
        googleId: googleUser.id || '',
        email: googleUser.email || '',
        firstname: nameParts[0] || '',
        lastname: nameParts.slice(1).join(' ') || '',
        avatarUrl:
          googleUser.user_metadata?.avatar_url ||
          googleUser.user_metadata?.picture ||
          '',
      });

      // appRedirect is already decoded by URLSearchParams.get()
      const link = `${appRedirect}?${userParams.toString()}`;
      setDeepLink(link);

      /* ── 5. Auto-redirect after a short delay ── */
      setTimeout(() => {
        window.location.href = link;
      }, 600);
    } catch (err) {
      console.error('Mobile callback error:', err);
      setError('Something went wrong. Please close this page and try again in the app.');
    }
  }

  /* ── UI ── */
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#0d0d1a',
        color: '#ffffff',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      {/* Logo / Title */}
      <h1
        style={{
          fontSize: '28px',
          fontWeight: '700',
          color: '#c9980b',
          marginBottom: '8px',
          letterSpacing: '2px',
        }}
      >
        JSCI
      </h1>
      <p style={{ color: '#888', fontSize: '14px', marginBottom: '32px' }}>
        Mobile Sign-In
      </p>

      {error ? (
        /* ── Error state ── */
        <div>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              backgroundColor: 'rgba(255,68,68,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
              fontSize: '28px',
            }}
          >
            ✕
          </div>
          <p style={{ color: '#ff6b6b', fontSize: '16px', lineHeight: '1.5' }}>
            {error}
          </p>
          <p
            style={{
              color: '#666',
              fontSize: '13px',
              marginTop: '16px',
            }}
          >
            You can safely close this page.
          </p>
        </div>
      ) : (
        /* ── Loading / Success state ── */
        <div>
          {!deepLink && (
            <div
              style={{
                width: '44px',
                height: '44px',
                border: '3px solid rgba(201,152,11,0.3)',
                borderTopColor: '#c9980b',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
                margin: '0 auto 24px',
              }}
            />
          )}

          <p style={{ fontSize: '16px', color: '#ccc', lineHeight: '1.5' }}>
            {status}
          </p>

          {deepLink && (
            <div style={{ marginTop: '28px' }}>
              <a
                href={deepLink}
                style={{
                  display: 'inline-block',
                  padding: '14px 36px',
                  backgroundColor: '#c9980b',
                  color: '#0d0d1a',
                  borderRadius: '10px',
                  textDecoration: 'none',
                  fontWeight: '700',
                  fontSize: '16px',
                  boxShadow: '0 4px 16px rgba(201,152,11,0.3)',
                }}
              >
                Open JSCI App
              </a>
              <p
                style={{
                  color: '#666',
                  fontSize: '13px',
                  marginTop: '16px',
                }}
              >
                Tap the button above if you&apos;re not redirected automatically.
              </p>
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
