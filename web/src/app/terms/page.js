'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import './terms.css';

export default function TermsPage() {
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(false);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState('');

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
    fetchTerms();
  }, []);

  const fetchTerms = async () => {
    try {
      const res = await fetch('/api/admin/terms');
      const data = await res.json();
      if (data.success) {
        setContent(data.data.content);
        setUpdatedAt(data.data.updated_at);
      }
    } catch (err) {
      console.error('Failed to load terms:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('darkModeEnabled', next);
    document.body.classList.toggle('dark-mode', next);
    document.documentElement.classList.toggle('dark-mode', next);
  };

  const handleBack = () => {
    router.back();
  };

  return (
    <>
      <button className="dark-mode-toggle" onClick={toggleDarkMode} title="Toggle Dark Mode">
        <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`}></i>
      </button>

      <div className="terms-page">
        <div className="terms-container">
          {/* Header */}
          <div className="terms-header">
            <button className="terms-back-btn" onClick={handleBack}>
              <i className="fas fa-arrow-left"></i>
              <span>Back</span>
            </button>
            <div className="terms-brand">
              <img src="/assets/LOGO.png" alt="SanctuaryHub Logo" />
              <div className="terms-brand-text">
                SanctuaryHub
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="terms-body">
            {loading ? (
              <div className="terms-loading">
                <div className="terms-loading-spinner"></div>
                <p>Loading Terms & Conditions...</p>
              </div>
            ) : content ? (
              <>
                <div
                  className="terms-content"
                  dangerouslySetInnerHTML={{ __html: content }}
                />
                {updatedAt && (
                  <div className="terms-updated">
                    Last updated: {new Date(updatedAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </div>
                )}
              </>
            ) : (
              <div className="terms-content">
                <h2>Terms of Service</h2>
                <p className="legal-effective-date"><strong>Effective Date:</strong> March 7, 2026</p>

                <p>
                  Welcome to the SanctuaryHub Ministry Portal. By accessing or using the Platform, you agree to be bound by these Terms of Service. Please read them carefully.
                </p>

                <h3><i className="fas fa-handshake"></i> 1. Acceptance of Terms</h3>
                <p>
                  By creating an account and using the SanctuaryHub platform, you agree to be bound by these Terms of Service. If you do not agree with any part of these terms, please do not create an account or use the platform.
                </p>

                <h3><i className="fas fa-user-plus"></i> 2. Account Registration</h3>
                <p>To use the Platform, you must:</p>
                <ul>
                  <li>Provide accurate and complete information when creating your account.</li>
                  <li>Be at least 13 years of age (users under 18 require parental consent).</li>
                  <li>Maintain the confidentiality of your login credentials.</li>
                  <li>Notify church administration immediately if you suspect unauthorized access to your account.</li>
                  <li>Accept responsibility for all activities that occur under your account.</li>
                </ul>

                <h3><i className="fas fa-check-circle"></i> 3. Account Verification</h3>
                <p>
                  New accounts require verification by church administrators before full platform access is granted. During the pending verification period, you will have limited access to platform features. Guest accounts may have restricted access as determined by church leadership.
                </p>

                <h3><i className="fas fa-heart"></i> 4. User Conduct</h3>
                <p>As a member of the SanctuaryHub community, you agree to:</p>
                <ul>
                  <li>Treat all members with respect, kindness, and Christ-like love.</li>
                  <li>Use the platform for fellowship, encouragement, and ministry-related purposes.</li>
                  <li>Not post or share content that is offensive, hateful, discriminatory, or inappropriate.</li>
                  <li>Not use the platform for any unlawful or unauthorized purposes.</li>
                  <li>Not attempt to access other users&apos; accounts or private information.</li>
                  <li>Not spread false teachings or misleading spiritual content.</li>
                  <li>Follow the guidelines set by church leadership.</li>
                </ul>

                <h3><i className="fas fa-comments"></i> 5. Community Guidelines</h3>
                <p>
                  The Community Hub, messaging features, and all interactive areas are intended for fellowship, encouragement, prayer requests, and ministry-related discussions. Content that promotes harassment, discrimination, false doctrine, or any form of harm will be removed and may result in account suspension or termination.
                </p>

                <h3><i className="fas fa-file-alt"></i> 6. Content Ownership</h3>
                <ul>
                  <li>Content you post (community posts, comments, messages) remains your intellectual property.</li>
                  <li>By posting content, you grant SanctuaryHub a non-exclusive, royalty-free license to display it within the Platform.</li>
                  <li>Church leadership reserves the right to moderate, edit, or remove content that violates these terms.</li>
                  <li>You must not post content that infringes on others&apos; copyrights or intellectual property.</li>
                </ul>

                <h3><i className="fas fa-shield-alt"></i> 7. Privacy & Data Protection</h3>
                <p>
                  Your privacy is important to us. Please review our <a href="/privacy-policy">Privacy Policy</a> for detailed information about how we collect, use, store, and protect your personal data. By using the Platform, you consent to our data practices as described in the Privacy Policy.
                </p>

                <h3><i className="fas fa-robot"></i> 8. AI-Powered Features</h3>
                <p>The Platform includes AI-powered features such as the Spiritual AI Assistant and Bible explanations. Please understand that:</p>
                <ul>
                  <li>AI responses are generated by artificial intelligence and are not a substitute for personal prayer, Bible study, or pastoral counsel.</li>
                  <li>AI-generated content should be verified against Scripture.</li>
                  <li>SanctuaryHub is not responsible for the accuracy of AI-generated content.</li>
                </ul>

                <h3><i className="fas fa-ban"></i> 9. Prohibited Activities</h3>
                <p>Users are strictly prohibited from:</p>
                <ul>
                  <li>Attempting to hack, exploit, or compromise the Platform&apos;s security.</li>
                  <li>Using automated bots or scripts to interact with the Platform.</li>
                  <li>Impersonating other users, administrators, or church leaders.</li>
                  <li>Distributing spam, malware, or harmful content.</li>
                  <li>Using the Platform for commercial solicitation or advertising.</li>
                </ul>

                <h3><i className="fas fa-gavel"></i> 10. Termination</h3>
                <p>
                  SanctuaryHub reserves the right to suspend or terminate accounts that violate these Terms of Service, disrupt the community, or engage in behavior deemed inappropriate by church leadership. Users may also request account deletion at any time through the Platform settings.
                </p>

                <h3><i className="fas fa-exclamation-triangle"></i> 11. Limitation of Liability</h3>
                <p>
                  The Platform is provided &quot;as is&quot; without warranties of any kind. SanctuaryHub shall not be liable for any indirect, incidental, or consequential damages arising from your use of the Platform. We strive to maintain platform availability but cannot guarantee uninterrupted service.
                </p>

                <h3><i className="fas fa-sync-alt"></i> 12. Changes to Terms</h3>
                <p>
                  SanctuaryHub reserves the right to modify these Terms of Service at any time. Changes will be posted on this page with an updated effective date. Continued use of the Platform after changes constitutes acceptance of the updated terms.
                </p>

                <h3><i className="fas fa-envelope"></i> 13. Contact</h3>
                <p>
                  For questions regarding these Terms of Service, please contact church administration through the Platform or during church services.
                </p>

                <div className="legal-scripture-box">
                  <i className="fas fa-hands-praying"></i>
                  <div>
                    <p className="legal-scripture-text">&ldquo;Let us not become weary in doing good, for at the proper time we will reap a harvest if we do not give up. Therefore, as we have opportunity, let us do good to all people.&rdquo;</p>
                    <p className="legal-scripture-ref">— Galatians 6:9-10 (NIV)</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer with links */}
          <div className="terms-footer legal-footer-links">
            <div className="legal-footer-nav">
              <a href="/terms" className="active">Terms of Service</a>
              <span className="legal-footer-dot">•</span>
              <a href="/privacy-policy">Privacy Policy</a>
            </div>
            <p>&copy; {new Date().getFullYear()} SanctuaryHub &mdash; All Rights Reserved</p>
          </div>
        </div>
      </div>
    </>
  );
}
