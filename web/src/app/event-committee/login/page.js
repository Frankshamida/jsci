'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import '../committee-auth.css';

// The committee's own front door. It takes the SAME email and password the
// person registered with on the main site - there is no separate committee
// credential anywhere in this app - and lands them on a committee dashboard
// instead of the member one.

export default function CommitteeLoginPage() {
  return (
    <Suspense fallback={null}>
      <CommitteeLoginContent />
    </Suspense>
  );
}

function CommitteeLoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [darkMode, setDarkMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState({ message: '', type: '' });
  const [splash, setSplash] = useState(null);

  useEffect(() => {
    // Already signed in to the committee portal — go straight through.
    try {
      const saved = JSON.parse(sessionStorage.getItem('committeeUser') || localStorage.getItem('committeeUser') || '{}');
      if (saved.id) { router.replace('/event-committee/dashboard'); return; }
    } catch { /* corrupt storage — treat as signed out */ }

    try {
      if (localStorage.getItem('ecRememberMe') === 'true') {
        setEmail(localStorage.getItem('ecSavedEmail') || '');
        setRememberMe(true);
      }
    } catch { /* private browsing — skip the pre-fill */ }

    const emailParam = searchParams.get('email');
    if (emailParam) setEmail(emailParam);
    // Sent here by the committee signup page after making an account.
    if (searchParams.get('pending') === '1') {
      setAlert({
        type: 'info',
        message: 'Your account is ready. You can sign in as soon as an Admin adds you to the Event Committee.',
      });
    }

    const dark = localStorage.getItem('darkModeEnabled') === 'true';
    setDarkMode(dark);
    document.body.classList.toggle('dark-mode', dark);
    document.documentElement.classList.toggle('dark-mode', dark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('darkModeEnabled', next);
    document.body.classList.toggle('dark-mode', next);
    document.documentElement.classList.toggle('dark-mode', next);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setAlert({ message: '', type: '' });

    // Only the email is remembered here. The committee portal is opened on
    // shared phones at a registration table, so a saved password would be one
    // tap away from anyone who picks the device up.
    try {
      if (rememberMe) {
        localStorage.setItem('ecRememberMe', 'true');
        localStorage.setItem('ecSavedEmail', email.trim());
      } else {
        localStorage.removeItem('ecRememberMe');
        localStorage.removeItem('ecSavedEmail');
      }
    } catch { /* storage unavailable — sign in anyway */ }

    try {
      const response = await fetch('/api/event-committee/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const result = await response.json();

      if (result.success) {
        sessionStorage.setItem('committeeUser', JSON.stringify(result.data));
        localStorage.setItem('committeeUser', JSON.stringify(result.data));
        setSplash(result.data);
        setTimeout(() => router.push('/event-committee/dashboard'), 1800);
        return;
      }

      setAlert({
        type: result.code === 'NOT_COMMITTEE' ? 'info' : 'danger',
        message: result.message || 'Invalid email or password',
      });
      setLoading(false);
    } catch (error) {
      console.error('Committee login error:', error);
      setAlert({ message: 'An error occurred. Please try again.', type: 'danger' });
      setLoading(false);
    }
  };

  return (
    <>
      {splash && (
        <div className="ec-splash">
          <div className="ec-splash-content">
            <img src="/assets/LOGO.png" alt="SanctuaryHub" className="ec-splash-logo" />
            <svg viewBox="0 0 52 52" className="ec-splash-check-svg">
              <circle cx="26" cy="26" r="25" fill="none" className="ec-splash-check-circle" />
              <path fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8" className="ec-splash-check-path" />
            </svg>
            <h2>Welcome, <span>{splash.firstname}!</span></h2>
            <p>
              {splash.isEventManager
                ? 'Signed in with full event management access.'
                : 'Signed in to the Event Committee portal.'}
            </p>
            <div className="ec-splash-loader"><div className="ec-splash-loader-bar" /></div>
          </div>
        </div>
      )}

      <button className="dark-mode-toggle" onClick={toggleDarkMode} title="Toggle Dark Mode">
        <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`}></i>
      </button>

      <a href="/" className="ec-back-link">
        <i className="fas fa-arrow-left"></i> Back to Home
      </a>

      <div className="ec-auth">
        <div className="ec-card">
          <div className="ec-panel-left">
            <div className="ec-brand">
              <img src="/assets/LOGO.png" alt="Joyful Sound Church International Logo" />
              <div className="ec-brand-text">
                Joyful Sound Church
                <span>International</span>
              </div>
            </div>

            <div className="ec-panel-message">
              <div className="ec-badge"><i className="fas fa-clipboard-check"></i> Event Committee</div>
              <h2>Run the day<br /><em>from the door.</em></h2>
              <div className="ec-panel-message-sub">
                <p>Check attendees in, confirm payments and keep the roster straight — all from one screen.</p>
              </div>
              <ul className="ec-panel-points">
                <li><i className="fas fa-qrcode"></i> Scan QR codes to check people in</li>
                <li><i className="fas fa-peso-sign"></i> Verify payments and record installments</li>
                <li><i className="fas fa-user-plus"></i> Add attendees on the spot</li>
              </ul>
            </div>

            <div className="ec-panel-footer">&copy; {new Date().getFullYear()} SanctuaryHub</div>
          </div>

          <div className="ec-panel-right">
            <h1>Committee Sign In</h1>
            <p className="ec-sub">Use the same email and password as your main SanctuaryHub account.</p>

            {alert.message && (
              <div className={`ec-alert ec-alert-${alert.type}`}>
                <i className={`fas ${alert.type === 'danger' ? 'fa-circle-exclamation' : 'fa-circle-info'}`}></i>
                <span>{alert.message}</span>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="ec-field">
                <label className="ec-label">Email Address</label>
                <input
                  type="email"
                  className="ec-input"
                  placeholder="name@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="ec-field">
                <label className="ec-label">Password</label>
                <div className="ec-input-wrap">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="ec-input"
                    placeholder="••••••••"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button type="button" className="ec-toggle" onClick={() => setShowPassword(!showPassword)}>
                    <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                  </button>
                </div>
              </div>

              <div className="ec-options-row">
                <label className="ec-remember">
                  <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                  <span>Remember my email</span>
                </label>
                <a href="/forgot-password" className="ec-forgot">Forgot Password?</a>
              </div>

              <button type="submit" className="ec-submit" disabled={loading}>
                {loading ? <i className="fas fa-spinner fa-spin"></i> : 'Sign In to Committee'}
              </button>
            </form>

            <div className="ec-divider"><span>New here?</span></div>

            <div className="ec-note">
              Already registered on the main site? <strong>That account works here</strong> — nothing else to
              create. An Admin just has to add you to the committee.
            </div>

            <div className="ec-footer">
              <p>No account yet? <a href="/event-committee/signup">Create one</a></p>
              <p>Looking for the member dashboard? <a href="/login">Member sign in</a></p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
