'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { Suspense } from 'react';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const CALLBACK_VERSES = [
  { verse: 'The Lord bless you and keep you; the Lord make his face shine on you and be gracious to you.', reference: 'Numbers 6:24-25' },
  { verse: 'I can do all this through him who gives me strength.', reference: 'Philippians 4:13' },
  { verse: 'For I know the plans I have for you, declares the Lord, plans to prosper you and not to harm you.', reference: 'Jeremiah 29:11' },
  { verse: 'The Lord is my shepherd, I lack nothing.', reference: 'Psalm 23:1' },
  { verse: 'Be strong and courageous. Do not be afraid; do not be discouraged, for the Lord your God will be with you wherever you go.', reference: 'Joshua 1:9' },
  { verse: 'Trust in the Lord with all your heart and lean not on your own understanding.', reference: 'Proverbs 3:5' },
  { verse: 'But those who hope in the Lord will renew their strength. They will soar on wings like eagles.', reference: 'Isaiah 40:31' },
  { verse: 'Come to me, all you who are weary and burdened, and I will give you rest.', reference: 'Matthew 11:28' },
];

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState('Processing your sign-in...');
  const [showSplash, setShowSplash] = useState(false);
  const [splashName, setSplashName] = useState('');
  const [splashVerse, setSplashVerse] = useState(CALLBACK_VERSES[0]);
  const [splashType, setSplashType] = useState('login'); // 'login' or 'signup'

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
          auth: {
            detectSessionInUrl: true,
            flowType: 'implicit',
            persistSession: true,
          },
        });
        const mode = searchParams.get('mode') || 'login';

        // Wait for the session from URL hash using onAuthStateChange
        // This reliably handles the OAuth token fragments in the URL
        const { session, error: sessionError } = await new Promise((resolve) => {
          let resolved = false;

          const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            // INITIAL_SESSION fires when the client finishes loading the session
            // SIGNED_IN fires when a new sign-in is detected from URL tokens
            if (!resolved && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) {
              if (session) {
                resolved = true;
                subscription.unsubscribe();
                resolve({ session, error: null });
              } else if (event === 'INITIAL_SESSION') {
                // INITIAL_SESSION with no session means no tokens were found
                resolved = true;
                subscription.unsubscribe();
                resolve({ session: null, error: { message: 'No session found' } });
              }
            }
          });

          // Safety timeout — if nothing fires in 10 seconds, fall back to getSession
          setTimeout(async () => {
            if (!resolved) {
              resolved = true;
              subscription.unsubscribe();
              const { data, error } = await supabase.auth.getSession();
              resolve({ session: data?.session || null, error });
            }
          }, 10000);
        });

        if (sessionError || !session) {
          setStatus('Authentication failed. Redirecting...');
          setTimeout(() => router.push(`/${mode === 'signup' ? 'signup' : 'login'}?error=auth_failed`), 2000);
          return;
        }

        const googleUser = session.user;
        const email = googleUser.email;
        const fullName = googleUser.user_metadata?.full_name || '';
        const nameParts = fullName.split(' ');
        const firstname = nameParts[0] || '';
        const lastname = nameParts.slice(1).join(' ') || '';
        const googleAvatarUrl = googleUser.user_metadata?.avatar_url || googleUser.user_metadata?.picture || null;

        // Check if a user with this email/google_id already exists in our users table
        const { data: existingUser, error: lookupError } = await supabase
          .from('users')
          .select('*')
          .eq('google_id', googleUser.id)
          .single();

        if (existingUser) {
          // User exists — log them in
          if (existingUser.is_active === false) {
            setStatus('Account has been deactivated. Contact admin.');
            setTimeout(() => router.push('/login?error=deactivated'), 2000);
            return;
          }

          // Update last login + sync Google profile picture
          const updateFields = { last_login: new Date().toISOString() };
          if (googleAvatarUrl) updateFields.profile_picture = googleAvatarUrl;
          if (fullName && !existingUser.firstname) updateFields.firstname = firstname;
          if (fullName && !existingUser.lastname) updateFields.lastname = lastname;
          await supabase.from('users').update(updateFields).eq('id', existingUser.id);

          const userData = {
            id: existingUser.id,
            memberId: existingUser.member_id,
            firstname: existingUser.firstname,
            lastname: existingUser.lastname,
            email: existingUser.email,
            birthdate: existingUser.birthdate,
            life_verse: existingUser.life_verse || null,
            ministry: existingUser.ministry,
            sub_role: existingUser.sub_role || null,
            role: existingUser.role || 'Guest',
            status: existingUser.status,
            isActive: existingUser.is_active !== false,
            isGoogleUser: true,
            hasPassword: existingUser.password !== 'GOOGLE_AUTH',
            profile_picture: googleAvatarUrl || existingUser.profile_picture || null,
            allowed_event_types: existingUser.allowed_event_types || [],
          };

          sessionStorage.setItem('userData', JSON.stringify(userData));
          localStorage.setItem('userData', JSON.stringify(userData));
          setSplashName(userData.firstname || 'Friend');
          setSplashVerse(CALLBACK_VERSES[Math.floor(Math.random() * CALLBACK_VERSES.length)]);
          setSplashType('login');
          setShowSplash(true);
          setTimeout(() => router.push('/dashboard'), 3000);
          return;
        }

        // No existing user found
        if (mode === 'login') {
          // On login mode, if no account exists, redirect to signup
          setStatus('No account found. Please sign up first.');
          setTimeout(() => router.push('/signup?error=no_account&google=true'), 2000);
          return;
        }

        // Signup mode — create new user in our users table
        const { data: newUser, error: insertError } = await supabase
          .from('users')
          .insert({
            firstname: firstname,
            lastname: lastname,
            google_id: googleUser.id,
            email: email,
            password: 'GOOGLE_AUTH',
            role: 'Guest',
            security_question: 'Google Account',
            security_answer: 'GOOGLE_AUTH',
            status: 'Unverified',
            profile_picture: googleAvatarUrl,
          })
          .select()
          .single();

        if (insertError) {
          console.error('Error creating user:', insertError);
          setStatus('Error creating account. Please try again.');
          setTimeout(() => router.push('/signup?error=create_failed'), 2000);
          return;
        }

        const userData = {
          id: newUser.id,
          memberId: newUser.member_id,
          firstname: newUser.firstname,
          lastname: newUser.lastname,
          email: newUser.email,
          birthdate: newUser.birthdate,
          life_verse: newUser.life_verse || null,
          ministry: newUser.ministry,
          sub_role: newUser.sub_role || null,
          role: newUser.role || 'Guest',
          status: newUser.status,
          isActive: newUser.is_active !== false,
          isGoogleUser: true,
          hasPassword: false,
          profile_picture: googleAvatarUrl || null,
          allowed_event_types: newUser.allowed_event_types || [],
        };

        sessionStorage.setItem('userData', JSON.stringify(userData));
        localStorage.setItem('userData', JSON.stringify(userData));
        setSplashName(userData.firstname || 'Friend');
        setSplashVerse(CALLBACK_VERSES[Math.floor(Math.random() * CALLBACK_VERSES.length)]);
        setSplashType('signup');
        setShowSplash(true);
        setTimeout(() => router.push('/dashboard'), 3000);

      } catch (error) {
        console.error('Auth callback error:', error);
        setStatus('An error occurred. Redirecting...');
        setTimeout(() => router.push('/login?error=unknown'), 2000);
      }
    };

    handleCallback();
  }, [router, searchParams]);

  return (
    <>
      {showSplash ? (
        <div className="login-splash-overlay" style={{
          position: 'fixed', inset: 0, zIndex: 99999,
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 40%, #0f3460 100%)',
          display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
          fontFamily: "'Montserrat', 'Poppins', sans-serif", overflow: 'hidden',
        }}>
          {/* Floating particles */}
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} style={{
                position: 'absolute', bottom: '-10px',
                left: `${Math.random() * 100}%`,
                width: `${4 + Math.random() * 6}px`, height: `${4 + Math.random() * 6}px`,
                background: 'radial-gradient(circle, rgba(255,195,0,0.6), transparent)',
                borderRadius: '50%',
                animation: `splashFloat ${3 + Math.random() * 4}s ease-in infinite`,
                animationDelay: `${Math.random() * 2}s`,
              }} />
            ))}
          </div>

          <div style={{ textAlign: 'center', position: 'relative', zIndex: 1, padding: '0 24px', maxWidth: 420 }}>
            {/* Logo */}
            <div style={{
              width: 100, height: 100, margin: '0 auto 20px', position: 'relative',
              borderRadius: '50%', background: 'rgba(255,195,0,0.1)', border: '3px solid rgba(255,195,0,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'splashLogoIn 0.8s cubic-bezier(0.34,1.56,0.64,1) forwards',
              boxShadow: '0 0 40px rgba(255,195,0,0.15)',
            }}>
              <img src="/assets/LOGO.png" alt="SanctuaryHub" style={{ width: 60, height: 60, objectFit: 'contain' }} />
            </div>

            {/* Checkmark */}
            <div style={{ width: 52, height: 52, margin: '0 auto 16px', animation: 'splashCheckIn 0.6s 0.5s cubic-bezier(0.34,1.56,0.64,1) both' }}>
              <svg viewBox="0 0 52 52" style={{ width: '100%', height: '100%' }}>
                <circle cx="26" cy="26" r="25" fill="none" stroke="#4ade80" strokeWidth="2"
                  style={{ strokeDasharray: 166, strokeDashoffset: 166, animation: 'splashCircle 0.6s 0.7s ease forwards' }} />
                <path fill="none" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                  d="M14.1 27.2l7.1 7.2 16.7-16.8"
                  style={{ strokeDasharray: 48, strokeDashoffset: 48, animation: 'splashCheck 0.4s 1.1s ease forwards' }} />
              </svg>
            </div>

            {/* Greeting */}
            <h2 style={{
              color: '#fff', fontSize: '1.5rem', fontWeight: 700, margin: '0 0 4px',
              fontFamily: "'Playfair Display', serif",
              animation: 'splashFadeUp 0.6s 0.8s ease both',
            }}>
              {splashType === 'signup' ? 'Welcome to the family,' : 'Welcome back,'} <span style={{ color: '#FFC300' }}>{splashName}!</span>
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.9rem', margin: '0 0 24px', animation: 'splashFadeUp 0.6s 1s ease both' }}>
              {splashType === 'signup' ? 'Your account has been created' : 'You\u2019re signed in successfully'}
            </p>

            {/* Verse card */}
            <div style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,195,0,0.2)',
              borderRadius: 16, padding: '20px 24px', margin: '0 auto 28px',
              backdropFilter: 'blur(10px)',
              animation: 'splashFadeUp 0.6s 1.2s ease both',
            }}>
              <i className="fas fa-quote-left" style={{ color: 'rgba(255,195,0,0.4)', fontSize: '1.2rem', marginBottom: 8, display: 'block' }} />
              <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.95rem', lineHeight: 1.7, fontStyle: 'italic', margin: '0 0 10px' }}>
                &ldquo;{splashVerse.verse}&rdquo;
              </p>
              <p style={{ color: '#FFC300', fontSize: '0.8rem', fontWeight: 600, margin: 0 }}>— {splashVerse.reference}</p>
            </div>

            {/* Progress bar */}
            <div style={{
              width: 180, height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 3, margin: '0 auto 12px', overflow: 'hidden',
              animation: 'splashFadeUp 0.6s 1.4s ease both',
            }}>
              <div style={{ width: '100%', height: '100%', background: 'linear-gradient(90deg, #926C15, #FFC300)', borderRadius: 3, animation: 'splashBar 2.5s 0.5s ease-in-out forwards', transformOrigin: 'left', transform: 'scaleX(0)' }} />
            </div>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', animation: 'splashFadeUp 0.6s 1.5s ease both' }}>Entering your dashboard...</p>
          </div>

          <style>{`
            @keyframes splashFloat { 0% { transform: translateY(0) scale(1); opacity: 0; } 10% { opacity: 1; } 100% { transform: translateY(-100vh) scale(0); opacity: 0; } }
            @keyframes splashLogoIn { 0% { transform: scale(0) rotate(-180deg); opacity: 0; } 100% { transform: scale(1) rotate(0); opacity: 1; } }
            @keyframes splashCheckIn { 0% { transform: scale(0); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
            @keyframes splashCircle { to { stroke-dashoffset: 0; } }
            @keyframes splashCheck { to { stroke-dashoffset: 0; } }
            @keyframes splashFadeUp { 0% { transform: translateY(20px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
            @keyframes splashBar { 0% { transform: scaleX(0); } 100% { transform: scaleX(1); } }
          `}</style>
        </div>
      ) : (
        <div style={{
          minHeight: '100vh',
          display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          fontFamily: "'Montserrat', sans-serif",
        }}>
          <div style={{
            textAlign: 'center', padding: '40px', maxWidth: 400, width: '90%',
          }}>
            <div style={{ width: 70, height: 70, margin: '0 auto 24px' }}>
              <img src="/assets/LOGO.png" alt="SanctuaryHub" style={{ width: '100%', height: '100%', objectFit: 'contain', animation: 'splashPulse 2s ease-in-out infinite' }} />
            </div>
            <div style={{
              width: 40, height: 40, border: '3px solid rgba(255,255,255,0.1)', borderTop: '3px solid #FFC300',
              borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 20px',
            }} />
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.95rem', fontWeight: 500 }}>{status}</p>
          </div>
          <style>{`
            @keyframes spin { to { transform: rotate(360deg); } }
            @keyframes splashPulse { 0%, 100% { opacity: 0.7; transform: scale(1); } 50% { opacity: 1; transform: scale(1.05); } }
          `}</style>
        </div>
      )}
    </>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
      }}>
        <div style={{ textAlign: 'center' }}>
          <img src="/assets/LOGO.png" alt="SanctuaryHub" style={{ width: 60, height: 60, objectFit: 'contain', opacity: 0.7, marginBottom: 16 }} />
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem' }}>Loading...</p>
        </div>
      </div>
    }>
      <AuthCallbackContent />
    </Suspense>
  );
}
