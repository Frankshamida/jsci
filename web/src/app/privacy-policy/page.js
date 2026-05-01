'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import '../terms/terms.css';

export default function PrivacyPolicyPage() {
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(false);

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
            <div className="terms-content">
              <h2>Privacy Policy</h2>
              <p className="legal-effective-date"><strong>Effective Date:</strong> March 7, 2026</p>

              <p>
                SanctuaryHub (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) is committed to protecting the privacy of our members and users. This Privacy Policy explains how we collect, use, store, and protect your personal information when you use the SanctuaryHub Ministry Portal (&quot;Platform&quot;).
              </p>

              <h3><i className="fas fa-database"></i> 1. Information We Collect</h3>
              <p>When you create an account or use the Platform, we may collect the following information:</p>
              <ul>
                <li><strong>Personal Information:</strong> First name, last name, email address, birthdate, and profile picture.</li>
                <li><strong>Account Information:</strong> Password (stored securely using hashing), account role, and verification status.</li>
                <li><strong>Profile Information:</strong> Life verse, ministry affiliation, and other optional profile details you choose to provide.</li>
                <li><strong>Usage Data:</strong> Login activity, feature usage, and interaction with community posts.</li>
                <li><strong>Content Data:</strong> Posts, comments, messages, and other content you create on the Platform.</li>
                <li><strong>Device Information:</strong> Browser type, device type, and general location for platform optimization.</li>
              </ul>

              <h3><i className="fas fa-cogs"></i> 2. How We Use Your Information</h3>
              <p>We use your personal information for the following purposes:</p>
              <ul>
                <li><strong>Account Management:</strong> To create, maintain, and verify your account.</li>
                <li><strong>Platform Functionality:</strong> To enable features such as community posts, messaging, event management, attendance tracking, and scheduling.</li>
                <li><strong>Communication:</strong> To send notifications about events, announcements, and important church updates.</li>
                <li><strong>Personalization:</strong> To display your life verse, customize your experience, and provide AI-powered spiritual guidance.</li>
                <li><strong>Security:</strong> To protect against unauthorized access and ensure the safety of all users.</li>
                <li><strong>Improvement:</strong> To analyze usage patterns and improve the Platform&apos;s features and performance.</li>
              </ul>

              <h3><i className="fas fa-share-alt"></i> 3. Information Sharing</h3>
              <p>We value your privacy and commit to the following:</p>
              <ul>
                <li><strong>No Selling of Data:</strong> We will never sell, rent, or trade your personal information to third parties.</li>
                <li><strong>Visible to Members:</strong> Your profile name, profile picture, role, and community posts are visible to other verified church members.</li>
                <li><strong>Administration Access:</strong> Church administrators have access to member information for verification, attendance tracking, and ministry management purposes.</li>
                <li><strong>Third-Party Services:</strong> We use trusted third-party services (such as Supabase for database hosting and Google for authentication) that process data in accordance with their own privacy policies.</li>
                <li><strong>Legal Requirements:</strong> We may disclose information if required by law or to protect the safety of our community.</li>
              </ul>

              <h3><i className="fas fa-lock"></i> 4. Data Security</h3>
              <p>We take the security of your data seriously:</p>
              <ul>
                <li>Passwords are encrypted using industry-standard hashing algorithms — we cannot see your password.</li>
                <li>All data transmission is encrypted using HTTPS/TLS protocols.</li>
                <li>Database access is restricted with role-based permissions.</li>
                <li>Regular security reviews and updates are performed to protect against vulnerabilities.</li>
                <li>Profile pictures are stored securely and accessed only through authenticated requests.</li>
              </ul>

              <h3><i className="fas fa-robot"></i> 5. AI-Powered Features</h3>
              <p>The Platform uses AI-powered features to enhance your spiritual experience:</p>
              <ul>
                <li>The Spiritual AI Assistant provides scripture-based guidance and is not a replacement for personal prayer and Bible study.</li>
                <li>AI-generated Bible explanations and verse analyses are for educational and devotional purposes only.</li>
                <li>Your conversations with the AI assistant are not stored permanently or shared with other users.</li>
                <li>AI features use third-party language models — your queries are processed but not used to train these models.</li>
              </ul>

              <h3><i className="fas fa-cookie-bite"></i> 6. Cookies & Local Storage</h3>
              <p>The Platform uses browser local storage and session storage for:</p>
              <ul>
                <li>Keeping you logged in (session management).</li>
                <li>Remembering your dark mode preference.</li>
                <li>Storing your Bible version preference for the Bible Reader.</li>
                <li>Caching viewed posts for the community feed algorithm.</li>
              </ul>
              <p>We do not use third-party tracking cookies or advertising cookies.</p>

              <h3><i className="fas fa-child"></i> 7. Children&apos;s Privacy</h3>
              <p>
                The Platform requires users to be at least <strong>13 years of age</strong> to create an account. Users under 18 should have parental or guardian consent. We do not knowingly collect information from children under 13. If we discover that we have collected such information, we will delete it promptly.
              </p>

              <h3><i className="fas fa-user-shield"></i> 8. Your Rights</h3>
              <p>As a user, you have the following rights regarding your data:</p>
              <ul>
                <li><strong>Access:</strong> You can view all personal information stored in your profile at any time.</li>
                <li><strong>Correction:</strong> You can update your personal information through the Profile section.</li>
                <li><strong>Deletion:</strong> You may request account deletion, which will remove your personal data from the Platform.</li>
                <li><strong>Portability:</strong> You can request a copy of your personal data by contacting church administration.</li>
                <li><strong>Withdraw Consent:</strong> You can stop using the Platform at any time.</li>
              </ul>

              <h3><i className="fas fa-history"></i> 9. Data Retention</h3>
              <p>
                We retain your personal data for as long as your account is active. If your account is deleted (either by you or by administration), your personal information will be removed from our systems. Community posts and content may be retained in anonymized form for record-keeping purposes.
              </p>

              <h3><i className="fas fa-edit"></i> 10. Changes to This Policy</h3>
              <p>
                We may update this Privacy Policy from time to time to reflect changes in our practices or legal requirements. Any changes will be posted on this page with an updated effective date. We encourage you to review this policy periodically.
              </p>

              <h3><i className="fas fa-envelope"></i> 11. Contact Us</h3>
              <p>
                If you have any questions, concerns, or requests regarding this Privacy Policy or how your data is handled, please contact church administration through the Platform or during church services.
              </p>

              <div className="legal-scripture-box">
                <i className="fas fa-hands-praying"></i>
                <div>
                  <p className="legal-scripture-text">&ldquo;The Lord is my shepherd, I lack nothing. He makes me lie down in green pastures, he leads me beside quiet waters, he refreshes my soul.&rdquo;</p>
                  <p className="legal-scripture-ref">— Psalm 23:1-3 (NIV)</p>
                </div>
              </div>
            </div>

            <div className="terms-updated">
              Effective: March 7, 2026
            </div>
          </div>

          {/* Footer with links */}
          <div className="terms-footer legal-footer-links">
            <div className="legal-footer-nav">
              <a href="/terms">Terms of Service</a>
              <span className="legal-footer-dot">•</span>
              <a href="/privacy-policy" className="active">Privacy Policy</a>
            </div>
            <p>&copy; {new Date().getFullYear()} SanctuaryHub &mdash; All Rights Reserved</p>
          </div>
        </div>
      </div>
    </>
  );
}
