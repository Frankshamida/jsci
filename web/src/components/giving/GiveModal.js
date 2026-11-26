'use client';

// Giving, in a window over the page - kept short, three steps:
//
//   1. How much    (tithes: Tithes or Offering, then the amount;
//                   a donation drive: just the amount)
//   2. Send it     one of the church's accounts from Mode of Payment - its QR,
//                  name and number - to send the money to in GCash, Maya or
//                  the bank app
//   3. Confirm     the reference number from that app's receipt, and an email
//
// Then: thank you, a verse, and - for somebody not signed in - one offer of a
// free account to keep track of their giving. Nobody needs an account to give.
//
//   <GiveButton mode="tithes" />                   on the Sunday Service page
//   <GiveButton mode="donation" campaign={drive} /> on a drive's page

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useViewer } from '@/lib/viewer';
import { PROOF_MAX_BYTES, PROOF_MAX_LABEL, shrinkProofImage } from '@/lib/proofFile';
import {
  EMAIL_RE, MAX_AMOUNT, MIN_AMOUNT, MY_GIVING_PATH, PRESET_AMOUNTS, STATUSES, TITHE_FUNDS,
  forgetGifts, fundLabel, parseAmount, peso, receiptPath, rememberGift, rememberedGifts, statusLabel, verseFor,
} from '@/lib/giving';
import './giving.css';

const STEPS = ['How much', 'Send it', 'Confirm'];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// The church's accounts, asked for once per page.
let methodsPromise = null;
const loadMethods = () => {
  methodsPromise ||= fetch('/api/giving')
    .then((r) => (r.ok ? r.json() : { methods: [] }))
    .then((j) => (Array.isArray(j.methods) ? j.methods : []))
    .catch(() => { methodsPromise = null; return []; });
  return methodsPromise;
};

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch { /* shown anyway */ }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return <button type="button" className="gv-copy" onClick={copy} aria-live="polite">{done ? 'Copied' : 'Copy'}</button>;
}

