'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import './login.css';

export default function LoginPage() {
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [alert, setAlert] = useState({ message: '', type: '' });

  useEffect(() => {
    // Redirect if already logged in
    const userData = JSON.parse(sessionStorage.getItem('userData') || localStorage.getItem('userData') || '{}');
    if (userData.firstname) {
      router.replace('/dashboard');
      return;
    }
    // Load saved credentials
    const savedEmail = localStorage.getItem('savedEmail');
    const savedPassword = localStorage.getItem('savedPassword');
    if (savedEmail && savedPassword) {
      setEmail(savedEmail);
      setPassword(savedPassword);
      setRememberMe(true);
    }
    // Dark mode
    const saved = localStorage.getItem('darkModeEnabled') === 'true';
    setDarkMode(saved);
    if (saved) document.body.classList.add('dark-mode');
  }, [router]);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('darkModeEnabled', next);
    document.body.classList.toggle('dark-mode', next);
  };

  const showAlert = (message, type) => {
    setAlert({ message, type });
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    setAlert({ message: '', type: '' });
    try {
      const response = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'login' }),
      });
      const result = await response.json();
      if (result.success && result.url) {
        window.location.href = result.url;
      } else {
        showAlert(result.message || 'Failed to initiate Google sign-in', 'danger');
        setGoogleLoading(false);
      }
    } catch (error) {
      console.error('Google login error:', error);
      showAlert('An error occurred. Please try again.', 'danger');
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (rememberMe) {
      localStorage.setItem('savedEmail', email);
      localStorage.setItem('savedPassword', password);
    } else {
      localStorage.removeItem('savedEmail');
      localStorage.removeItem('savedPassword');
    }

    setLoading(true);
    setAlert({ message: '', type: '' });

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const result = await response.json();

      if (result.success) {
        sessionStorage.setItem('userData', JSON.stringify(result.data));
        showAlert('Login successful! Redirecting...', 'success');
        setTimeout(() => router.push('/dashboard'), 1000);
      } else {
        showAlert(result.message || 'Invalid username or password', 'danger');
        setLoading(false);
      }
    } catch (error) {
      console.error('Login error:', error);
      showAlert('An error occurred. Please try again.', 'danger');
      setLoading(false);
    }
  };

  return (
    <>
      <button className="dark-mode-toggle" onClick={toggleDarkMode} title="Toggle Dark Mode">
        <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`}></i>
      </button>

      <div className="login-page">
        <div className="login-container">
          <div className="login-header">
            <div className="logo"></div>
            <h1>JOYFUL SOUND CHURCH</h1>
            <p>INTERNATIONAL</p>
          </div>

          <div className="login-body">
            {alert.message && (
              <div className={`alert alert-${alert.type} show`}>{alert.message}</div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="email">Email Address</label>
                <div className="input-wrapper">
                  <span className="input-icon"><i className="fa-solid fa-envelope"></i></span>
                  <input
                    type="email" id="email" className="form-control"
                    placeholder="Enter your email address" required
                    value={email} onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="password">Password</label>
                <div className="input-wrapper">
                  <span className="input-icon"><i className="fa-solid fa-lock"></i></span>
                  <input
                    type={showPassword ? 'text' : 'password'} id="password" className="form-control"
                    placeholder="Enter your password" required
                    value={password} onChange={(e) => setPassword(e.target.value)}
                  />
                  <span className="password-toggle" onClick={() => setShowPassword(!showPassword)}>
                    <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                  </span>
                </div>
              </div>

              <div className="checkbox-group">
                <input type="checkbox" id="rememberMe" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                <label htmlFor="rememberMe">Remember me</label>
              </div>

              <button type="submit" className="btn-login" disabled={loading}>
                {loading ? <div className="spinner" style={{ display: 'block' }}></div> : <span>Login</span>}
              </button>
            </form>

            <div className="divider">
              <span>or</span>
            </div>

            <button className="btn-google" onClick={handleGoogleLogin} disabled={googleLoading}>
              {googleLoading ? (
                <div className="spinner" style={{ display: 'block' }}></div>
              ) : (
                <>
                  <svg className="google-icon" viewBox="0 0 24 24" width="20" height="20">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  <span>Sign in with Google</span>
                </>
              )}
            </button>

            <div className="login-footer">
              <p>Don&apos;t have an account? <a href="/signup">Sign Up</a></p>
              <p style={{ marginTop: '8px' }}>
                <a href="/forgot-password" style={{ fontSize: '0.9rem' }}>Forgot Password?</a>
              </p>
              <p style={{ marginTop: '12px' }}>
                <a href="/" style={{ fontSize: '0.9rem', color: 'var(--primary)', fontWeight: '600', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <i className="fas fa-arrow-left" style={{ fontSize: '0.8rem' }}></i> Back to Homepage
                </a>
              </p>
              <p style={{ marginTop: '10px', fontSize: '0.8rem', color: '#999' }}>
                &copy; {new Date().getFullYear()} Joyful Sound Church International. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
