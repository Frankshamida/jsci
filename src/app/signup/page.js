'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import './signup.css';

export default function SignupPage() {
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState({ message: '', type: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState({ level: '', text: '' });
  const [confirmError, setConfirmError] = useState('');

  const [form, setForm] = useState({
    firstname: '', lastname: '', birthdate: '', ministry: '',
    username: '', password: '', confirmPassword: '',
    securityQuestion: '', securityAnswer: '', terms: false,
  });

  useEffect(() => {
    const saved = localStorage.getItem('darkModeEnabled') === 'true';
    setDarkMode(saved);
    if (saved) document.body.classList.add('dark-mode');
  }, []);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('darkModeEnabled', next);
    document.body.classList.toggle('dark-mode', next);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));

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
    if (!form.firstname || !form.lastname || !form.username || !form.password || !form.securityQuestion || !form.securityAnswer) {
      setAlert({ message: 'Please fill all required fields', type: 'danger' });
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
        setAlert({ message: 'Account created successfully! Redirecting to login...', type: 'success' });
        setTimeout(() => router.push('/login'), 2000);
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
      <button className="dark-mode-toggle" onClick={toggleDarkMode} title="Toggle Dark Mode">
        <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`}></i>
      </button>

      <div className="signup-page">
        <div className="signup-container">
          <div className="signup-header">
            <div className="logo"></div>
            <h1>JOYFUL SOUND CHURCH</h1>
            <p>INTERNATIONAL</p>
          </div>

          <div className="signup-body">
            {alert.message && (
              <div className={`alert alert-${alert.type} show`}>{alert.message}</div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div className="form-group">
                  <label>First Name <span className="required">*</span></label>
                  <div className="input-wrapper">
                    <span className="input-icon"><i className="fa-solid fa-user"></i></span>
                    <input type="text" name="firstname" className="form-control" placeholder="John" required value={form.firstname} onChange={handleChange} />
                  </div>
                </div>
                <div className="form-group">
                  <label>Last Name <span className="required">*</span></label>
                  <div className="input-wrapper">
                    <span className="input-icon"><i className="fa-solid fa-user"></i></span>
                    <input type="text" name="lastname" className="form-control" placeholder="Doe" required value={form.lastname} onChange={handleChange} />
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label>Birthdate <span className="required">*</span></label>
                <div className="input-wrapper">
                  <span className="input-icon"><i className="fa-solid fa-calendar"></i></span>
                  <input type="date" name="birthdate" className="form-control" required value={form.birthdate} onChange={handleChange} />
                </div>
              </div>

              <div className="form-group">
                <label>Ministry <span className="required">*</span></label>
                <div className="input-wrapper">
                  <span className="input-icon"><i className="fa-solid fa-hands-praying"></i></span>
                  <select name="ministry" className="form-select" required value={form.ministry} onChange={handleChange}>
                    <option value="">Select your ministry</option>
                    <option value="Media">Media</option>
                    <option value="Praise And Worship">Praise And Worship</option>
                    <option value="Dancers">Dancers</option>
                    <option value="Ashers">Ashers</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Username <span className="required">*</span></label>
                <div className="input-wrapper">
                  <span className="input-icon"><i className="fa-solid fa-user"></i></span>
                  <input type="text" name="username" className="form-control" placeholder="johndoe123" required value={form.username} onChange={handleChange} />
                </div>
              </div>

              <div className="form-group">
                <label>Password <span className="required">*</span></label>
                <div className="input-wrapper">
                  <span className="input-icon"><i className="fa-solid fa-lock"></i></span>
                  <input type={showPassword ? 'text' : 'password'} name="password" className="form-control" placeholder="Enter password" required value={form.password} onChange={handleChange} />
                  <span className="password-toggle" onClick={() => setShowPassword(!showPassword)}>
                    <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                  </span>
                </div>
                {form.password && (
                  <>
                    <div className="password-strength">
                      <div className={`password-strength-bar strength-${passwordStrength.level}`}></div>
                    </div>
                    <div className="password-strength-text" style={{ color: passwordStrength.level === 'weak' ? 'var(--primary)' : passwordStrength.level === 'medium' ? 'var(--secondary)' : 'var(--accent)' }}>
                      {passwordStrength.text}
                    </div>
                  </>
                )}
              </div>

              <div className="form-group">
                <label>Confirm Password <span className="required">*</span></label>
                <div className="input-wrapper">
                  <span className="input-icon"><i className="fa-solid fa-lock"></i></span>
                  <input type={showConfirmPassword ? 'text' : 'password'} name="confirmPassword" className="form-control" placeholder="Confirm password" required value={form.confirmPassword} onChange={handleChange} />
                  <span className="password-toggle" onClick={() => setShowConfirmPassword(!showConfirmPassword)}>
                    <i className={`fa-solid ${showConfirmPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                  </span>
                </div>
                {confirmError && <div className="error-text" style={{ display: 'block' }}>{confirmError}</div>}
              </div>

              <div className="form-group">
                <label>Security Question <span className="required">*</span></label>
                <div className="input-wrapper">
                  <span className="input-icon"><i className="fa-solid fa-shield"></i></span>
                  <select name="securityQuestion" className="form-select" required value={form.securityQuestion} onChange={handleChange}>
                    <option value="">Select a security question</option>
                    <option value="What was your childhood nickname?">What was your childhood nickname?</option>
                    <option value="What city were you born in?">What city were you born in?</option>
                    <option value="What is your mother's maiden name?">What is your mother&apos;s maiden name?</option>
                    <option value="What was the name of your first pet?">What was the name of your first pet?</option>
                    <option value="What elementary school did you attend?">What elementary school did you attend?</option>
                    <option value="What is your favorite Bible verse?">What is your favorite Bible verse?</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Security Answer <span className="required">*</span></label>
                <div className="input-wrapper">
                  <span className="input-icon"><i className="fa-solid fa-key"></i></span>
                  <input type="text" name="securityAnswer" className="form-control" placeholder="Your answer" required value={form.securityAnswer} onChange={handleChange} />
                </div>
              </div>

              <div className="form-group full-width">
                <div className="checkbox-group">
                  <input type="checkbox" id="terms" name="terms" required checked={form.terms} onChange={handleChange} />
                  <label htmlFor="terms">I agree to the Terms and Conditions <span className="required">*</span></label>
                </div>
              </div>

              <button type="submit" className="btn-signup" disabled={loading}>
                {loading ? <div className="spinner" style={{ display: 'block' }}></div> : <span>Create Account</span>}
              </button>
            </form>

            <div className="signup-footer">
              <p>Already have an account? <a href="/login">Login</a></p>
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
