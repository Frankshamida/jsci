'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import './login.css';

export default function LoginPage() {
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState({ message: '', type: '' });

  useEffect(() => {
    // Redirect if already logged in
    const userData = JSON.parse(sessionStorage.getItem('userData') || localStorage.getItem('userData') || '{}');
    if (userData.firstname) {
      router.replace('/dashboard');
      return;
    }
    // Load saved credentials
    const savedUsername = localStorage.getItem('savedUsername');
    const savedPassword = localStorage.getItem('savedPassword');
    if (savedUsername && savedPassword) {
      setUsername(savedUsername);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (rememberMe) {
      localStorage.setItem('savedUsername', username);
      localStorage.setItem('savedPassword', password);
    } else {
      localStorage.removeItem('savedUsername');
      localStorage.removeItem('savedPassword');
    }

    setLoading(true);
    setAlert({ message: '', type: '' });

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
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
                <label htmlFor="username">Username</label>
                <div className="input-wrapper">
                  <span className="input-icon"><i className="fa-solid fa-user"></i></span>
                  <input
                    type="text" id="username" className="form-control"
                    placeholder="Enter your username" required
                    value={username} onChange={(e) => setUsername(e.target.value)}
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
