'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import emailjs from '@emailjs/browser';
import './forgot-password.css';

const EMAILJS_SERVICE_ID = process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID;
const EMAILJS_PUBLIC_KEY = process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY;

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [alert, setAlert] = useState({ message: '', type: '' });

  // Step 1
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [loadingStep1, setLoadingStep1] = useState(false);

  // Step 2
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState('');
  const [loadingStep2, setLoadingStep2] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

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

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

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

  // Step 1: Send OTP to email
  const sendOtp = async () => {
    if (!email.trim()) {
      setEmailError('Please enter your email address');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError('Please enter a valid email address');
      return;
    }
    setLoadingStep1(true);
    setEmailError('');
    try {
      // 1. Generate OTP on the server
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const result = await response.json();
      if (!result.success) {
        setEmailError(result.message || 'Email not found');
        setLoadingStep1(false);
        return;
      }

      // 2. Send email via EmailJS from client
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
        to_email: email.trim().toLowerCase(),
        title: 'Password Reset Code',
        name: result.firstname || 'User',
        email: email.trim().toLowerCase(),
        otp: result.otp,
      }, { publicKey: EMAILJS_PUBLIC_KEY });

      setAlert({ message: 'OTP sent to your email!', type: 'success' });
      setCurrentStep(2);
      setResendCooldown(60);
    } catch (err) {
      console.error('Send OTP error:', err);
      setEmailError('Failed to send OTP. Please try again.');
    } finally {
      setLoadingStep1(false);
    }
  };

  // Resend OTP
  const resendOtp = async () => {
    if (resendCooldown > 0) return;
    setLoadingStep2(true);
    setOtpError('');
    try {
      // 1. Generate new OTP on server
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const result = await response.json();
      if (!result.success) {
        setOtpError(result.message || 'Failed to resend OTP');
        setLoadingStep2(false);
        return;
      }

      // 2. Send email via EmailJS from client
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
        to_email: email.trim().toLowerCase(),
        title: 'Password Reset Code',
        name: result.firstname || 'User',
        email: email.trim().toLowerCase(),
        otp: result.otp,
      }, { publicKey: EMAILJS_PUBLIC_KEY });

      setAlert({ message: 'New OTP sent!', type: 'success' });
      setResendCooldown(60);
      setOtp('');
    } catch (err) {
      console.error('Resend OTP error:', err);
      setOtpError('Failed to resend OTP. Please try again.');
    } finally {
      setLoadingStep2(false);
    }
  };

  // Step 2: Verify OTP
  const verifyOtp = async () => {
    if (!otp.trim()) {
      setOtpError('Please enter the OTP code');
      return;
    }
    if (otp.trim().length !== 6) {
      setOtpError('OTP must be 6 digits');
      return;
    }
    setLoadingStep2(true);
    setOtpError('');
    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), otp: otp.trim() }),
      });
      const result = await response.json();
      if (result.success) {
        setAlert({ message: 'OTP verified!', type: 'success' });
        setCurrentStep(3);
      } else {
        setOtpError(result.message || 'Invalid OTP');
      }
    } catch {
      setOtpError('An error occurred. Please try again.');
    } finally {
      setLoadingStep2(false);
    }
  };

  // Step 3: Reset password
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
        body: JSON.stringify({ email: email.trim(), newPassword }),
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

            {/* Step 1: Enter Email */}
            {currentStep === 1 && (
              <div className="step active">
                <h3 style={{ marginBottom: '15px', color: 'var(--primary)' }}>Step 1: Verify Your Email</h3>
                <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '18px' }}>Enter your registered email address and we&apos;ll send you a verification code.</p>
                <div className="form-group">
                  <label>Email Address <span className="required">*</span></label>
                  <div className="input-wrapper">
                    <span className="input-icon"><i className="fa-solid fa-envelope"></i></span>
                    <input type="email" className="form-control" placeholder="Enter your email address" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  {emailError && <div className="error-text" style={{ display: 'block' }}>{emailError}</div>}
                </div>
                <button className="btn-reset" onClick={sendOtp} disabled={loadingStep1}>
                  {loadingStep1 ? <div className="spinner" style={{ display: 'block' }}></div> : <span>Send OTP Code</span>}
                </button>
              </div>
            )}

            {/* Step 2: Enter OTP */}
            {currentStep === 2 && (
              <div className="step active">
                <h3 style={{ marginBottom: '15px', color: 'var(--primary)' }}>Step 2: Enter OTP Code</h3>
                <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '18px' }}>
                  We sent a 6-digit code to <strong>{email}</strong>. Check your inbox (and spam folder).
                </p>
                <div className="form-group">
                  <label>OTP Code <span className="required">*</span></label>
                  <div className="input-wrapper">
                    <span className="input-icon"><i className="fa-solid fa-key"></i></span>
                    <input
                      type="text" className="form-control otp-input" placeholder="Enter 6-digit code"
                      maxLength={6} value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))}
                      style={{ letterSpacing: '6px', fontSize: '1.2rem', textAlign: 'center', fontWeight: '700' }}
                    />
                  </div>
                  {otpError && <div className="error-text" style={{ display: 'block' }}>{otpError}</div>}
                </div>
                <button className="btn-reset" onClick={verifyOtp} disabled={loadingStep2}>
                  {loadingStep2 ? <div className="spinner" style={{ display: 'block' }}></div> : <span>Verify OTP</span>}
                </button>
                <div style={{ textAlign: 'center', marginTop: '14px' }}>
                  <button
                    onClick={resendOtp}
                    disabled={resendCooldown > 0}
                    style={{
                      background: 'none', border: 'none', color: resendCooldown > 0 ? '#aaa' : 'var(--primary)',
                      cursor: resendCooldown > 0 ? 'default' : 'pointer', fontSize: '0.9rem', fontWeight: '600',
                      fontFamily: 'inherit',
                    }}
                  >
                    {resendCooldown > 0 ? `Resend OTP in ${resendCooldown}s` : 'Resend OTP Code'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Reset Password */}
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
