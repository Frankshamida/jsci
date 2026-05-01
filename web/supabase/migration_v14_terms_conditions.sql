-- ============================================
-- Migration V14: Terms & Conditions
-- Stores editable Terms & Conditions content
-- ============================================

CREATE TABLE IF NOT EXISTS terms_conditions (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default Terms & Conditions
INSERT INTO terms_conditions (content, updated_by) VALUES (
  '<h2>Terms and Conditions</h2>
<p><strong>Last Updated:</strong> ' || TO_CHAR(NOW(), 'Month DD, YYYY') || '</p>

<h3>1. Acceptance of Terms</h3>
<p>By creating an account and using the SanctuaryHub (JSCI) platform, you agree to be bound by these Terms and Conditions. If you do not agree, please do not create an account.</p>

<h3>2. Account Registration</h3>
<p>You must provide accurate and complete information when creating your account. You are responsible for maintaining the confidentiality of your login credentials and for all activities that occur under your account.</p>

<h3>3. User Conduct</h3>
<p>As a member of the JSCI community, you agree to:</p>
<ul>
  <li>Treat all members with respect and kindness</li>
  <li>Not post or share content that is offensive, hateful, or inappropriate</li>
  <li>Not use the platform for any unlawful purposes</li>
  <li>Not attempt to access other users'' accounts or private information</li>
  <li>Follow the guidelines set by church leadership</li>
</ul>

<h3>4. Community Guidelines</h3>
<p>The Community Hub and messaging features are intended for fellowship, encouragement, and ministry-related discussions. Content that promotes harassment, discrimination, or false teachings will be removed and may result in account suspension.</p>

<h3>5. Privacy & Data</h3>
<p>We respect your privacy. Your personal information (name, email, birthdate) is stored securely and used only for platform functionality. We do not sell or share your data with third parties. Profile information you choose to share within the community is visible to other verified members.</p>

<h3>6. Content Ownership</h3>
<p>Content you post (community posts, comments, messages) remains yours, but you grant JSCI a non-exclusive license to display it within the platform. Church leadership reserves the right to moderate or remove content that violates these terms.</p>

<h3>7. Account Verification</h3>
<p>New accounts require verification by church administrators before full platform access is granted. Guest accounts have limited access to certain features.</p>

<h3>8. Age Requirement</h3>
<p>You must be at least 13 years old to create an account on this platform. Users under 18 should have parental consent.</p>

<h3>9. Modifications</h3>
<p>JSCI reserves the right to modify these Terms and Conditions at any time. Continued use of the platform after changes constitutes acceptance of the updated terms.</p>

<h3>10. Termination</h3>
<p>JSCI reserves the right to suspend or terminate accounts that violate these terms or disrupt the community.</p>

<h3>11. Contact</h3>
<p>For questions regarding these terms, please contact church administration through the platform or during church services.</p>',
  'System'
);
