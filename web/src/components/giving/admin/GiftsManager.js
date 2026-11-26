'use client';

// Dashboard > Giving > Gifts: every gift sent to the church, newest first.
// Match each with the church's GCash, Maya or bank history by its reference
// number, then Confirm it: the giver is emailed a thank-you with a link to
// the giving jar. Mark it failed if the money never came, refunded if it was
// given back. Record a gift handed over in person (cash, a card at church)
// with "Record a gift".

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FUNDS, STATUSES, fundLabel, giftWhen, jarPath, methodLabel, peso, phYear, receiptPath,
} from '@/lib/giving';
import { Field, ManageMenu, ManagerHead, Modal, Notice, Stats, Switch, Toolbar } from '@/components/social/kit';

const API = '/api/giving/manage/gifts';
const FORM_ID = 'gvg';
const TONE = { pending: 'warn', successful: 'on', failed: 'bad', refunded: 'off' };
const IN_PERSON = ['Cash', 'Card'];

// "2026-11-26T15:30", in Philippine time, for <input type="datetime-local">.
const phLocal = (iso) => {
  const d = iso ? new Date(iso) : new Date();
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
const phMonth = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit' }).format(iso ? new Date(iso) : new Date());

const blank = (methods) => ({
  amount: '',
  fund: 'Offering',
  campaign_id: '',
  how: methods.find((m) => m.category !== 'cash')?.id || 'Cash',
  card_last4: '',
  reference_no: '',
  given_at: phLocal(),
  donor_name: '',
  donor_email: '',
  message: '',
  status: 'successful',
  send_email: true,
});

const fromGift = (g) => ({
  id: g.id,
  amount: String(g.amount),
  fund: g.fund,
  campaign_id: g.campaign_id || '',
  how: g.method_id || (IN_PERSON.includes(g.method_name) ? g.method_name : 'Other'),
  other: g.method_id || IN_PERSON.includes(g.method_name) ? '' : g.method_name,
  card_last4: g.card_last4 || '',
  reference_no: g.reference_no || '',
  given_at: phLocal(g.given_at),
  donor_name: g.donor_name || '',
  donor_email: g.donor_email || '',
  message: g.message || '',
});

// The form, as the API reads it.
const toGift = (f, methods) => {
  const method = methods.find((m) => m.id === f.how);
  return {
    amount: f.amount,
    fund: f.campaign_id ? 'Donation' : f.fund,
    campaign_id: f.campaign_id || null,
    method_id: method ? method.id : null,
    method_name: method ? method.name : f.how === 'Other' ? f.other : f.how,
    card_last4: f.how === 'Card' ? f.card_last4 : '',
    reference_no: f.reference_no,
    given_at: f.given_at,
    donor_name: f.donor_name,
    donor_email: f.donor_email,
    message: f.message,
    status: f.status,
    send_email: f.send_email,
  };
};

export default function GiftsManager({ actorId, onPending }) {
  const [gifts, setGifts] = useState([]);
  const [methods, setMethods] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [emailReady, setEmailReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [setupNote, setSetupNote] = useState('');
  const [notice, setNotice] = useState(null);
  const [filter, setFilter] = useState(null);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [form, setForm] = useState(null);
  const [pristine, setPristine] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [ask, setAsk] = useState(null); // { gift, action }
  const [askNote, setAskNote] = useState('');
  const [askEmail, setAskEmail] = useState(true);

  const load = useCallback(async () => {
    if (!actorId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}?actorId=${encodeURIComponent(actorId)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (res.status === 503) { setSetupNote(json.message); setGifts([]); return; }
      if (!json.success) throw new Error(json.message || 'Could not load the gifts.');
      setSetupNote('');
      setGifts(json.data || []);
      setMethods(json.methods || []);
      setCampaigns(json.campaigns || []);
      setEmailReady(json.emailReady !== false);
      setFilter((f) => f || ((json.data || []).some((g) => g.status === 'pending') ? 'pending' : 'all'));
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, [actorId]);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c = { pending: 0, successful: 0, failed: 0, refunded: 0, waiting: 0, month: 0, year: 0 };
    const month = phMonth();
    const year = phYear();
    gifts.forEach((g) => {
      c[g.status] = (c[g.status] || 0) + 1;
      if (g.status === 'pending') c.waiting += g.amount;
      if (g.status === 'successful') {
        if (phMonth(g.given_at) === month) c.month += g.amount;
        if (phYear(g.given_at) === year) c.year += g.amount;
      }
    });
    return c;
  }, [gifts]);
  useEffect(() => { onPending?.(counts.pending); }, [counts.pending, onPending]);

  const shown = gifts.filter((g) => {
    if (filter && filter !== 'all' && g.status !== filter) return false;
    const q = query.trim().toLowerCase();
    return !q || [g.donor_name, g.donor_email, g.reference_no, g.receipt_no, g.method_name, fundLabel(g), String(g.amount), peso(g.amount)]
      .filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  const replace = (saved) => setGifts((list) => list.map((g) => (g.id === saved.id ? saved : g)));
  const who = (g) => g.donor_name || g.donor_email || 'Anonymous';
  const emailLine = (email, g) => {
    if (!email) return '';
    if (email.sent) return ` ${who(g)} was emailed a thank-you.`;
    return ` The thank-you email was not sent: ${email.reason} You can copy the thank-you link from Manage and send it yourself.`;
  };

  // ---- Confirm, failed, refunded, back to pending, email again ----
  const openAsk = (gift, action) => { setAsk({ gift, action }); setAskNote(''); setAskEmail(!!gift.donor_email); };
  const act = async (gift, action, extra = {}) => {
    setBusyId(gift.id);
    setNotice(null);
    try {
      const res = await fetch(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, id: gift.id, action, ...extra }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Could not do that.');
      replace(json.data);
      const said = {
        confirm: `${peso(gift.amount)} from ${who(gift)} is confirmed.${emailLine(json.email, gift)}`,
        fail: `${peso(gift.amount)} from ${who(gift)} is marked failed.`,
        refund: `${peso(gift.amount)} from ${who(gift)} is marked refunded.`,
        reopen: `${peso(gift.amount)} from ${who(gift)} is pending again.`,
        resend: json.email?.sent ? `The thank-you email went to ${gift.donor_email} again.` : `The email was not sent: ${json.email?.reason || 'unknown reason'}`,
      }[action];
      setNotice({ type: action === 'resend' && !json.email?.sent ? 'warn' : json.email && !json.email.sent ? 'warn' : 'ok', text: said });
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setBusyId(null);
      setAsk(null);
    }
  };
  const runAsk = () => {
    if (!ask) return;
    const { gift, action } = ask;
    if (action === 'delete') { remove(gift); return; }
    act(gift, action, { note: askNote, sendEmail: askEmail });
  };
  const remove = async (gift) => {
    setBusyId(gift.id);
    try {
      const res = await fetch(API, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorId, id: gift.id }) });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Could not delete it.');
      setGifts((list) => list.filter((g) => g.id !== gift.id));
      setNotice({ type: 'ok', text: `The gift ${gift.receipt_no} was deleted.` });
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setBusyId(null);
      setAsk(null);
    }
  };

  // A donation's link is its drive's page, where its hearts drop into the jar;
  // a tithe's or an offering's is its receipt.
  const copyLink = async (gift) => {
    const slug = campaigns.find((c) => c.id === gift.campaign_id && c.is_published !== false)?.slug;
    const url = `${window.location.origin}${slug ? jarPath(slug, gift.token) : receiptPath(gift.token)}`;
    try { await navigator.clipboard.writeText(url); setNotice({ type: 'ok', text: `The thank-you link for ${who(gift)} is copied. Paste it in Messenger or an email.` }); } catch {
      setNotice({ type: 'warn', text: url });
    }
  };

  // ---- Record a gift / edit one ----
  const openForm = (gift = null) => {
    const f = gift ? fromGift(gift) : blank(methods);
    setForm(f);
    setPristine(JSON.stringify(f));
    setFormError('');
    setNotice(null);
  };
  const set = (k, v) => { setFormError(''); setForm((f) => ({ ...f, [k]: v })); };
  const dirty = !!form && JSON.stringify(form) !== pristine;
  const save = async () => {
    if (!form) return;
    setSaving(true);
    setFormError('');
    try {
      const res = await fetch(API, {
        method: form.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, id: form.id, gift: toGift(form, methods) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Could not save the gift.');
      if (form.id) replace(json.data); else setGifts((list) => [json.data, ...list].sort((a, b) => String(b.given_at).localeCompare(String(a.given_at))));
      setNotice({
        type: json.email && !json.email.sent ? 'warn' : 'ok',
        text: form.id ? `The gift ${json.data.receipt_no} is saved.` : `${peso(json.data.amount)} from ${who(json.data)} is recorded (${json.data.receipt_no}).${emailLine(json.email, json.data)}`,
      });
      setForm(null);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const recordButton = <button type="button" className="sm-btn is-primary" onClick={() => openForm()} disabled={!!setupNote || loading}>Record a gift</button>;
  const method = form ? methods.find((m) => m.id === form.how) : null;

  return (
    <div className="sm-card">
      <ManagerHead
        title="Gifts"
        text="Tithes, offerings and donations wait here as Pending. Find each one in the church's GCash, Maya or bank history by its reference number, then Confirm it - the giver is emailed a thank-you, and a donation's hearts drop into its drive's jar."
        pageHref="/donation"
        pageLabel="View the page"
        action={recordButton}
      />

      {setupNote && <Notice notice={{ type: 'warn', text: setupNote }} />}
      {!setupNote && !emailReady && !loading && (
        <Notice notice={{ type: 'warn', text: 'Thank-you emails are not set up yet, so confirming a gift sends nothing. Until they are, copy the thank-you link from Manage and send it yourself. (Set up: see src/lib/mailer.js.)' }} />
      )}

      {!setupNote && (
        <Stats
          items={[
            { value: counts.pending ? `${counts.pending} · ${peso(counts.waiting)}` : '0', label: 'Waiting to confirm' },
            { value: peso(counts.month), label: 'Confirmed this month' },
            { value: peso(counts.year), label: `Confirmed in ${phYear()}` },
          ]}
        />
      )}

      <Toolbar
        filters={[
          { key: 'all', label: 'All', count: gifts.length },
          { key: 'pending', label: 'Pending', count: counts.pending },
          { key: 'successful', label: 'Successful', count: counts.successful },
          { key: 'failed', label: 'Failed', count: counts.failed },
          { key: 'refunded', label: 'Refunded', count: counts.refunded },
        ]}
        filter={filter || 'all'}
        onFilter={setFilter}
        query={query}
        onQuery={setQuery}
        placeholder="Search name, email, reference or receipt"
      />

      <Notice notice={notice} onClose={() => setNotice(null)} />

      {loading ? (
        <div className="sm-empty">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="sm-empty">
          {gifts.length === 0 && !setupNote ? (
            <>
              <strong>No gifts yet</strong>
              <span>Tithes, offerings and donations sent online appear here, waiting for you to confirm them.</span>
            </>
          ) : !setupNote && <span>{filter === 'pending' && !query ? 'Nothing is waiting to be confirmed.' : 'No gifts match.'}</span>}
        </div>
      ) : (
        <ul className="sm-list">
          {shown.map((g) => (
            <li key={g.id} className={`sm-row gvm-row ${busyId === g.id ? 'is-busy' : ''} ${g.status === 'failed' || g.status === 'refunded' ? 'is-off' : ''}`}>
              <div className="gvm-amount">
                <strong>{peso(g.amount)}</strong>
                <span>{fundLabel(g)}</span>
              </div>
              <div className="sm-row-main">
                <div className="sm-row-top">
                  <span className={`sm-status ${TONE[g.status]}`}>{STATUSES[g.status]?.label}</span>
                  <span className="gvm-when">{giftWhen(g.given_at, { short: true })}</span>
                  {g.source === 'admin' && <span className="gvm-tag">Recorded by {g.recorded_by_name || 'staff'}</span>}
                </div>
                <button type="button" className="sm-row-title" onClick={() => openForm(g)}>
                  {g.donor_name || 'Anonymous'}{g.donor_email && <span className="gvm-email"> · {g.donor_email}</span>}
                </button>
                <span className="sm-row-meta">
                  {[methodLabel(g), g.reference_no ? `Ref ${g.reference_no}` : 'No reference', g.receipt_no].join(' · ')}
                  {g.status === 'successful' && g.donor_email && (g.email_sent_at ? ' · Emailed' : ' · Not emailed')}
                  {g.status_note ? ` · ${g.status_note}` : ''}
                </span>
                {g.message && <span className="gvm-msg">&ldquo;{g.message}&rdquo;</span>}
              </div>
              <div className="sm-row-actions">
                {g.status === 'pending' && (
                  <button type="button" className="sm-btn is-primary" onClick={() => openAsk(g, 'confirm')} disabled={busyId === g.id}>Confirm</button>
                )}
                <ManageMenu
                  disabled={busyId === g.id}
                  items={[
                    { label: 'View receipt', href: receiptPath(g.token) },
                    g.proof_url && { label: 'View screenshot', href: g.proof_url },
                    g.status === 'successful' && { label: 'Copy thank-you link', onClick: () => copyLink(g) },
                    g.status === 'successful' && g.donor_email && { label: 'Email the thank-you again', onClick: () => act(g, 'resend') },
                    { label: 'Edit details', onClick: () => openForm(g) },
                    { divider: true },
                    g.status === 'failed' && { label: 'Confirm it after all', onClick: () => openAsk(g, 'confirm') },
                    g.status === 'pending' && { label: 'Mark as failed', onClick: () => openAsk(g, 'fail') },
                    g.status === 'successful' && { label: 'Mark as refunded', onClick: () => openAsk(g, 'refund') },
                    (g.status === 'failed' || g.status === 'refunded' || g.status === 'successful') && { label: 'Back to pending', onClick: () => act(g, 'reopen') },
                    { label: 'Delete', danger: true, onClick: () => openAsk(g, 'delete') },
                  ]}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {ask && (
        <Modal
          small
          title={{
            confirm: 'Confirm this gift?',
            fail: 'Mark this gift as failed?',
            refund: 'Mark this gift as refunded?',
            delete: 'Delete this gift?',
          }[ask.action]}
          onClose={() => { if (busyId !== ask.gift.id) setAsk(null); }}
          busy={busyId === ask.gift.id}
          initialFocus=".gvm-ask-cancel"
          footer={(
            <>
              <button type="button" className="sm-btn gvm-ask-cancel" onClick={() => setAsk(null)} disabled={busyId === ask.gift.id}>Cancel</button>
              <button
                type="button"
                className={`sm-btn ${ask.action === 'delete' || ask.action === 'fail' ? 'is-danger-solid' : 'is-primary'}`}
                onClick={runAsk}
                disabled={busyId === ask.gift.id}
              >
                {busyId === ask.gift.id ? 'Working…' : { confirm: 'Confirm gift', fail: 'Mark as failed', refund: 'Mark as refunded', delete: 'Delete' }[ask.action]}
              </button>
            </>
          )}
        >
          <div className="gvm-ask">
            <dl className="gvm-facts">
              <div><dt>Amount</dt><dd>{peso(ask.gift.amount)}</dd></div>
              <div><dt>From</dt><dd>{ask.gift.donor_name || 'Anonymous'}{ask.gift.donor_email ? ` (${ask.gift.donor_email})` : ''}</dd></div>
              <div><dt>Sent through</dt><dd>{methodLabel(ask.gift)}</dd></div>
              <div><dt>Reference</dt><dd>{ask.gift.reference_no || '—'}</dd></div>
              <div><dt>When</dt><dd>{giftWhen(ask.gift.given_at, { short: true })}</dd></div>
            </dl>
            {ask.action === 'confirm' && (
              <>
                <p className="sm-confirm-text">Confirm it only once you have found this amount and reference number in the church&apos;s {ask.gift.method_name} history.</p>
                {ask.gift.donor_email && (
                  <Switch
                    checked={askEmail}
                    onChange={setAskEmail}
                    title="Email the giver a thank-you"
                    text={emailReady ? `With the receipt, and a link to see the gift drop into the giving jar.` : 'Emails are not set up yet, so nothing will be sent.'}
                  />
                )}
              </>
            )}
            {(ask.action === 'fail' || ask.action === 'refund') && (
              <Field id="gvm-ask-note" label="A note for the giver" optional below={<p className="sm-hint">Shown on their receipt.</p>}>
                <textarea id="gvm-ask-note" className="sm-input" rows={2} maxLength={300} value={askNote} onChange={(e) => setAskNote(e.target.value)} placeholder={ask.action === 'fail' ? 'e.g. No transfer with this reference number reached our GCash.' : 'e.g. Sent back to your GCash on Nov 28.'} />
              </Field>
            )}
            {ask.action === 'delete' && (
              <p className="sm-confirm-text">The gift {ask.gift.receipt_no} and its receipt are removed for good. To keep a record, mark it failed instead.</p>
            )}
          </div>
        </Modal>
      )}

      {form && (
        <Modal
          title={form.id ? 'Edit gift' : 'Record a gift'}
          subtitle={form.id ? 'Correct the details. Confirming, failing and refunding are in Manage.' : 'For a gift given in person, or one you found before it was sent through the page.'}
          onClose={() => { if (!saving) setForm(null); }}
          busy={saving}
          dirty={dirty}
          initialFocus={`#${FORM_ID}-amount`}
          footer={(
            <>
              {formError && <p className="sm-foot-error" role="alert">{formError}</p>}
              <button type="button" className="sm-btn" onClick={() => setForm(null)} disabled={saving}>Cancel</button>
              <button type="button" className="sm-btn is-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : form.id ? 'Save changes' : form.status === 'successful' ? 'Record as confirmed' : 'Record as pending'}
              </button>
            </>
          )}
        >
          <div className="sm-fields gvm-form">
            <div className="sm-two">
              <Field id={`${FORM_ID}-amount`} label="Amount" required>
                <input id={`${FORM_ID}-amount`} className="sm-input" inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value.replace(/[^\d.,]/g, ''))} placeholder="₱ 500" />
              </Field>
              <Field id={`${FORM_ID}-when`} label="Date and time" required>
                <input id={`${FORM_ID}-when`} type="datetime-local" className="sm-input" value={form.given_at} onChange={(e) => set('given_at', e.target.value)} />
              </Field>
            </div>

            <div className="sm-two">
              <Field id={`${FORM_ID}-fund`} label="Fund or purpose" required>
                <select id={`${FORM_ID}-fund`} className="sm-input" value={form.campaign_id ? 'Donation' : form.fund} disabled={!!form.campaign_id} onChange={(e) => set('fund', e.target.value)}>
                  {FUNDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </Field>
              <Field id={`${FORM_ID}-appeal`} label="Donation drive" optional>
                <select id={`${FORM_ID}-appeal`} className="sm-input" value={form.campaign_id} onChange={(e) => set('campaign_id', e.target.value)}>
                  <option value="">None</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </Field>
            </div>

            <div className="sm-two">
              <Field id={`${FORM_ID}-how`} label="Given through" required>
                <select id={`${FORM_ID}-how`} className="sm-input" value={form.how} onChange={(e) => set('how', e.target.value)}>
                  {methods.filter((m) => m.category !== 'cash').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  <option value="Cash">Cash</option>
                  <option value="Card">Card</option>
                  <option value="Other">Other…</option>
                </select>
              </Field>
              {form.how === 'Card' ? (
                <Field id={`${FORM_ID}-last4`} label="Card ending in" optional>
                  <input id={`${FORM_ID}-last4`} className="sm-input" inputMode="numeric" maxLength={4} value={form.card_last4} onChange={(e) => set('card_last4', e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="4242" />
                </Field>
              ) : form.how === 'Other' ? (
                <Field id={`${FORM_ID}-other`} label="What it was" required>
                  <input id={`${FORM_ID}-other`} className="sm-input" maxLength={60} value={form.other || ''} onChange={(e) => set('other', e.target.value)} placeholder="e.g. Cheque" />
                </Field>
              ) : (
                <Field id={`${FORM_ID}-ref`} label="Reference number" optional>
                  <input id={`${FORM_ID}-ref`} className="sm-input is-code" maxLength={40} value={form.reference_no} onChange={(e) => set('reference_no', e.target.value)} placeholder={method ? `From the ${method.name} receipt` : 'If there is one'} />
                </Field>
              )}
            </div>
            {(form.how === 'Card' || form.how === 'Other') && (
              <Field id={`${FORM_ID}-ref2`} label="Reference number" optional>
                <input id={`${FORM_ID}-ref2`} className="sm-input is-code" maxLength={40} value={form.reference_no} onChange={(e) => set('reference_no', e.target.value)} />
              </Field>
            )}

            <div className="sm-two">
              <Field id={`${FORM_ID}-name`} label="Giver's name" optional>
                <input id={`${FORM_ID}-name`} className="sm-input" maxLength={100} value={form.donor_name} onChange={(e) => set('donor_name', e.target.value)} placeholder="Empty for anonymous" />
              </Field>
              <Field id={`${FORM_ID}-email`} label="Giver's email" optional>
                <input id={`${FORM_ID}-email`} type="email" className="sm-input" maxLength={200} value={form.donor_email} onChange={(e) => set('donor_email', e.target.value)} placeholder="For the receipt" />
              </Field>
            </div>

            <Field id={`${FORM_ID}-note`} label="Note" optional>
              <textarea id={`${FORM_ID}-note`} className="sm-input" rows={2} maxLength={500} value={form.message} onChange={(e) => set('message', e.target.value)} />
            </Field>

            {!form.id && (
              <>
                <Switch
                  checked={form.status === 'successful'}
                  onChange={(v) => set('status', v ? 'successful' : 'pending')}
                  title="It is in the church's account"
                  text={form.status === 'successful' ? 'Recorded as confirmed (Successful).' : 'Recorded as Pending, to confirm later.'}
                />
                {form.status === 'successful' && form.donor_email.trim() && (
                  <Switch
                    checked={form.send_email}
                    onChange={(v) => set('send_email', v)}
                    title="Email the giver a thank-you"
                    text={emailReady ? 'With the receipt and the giving jar link.' : 'Emails are not set up yet, so nothing will be sent.'}
                  />
                )}
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

