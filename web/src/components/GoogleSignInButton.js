'use client';

// Google's own "Sign in with Google" button, signing in on this site.
//
// The old way went through Supabase's sign-in page, and Google names the site
// a sign-in returns to - so the account chooser read "to continue to
// okgootzwaklvzywtbwub.supabase.co". With Google's button (Google Identity
// Services) the sign-in happens here: Google hands back an ID token, Supabase
// takes it through signInWithIdToken, and Google names this site instead.
// /auth/callback then does what it always did - finds or creates the account
// and shows the welcome - from the session this leaves behind.
//
// It switches on with NEXT_PUBLIC_GOOGLE_CLIENT_ID: the Web client ID that
// Supabase's Google provider uses, with this site listed under that client's
// Authorized JavaScript origins in Google Cloud. Until it is set, or when
// Google's script cannot load, the page's own button (the old redirect) shows.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
const GSI_SRC = 'https://accounts.google.com/gsi/client';

let gsiLoading = null;
function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (!gsiLoading) {
    gsiLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GSI_SRC;
      script.async = true;
      script.onload = () => (window.google?.accounts?.id
        ? resolve(window.google.accounts.id)
        : reject(new Error('Google sign-in did not start.')));
      script.onerror = () => reject(new Error('Google sign-in could not load.'));
      document.head.appendChild(script);
      setTimeout(() => reject(new Error('Google sign-in took too long to load.')), 10000);
    });
    gsiLoading.catch(() => { gsiLoading = null; });
  }
  return gsiLoading;
}

const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

// Google signs the hashed nonce into the ID token; Supabase is given the raw
// one and checks the two match, so a token cannot be replayed from elsewhere.
async function makeNonce() {
  const raw = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const hashed = toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
  return { raw, hashed };
}

const overlay = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export default function GoogleSignInButton({ mode = 'login', dark = false, locked = false, onLocked, onProblem, children }) {
  const router = useRouter();
  const slot = useRef(null);
  const nonce = useRef(null);
  const latest = useRef({ mode, onProblem });
  latest.current = { mode, onProblem };
  // loading -> ready -> busy (after an account is picked); off = use children.
  const [state, setState] = useState(CLIENT_ID ? 'loading' : 'off');

  useEffect(() => {
    if (!CLIENT_ID) return undefined;
    let cancelled = false;

    const prepare = async () => {
      try {
        const id = await loadGoogleIdentity();
        const fresh = await makeNonce();
        if (cancelled || !slot.current) return;
        const signup = latest.current.mode === 'signup';
        nonce.current = fresh;
        id.initialize({
          client_id: CLIENT_ID,
          callback: handleCredential,
          nonce: fresh.hashed,
          ux_mode: 'popup',
          auto_select: false,
          context: signup ? 'signup' : 'signin',
          itp_support: true,
        });
        slot.current.innerHTML = '';
        id.renderButton(slot.current, {
          type: 'standard',
          size: 'large',
          shape: 'rectangular',
          logo_alignment: 'center',
          theme: dark ? 'filled_black' : 'outline',
          text: signup ? 'signup_with' : 'continue_with',
          locale: 'en', // the site is in English; Google would follow the visitor's region
          // Google draws the button between 200 and 400 pixels wide.
          width: Math.max(200, Math.min(400, Math.round(slot.current.offsetWidth || 320))),
        });
        setState('ready');
      } catch (err) {
        if (!cancelled) {
          console.warn('Google button unavailable, using the redirect:', err?.message || err);
          setState('off');
        }
      }
    };

    async function handleCredential({ credential }) {
      setState('busy');
      try {
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
          auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
        });
        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: credential,
          nonce: nonce.current?.raw,
        });
        if (error) throw error;
        router.replace(`/auth/callback?mode=${latest.current.mode === 'signup' ? 'signup' : 'login'}`);
      } catch (err) {
        console.error('Google sign-in error:', err);
        latest.current.onProblem?.('Google sign-in did not go through. Please try again.');
        setState('ready');
        prepare(); // a fresh nonce for the next try
      }
    }

    prepare();
    return () => { cancelled = true; };
  }, [dark, router]);

  if (state === 'off') return children ?? null;

  return (
    <div style={{ position: 'relative', minHeight: 44 }}>
      <div
        ref={slot}
        style={{ display: 'flex', justifyContent: 'center', minHeight: 44, opacity: locked ? 0.55 : 1, transition: 'opacity 0.2s ease' }}
      />
      {locked && state === 'ready' && (
        <button
          type="button"
          onClick={onLocked}
          aria-label="Agree to the terms first to sign up with Google"
          style={{ ...overlay, zIndex: 2, background: 'transparent', border: 0, cursor: 'not-allowed' }}
        />
      )}
      {state === 'busy' && (
        <div
          role="status"
          style={{
            ...overlay,
            zIndex: 3,
            borderRadius: 4,
            fontSize: '0.9rem',
            fontWeight: 600,
            color: dark ? '#fff' : '#3c4043',
            background: dark ? 'rgba(20, 20, 30, 0.9)' : 'rgba(255, 255, 255, 0.92)',
          }}
        >
          Signing you in…
        </div>
      )}
    </div>
  );
}
