'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import '../committee-auth.css';

// One account, two doors. What is created here is an ordinary SanctuaryHub
// account in the same users table as the main registration - it signs in on
// the member site immediately, and on this portal as soon as an Admin adds the
// person to the committee.

export default function CommitteeSignupPage() {
  const router = useRouter();

  const [darkMode, setDarkMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState({ message: '', type: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [strength, setStrength] = useState({ level: '', text: '' });
  const [confirmError, setConfirmError] = useState('');
  const [done, setDone] = useState(false);

  const [form, setForm] = useState({
    firstname: '', lastname: '', birthdate: '',
    email: '', password: '', confirmPassword: '', terms: false,
  });

  useEffect(() => {
    const dark = localStorage.getItem('darkModeEnabled') === 'true';
    setDarkMode(dark);
    document.body.classList.toggle('dark-mode', dark);
    document.documentElement.classList.toggle('dark-mode', dark);
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
    const val = type === 'checkbox' ? checked : value;
    setForm((prev) => ({ ...prev, [name]: val }));

    if (name === 'password') {
      let score = 0;
      if (value.length >= 8) score++;
      if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
      if (/\d/.test(value)) score++;
      if (/[^a-zA-Z\d]/.test(value)) score++;
      if (score <= 1) setStrength({ level: 'weak', text: 'Weak password' });
      else if (score <= 3) setStrength({ level: 'medium', text: 'Medium password' });
      else setStrength({ level: 'strong', text: 'Strong password' });
      setConfirmError(form.confirmPassword && form.confirmPassword !== value ? 'Passwords do not match' : '');
    }

    if (name === 'confirmPassword') {
      setConfirmError(value && form.password !== value ? 'Passwords do not match' : '');
    }
  };

  const validate = () => {
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
      const b = new Date(form.birthdate);
      const now = new Date();
      let age = now.getFullYear() - b.getFullYear();
      const m = now.getMonth() - b.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
      if (age < 13) {
        setAlert({ message: 'You must be at least 13 years old', type: 'danger' });
        return false;
      }
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setAlert({ message: '', type: '' });

    try {
      const response = await fetch('/api/event-committee/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const result = await response.json();

      if (result.success) {
        setDone(true);
        setTimeout(() => router.push(`/event-committee/login?pending=1&email=${encodeURIComponent(form.email)}`), 4000);
        return;
      }

      // An existing account is not a failure to apologise for — it is the
      // shared-credentials design working, so it reads as information and
      // points at the sign-in page.
      setAlert({
        type: result.code === 'ACCOUNT_EXISTS' ? 'info' : 'danger',
        message: result.message || 'Error creating account',
      });
      setLoading(false);
    } catch (error) {
      console.error('Committee signup error:', error);
      setAlert({ message: 'An error occurred. Please try again.', type: 'danger' });
      setLoading(false);
    }
  };

  return (
    <>
      {done && (
        <div className="ec-splash">
          <div className="ec-splash-content">
            <img src="/assets/LOGO.png" alt="SanctuaryHub" className="ec-splash-logo" />
            <svg viewBox="0 0 52 52" className="ec-splash-check-svg">
              <circle cx="26" cy="26" r="25" fill="none" className="ec-splash-check-circle" />
              <path fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8" className="ec-splash-check-path" />
            </svg>
            <h2>You&apos;re registered, <span>{form.firstname}!</span></h2>
            <p>
              Your account works on the main site right now. An Admin has been asked to add you to the
              Event Committee — once they do, sign in here with this same email and password.
            </p>
            <div className="ec-splash-loader"><div className="ec-splash-loader-bar" /></div>
          </div>
        </div>
      )}

      <button className="dark-mode-toggle" onClick={toggleDarkMode} title="Toggle Dark Mode">
        <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`}></i>
      </button>

      <a href="/event-committee/login" className="ec-back-link">
        <i className="fas fa-arrow-left"></i> Committee Sign In
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
              <div className="ec-badge"><i className="fas fa-user-plus"></i> Join the Committee</div>
              <h2>One account,<br /><em>both doors.</em></h2>
              <div className="ec-panel-message-sub">
                <p>The account you make here is your ordinary SanctuaryHub account — same email, same password, on the member site and on this portal.</p>
              </div>
              <ul className="ec-panel-points">
                <li><i className="fas fa-circle-check"></i> Works on the main site straight away</li>
                <li><i className="fas fa-user-shield"></i> An Admin adds you to the committee</li>
                <li><i className="fas fa-key"></i> Nothing extra to remember</li>
              </ul>
            </div>

            <div className="ec-panel-footer">&copy; {new Date().getFullYear()} SanctuaryHub</div>
          </div>

          <div className="ec-panel-right">
            <h1>Create Committee Account</h1>
            <p className="ec-sub">Already registered on the main site? Skip this — just sign in.</p>

            {alert.message && (
              <div className={`ec-alert ec-alert-${alert.type}`}>
                <i className={`fas ${alert.type === 'danger' ? 'fa-circle-exclamation' : 'fa-circle-info'}`}></i>
                <span>
                  {alert.message}
                  {alert.type === 'info' && <> <a href={`/event-committee/login?email=${encodeURIComponent(form.email)}`}>Go to sign in</a></>}
                </span>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="ec-field-row">
                <div className="ec-field">
                  <label className="ec-label">First Name</label>
                  <input type="text" name="firstname" className="ec-input" placeholder="John" required value={form.firstname} onChange={handleChange} />
                </div>
                <div className="ec-field">
                  <label className="ec-label">Last Name</label>
                  <input type="text" name="lastname" className="ec-input" placeholder="Doe" required value={form.lastname} onChange={handleChange} />
                </div>
              </div>

              <div className="ec-field-row">
                <div className="ec-field">
                  <label className="ec-label">Birthdate</label>
                  <input type="date" name="birthdate" className="ec-input" required value={form.birthdate} onChange={handleChange} />
                </div>
                <div className="ec-field">
                  <label className="ec-label">Email Address</label>
                  <input type="email" name="email" className="ec-input" placeholder="john@example.com" required value={form.email} onChange={handleChange} />
                </div>
              </div>

              <div className="ec-field-row">
                <div className="ec-field">
                  <label className="ec-label">Password</label>
                  <div className="ec-input-wrap">
                    <input type={showPassword ? 'text' : 'password'} name="password" className="ec-input" placeholder="Create password" required value={form.password} onChange={handleChange} />
                    <button type="button" className="ec-toggle" onClick={() => setShowPassword(!showPassword)}>
                      <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                    </button>
                  </div>
                  <div className={`ec-strength ${form.password ? 'visible' : ''}`}>
                    <div className="ec-strength-bar">
                      <div className={`ec-strength-fill strength-${strength.level}`}></div>
                    </div>
                    <div
                      className="ec-strength-text"
                      style={{ color: strength.level === 'weak' ? '#dc3545' : strength.level === 'medium' ? 'var(--secondary)' : '#28a745' }}
                    >
                      {strength.text}
                    </div>
                  </div>
                </div>
                <div className="ec-field">
                  <label className="ec-label">Confirm Password</label>
                  <div className="ec-input-wrap">
                    <input type={showConfirm ? 'text' : 'password'} name="confirmPassword" className="ec-input" placeholder="Confirm password" required value={form.confirmPassword} onChange={handleChange} />
                    <button type="button" className="ec-toggle" onClick={() => setShowConfirm(!showConfirm)}>
                      <i className={`fa-solid ${showConfirm ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                    </button>
                  </div>
                  <div className={`ec-error-text ${confirmError ? 'visible' : ''}`}>{confirmError || ' '}</div>
                </div>
              </div>

              <div className="ec-terms">
                <input type="checkbox" id="ec-terms" name="terms" required checked={form.terms} onChange={handleChange} />
                <label htmlFor="ec-terms">
                  I agree to the <a href="/terms">Terms of Service</a> and <a href="/privacy-policy">Privacy Policy</a>
                </label>
              </div>

              <button type="submit" className="ec-submit" disabled={loading}>
                {loading ? <i className="fas fa-spinner fa-spin"></i> : 'Create Account'}
              </button>
            </form>

            <div className="ec-note" style={{ marginTop: 20, marginBottom: 0 }}>
              Creating an account does not put you on the committee by itself. An <strong>Admin</strong> reviews
              the list and adds you — you will get a notification when they do.
            </div>

            <div className="ec-footer">
              <p>Already have an account? <a href="/event-committee/login">Committee sign in</a></p>
              <p>Not committee? <a href="/signup">Register as a member</a></p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
