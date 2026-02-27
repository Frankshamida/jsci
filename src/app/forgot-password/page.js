'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import './forgot-password.css';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [userData, setUserData] = useState(null);
  const [alert, setAlert] = useState({ message: '', type: '' });

  // Step 1
  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [loadingStep1, setLoadingStep1] = useState(false);

  // Step 2
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [answerError, setAnswerError] = useState('');
  const [loadingStep2, setLoadingStep2] = useState(false);

  // Step 3
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loadingStep3, setLoadingStep3] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState({ level: '', text: '' });

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

  const checkPasswordStrength = (value) => {
    let strength = 0;
    if (value.length >= 8) strength++;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) strength++;
    if (/\d/.test(value)) strength++;
    if (/[^a-zA-Z\d]/.test(value)) strength++;
    if (strength <= 1) setPasswordStrength({ level: 'weak', text: 'Weak password' });
    else if (strength <= 3) setPasswordStrength({ level: 'medium', text: 'Medium password' });
    else setPasswordStrength({ level: 'strong', text: 'Strong password' });
  };

  const verifyUsername = async () => {
    if (!username.trim()) {
      setUsernameError('Please enter your username');
      return;
    }
    setLoadingStep1(true);
    setUsernameError('');
    try {
      const response = await fetch(`/api/auth/verify-username?username=${encodeURIComponent(username.trim())}`);
      const result = await response.json();
      if (result.success) {
        setUserData(result.data);
        setCurrentStep(2);
      } else {
        setUsernameError(result.message || 'Username not found');
      }
    } catch {
      setUsernameError('An error occurred. Please try again.');
    } finally {
      setLoadingStep1(false);
    }
  };

  const verifyAnswer = async () => {
    if (!securityAnswer.trim()) {
      setAnswerError('Please enter your answer');
      return;
    }
    setLoadingStep2(true);
    setAnswerError('');
    try {
      const response = await fetch('/api/auth/verify-security-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: userData.username, answer: securityAnswer }),
      });
      const result = await response.json();
      if (result.success) {
        setCurrentStep(3);
      } else {
        setAnswerError(result.message || 'Incorrect answer');
      }
    } catch {
      setAnswerError('An error occurred. Please try again.');
    } finally {
      setLoadingStep2(false);
    }
  };

  const resetPassword = async () => {
    if (newPassword.length < 8) {
      setAlert({ message: 'Password must be at least 8 characters', type: 'danger' });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setAlert({ message: 'Passwords do not match', type: 'danger' });
      return;
    }
    setLoadingStep3(true);
    setAlert({ message: '', type: '' });
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: userData.username, newPassword }),
      });
      const result = await response.json();
      if (result.success) {
        setAlert({ message: 'Password reset successfully! Redirecting to login...', type: 'success' });
        setTimeout(() => router.push('/login'), 2000);
      } else {
        setAlert({ message: result.message || 'Error resetting password', type: 'danger' });
      }
    } catch {
      setAlert({ message: 'An error occurred. Please try again.', type: 'danger' });
    } finally {
      setLoadingStep3(false);
    }
  };

  return (
    <>
      <button className="dark-mode-toggle" onClick={toggleDarkMode} title="Toggle Dark Mode">
        <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`}></i>
      </button>

      <div className="forgot-page">
        <div className="forgot-container">
          <div className="forgot-header">
            <div className="logo"></div>
            <h1>JOYFUL SOUND CHURCH</h1>
            <p>INTERNATIONAL</p>
          </div>

          <div className="forgot-body">
            {alert.message && (
              <div className={`alert alert-${alert.type} show`}>{alert.message}</div>
            )}

            <div className="step-indicator">
              <div className={`step-dot ${currentStep >= 1 ? 'active' : ''}`}></div>
              <div className={`step-dot ${currentStep >= 2 ? 'active' : ''}`}></div>
              <div className={`step-dot ${currentStep >= 3 ? 'active' : ''}`}></div>
            </div>

            {/* Step 1 */}
            {currentStep === 1 && (
              <div className="step active">
                <h3 style={{ marginBottom: '15px', color: 'var(--primary)' }}>Step 1: Verify Your Account</h3>
                <div className="form-group">
                  <label>Username <span className="required">*</span></label>
                  <div className="input-wrapper">
                    <span className="input-icon"><i className="fa-solid fa-user"></i></span>
                    <input type="text" className="form-control" placeholder="Enter your username" value={username} onChange={(e) => setUsername(e.target.value)} />
                  </div>
                  {usernameError && <div className="error-text" style={{ display: 'block' }}>{usernameError}</div>}
                </div>
                <button className="btn-reset" onClick={verifyUsername} disabled={loadingStep1}>
                  {loadingStep1 ? <div className="spinner" style={{ display: 'block' }}></div> : <span>Verify Username</span>}
                </button>
              </div>
            )}

            {/* Step 2 */}
            {currentStep === 2 && (
              <div className="step active">
                <h3 style={{ marginBottom: '15px', color: 'var(--primary)' }}>Step 2: Security Question</h3>
                <div className="form-group">
                  <label>{userData?.securityQuestion || 'Security Question'}</label>
                  <div className="input-wrapper">
                    <span className="input-icon"><i className="fa-solid fa-shield"></i></span>
                    <input type="text" className="form-control" placeholder="Enter your answer" value={securityAnswer} onChange={(e) => setSecurityAnswer(e.target.value)} />
                  </div>
                  {answerError && <div className="error-text" style={{ display: 'block' }}>{answerError}</div>}
                </div>
                <button className="btn-reset" onClick={verifyAnswer} disabled={loadingStep2}>
                  {loadingStep2 ? <div className="spinner" style={{ display: 'block' }}></div> : <span>Verify Answer</span>}
                </button>
              </div>
            )}

            {/* Step 3 */}
            {currentStep === 3 && (
              <div className="step active">
                <h3 style={{ marginBottom: '15px', color: 'var(--primary)' }}>Step 3: Reset Password</h3>
                <div className="form-group">
                  <label>New Password <span className="required">*</span></label>
                  <div className="input-wrapper">
                    <span className="input-icon"><i className="fa-solid fa-lock"></i></span>
                    <input
                      type={showNewPassword ? 'text' : 'password'} className="form-control" placeholder="Enter new password"
                      value={newPassword} onChange={(e) => { setNewPassword(e.target.value); checkPasswordStrength(e.target.value); }}
                    />
                    <span className="password-toggle" onClick={() => setShowNewPassword(!showNewPassword)}>
                      <i className={`fa-solid ${showNewPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                    </span>
                  </div>
                  {newPassword && (
                    <>
                      <div className="password-strength">
                        <div className={`password-strength-bar strength-${passwordStrength.level}`}></div>
                      </div>
                      <div className="password-strength-text">{passwordStrength.text}</div>
                    </>
                  )}
                </div>
                <div className="form-group">
                  <label>Confirm New Password <span className="required">*</span></label>
                  <div className="input-wrapper">
                    <span className="input-icon"><i className="fa-solid fa-lock"></i></span>
                    <input
                      type={showConfirmPassword ? 'text' : 'password'} className="form-control" placeholder="Confirm new password"
                      value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)}
                    />
                    <span className="password-toggle" onClick={() => setShowConfirmPassword(!showConfirmPassword)}>
                      <i className={`fa-solid ${showConfirmPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                    </span>
                  </div>
                  {confirmNewPassword && newPassword !== confirmNewPassword && (
                    <div className="error-text" style={{ display: 'block' }}>Passwords do not match</div>
                  )}
                </div>
                <button className="btn-reset" onClick={resetPassword} disabled={loadingStep3}>
                  {loadingStep3 ? <div className="spinner" style={{ display: 'block' }}></div> : <span>Reset Password</span>}
                </button>
              </div>
            )}

            <div className="forgot-footer">
              <p>Remember your password? <a href="/login">Back to Login</a></p>
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
