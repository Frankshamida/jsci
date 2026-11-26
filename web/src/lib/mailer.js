// Email from the server, through EmailJS - the service the site already uses
// for the password reset code - so there is no new account to open.
//
// One EmailJS template sends every email this file writes: the page builds
// the whole message and the template only places it. Setting it up once:
//
//   1. EmailJS > Email Templates > Create New Template. Set
//        To Email:  {{to_email}}
//        From Name: {{from_name}}
//        Subject:   {{subject}}
//        Reply To:  the church's own email (optional)
//      and as the content (Edit Content, then the "</>" code view) only:
//        {{{html}}}
//      - three braces, so the message's layout is kept, and nothing around it.
//      Save it and copy its Template ID.
//   2. EmailJS > Account > Security: tick "Allow EmailJS API for non-browser
//      applications", and copy the Private Key.
//   3. In Vercel (and .env.local), add
//        EMAILJS_GIVING_TEMPLATE_ID = the Template ID
//        EMAILJS_PRIVATE_KEY        = the Private Key
//      The service and public key already set for the password reset
//      (NEXT_PUBLIC_EMAILJS_SERVICE_ID, NEXT_PUBLIC_EMAILJS_PUBLIC_KEY) are
//      used as they are.
//
// Until then nothing is sent, and whoever confirmed the gift is told so.

const ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send';

function config() {
  return {
    service: process.env.EMAILJS_SERVICE_ID || process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID || '',
    template: process.env.EMAILJS_GIVING_TEMPLATE_ID || '',
    publicKey: process.env.EMAILJS_PUBLIC_KEY || process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY || '',
    privateKey: process.env.EMAILJS_PRIVATE_KEY || '',
  };
}

export const emailReady = () => {
  const c = config();
  return Boolean(c.service && c.template && c.publicKey && c.privateKey);
};

export const EMAIL_SETUP_NOTE = 'Emails are not set up yet: add EMAILJS_GIVING_TEMPLATE_ID and EMAILJS_PRIVATE_KEY (see src/lib/mailer.js).';

// { sent: true } or { sent: false, reason }. Never throws.
export async function sendEmail({ to, subject, html, text = '', fromName = 'Joyful Sound Church', replyTo = '' }) {
  const c = config();
  if (!emailReady()) return { sent: false, reason: EMAIL_SETUP_NOTE };
  if (!to) return { sent: false, reason: 'There is no email address to send to.' };
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: c.service,
        template_id: c.template,
        user_id: c.publicKey,
        accessToken: c.privateKey,
        template_params: { to_email: to, subject, html, text, from_name: fromName, reply_to: replyTo || undefined },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return { sent: true };
    const why = (await res.text().catch(() => '')).slice(0, 200);
    return { sent: false, reason: `The email service said no (${res.status}${why ? `: ${why}` : ''}).` };
  } catch (err) {
    return { sent: false, reason: `The email could not be sent (${err?.name === 'TimeoutError' ? 'no answer from the email service' : err?.message || 'network error'}).` };
  }
}