function MethodLogo({ method }) {
  return (
    <span className="gv-logo" style={{ background: method.logo_url ? '#fff' : method.logo_color || '#1e3a8a' }} aria-hidden="true">
      {method.logo_url ? <img src={method.logo_url} alt="" /> : String(method.name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}

// ---- Thank you, and (once) the offer of an account ----
function ThankYou({ gift, hasAccount, signedIn, giverName, onClose }) {
  const verse = verseFor(gift.receipt_no);
  const first = String(giverName || '').trim().split(/\s+/)[0];
  const [offer, setOffer] = useState(hasAccount ? 'exists' : 'ask'); // ask | form | made | declined | exists
  const [names, setNames] = useState(() => {
    const parts = String(giverName || '').trim().split(/\s+/).filter(Boolean);
    return { firstname: parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '', lastname: parts.length > 1 ? parts[parts.length - 1] : '' };
  });
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const top = useRef(null);
  useEffect(() => { top.current?.focus(); }, []);
  const isDonation = gift.fund === 'Donation';

  const makeAccount = async (e) => {
    e.preventDefault();
    if (!names.firstname.trim() || !names.lastname.trim()) { setError('Please enter your first and last name.'); return; }
    if (password.length < 8) { setError('Your password needs at least 8 characters.'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/giving/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: gift.token, tokens: rememberedGifts(), ...names, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.code === 'exists') { setOffer('exists'); return; }
      if (!json.success) throw new Error(json.message || 'Your account could not be made.');
      try {
        sessionStorage.setItem('userData', JSON.stringify(json.data));
        localStorage.setItem('userData', JSON.stringify(json.data));
      } catch { /* signed in for this page only */ }
      forgetGifts([gift.token]);
      window.dispatchEvent(new Event('viewer-change'));
      setOffer('made');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gv-done">
      <div className="gv-done-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </div>
      <h2 ref={top} tabIndex={-1}>Thank you{first ? `, ${first}` : ''}!</h2>
      <p className="gv-sub">
        We have your {peso(gift.amount)} {isDonation ? `for ${gift.campaign_title || 'the drive'}` : `for ${gift.fund}`}.
        {' '}We will email you when it is confirmed{isDonation ? ' - then it is counted in the jar' : ''}.
      </p>

      <div className="gv-receipt-mini">
        <dl className="gv-rows">
          <div><dt>Amount</dt><dd>{peso(gift.amount)}</dd></div>
          <div><dt>For</dt><dd>{fundLabel(gift)}</dd></div>
          <div><dt>Reference</dt><dd className="gv-mono">{gift.reference_no}</dd></div>
          <div><dt>Status</dt><dd><span className={`gv-status ${STATUSES[gift.status]?.tone || 'warn'}`}>{statusLabel(gift.status)}</span></dd></div>
        </dl>
        <a href={receiptPath(gift.token)} target="_blank" rel="noopener noreferrer">View receipt</a>
      </div>

      <blockquote className="gv-verse">
        &ldquo;{verse.text}&rdquo;
        <cite>{verse.ref}</cite>
      </blockquote>

      {signedIn ? (
        <div className="gv-actions is-center">
          <a href={MY_GIVING_PATH} className="gv-btn">My giving</a>
          <button type="button" className="gv-btn is-primary" onClick={onClose}>Done</button>
        </div>
      ) : (
        <div className="gv-offer" aria-live="polite">
          {offer === 'ask' && (
            <>
              <h3>Keep track of your giving?</h3>
              <p>A free account keeps every gift and its receipt in one place.</p>
              <div className="gv-actions">
                <button type="button" className="gv-btn is-primary" onClick={() => setOffer('form')}>Yes, please</button>
                <button type="button" className="gv-btn is-quiet" onClick={() => setOffer('declined')}>No, thanks</button>
              </div>
            </>
          )}
          {offer === 'form' && (
            <form onSubmit={makeAccount} noValidate>
              <h3>Your free account</h3>
              <p>With {gift.donor_email}. Choose a password, and you are signed in.</p>
              <div className="gv-two">
                <div>
                  <label className="gv-label" htmlFor="gv-acc-first">First name</label>
                  <input id="gv-acc-first" className="gv-input" autoComplete="given-name" value={names.firstname} maxLength={60} onChange={(e) => setNames((n) => ({ ...n, firstname: e.target.value }))} />
                </div>
                <div>
                  <label className="gv-label" htmlFor="gv-acc-last">Last name</label>
                  <input id="gv-acc-last" className="gv-input" autoComplete="family-name" value={names.lastname} maxLength={60} onChange={(e) => setNames((n) => ({ ...n, lastname: e.target.value }))} />
                </div>
              </div>
              <div className="gv-section">
                <label className="gv-label" htmlFor="gv-acc-pass">Password <em>8 characters or more</em></label>
                <div className="gv-pass">
                  <input id="gv-acc-pass" className="gv-input" type={show ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button type="button" onClick={() => setShow((v) => !v)}>{show ? 'Hide' : 'Show'}</button>
                </div>
              </div>
              {error && <p className="gv-error" role="alert">{error}</p>}
              <div className="gv-actions">
                <button type="submit" className="gv-btn is-primary" disabled={busy}>{busy ? 'Making it…' : 'Make my account'}</button>
                <button type="button" className="gv-btn is-quiet" onClick={() => setOffer('declined')} disabled={busy}>Not now</button>
              </div>
            </form>
          )}
          {offer === 'made' && (
            <>
              <h3>Your account is ready{names.firstname ? `, ${names.firstname.trim().split(/\s+/)[0]}` : ''}</h3>
              <p>You are signed in, and this gift is in My giving.</p>
              <div className="gv-actions">
                <a href={MY_GIVING_PATH} className="gv-btn">My giving</a>
                <button type="button" className="gv-btn is-primary" onClick={onClose}>Done</button>
              </div>
            </>
          )}
          {offer === 'exists' && (
            <>
              <h3>You already have an account</h3>
              <p>Sign in, and this gift joins the others in My giving.</p>
              <div className="gv-actions">
                <a href={`/login?next=${encodeURIComponent(MY_GIVING_PATH)}&email=${encodeURIComponent(gift.donor_email || '')}`} className="gv-btn is-primary">Sign in</a>
                <button type="button" className="gv-btn is-quiet" onClick={onClose}>Not now</button>
              </div>
            </>
          )}
          {offer === 'declined' && (
            <>
              <h3>God bless you!</h3>
              <p>Your receipt number is {gift.receipt_no}, in case you ever need to ask us about it.</p>
              <div className="gv-actions">
                <button type="button" className="gv-btn is-primary" onClick={onClose}>Done</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---- The three steps ----
function GiveForm({ mode, campaign, onClose, onBusy, onGiven }) {
  const { viewer } = useViewer();
  const isDonation = mode === 'donation';
  const [methods, setMethods] = useState(null);
  const [step, setStep] = useState(0);
  const [fund, setFund] = useState('Tithes');
  const [amountText, setAmountText] = useState('');
  const [custom, setCustom] = useState(false);
  const [methodId, setMethodId] = useState('');
  const [reference, setReference] = useState('');
  const [proof, setProof] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const head = useRef(null);
  const moved = useRef(false);

  useEffect(() => {
    let alive = true;
    loadMethods().then((m) => {
      if (!alive) return;
      setMethods(m);
      if (m.length === 1) setMethodId(m[0].id);
    });
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (moved.current) head.current?.focus(); }, [step]);
  useEffect(() => { onBusy?.(busy); }, [busy, onBusy]);

  const amount = parseAmount(amountText);
  const method = (methods || []).find((m) => m.id === methodId) || null;
  const forLabel = isDonation ? campaign?.title : fund;
  const signedIn = !!viewer;
  const go = (n) => { moved.current = true; setError(''); setStep(n); };

  const next = () => {
    if (step === 0) {
      if (!amount || amount < MIN_AMOUNT) { setError('Choose or type an amount.'); return; }
      if (amount > MAX_AMOUNT) { setError(`For more than ${peso(MAX_AMOUNT)}, please message the church office.`); return; }
      go(1);
    } else if (step === 1) {
      if (!method) { setError('Choose where you are sending it.'); return; }
      go(2);
    }
  };

  const pickProof = async (file) => {
    setError('');
    if (!file) { setProof(null); return; }
    const small = await shrinkProofImage(file);
    if (small.size > PROOF_MAX_BYTES) { setError(`That file is larger than ${PROOF_MAX_LABEL}. Leave it out, or try a smaller one.`); return; }
    setProof(small);
  };

  const submit = async (e) => {
    e.preventDefault();
    const ref = reference.trim();
    const mail = (viewer?.email || email).trim();
    if (ref.length < 4) { setError(`Enter the reference number from your ${method?.name || ''} receipt.`); return; }
    if (!EMAIL_RE.test(mail)) { setError('Enter your email, so we can tell you when it is confirmed.'); return; }
    setBusy(true);
    setError('');
    try {
      const fields = {
        amount: String(amount),
        fund: isDonation ? 'Donation' : fund,
        campaignId: isDonation ? campaign.id : '',
        methodId,
        reference: ref,
        name: signedIn ? '' : name.trim(),
        email: mail,
        userId: viewer?.id || '',
      };
      let res;
      if (proof) {
        const form = new FormData();
        Object.entries(fields).forEach(([k, v]) => form.append(k, v));
        form.append('proof', proof, proof.name || 'receipt');
        res = await fetch('/api/giving/gifts', { method: 'POST', body: form });
      } else {
        res = await fetch('/api/giving/gifts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
      }
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'It could not be sent. Please try again.');
      if (!signedIn) rememberGift(json.data.token);
      setDone({ gift: json.data, hasAccount: !!json.hasAccount && !signedIn, signedIn });
      onGiven?.(json.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return <ThankYou gift={done.gift} hasAccount={done.hasAccount} signedIn={done.signedIn} giverName={name || [viewer?.firstname, viewer?.lastname].filter(Boolean).join(' ')} onClose={onClose} />;
  }
  if (methods === null) return <div className="gv-loading"><span className="gv-spinner" aria-label="Loading"></span></div>;
  if (!methods.length) {
    return (
      <div className="gv-done">
        <h2>Online giving is getting ready</h2>
        <p className="gv-sub">The church&apos;s GCash, Maya and bank accounts are not listed yet. Please give during the service for now.</p>
        <div className="gv-actions is-center"><button type="button" className="gv-btn is-primary" onClick={onClose}>Close</button></div>
      </div>
    );
  }

  const presetOn = (n) => !custom && amount === n;

  return (
    <div>
      <ol className="gv-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>{s}</li>
        ))}
      </ol>

      {step === 0 && (
        <div>
          <h2 ref={head} tabIndex={-1}>{isDonation ? `Donate to ${campaign.title}` : 'Tithes & Offering'}</h2>
          {!isDonation && (
            <div className="gv-section">
              <div className="gv-segment" role="group" aria-label="Give">
                {TITHE_FUNDS.map((f) => (
                  <button key={f.key} type="button" aria-pressed={fund === f.key} onClick={() => setFund(f.key)}>{f.label}</button>
                ))}
              </div>
            </div>
          )}
          <div className="gv-section">
            <div className="gv-choices is-amounts" role="group" aria-label="Amount">
              {PRESET_AMOUNTS.map((n) => (
                <button key={n} type="button" className="gv-choice" aria-pressed={presetOn(n)} onClick={() => { setAmountText(String(n)); setCustom(false); setError(''); }}>
                  <strong>{peso(n)}</strong>
                </button>
              ))}
            </div>
            <div className="gv-money">
              <span aria-hidden="true">₱</span>
              <input
                className="gv-input"
                inputMode="decimal"
                aria-label="Other amount, in pesos"
                placeholder="Other amount"
                value={custom ? amountText : ''}
                onChange={(e) => { setAmountText(e.target.value.replace(/[^\d.,]/g, '')); setCustom(true); setError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); next(); } }}
              />
            </div>
          </div>
          {error && <p className="gv-error" role="alert">{error}</p>}
          <div className="gv-actions">
            <button type="button" className="gv-btn is-primary is-wide" onClick={next}>{amount ? `Continue with ${peso(amount)}` : 'Continue'}</button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div>
          <h2 ref={head} tabIndex={-1}>Send {peso(amount)}</h2>
          <p className="gv-sub">{forLabel}. Choose where to send it:</p>
          <div className="gv-section">
            <div className="gv-methods" role="radiogroup" aria-label="Send it to">
              {methods.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={methodId === m.id} className="gv-choice gv-method" onClick={() => { setMethodId(m.id); setError(''); }}>
                  <MethodLogo method={m} />
                  <strong>{m.name}</strong>
                </button>
              ))}
            </div>
          </div>
          {method && (
            <div className={`gv-account ${method.qr_url ? '' : 'no-qr'}`}>
              {method.qr_url && (
                <a className="gv-qr" href={method.qr_url} target="_blank" rel="noopener noreferrer" aria-label={`Open the ${method.name} QR code to save it`}>
                  <img src={method.qr_url} alt={`${method.name} QR code`} />
                </a>
              )}
              <dl className="gv-rows">
                {method.account_name && <div><dt>Name</dt><dd>{method.account_name}</dd></div>}
                {method.account_number && <div><dt>Number</dt><dd><span className="gv-mono">{method.account_number}</span><CopyButton text={method.account_number} /></dd></div>}
                <div><dt>Amount</dt><dd>{peso(amount)}<CopyButton text={String(amount)} /></dd></div>
              </dl>
            </div>
          )}
          {method && (
            <p className="gv-hint">
              {method.qr_url ? `Scan the QR in ${method.name}, or send to the number. ` : `Send it from your ${method.category === 'bank' ? 'bank' : method.name} app. `}
              Then come back for step 3.
            </p>
          )}
          {error && <p className="gv-error" role="alert">{error}</p>}
          <div className="gv-actions is-split">
            <button type="button" className="gv-btn is-quiet" onClick={() => go(0)}>Back</button>
            <button type="button" className="gv-btn is-primary" onClick={next}>I have sent it</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <form onSubmit={submit} noValidate>
          <h2 ref={head} tabIndex={-1}>Almost done</h2>
          <p className="gv-sub">{peso(amount)} · {forLabel} · {method?.name}</p>
          <div className="gv-section">
            <label className="gv-label" htmlFor="gv-ref">Reference number</label>
            <input id="gv-ref" className="gv-input gv-mono" value={reference} maxLength={40} autoComplete="off" spellCheck={false} onChange={(e) => { setReference(e.target.value); setError(''); }} placeholder={`From your ${method?.name || ''} receipt`} />
          </div>
          {!signedIn && (
            <div className="gv-two gv-section">
              <div>
                <label className="gv-label" htmlFor="gv-email">Email</label>
                <input id="gv-email" className="gv-input" type="email" autoComplete="email" value={email} maxLength={200} onChange={(e) => { setEmail(e.target.value); setError(''); }} placeholder="For your receipt" />
              </div>
              <div>
                <label className="gv-label" htmlFor="gv-name">Name <em>optional</em></label>
                <input id="gv-name" className="gv-input" autoComplete="name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
              </div>
            </div>
          )}
          <label className="gv-file">
            <input type="file" accept="image/*,.pdf,application/pdf" onChange={(e) => pickProof(e.target.files?.[0] || null)} />
            <span>{proof ? `Screenshot: ${proof.name}` : 'Add a screenshot of the receipt (optional)'}</span>
          </label>
          {error && <p className="gv-error" role="alert">{error}</p>}
          <div className="gv-actions is-split">
            <button type="button" className="gv-btn is-quiet" onClick={() => go(1)} disabled={busy}>Back</button>
            <button type="submit" className="gv-btn is-primary" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---- The window ----
export function GiveModal({ mode, campaign = null, onClose, onGiven }) {
  const box = useRef(null);
  const titleId = useId();
  const busy = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const before = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    setTimeout(() => box.current?.querySelector('.gv-steps + div h2, h2')?.focus?.(), 60);
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy.current) { closeRef.current?.(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const all = [...box.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!all.length) return;
      const [a, z] = [all[0], all[all.length - 1]];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="gv-theme gv-modal-root">
      <div className="gv-overlay" aria-hidden="true"></div>
      <div ref={box} className="gv-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <span id={titleId} className="gv-visually-hidden">{mode === 'donation' ? `Donate to ${campaign?.title}` : 'Give your tithes and offerings'}</span>
        <button type="button" className="gv-x" onClick={() => { if (!busy.current) onClose(); }} aria-label="Close">×</button>
        <GiveForm mode={mode} campaign={campaign} onClose={onClose} onBusy={(b) => { busy.current = b; }} onGiven={onGiven} />
      </div>
    </div>,
    document.body,
  );
}

// onGiven(gift): called once the window closes after a gift was sent - the
// page's jar drops hearts for the giver (components/giving/GivingJar
// replayJar). It still shows only confirmed donations.
export function GiveButton({ mode, campaign = null, className = 'gv-btn is-primary', onGiven, children }) {
  const [open, setOpen] = useState(false);
  const given = useRef(null);
  const close = () => {
    setOpen(false);
    const gift = given.current;
    given.current = null;
    if (gift) onGiven?.(gift);
  };
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open && <GiveModal mode={mode} campaign={campaign} onClose={close} onGiven={(g) => { given.current = g; }} />}
    </>
  );
}
