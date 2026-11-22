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
              <p className="legal-effective-date"><strong>Effective Date:</strong> November 23, 2026</p>

              <p>
                SanctuaryHub (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) is the online church management platform of Joyful Sound Church &ndash; International in Cebu City, Philippines, available at <a href="https://sanctuaryhub.vercel.app">sanctuaryhub.vercel.app</a>. We are committed to protecting the privacy of our members and users. This Privacy Policy explains how we collect, use, store, and protect your personal information when you use the SanctuaryHub website and its ministry app (together, the &quot;Platform&quot;).
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

              <h3><i className="fab fa-google"></i> 3. Signing In with Google</h3>
              <p>You can create an account and sign in with your Google account instead of a password. When you do:</p>
              <ul>
                <li><strong>What we receive:</strong> Google shares your name, email address, profile picture, and a Google account identifier with us. We ask only for this basic profile information. We do not request access to your Gmail, Google Drive, Contacts, Calendar, or any other Google data.</li>
                <li><strong>How we use it:</strong> Only to create your SanctuaryHub account, sign you in, keep your account linked to your Google account, and show your name and picture on your profile and to other members as described in Section 4.</li>
                <li><strong>How we store it:</strong> It is saved with your account in our database (hosted by Supabase) and protected as described in Section 5.</li>
                <li><strong>Sharing:</strong> We do not sell Google user data, do not use it for advertising, and do not share or transfer it to anyone except as needed to run the Platform or as required by law.</li>
                <li><strong>Limited Use:</strong> SanctuaryHub&apos;s use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements.</li>
                <li><strong>Removing access:</strong> You can disconnect SanctuaryHub from your Google account at any time at <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">myaccount.google.com/connections</a>, and you can ask us to delete your account and its Google data as described in Section 9.</li>
              </ul>

              <h3><i className="fas fa-share-alt"></i> 4. Information Sharing</h3>
              <p>We value your privacy and commit to the following:</p>
              <ul>
                <li><strong>No Selling of Data:</strong> We will never sell, rent, or trade your personal information to third parties.</li>
                <li><strong>Visible to Members:</strong> Your profile name, profile picture, role, and community posts are visible to other verified church members.</li>
                <li><strong>Administration Access:</strong> Church administrators have access to member information for verification, attendance tracking, and ministry management purposes.</li>
                <li><strong>Third-Party Services:</strong> We use trusted third-party services (such as Supabase for database hosting and Google for authentication) that process data in accordance with their own privacy policies.</li>
                <li><strong>Legal Requirements:</strong> We may disclose information if required by law or to protect the safety of our community.</li>
              </ul>

              <h3><i className="fas fa-lock"></i> 5. Data Security</h3>
              <p>We take the security of your data seriously:</p>
              <ul>
                <li>Passwords are encrypted using industry-standard hashing algorithms — we cannot see your password.</li>
                <li>All data transmission is encrypted using HTTPS/TLS protocols.</li>
                <li>Database access is restricted with role-based permissions.</li>
                <li>Regular security reviews and updates are performed to protect against vulnerabilities.</li>
                <li>Profile pictures are stored securely and accessed only through authenticated requests.</li>
              </ul>

              <h3><i className="fas fa-robot"></i> 6. AI-Powered Features</h3>
              <p>The Platform uses AI-powered features to enhance your spiritual experience:</p>
              <ul>
                <li>The Spiritual AI Assistant provides scripture-based guidance and is not a replacement for personal prayer and Bible study.</li>
                <li>AI-generated Bible explanations and verse analyses are for educational and devotional purposes only.</li>
                <li>Your conversations with the AI assistant are not stored permanently or shared with other users.</li>
                <li>AI features use third-party language models — your queries are processed but not used to train these models.</li>
              </ul>

              <h3><i className="fas fa-cookie-bite"></i> 7. Cookies & Local Storage</h3>
              <p>The Platform uses browser local storage and session storage for:</p>
              <ul>
                <li>Keeping you logged in (session management).</li>
                <li>Remembering your dark mode preference.</li>
                <li>Storing your Bible version preference for the Bible Reader.</li>
                <li>Caching viewed posts for the community feed algorithm.</li>
              </ul>
              <p>We do not use third-party tracking cookies or advertising cookies.</p>

              <h3><i className="fas fa-child"></i> 8. Children&apos;s Privacy</h3>
              <p>
                The Platform requires users to be at least <strong>13 years of age</strong> to create an account. Users under 18 should have parental or guardian consent. We do not knowingly collect information from children under 13. If we discover that we have collected such information, we will delete it promptly.
              </p>

              <h3><i className="fas fa-user-shield"></i> 9. Your Rights</h3>
              <p>As a user, you have the following rights regarding your data:</p>
              <ul>
                <li><strong>Access:</strong> You can view all personal information stored in your profile at any time.</li>
                <li><strong>Correction:</strong> You can update your personal information through the Profile section.</li>
                <li><strong>Deletion:</strong> You may request account deletion by emailing us (see Section 12), which will remove your personal data, including any data received from Google, from the Platform.</li>
                <li><strong>Portability:</strong> You can request a copy of your personal data by contacting church administration.</li>
                <li><strong>Withdraw Consent:</strong> You can stop using the Platform at any time.</li>
              </ul>

              <h3><i className="fas fa-history"></i> 10. Data Retention</h3>
              <p>
                We retain your personal data for as long as your account is active. If your account is deleted (either by you or by administration), your personal information will be removed from our systems. Community posts and content may be retained in anonymized form for record-keeping purposes.
              </p>

              <h3><i className="fas fa-edit"></i> 11. Changes to This Policy</h3>
              <p>
                We may update this Privacy Policy from time to time to reflect changes in our practices or legal requirements. Any changes will be posted on this page with an updated effective date. We encourage you to review this policy periodically.
              </p>

              <h3><i className="fas fa-envelope"></i> 12. Contact Us</h3>
              <p>
                If you have any questions, concerns, or requests regarding this Privacy Policy or how your data is handled, including a request to see, correct, or delete your data, email us at <a href="mailto:joyfulsoundchurchc@gmail.com">joyfulsoundchurchc@gmail.com</a>, or contact church administration through the Platform or during church services.
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
              Effective: November 23, 2026
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
