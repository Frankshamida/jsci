'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { Suspense } from 'react';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState('Processing your sign-in...');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const mode = searchParams.get('mode') || 'login';

        // Get the session from Supabase Auth (handles the OAuth code exchange)
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

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

          // Update last login
          await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', existingUser.id);

          const userData = {
            id: existingUser.id,
            memberId: existingUser.member_id,
            firstname: existingUser.firstname,
            lastname: existingUser.lastname,
            email: existingUser.email,
            birthdate: existingUser.birthdate,
            ministry: existingUser.ministry,
            role: existingUser.role || 'Guest',
            status: existingUser.status,
            isActive: existingUser.is_active !== false,
            isGoogleUser: true,
            hasPassword: existingUser.password !== 'GOOGLE_AUTH',
          };

          sessionStorage.setItem('userData', JSON.stringify(userData));
          setStatus('Login successful! Redirecting...');
          setTimeout(() => router.push('/dashboard'), 1000);
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
          ministry: newUser.ministry,
          role: newUser.role || 'Guest',
          status: newUser.status,
          isActive: newUser.is_active !== false,
          isGoogleUser: true,
          hasPassword: false,
        };

        sessionStorage.setItem('userData', JSON.stringify(userData));
        setStatus('Account created! Redirecting...');
        setTimeout(() => router.push('/dashboard'), 1000);

      } catch (error) {
        console.error('Auth callback error:', error);
        setStatus('An error occurred. Redirecting...');
        setTimeout(() => router.push('/login?error=unknown'), 2000);
      }
    };

    handleCallback();
  }, [router, searchParams]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      background: 'linear-gradient(135deg, #f5f7fa 0%, #e4edf5 100%)',
      fontFamily: "'Poppins', sans-serif",
    }}>
      <div style={{
        background: 'white',
        padding: '40px',
        borderRadius: '16px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.1)',
        textAlign: 'center',
        maxWidth: '400px',
        width: '90%',
      }}>
        <div style={{
          width: '50px',
          height: '50px',
          border: '4px solid #e0e0e0',
          borderTop: '4px solid #926c15',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          margin: '0 auto 20px',
        }}></div>
        <p style={{ color: '#333', fontSize: '1rem', fontWeight: '500' }}>{status}</p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
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
        background: 'linear-gradient(135deg, #f5f7fa 0%, #e4edf5 100%)',
      }}>
        <p>Loading...</p>
      </div>
    }>
      <AuthCallbackContent />
    </Suspense>
  );
}
