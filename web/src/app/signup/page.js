'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import './signup.css';

const WELCOME_VERSES = [
  { verse: 'Therefore, if anyone is in Christ, the new creation has come: The old has gone, the new is here!', reference: '2 Corinthians 5:17' },
  { verse: 'For I know the plans I have for you, declares the Lord, plans to prosper you and not to harm you, plans to give you hope and a future.', reference: 'Jeremiah 29:11' },
  { verse: 'See, I am doing a new thing! Now it springs up; do you not perceive it?', reference: 'Isaiah 43:19' },
  { verse: 'The Lord bless you and keep you; the Lord make his face shine on you and be gracious to you.', reference: 'Numbers 6:24-26' },
  { verse: 'You are a chosen people, a royal priesthood, a holy nation, God\'s special possession.', reference: '1 Peter 2:9' },
  { verse: 'And we know that in all things God works for the good of those who love him.', reference: 'Romans 8:28' },
  { verse: 'The joy of the Lord is your strength.', reference: 'Nehemiah 8:10' },
  { verse: 'Delight yourself in the Lord, and he will give you the desires of your heart.', reference: 'Psalm 37:4' },
];

export default function SignupPage() {
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState({ message: '', type: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState({ level: '', text: '' });
  const [confirmError, setConfirmError] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showSignupSplash, setShowSignupSplash] = useState(false);
  const [splashName, setSplashName] = useState('');
  const [splashVerse, setSplashVerse] = useState(WELCOME_VERSES[0]);

  const [form, setForm] = useState({
    firstname: '', lastname: '', birthdate: '',
    email: '', password: '', confirmPassword: '',
    terms: false,
  });

  // Restore form data from sessionStorage (when returning from T&C page)
  useEffect(() => {
    const saved = sessionStorage.getItem('signupFormData');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setForm(parsed);
        // Recalculate password strength if password was saved
        if (parsed.password) {
          let strength = 0;
          if (parsed.password.length >= 8) strength++;
          if (/[a-z]/.test(parsed.password) && /[A-Z]/.test(parsed.password)) strength++;
          if (/\d/.test(parsed.password)) strength++;
          if (/[^a-zA-Z\d]/.test(parsed.password)) strength++;
          if (strength <= 1) setPasswordStrength({ level: 'weak', text: 'Weak password' });
          else if (strength <= 3) setPasswordStrength({ level: 'medium', text: 'Medium password' });
          else setPasswordStrength({ level: 'strong', text: 'Strong password' });
        }
      } catch { /* ignore parse errors */ }
    }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('darkModeEnabled') === 'true';
    setDarkMode(saved);
    if (saved) {
      document.body.classList.add('dark-mode');
      document.documentElement.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
      document.documentElement.classList.remove('dark-mode');
    }
  }, []);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('darkModeEnabled', next);
    document.body.classList.toggle('dark-mode', next);
    document.documentElement.classList.toggle('dark-mode', next);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => {
      const updated = { ...prev, [name]: type === 'checkbox' ? checked : value };
      // Persist form data for navigation preservation
      sessionStorage.setItem('signupFormData', JSON.stringify(updated));
      return updated;
    });

    if (name === 'password') {
      let strength = 0;
      if (value.length >= 8) strength++;
      if (/[a-z]/.test(value) && /[A-Z]/.test(value)) strength++;
      if (/\d/.test(value)) strength++;
      if (/[^a-zA-Z\d]/.test(value)) strength++;
      if (strength <= 1) setPasswordStrength({ level: 'weak', text: 'Weak password' });
      else if (strength <= 3) setPasswordStrength({ level: 'medium', text: 'Medium password' });
      else setPasswordStrength({ level: 'strong', text: 'Strong password' });
    }

    if (name === 'confirmPassword') {
      setConfirmError(value && form.password !== value ? 'Passwords do not match' : '');
    }
  };

  const validateForm = () => {
    if (!form.firstname || !form.lastname || !form.email || !form.password) {
      setAlert({ message: 'Please fill all required fields', type: 'danger' });
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setAlert({ message: 'Please enter a valid email address', type: 'danger' });
      return false;
    }
    if (form.password.length < 8) {
      setAlert({ message: 'Password must be at least 8 characters', type: 'danger' });
      return false;
    }
    if (form.password !== form.confirmPassword) {
      setAlert({ message: 'Passwords do not match', type: 'danger' });
      return false;
    }
    if (!form.terms) {
      setAlert({ message: 'You must agree to the terms and conditions', type: 'danger' });
      return false;
    }
    if (form.birthdate) {
      const birthdate = new Date(form.birthdate);
      const today = new Date();
      let age = today.getFullYear() - birthdate.getFullYear();
      const monthDiff = today.getMonth() - birthdate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthdate.getDate())) age--;
      if (age < 13) {
        setAlert({ message: 'You must be at least 13 years old', type: 'danger' });
        return false;
      }
    }
    return true;
  };

  const handleGoogleSignup = async () => {
    if (!form.terms) {
      setAlert({ message: 'You must agree to the terms and conditions before signing up with Google', type: 'danger' });
      return;
    }
    setGoogleLoading(true);
    setAlert({ message: '', type: '' });
    try {
      const response = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'signup' }),
      });
      const result = await response.json();
      if (result.success && result.url) {
        window.location.href = result.url;
      } else {
        setAlert({ message: result.message || 'Failed to initiate Google sign-up', type: 'danger' });
        setGoogleLoading(false);
      }
    } catch (error) {
      console.error('Google signup error:', error);
      setAlert({ message: 'An error occurred. Please try again.', type: 'danger' });
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setLoading(true);
    setAlert({ message: '', type: '' });

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const result = await response.json();

      if (result.success) {
        sessionStorage.removeItem('signupFormData');
        setSplashName(form.firstname || 'Friend');
        setSplashVerse(WELCOME_VERSES[Math.floor(Math.random() * WELCOME_VERSES.length)]);
        setShowSignupSplash(true);
        setTimeout(() => router.push('/login?email=' + encodeURIComponent(form.email)), 4500);
      } else {
        setAlert({ message: result.message || 'Error creating account', type: 'danger' });
        setLoading(false);
      }
    } catch (error) {
      console.error('Signup error:', error);
      setAlert({ message: 'An error occurred. Please try again.', type: 'danger' });
      setLoading(false);
    }
  };

  return (
    <>
      {/* Signup Success Splash */}
      {showSignupSplash && (
        <div className="signup-splash-overlay">
          {/* Floating particles */}
          <div className="signup-splash-particles">
            {Array.from({ length: 30 }).map((_, i) => (
              <div key={i} className="signup-splash-particle" style={{
                left: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 3}s`,
                animationDuration: `${4 + Math.random() * 5}s`,
              }} />
            ))}
          </div>

          {/* Confetti */}
          <div className="signup-splash-confetti">
            {Array.from({ length: 40 }).map((_, i) => (
              <div key={i} className={`signup-splash-confetti-piece confetti-${(i % 5) + 1}`} style={{
                left: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 2}s`,
                animationDuration: `${3 + Math.random() * 3}s`,
              }} />
            ))}
          </div>

          <div className="signup-splash-content">
            {/* Animated Logo */}
            <div className="signup-splash-logo-ring">
              <div className="signup-splash-logo-glow"></div>
              <img src="/assets/LOGO.png" alt="SanctuaryHub" className="signup-splash-logo" />
            </div>

            {/* Animated Checkmark */}
            <div className="signup-splash-check">
              <svg viewBox="0 0 52 52" className="signup-splash-check-svg">
                <circle cx="26" cy="26" r="25" fill="none" className="signup-splash-check-circle" />
                <path fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8" className="signup-splash-check-path" />
              </svg>
            </div>

            {/* Welcome Text */}
            <h2 className="signup-splash-greeting">
              Welcome to the family, <span>{splashName}!</span>
            </h2>
            <p className="signup-splash-subtitle">
              Your account has been created successfully 🎉
            </p>

            {/* Verse Card */}
            <div className="signup-splash-verse-card">
              <div className="signup-splash-verse-glow"></div>
              <i className="fas fa-quote-left signup-splash-quote-icon"></i>
              <p className="signup-splash-verse-text">&ldquo;{splashVerse.verse}&rdquo;</p>
              <p className="signup-splash-verse-ref">&mdash; {splashVerse.reference}</p>
            </div>

            {/* Progress bar */}
            <div className="signup-splash-loader">
              <div className="signup-splash-loader-bar"></div>
            </div>
            <p className="signup-splash-redirect">Taking you to sign in...</p>
          </div>
        </div>
      )}

      <button className="dark-mode-toggle" onClick={toggleDarkMode} title="Toggle Dark Mode">
        <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`}></i>
      </button>

      <a href="/" className="signup-back-link">
        <i className="fas fa-arrow-left"></i> Home
      </a>

      <div className="signup-page">
        <div className="signup-container">
          {/* ---- LEFT PANEL ---- */}
          <div className="signup-panel-left">
            <div className="signup-panel-brand">
              <img src="/assets/LOGO.png" alt="SanctuaryHub Logo" />
              <div className="signup-panel-brand-text">
                SanctuaryHub
              </div>
            </div>

            <div className="signup-panel-message">
              <h2>Begin your<br /><em>journey of faith</em></h2>
              <div className="signup-panel-message-sub">
                <p>Join a vibrant community of believers growing together in worship, fellowship, and purpose.</p>
              </div>
            </div>

            <div className="signup-panel-footer">
              &copy; {new Date().getFullYear()} SanctuaryHub &mdash; All Rights Reserved
            </div>
          </div>

          {/* ---- RIGHT PANEL (Form) ---- */}
          <div className="signup-panel-right">
            <h1>Create Account</h1>

            {alert.message && (
              <div className={`signup-alert signup-alert-${alert.type}`}>{alert.message}</div>
            )}

            <form onSubmit={handleSubmit}>
              {/* First & Last Name */}
              <div className="signup-field-row">
                <div className="signup-field">
                  <label className="signup-field-label">First Name</label>
                  <input type="text" name="firstname" className="signup-field-input" placeholder="John" required value={form.firstname} onChange={handleChange} />
                </div>
                <div className="signup-field">
                  <label className="signup-field-label">Last Name</label>
                  <input type="text" name="lastname" className="signup-field-input" placeholder="Doe" required value={form.lastname} onChange={handleChange} />
                </div>
              </div>

              {/* Birthdate & Email */}
              <div className="signup-field-row">
                <div className="signup-field">
                  <label className="signup-field-label">Birthdate</label>
                  <input type="date" name="birthdate" className="signup-field-input" required value={form.birthdate} onChange={handleChange} />
                </div>
                <div className="signup-field">
                  <label className="signup-field-label">Email Address</label>
                  <input type="email" name="email" className="signup-field-input" placeholder="john@example.com" required value={form.email} onChange={handleChange} />
                </div>
              </div>

              {/* Password & Confirm Password */}
              <div className="signup-field-row">
                <div className="signup-field">
                  <label className="signup-field-label">Password</label>
                  <div className="signup-field-input-wrap">
                    <input type={showPassword ? 'text' : 'password'} name="password" className="signup-field-input" placeholder="Create password" required value={form.password} onChange={handleChange} />
                    <button type="button" className="signup-field-toggle" onClick={() => setShowPassword(!showPassword)}>
                      <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                    </button>
                  </div>
                  <div className={`signup-strength-wrapper ${form.password ? 'visible' : ''}`}>
                    <div className="signup-strength-bar">
                      <div className={`signup-strength-fill strength-${passwordStrength.level}`}></div>
                    </div>
                    <div className="signup-strength-text" style={{ color: passwordStrength.level === 'weak' ? '#dc3545' : passwordStrength.level === 'medium' ? 'var(--secondary)' : '#28a745' }}>
                      {passwordStrength.text}
                    </div>
                  </div>
                </div>
                <div className="signup-field">
                  <label className="signup-field-label">Confirm Password</label>
                  <div className="signup-field-input-wrap">
                    <input type={showConfirmPassword ? 'text' : 'password'} name="confirmPassword" className="signup-field-input" placeholder="Confirm password" required value={form.confirmPassword} onChange={handleChange} />
                    <button type="button" className="signup-field-toggle" onClick={() => setShowConfirmPassword(!showConfirmPassword)}>
                      <i className={`fa-solid ${showConfirmPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                    </button>
                  </div>
                  <div className={`signup-error-text ${confirmError ? 'visible' : ''}`}>{confirmError || '\u00A0'}</div>
                </div>
              </div>

              {/* Terms */}
              <div className="signup-terms">
                <input type="checkbox" id="terms" name="terms" required checked={form.terms} onChange={handleChange} />
                <label htmlFor="terms">I agree to the <a href="/terms">Terms of Service</a> and <a href="/privacy-policy">Privacy Policy</a></label>
              </div>

              {/* Submit */}
              <button type="submit" className="btn-signup" disabled={loading}>
                {loading ? <i className="fas fa-spinner fa-spin"></i> : 'Create Account'}
              </button>
            </form>

            {/* Divider */}
            <div className="signup-divider">
              <span>or</span>
            </div>

            {/* Google */}
            <button className="btn-google" onClick={handleGoogleSignup} disabled={googleLoading}>
              {googleLoading ? (
                <i className="fas fa-spinner fa-spin"></i>
              ) : (
                <>
                  <svg className="google-icon" viewBox="0 0 24 24" width="20" height="20">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  <span>Sign up with Google</span>
                </>
              )}
            </button>

            {/* Footer */}
            <div className="signup-footer">
              <p>Already have an account? <a href="/login">Sign In</a></p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
