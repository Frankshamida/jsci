'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ProofDrop from '@/components/ProofDrop';
import { isImageProof, isPdfProof, proofFileName } from '@/lib/proofFile';
import { bedWaitDue } from '@/lib/rooms';
import { addonShortLabel } from '@/lib/eventPricing';
import { extraNetFee } from '@/lib/exemption';
import './eventPayments.css';

// Event -> Payments (Super Admin). One sum of money, and the attendees it pays
// for, recorded in one go:
//
//   Cash On Hand    who is holding the money, and how much. No reference.
//   Online Payment  the bank or e-wallet, the recipient, the receipt, the
//                   reference ID and the amount sent.
//
// Attendees are found by search and added one by one (or a whole booking at
// once), each showing what they still owe. Confirm only unlocks when what they
// owe adds up to exactly the money entered - the API checks the same sum
// against the database before anybody is marked paid.
//
// A third view, Online Payment Verification, is for money already sent when
// the attendee registered (status payment_submitted): every receipt waiting to
// be checked, one card per transfer - the sender, the receipt and its total on
// the left, everyone that transfer covers on the right - verified the same way
// the proof window does it.
//
// The two online views read as one list, so no transfer is taken twice:
//   - somebody whose receipt is waiting to be verified has already paid, and
//     cannot be added on Cash On Hand or Online Payment - the search shows them
//     as paid online, with a way to go and verify it;
//   - Recorded Online Payments lists every online payment - those recorded
//     here by an admin and those sent with the registration and verified -
//     and the Verification view's Verified list is the same payments; each
//     says which of the two it was.

const KINDS = [
  { key: 'cash', icon: 'fa-money-bill-wave', label: 'Cash On Hand', hint: 'Money handed over in person' },
  { key: 'online', icon: 'fa-mobile-screen-button', label: 'Online Payment', hint: 'GCash, bank transfer and the like' },
  { key: 'verify', icon: 'fa-shield-halved', label: 'Online Payment Verification', hint: 'Paid at registration - check and confirm' },
];

// Still owing, in the words the Registrations table uses.
const STATUS_TAGS = {
  pending_cash: { label: 'Cash to collect', tone: 'due' },
  pending_payment: { label: 'Awaiting payment', tone: 'muted' },
  payment_submitted: { label: 'For verification', tone: 'info' },
  installment: { label: 'Installment', tone: 'info' },
  paid_pending_turnover: { label: 'Pending turnover', tone: 'wait' },
  // Already paid - on the list only for a bed they are waiting for.
  payment_verified: { label: 'Paid', tone: 'ok' },
  registered: { label: 'Registered', tone: 'ok' },
};
const SETTLED = new Set(['payment_verified', 'registered', 'cancelled']);

const owedOf = (r) => Math.max(0, (Number(r.amount) || 0) - (Number(r.amount_paid) || 0));
const cents = (n) => Math.round((Number(n) || 0) * 100);
const peso = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
// Digits and at most one point with two places: "1,500" and "₱1500" both read.
const moneyInput = (raw) => {
  const s = String(raw || '').replace(/[^\d.]/g, '');
  const [whole, ...rest] = s.split('.');
  return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
};
const stamp = (iso) => (iso
  ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })
  : '');
const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
const repOf = (r) => String(r.representative || '').trim().replace(/\s+/g, ' ');
const isBulk = (r) => r.registration_type === 'bulk' || (r.registration_type !== 'individual' && Number(r.group_size) > 1);

// ---- One transfer, everyone on it ----
// A representative pays for the whole booking on one transfer, so every row
// of it carries the same receipt - the same grouping as the proof window:
// group_ref, else (older bookings) the same representative and the same
// receipt, else the registration on its own.
const VERIFIABLE = new Set(['payment_submitted', 'pending_payment']);
const transferKeyOf = (r) => {
  if (r.group_ref) return `g:${r.group_ref}`;
  if (isBulk(r) && r.payment_proof_url) return `p:${norm(repOf(r))}|${r.payment_proof_url}`;
  return `r:${r.id}`;
};
// leads: the rows that put a transfer on the list. 'waiting' - a receipt sent
// and not yet checked; 'verified' - paid online and confirmed.
function groupTransfers(regs, leads) {
  const live = regs.filter((r) => !r.deleted_at && r.status !== 'cancelled');
  const byKey = new Map();
  live.forEach((r) => {
    const k = transferKeyOf(r);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  });
  const out = [];
  byKey.forEach((rows, key) => {
    const leadRows = rows.filter(leads);
    if (!leadRows.length) return;
    const lead = leadRows.find((r) => r.payment_proof_url) || leadRows[0];
    // Who sent it: the representative of a booking, else the attendee.
    const sender = (isBulk(lead) && repOf(lead)) || lead.attendee_name || '';
    const refs = [...new Set(rows.map((r) => String(r.payment_reference || '').trim()).filter(Boolean))];
    const when = leadRows.map((r) => r.created_at).filter(Boolean).sort()[0] || lead.created_at;
    // When the money was confirmed: the last of its rows to be verified.
    const paidAt = leadRows.map((r) => r.verified_at).filter(Boolean).sort().pop() || lead.paid_at || when;
    out.push({ key, rows, leadRows, lead, sender, refs, when, paidAt });
  });
  return out;
}

// Where an online payment came from, for the tag on it in both views.
const SOURCES = {
  admin: { icon: 'fa-user-shield', label: 'Recorded by admin', title: 'Recorded by a Super Admin on the Online Payment tab' },
  registration: { icon: 'fa-receipt', label: 'Paid at registration', title: 'Sent online with the registration, then verified in Online Payment Verification' },
};
function SourceTag({ source }) {
  const s = SOURCES[source];
  if (!s) return null;
  return <span className={`pay-tag src ${source}`} title={s.title}><i className={`fas ${s.icon}`}></i> <span>{s.label}</span></span>;
}

// A payment recorded on the Online Payment tab, shaped like a transfer so the
// Verification view can show it beside the ones paid at registration.
function recordTransfer(rec, regById) {
  const items = Array.isArray(rec.items) ? rec.items : [];
  const rows = items.map((it) => regById.get(it.id)
    || { id: it.id, attendee_name: it.name, church_name: it.church, amount: it.amount, status: 'payment_verified' });
  return {
    key: `rec:${rec.id}`,
    record: rec,
    rows,
    leadRows: rows,
    lead: rows[0] || {},
    sender: rec.recipient_name || '',
    refs: rec.reference ? [rec.reference] : [],
    when: rec.created_at,
    paidAt: rec.created_at,
    // What this payment took for each, which is not always their whole total.
    amounts: new Map(items.map((it) => [it.id, Number(it.amount) || 0])),
  };
}

// A transfer paid at registration and verified, shaped like a record so it
// sits in Recorded Online Payments beside the ones recorded here.
function transferRecord(g) {
  return {
    id: g.key,
    kind: 'online',
    source: 'registration',
    bank_name: g.lead.payment_method || 'Online',
    sender_name: g.sender,
    reference: g.refs.join(', '),
    proof_url: g.leadRows.find((r) => r.payment_proof_url)?.payment_proof_url || null,
    total_amount: g.leadRows.reduce((t, r) => t + (Number(r.amount) || 0), 0),
    items: g.leadRows.map((r) => ({ id: r.id, name: r.attendee_name, church: r.church_name, amount: Number(r.amount) || 0 })),
    created_at: g.paidAt,
    registered_at: g.when,
    recorded_by_name: g.lead.paid_by_name || '',
  };
}

const REC_PAGE = 15;

const EMPTY = {
  cash: { holder: '', total: '', notes: '', ids: [] },
  online: { methodId: '', otherBank: '', recipient: '', reference: '', total: '', notes: '', proof: null, ids: [] },
};

export default function EventPaymentsTab({
  event,
  actorId,
  regs = [],
  channels = [],
  showToast,
  askConfirm,
  onPaid,
  formatName = (s) => s,
  formatChurch = (s) => s,
  isCash = () => false,
  // The payment records live with the host page, which also needs them for
  // the Registrations table's Review Payment flags (src/lib/paymentReview.js).
  records = [],
  recordsLoading = false,
  needsMigration = '',
  reloadRecords,
  reviews = new Map(),
}) {
  const [kind, setKind] = useState('cash');
  const [forms, setForms] = useState(EMPTY);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  // What the Verification view opens searching for, when the search here sends
  // somebody there to verify a receipt.
  const [verifyQuery, setVerifyQuery] = useState('');
  // Recorded Online Payments: which of them to show, and how many so far.
  const [recFilter, setRecFilter] = useState('all'); // 'all' | 'admin' | 'registration'
  const [recShown, setRecShown] = useState(REC_PAGE);
  useEffect(() => { setRecShown(REC_PAGE); }, [kind, recFilter]);
  const searchRef = useRef(null);
  // A recorded payment: its receipt open, being edited, or being changed.
  const [receiptRec, setReceiptRec] = useState(null);
  const [editing, setEditing] = useState(null); // { rec, holder, bank, recipient, reference, notes, saving, error }
  const [recBusy, setRecBusy] = useState('');

  // The verification view has no form of its own; the online one stands in
  // so the arithmetic below never reads undefined.
  const form = forms[kind] || forms.online;
  const patch = (p) => setForms((f) => ({ ...f, [kind]: { ...f[kind], ...p } }));

  // The host's showToast is a new function every render; the panels below
  // read it through a ref so it never has to be a dependency.
  const toastRef = useRef(showToast);
  toastRef.current = showToast;

  // Receipts sent at registration and not yet checked - for the third tab's
  // badge, and handed to it so both read the same list.
  const waiting = useMemo(() => groupTransfers(regs, (r) => r.status === 'payment_submitted'), [regs]);
  const waitingTotal = waiting.reduce((t, g) => t + g.rows.filter((r) => VERIFIABLE.has(r.status)).reduce((s, r) => s + (Number(r.amount) || 0), 0), 0);
  // Everyone on one of those receipts - exactly the rows its Verification card
  // lists. They have paid online already; the receipt is checked there, never
  // taken again here.
  const awaiting = useMemo(() => {
    const m = new Map();
    waiting.forEach((g) => g.rows.forEach((r) => { if (VERIFIABLE.has(r.status)) m.set(r.id, g); }));
    return m;
  }, [waiting]);

  // Everyone who still owes something.
  // What each still owes: the registration itself if it is not paid yet, and
  // the bed they are waiting for if they are on the accommodation waiting
  // list - charged now, though the bed is not theirs yet. The API keeps what
  // is paid for it until the waiting list gives them the bed, which then
  // arrives already paid for.
  const regDue = (r) => (SETTLED.has(r.status) || awaiting.has(r.id) ? 0 : owedOf(r));
  const bedDue = (r) => bedWaitDue(r, event);
  const dueOf = (r) => regDue(r) + bedDue(r);
  const open = useMemo(
    () => regs.filter((r) => !r.deleted_at && r.status !== 'cancelled' && dueOf(r) > 0),
    [regs, event, awaiting], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ---- Every online payment, wherever it came from ----
  // Who each recorded payment actually paid for - not somebody on it only for
  // a waiting-list bed, whose own payment came from somewhere else. Newest
  // first, so a later record wins.
  const regById = useMemo(() => new Map(regs.map((r) => [r.id, r])), [regs]);
  const paidByRecord = useMemo(() => {
    const m = new Map();
    [...records]
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .forEach((rec) => (Array.isArray(rec.items) ? rec.items : []).forEach((it) => {
        if (it?.id && !m.has(it.id) && cents(it.amount) > cents(it.bedFee)) m.set(it.id, rec);
      }));
    return m;
  }, [records]);
  // Sent online with the registration and verified - by the Verification view
  // or the proof window. Not recorded on this tab, not taken at the desk, and
  // not money somebody was holding and turned over.
  const onlineVerified = (r) => r.status === 'payment_verified' && Number(r.amount) > 0 && r.payment_plan !== 'flexible'
    && !isCash(r.payment_method) && !!(r.payment_proof_url || r.payment_reference) && !paidByRecord.has(r.id)
    && !r.paid_at_desk && !r.turned_over_at;
  const regVerified = groupTransfers(regs, onlineVerified);
  const onlineRecords = records.filter((r) => r.kind === 'online');
  // The Verification view's Verified list: both kinds, as transfers.
  const verified = [...onlineRecords.map((rec) => recordTransfer(rec, regById)), ...regVerified];
  // Recorded Online Payments: both kinds, as records, newest first.
  const onlineList = [...onlineRecords, ...regVerified.map(transferRecord)]
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  // How somebody who owes nothing here was paid, for the search: so they read
  // as paid instead of just not being found.
  const paidHow = (r) => {
    if (awaiting.has(r.id)) {
      return { tone: 'info', label: 'Paid online · to verify', verify: true, hint: `Sent with their registration${r.payment_method ? ` via ${r.payment_method}` : ''} - waiting in Online Payment Verification` };
    }
    const rec = paidByRecord.get(r.id);
    if (rec && SETTLED.has(r.status)) {
      return rec.kind === 'cash'
        ? { tone: 'ok', label: 'Paid · Cash On Hand', hint: `Cash on hand from ${formatName(rec.holder_name)} · ${stamp(rec.created_at)}` }
        : { tone: 'ok', label: 'Paid · recorded by admin', hint: `${rec.bank_name} → ${rec.recipient_name}${rec.reference ? ` · Ref ${rec.reference}` : ''}` };
    }
    if (onlineVerified(r)) {
      return { tone: 'ok', label: 'Paid online · verified', hint: `Sent with their registration${r.payment_method ? ` via ${r.payment_method}` : ''}${r.payment_reference ? ` · Ref ${r.payment_reference}` : ''}` };
    }
    const via = [r.payment_method, r.payment_reference ? `Ref ${r.payment_reference}` : ''].filter(Boolean).join(' · ');
    if (r.paid_at_desk && SETTLED.has(r.status)) return { tone: 'ok', label: 'Paid at the desk', hint: via };
    if (r.turned_over_at && r.status === 'payment_verified') return { tone: 'ok', label: 'Paid · turned over', hint: [r.turnover_holder ? `Held by ${formatName(r.turnover_holder)}` : '', via].filter(Boolean).join(' · ') };
    if (r.status === 'payment_verified') return { tone: 'ok', label: isCash(r.payment_method) ? 'Paid in cash' : 'Paid', hint: via };
    if (r.status === 'registered') return { tone: 'ok', label: 'Registered', hint: Number(r.amount) > 0 ? '' : 'Nothing to pay' };
    return null;
  };
  const goVerify = (r) => {
    setVerifyQuery(r.attendee_name || '');
    setKind('verify');
    setQuery('');
    setSearchOpen(false);
    setTried(false);
  };
  const openById = useMemo(() => new Map(open.map((r) => [r.id, r])), [open]);

  // Somebody paid elsewhere while they were on a list here (the desk, the other
  // tab): they drop off it rather than fail the whole payment on Confirm.
  useEffect(() => {
    setForms((f) => {
      let changed = false;
      const next = { ...f };
      Object.keys(f).forEach((k) => {
        const kept = f[k].ids.filter((id) => openById.has(id));
        if (kept.length !== f[k].ids.length) { next[k] = { ...f[k], ids: kept }; changed = true; }
      });
      return changed ? next : f;
    });
  }, [openById]);

  const picked = form.ids.map((id) => openById.get(id)).filter(Boolean);
  const pickedSet = new Set(form.ids);
  const otherKind = kind === 'cash' ? 'online' : 'cash';
  const inOther = new Set(forms[otherKind].ids);

  // ---- Search ----
  // Every word has to appear somewhere on the row, in any order - the name,
  // church, pastor, representative, contact or reference.
  const words = norm(query).split(' ').filter(Boolean);
  const hayOf = (r) => [
    r.attendee_name, r.attendee_firstname, r.attendee_lastname, r.church_name, r.church_pastor,
    r.representative, r.added_by, r.attendee_mobile, r.attendee_email, r.payment_reference, r.turnover_holder,
  ].map(norm).join(' | ');
  const options = useMemo(() => {
    if (!words.length) return [];
    const rows = open.filter((r) => !pickedSet.has(r.id) && words.every((w) => hayOf(r).includes(w)));
    // A whole booking at once, when the search names its representative.
    const groups = new Map();
    open.forEach((r) => {
      const rep = repOf(r);
      if (!rep || pickedSet.has(r.id) || !words.every((w) => norm(rep).includes(w))) return;
      const key = norm(rep);
      if (!groups.has(key)) groups.set(key, { rep, rows: [] });
      groups.get(key).rows.push(r);
    });
    const groupOpts = [...groups.values()].filter((g) => g.rows.length > 1).slice(0, 3).map((g) => ({
      type: 'group', key: `g:${norm(g.rep)}`, rep: g.rep, rows: g.rows,
      total: g.rows.reduce((t, r) => t + dueOf(r), 0),
    }));
    // The person's own name first, then anything else that matched.
    const own = (r) => (words.every((w) => norm(`${r.attendee_name} ${r.attendee_firstname} ${r.attendee_lastname}`).includes(w)) ? 0 : 1);
    const rowOpts = rows
      .sort((a, b) => own(a) - own(b) || String(a.attendee_name).localeCompare(String(b.attendee_name)))
      .slice(0, 12)
      .map((r) => ({ type: 'row', key: r.id, row: r }));
    return [...groupOpts, ...rowOpts];
  }, [open, query, form.ids]); // eslint-disable-line react-hooks/exhaustive-deps

  // Matches who owe nothing - paid already, or paid online and waiting to be
  // verified - found by their own name, representative or reference, so a
  // search for somebody already paid says so instead of finding nobody.
  const paidMatches = (() => {
    if (!words.length) return [];
    const ownHay = (r) => [r.attendee_name, r.attendee_firstname, r.attendee_lastname, r.representative, r.payment_reference].map(norm).join(' | ');
    return regs
      .filter((r) => !r.deleted_at && r.status !== 'cancelled' && !openById.has(r.id) && words.every((w) => ownHay(r).includes(w)))
      .map((r) => ({ row: r, how: paidHow(r) }))
      .filter((m) => m.how)
      // Waiting to be verified first - that is the one somebody may be about to take twice.
      .sort((a, b) => Number(!!b.how.verify) - Number(!!a.how.verify) || String(a.row.attendee_name).localeCompare(String(b.row.attendee_name)))
      .slice(0, 6);
  })();
  // Somebody paid online and still waiting to be verified reads as that,
  // here too, rather than as just "For verification".
  const tagOf = (r) => (awaiting.has(r.id)
    ? <span className="pay-tag info" title="Sent with their registration - verify it in Online Payment Verification">Paid online · to verify</span>
    : <StatusTag status={r.status} />);

  useEffect(() => { setActiveIdx(0); }, [query, kind]);

  const add = (ids) => {
    const fresh = ids.filter((id) => !pickedSet.has(id));
    if (fresh.length) patch({ ids: [...form.ids, ...fresh] });
  };
  const choose = (opt) => {
    if (!opt) return;
    add(opt.type === 'group' ? opt.rows.map((r) => r.id) : [opt.row.id]);
    setQuery('');
    setSearchOpen(false);
    searchRef.current?.focus();
  };
  const remove = (id) => patch({ ids: form.ids.filter((x) => x !== id) });

  const onSearchKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSearchOpen(true); setActiveIdx((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(options[activeIdx]); }
    else if (e.key === 'Escape') setSearchOpen(false);
  };

  // ---- The arithmetic ----
  const due = picked.reduce((t, r) => t + dueOf(r), 0);
  const bedTotal = picked.reduce((t, r) => t + bedDue(r), 0);
  const entered = Number(form.total) || 0;
  const diff = (cents(entered) - cents(due)) / 100;
  const matched = picked.length > 0 && form.total !== '' && entered > 0 && diff === 0;

  const channel = channels.find((m) => m.id === form.methodId) || null;
  const bankName = kind === 'online' ? (form.methodId === 'other' ? form.otherBank.trim() : channel?.name || '') : '';

  // The first thing still missing, in the order the form asks for it.
  const missing = (() => {
    if (kind === 'cash') {
      if (!form.holder.trim()) return 'Enter the name of the person holding the money.';
      if (!(entered > 0)) return 'Enter the total money on hand.';
    } else {
      if (!bankName) return 'Choose the bank or e-wallet it was sent through.';
      if (!form.recipient.trim()) return 'Enter the name of the recipient.';
      if (!form.proof) return 'Attach the proof of payment.';
      if (!form.reference.trim()) return 'Enter the reference ID.';
      if (!(entered > 0)) return 'Enter the total amount sent.';
    }
    if (!picked.length) return 'Add the attendees this money is for.';
    if (diff !== 0) return `The attendees owe ${peso(due)} - that is ${diff > 0 ? 'over' : 'short'} by ${peso(Math.abs(diff))}.`;
    return '';
  })();

  const pickChannel = (m) => {
    const next = { methodId: m ? m.id : 'other' };
    // The account's own name is who received it, nine times out of ten.
    if (m?.account_name && !form.recipient.trim()) next.recipient = m.account_name;
    patch(next);
  };

  const submit = async () => {
    const snapshot = { kind, form: { ...form }, bankName, picked, due };
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('eventId', event.id);
      fd.append('actorId', actorId);
      fd.append('kind', snapshot.kind);
      fd.append('totalAmount', String(Number(snapshot.form.total) || 0));
      fd.append('notes', snapshot.form.notes || '');
      fd.append('registrationIds', JSON.stringify(snapshot.picked.map((r) => r.id)));
      if (snapshot.kind === 'cash') {
        fd.append('holderName', snapshot.form.holder.trim());
      } else {
        fd.append('bankName', snapshot.bankName);
        if (snapshot.form.methodId && snapshot.form.methodId !== 'other') fd.append('paymentMethodId', snapshot.form.methodId);
        fd.append('recipientName', snapshot.form.recipient.trim());
        fd.append('reference', snapshot.form.reference.trim());
        if (snapshot.form.proof) fd.append('proof', snapshot.form.proof);
      }
      const res = await fetch('/api/events/payments', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({ success: false, message: `The server answered ${res.status}.` }));
      if (!data.success) { showToast?.(data.message || 'Could not record the payment.', 'danger'); return; }
      showToast?.(data.message || 'Payment recorded.', 'success');
      if (data.warning) showToast?.(data.warning, 'warning');
      setForms((f) => ({ ...f, [snapshot.kind]: EMPTY[snapshot.kind] }));
      setTried(false);
      setQuery('');
      reloadRecords?.();
      onPaid?.(data.updated || []);
    } catch (err) {
      showToast?.(err.message || 'Could not record the payment.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const confirm = () => {
    setTried(true);
    if (missing) { showToast?.(missing, 'danger'); return; }
    const n = picked.length;
    const who = `${n} attendee${n === 1 ? '' : 's'}`;
    const message = kind === 'cash'
      ? `${peso(entered)} cash on hand from ${formatName(form.holder.trim())} will be recorded, and ${who} marked paid.`
      : `${peso(entered)} sent through ${bankName} to ${form.recipient.trim()} (ref ${form.reference.trim()}) will be recorded, and ${who} marked paid.`;
    if (askConfirm) {
      askConfirm(message, submit, {
        title: 'Confirm this payment?',
        subtitle: event?.title || 'Payments',
        confirmLabel: `Confirm ${peso(entered)}`,
        icon: kind === 'cash' ? 'fa-money-bill-wave' : 'fa-mobile-screen-button',
        confirmIcon: 'fa-check',
      });
    } else submit();
  };

  // ---- Changing a recorded payment (api/events/payments PATCH / DELETE) ----
  const send = async (method, url, body) => {
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return await res.json().catch(() => ({ success: false, message: `The server answered ${res.status}.` }));
    } catch (e) { return { success: false, message: e.message || 'Could not reach the server.' }; }
  };
  const afterChange = (data) => {
    showToast?.(data.message, 'success');
    if (data.warning) showToast?.(data.warning, 'warning');
    reloadRecords?.();
    onPaid?.(data.updated || []);
  };
  const recordLabel = (rec) => (rec.kind === 'cash'
    ? `the ${peso(rec.total_amount)} cash on hand from ${formatName(rec.holder_name)}`
    : `the ${peso(rec.total_amount)} ${rec.bank_name} payment${rec.reference ? ` (ref ${rec.reference})` : ''}`);

  const removeItem = (rec, it) => {
    const go = async () => {
      setRecBusy(`${rec.id}:${it.id}`);
      const data = await send('PATCH', '/api/events/payments', { actorId, id: rec.id, action: 'remove_items', registrationIds: [it.id] });
      setRecBusy('');
      if (!data.success) { showToast?.(data.message, 'danger'); return; }
      afterChange(data);
    };
    const left = (Number(rec.total_amount) || 0) - (Number(it.amount) || 0);
    const message = `Take ${formatName(it.name)} off ${recordLabel(rec)}? The ${peso(it.amount)} it paid for them is undone - they owe it again`
      + (left > 0 ? `, and the payment comes down to ${peso(left)}.` : ' - and, with nobody left on it, the payment is deleted.');
    if (askConfirm) askConfirm(message, go, { title: 'Take off this payment?', subtitle: event?.title || 'Payments', confirmLabel: 'Take off', icon: 'fa-user-minus', confirmIcon: 'fa-user-minus' });
    else go();
  };

  const deleteRecord = (rec) => {
    const n = (rec.items || []).length;
    const go = async () => {
      setRecBusy(rec.id);
      const data = await send('DELETE', `/api/events/payments?id=${encodeURIComponent(rec.id)}&actorId=${encodeURIComponent(actorId || '')}`);
      setRecBusy('');
      if (!data.success) { showToast?.(data.message, 'danger'); return; }
      afterChange(data);
    };
    const message = `Delete ${recordLabel(rec)}? ${n === 1 ? 'The attendee on it goes' : `All ${n} attendees on it go`} back to owing what it paid for them. Anybody already checked in stays checked in.`;
    if (askConfirm) askConfirm(message, go, { title: 'Delete this payment?', subtitle: event?.title || 'Payments', confirmLabel: 'Delete payment', icon: 'fa-trash', confirmIcon: 'fa-trash' });
    else go();
  };

  const openEdit = (rec) => setEditing({
    rec,
    holder: rec.holder_name || '',
    bank: rec.bank_name || '',
    recipient: rec.recipient_name || '',
    reference: rec.reference || '',
    notes: rec.notes || '',
    saving: false,
    error: '',
  });
  const saveEdit = async () => {
    const e = editing;
    if (!e || e.saving) return;
    const cash = e.rec.kind === 'cash';
    const missingField = cash
      ? (!e.holder.trim() && 'Enter the name of the person holding the money.')
      : (!e.bank.trim() && 'Enter the bank or e-wallet.') || (!e.recipient.trim() && 'Enter the name of the recipient.') || (!e.reference.trim() && 'Enter the reference ID.');
    if (missingField) { setEditing({ ...e, error: missingField }); return; }
    setEditing({ ...e, saving: true, error: '' });
    const data = await send('PATCH', '/api/events/payments', {
      actorId, id: e.rec.id, action: 'edit', notes: e.notes,
      ...(cash ? { holderName: e.holder } : { bankName: e.bank, recipientName: e.recipient, reference: e.reference }),
    });
    if (!data.success) { setEditing((cur) => (cur ? { ...cur, saving: false, error: data.message } : cur)); return; }
    setEditing(null);
    afterChange(data);
  };

  // What each kind has recorded: Cash On Hand its own records, Online Payment
  // every online payment (see onlineList).
  const listOf = (k) => (k === 'online' ? onlineList : records.filter((r) => r.kind === k));
  const kindRecords = listOf(kind);
  const kindTotal = (k) => listOf(k).reduce((t, r) => t + (Number(r.total_amount) || 0), 0);
  const history = kind === 'online' && recFilter !== 'all'
    ? kindRecords.filter((r) => (r.source === 'registration' ? 'registration' : 'admin') === recFilter)
    : kindRecords;
  const err = (bad) => (tried && bad ? 'is-error' : '');

  return (
    <div className="pay-tab">
      {/* The two ways money arrives, each its own form. */}
      <div className="pay-kinds" role="tablist" aria-label="Payment type">
        {KINDS.map((k) => {
          const n = k.key === 'verify' ? 0 : listOf(k.key).length;
          const sub = k.key === 'verify'
            ? (waiting.length ? `${waiting.length} to verify · ${peso(waitingTotal)}` : k.hint)
            : n > 0 ? `${n} recorded · ${peso(kindTotal(k.key))}` : k.hint;
          return (
            <button
              key={k.key}
              type="button"
              role="tab"
              aria-selected={kind === k.key}
              className={`pay-kind ${kind === k.key ? 'on' : ''}`}
              onClick={() => { setKind(k.key); setQuery(''); setSearchOpen(false); setTried(false); setVerifyQuery(''); }}
            >
              <span className="pay-kind-icon"><i className={`fas ${k.icon}`}></i></span>
              <span className="pay-kind-text">
                <b>{k.label}</b>
                <small>{sub}</small>
              </span>
              {k.key === 'verify'
                ? waiting.length > 0 && <em className="pay-kind-count alert">{waiting.length}</em>
                : forms[k.key].ids.length > 0 && <em className="pay-kind-count">{forms[k.key].ids.length}</em>}
            </button>
          );
        })}
      </div>

      {kind === 'verify' ? (
        <VerifyPanel
          waiting={waiting}
          verified={verified}
          initialQuery={verifyQuery}
          actorId={actorId}
          toastRef={toastRef}
          askConfirm={askConfirm}
          onChanged={() => onPaid?.([])}
          formatName={formatName}
          formatChurch={formatChurch}
        />
      ) : (
      <>
      {needsMigration && (
        <p className="pay-banner warn"><i className="fas fa-database"></i> {needsMigration}</p>
      )}

      <div className="pay-grid">
        {/* ---- What the money is ---- */}
        <section className="pay-card">
          <h4 className="pay-card-title">
            <i className={`fas ${kind === 'cash' ? 'fa-hand-holding-dollar' : 'fa-building-columns'}`}></i>
            {kind === 'cash' ? 'Cash On Hand' : 'Online Payment'}
          </h4>

          {kind === 'cash' ? (
            <>
              <label className="pay-field">
                <span>Name of the person holding the money <i>*</i></span>
                <input
                  className={`pay-input ${err(!form.holder.trim())}`}
                  value={form.holder}
                  onChange={(e) => patch({ holder: e.target.value })}
                  placeholder="e.g. Ptr. Juan Dela Cruz"
                  maxLength={120}
                  disabled={saving}
                />
              </label>
              <label className="pay-field">
                <span>Total money on hand <i>*</i></span>
                <span className={`pay-money ${err(!(entered > 0))}`}>
                  <b>₱</b>
                  <input
                    inputMode="decimal"
                    value={form.total}
                    onChange={(e) => patch({ total: moneyInput(e.target.value) })}
                    placeholder="0"
                    disabled={saving}
                  />
                </span>
              </label>
            </>
          ) : (
            <>
              <div className="pay-field">
                <span>Bank / e-wallet <i>*</i></span>
                <div className={`pay-banks ${err(!bankName)}`} role="radiogroup" aria-label="Bank or e-wallet">
                  {channels.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={form.methodId === m.id}
                      className={`pay-bank ${form.methodId === m.id ? 'on' : ''}`}
                      onClick={() => pickChannel(m)}
                      disabled={saving}
                      title={m.account_number ? `${m.name} · ${m.account_number}` : m.name}
                    >
                      {m.logo_url
                        ? <img src={m.logo_url} alt="" />
                        : <span className="pay-bank-dot" style={{ background: m.logo_color || '#1e3a8a' }}>{String(m.name || '?').slice(0, 2).toUpperCase()}</span>}
                      {m.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={form.methodId === 'other'}
                    className={`pay-bank ${form.methodId === 'other' ? 'on' : ''}`}
                    onClick={() => pickChannel(null)}
                    disabled={saving}
                  >
                    <span className="pay-bank-dot other"><i className="fas fa-ellipsis"></i></span>
                    Other
                  </button>
                </div>
                {form.methodId === 'other' && (
                  <input
                    className={`pay-input ${err(!form.otherBank.trim())}`}
                    style={{ marginTop: 8 }}
                    value={form.otherBank}
                    onChange={(e) => patch({ otherBank: e.target.value })}
                    placeholder="Bank or e-wallet name, e.g. Maya, BDO"
                    maxLength={80}
                    disabled={saving}
                    autoFocus
                  />
                )}
              </div>
              <label className="pay-field">
                <span>Name of recipient <i>*</i></span>
                <input
                  className={`pay-input ${err(!form.recipient.trim())}`}
                  value={form.recipient}
                  onChange={(e) => patch({ recipient: e.target.value })}
                  placeholder="Whose account received it"
                  maxLength={120}
                  disabled={saving}
                />
              </label>
              <div className="pay-field">
                <span>Proof of payment <i>*</i></span>
                <ProofDrop
                  id={`pay-proof-${event?.id || 'x'}`}
                  file={form.proof}
                  onPick={(f) => patch({ proof: f })}
                  invalid={tried && !form.proof}
                  label="Upload the receipt or screenshot"
                  hint="Photo, screenshot or PDF of the transfer"
                />
              </div>
              <label className="pay-field">
                <span>Reference ID <i>*</i></span>
                <input
                  className={`pay-input ${err(!form.reference.trim())}`}
                  value={form.reference}
                  onChange={(e) => patch({ reference: e.target.value })}
                  placeholder="Transaction / reference number"
                  maxLength={120}
                  disabled={saving}
                />
              </label>
              <label className="pay-field">
                <span>Total amount sent <i>*</i></span>
                <span className={`pay-money ${err(!(entered > 0))}`}>
                  <b>₱</b>
                  <input
                    inputMode="decimal"
                    value={form.total}
                    onChange={(e) => patch({ total: moneyInput(e.target.value) })}
                    placeholder="0"
                    disabled={saving}
                  />
                </span>
              </label>
            </>
          )}

          <label className="pay-field">
            <span>Notes</span>
            <textarea
              className="pay-input"
              rows={3}
              value={form.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder="Anything to remember about this payment - concerns, who to follow up, etc."
              maxLength={2000}
              disabled={saving}
            />
          </label>
        </section>

        {/* ---- Who it is for ---- */}
        <section className="pay-card">
          <h4 className="pay-card-title">
            <i className="fas fa-users"></i> Attendees
            {picked.length > 0 && <em className="pay-count">{picked.length}</em>}
            {picked.length > 1 && (
              <button type="button" className="pay-link" onClick={() => patch({ ids: [] })} disabled={saving}>
                <i className="fas fa-xmark"></i> Clear all
              </button>
            )}
          </h4>

          <div className="pay-search-wrap">
            <div className="pay-search">
              <i className="fas fa-magnifying-glass"></i>
              <input
                ref={searchRef}
                type="search"
                autoComplete="off"
                data-lpignore="true"
                data-form-type="other"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                onKeyDown={onSearchKey}
                placeholder={open.length ? `Search ${open.length} attendees who still owe - name, church, representative…` : 'Nobody on this event owes anything'}
                aria-label="Search attendees to add"
                disabled={saving || open.length === 0}
              />
            </div>
            {searchOpen && words.length > 0 && (
              <div className="pay-results" role="listbox">
                {options.length === 0 ? (
                  <p className="pay-results-empty">No one who still owes matches &ldquo;{query.trim()}&rdquo;.</p>
                ) : options.map((o, i) => (o.type === 'group' ? (
                  <button
                    key={o.key}
                    type="button"
                    role="option"
                    aria-selected={i === activeIdx}
                    className={`pay-result group ${i === activeIdx ? 'on' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => choose(o)}
                  >
                    <span className="pay-result-icon"><i className="fas fa-people-group"></i></span>
                    <span className="pay-result-who">
                      <b>Add all {o.rows.length} from {formatName(o.rep)}&apos;s booking</b>
                      <em>Everyone they registered who still owes</em>
                    </span>
                    <span className="pay-result-amt">{peso(o.total)}</span>
                  </button>
                ) : (
                  <button
                    key={o.key}
                    type="button"
                    role="option"
                    aria-selected={i === activeIdx}
                    className={`pay-result ${i === activeIdx ? 'on' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => choose(o)}
                  >
                    <span className="pay-result-icon"><i className="fas fa-user-plus"></i></span>
                    <span className="pay-result-who">
                      <b>{formatName(o.row.attendee_name)}</b>
                      <em>
                        {formatChurch(o.row.church_name) || 'No church given'}
                        {repOf(o.row) && norm(repOf(o.row)) !== norm(o.row.attendee_name) ? ` · rep. ${formatName(repOf(o.row))}` : ''}
                      </em>
                    </span>
                    {inOther.has(o.row.id) && <span className="pay-tag muted">In {kind === 'cash' ? 'Online' : 'Cash'} list</span>}
                    {tagOf(o.row)}
                    <BedTag fee={bedDue(o.row)} />
                    <span className="pay-result-amt">{peso(dueOf(o.row))}</span>
                  </button>
                )))}
                {/* Found, but nothing to take: paid already, or paid online
                    and waiting in Online Payment Verification. */}
                {paidMatches.length > 0 && (
                  <div className="pay-results-paid">
                    <p className="pay-results-head"><i className="fas fa-circle-check"></i> Already paid - cannot be added again</p>
                    {paidMatches.map(({ row: r, how }) => (
                      <div key={r.id} className="pay-result paid" role="option" aria-selected={false} aria-disabled="true">
                        <span className="pay-result-icon"><i className={`fas ${how.verify ? 'fa-hourglass-half' : 'fa-circle-check'}`}></i></span>
                        <span className="pay-result-who">
                          <b>{formatName(r.attendee_name)}</b>
                          <em title={how.hint}>{[formatChurch(r.church_name), how.hint].filter(Boolean).join(' · ') || '—'}</em>
                        </span>
                        <span className={`pay-tag ${how.tone}`}>{how.label}</span>
                        {how.verify && (
                          <button
                            type="button"
                            className="pay-result-go"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => goVerify(r)}
                            title="Open this receipt in Online Payment Verification"
                          >
                            Verify <i className="fas fa-arrow-right"></i>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {picked.length === 0 ? (
            <div className={`pay-empty ${tried ? 'is-error' : ''}`}>
              <i className="fas fa-user-plus"></i>
              <p>Search above and add the attendees this money is for.<br />Each one shows what they still have to pay.</p>
            </div>
          ) : (
            <ol className="pay-list">
              {picked.map((r, i) => (
                <li key={r.id} className="pay-item">
                  <span className="pay-item-n">{i + 1}</span>
                  <span className="pay-item-who">
                    <b>{formatName(r.attendee_name)}</b>
                    <em>
                      {formatChurch(r.church_name) || 'No church given'}
                      {r.payment_plan === 'flexible' && Number(r.amount_paid) > 0 ? ` · ${peso(r.amount_paid)} of ${peso(r.amount)} paid` : ''}
                    </em>
                  </span>
                  {tagOf(r)}
                  <BedTag fee={bedDue(r)} reg={regDue(r)} />
                  <span className="pay-item-amt">{peso(dueOf(r))}</span>
                  <button type="button" className="pay-item-x" onClick={() => remove(r.id)} disabled={saving} title="Remove" aria-label={`Remove ${formatName(r.attendee_name)}`}>
                    <i className="fas fa-xmark"></i>
                  </button>
                </li>
              ))}
            </ol>
          )}

          {/* The check the whole screen exists for. Wrapped so it can fold to
              two rows when its card is narrow (a container query). */}
          <div className="pay-sum-wrap">
          <div className="pay-sum">
            <div><span>Attendees</span><b>{picked.length}</b></div>
            <div><span>Total to pay</span><b>{peso(due)}</b></div>
            <div><span>{kind === 'cash' ? 'Money on hand' : 'Amount sent'}</span><b>{form.total === '' ? '—' : peso(entered)}</b></div>
            <div className={`pay-sum-state ${matched ? 'ok' : picked.length > 0 && form.total !== '' ? (diff > 0 ? 'over' : 'short') : ''}`}>
              <span>Status</span>
              <b>
                {matched ? <><i className="fas fa-circle-check"></i> Matched</>
                  : !picked.length || form.total === '' ? '—'
                    : <><i className="fas fa-triangle-exclamation"></i> {diff > 0 ? 'Over' : 'Short'} {peso(Math.abs(diff))}</>}
              </b>
            </div>
          </div>
          </div>
          {bedTotal > 0 && (
            <p className="pay-hint bed">
              <i className="fas fa-bed"></i>
              <span>
                The total includes <b>{peso(bedTotal)}</b> for accommodation {picked.filter((r) => bedDue(r) > 0).length === 1 ? 'an attendee is' : 'attendees are'} still
                on the waiting list for. It is kept as paid in advance - when a bed is given they get it already paid for.
              </span>
            </p>
          )}

          {missing ? (
            <p className={`pay-hint ${tried ? 'is-error' : ''}`}><i className="fas fa-circle-info"></i> {missing}</p>
          ) : (
            <p className="pay-hint ok">
              <i className="fas fa-circle-check"></i> The amounts match. Confirming marks {picked.length === 1 ? 'this attendee' : `all ${picked.length} attendees`} paid
              {kind === 'cash' ? ' in cash' : ` online (${bankName})`} - their attendance QR and RFID card unlock straight away.
            </p>
          )}

          <div className="pay-actions">
            <button
              type="button"
              className="pay-btn ghost"
              onClick={() => { setForms((f) => ({ ...f, [kind]: EMPTY[kind] })); setTried(false); setQuery(''); }}
              disabled={saving}
            >
              Reset
            </button>
            <button type="button" className="pay-btn primary" onClick={confirm} disabled={saving || (tried && !!missing)}>
              <i className={`fas ${saving ? 'fa-spinner fa-spin' : 'fa-check'}`}></i>
              {saving ? 'Saving…' : matched ? `Confirm ${peso(entered)}` : 'Confirm Payment'}
            </button>
          </div>
        </section>
      </div>

      {/* ---- What has been recorded this way ---- */}
      <section className="pay-card pay-history">
        <h4 className="pay-card-title">
          <i className="fas fa-clock-rotate-left"></i>
          Recorded {kind === 'cash' ? 'Cash On Hand' : 'Online Payments'}
          {kindRecords.length > 0 && <em className="pay-count">{kindRecords.length}</em>}
        </h4>
        {/* Recorded here by an admin, or sent with the registration and
            verified - the same payments the Verification view lists. */}
        {kind === 'online' && kindRecords.length > 0 && (
          <div className="pay-vviews pay-rfilter" role="tablist" aria-label="Show">
            {[
              ['all', 'All', kindRecords.length],
              ['admin', SOURCES.admin.label, onlineRecords.length],
              ['registration', SOURCES.registration.label, regVerified.length],
            ].map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={recFilter === key}
                className={recFilter === key ? 'on' : ''}
                onClick={() => setRecFilter(key)}
                title={SOURCES[key]?.title}
              >
                {SOURCES[key] && <i className={`fas ${SOURCES[key].icon}`}></i>} {label} <em>{count}</em>
              </button>
            ))}
          </div>
        )}
        {recordsLoading ? (
          <p className="pay-muted"><i className="fas fa-spinner fa-spin"></i> Loading…</p>
        ) : history.length === 0 ? (
          <p className="pay-muted">
            {kindRecords.length === 0 ? 'Nothing recorded here yet.'
              : recFilter === 'admin' ? 'No online payment has been recorded by an admin yet.'
                : 'No payment sent with a registration has been verified yet.'}
          </p>
        ) : (
          <div className="pay-records">
            {history.slice(0, recShown).map((rec) => (
              <RecordRow
                key={rec.id}
                rec={rec}
                reviews={reviews}
                formatName={formatName}
                formatChurch={formatChurch}
                busy={recBusy}
                onReceipt={() => setReceiptRec(rec)}
                onEdit={() => openEdit(rec)}
                onDelete={() => deleteRecord(rec)}
                onRemove={(it) => removeItem(rec, it)}
              />
            ))}
            {history.length > recShown && (
              <button type="button" className="pay-btn ghost pay-vmore" onClick={() => setRecShown((n) => n + REC_PAGE)}>
                Show {Math.min(REC_PAGE, history.length - recShown)} more <span>({history.length - recShown} left)</span>
              </button>
            )}
          </div>
        )}
      </section>
      </>
      )}

      {receiptRec && (
        <RecordReceipt
          rec={receiptRec}
          regById={regById}
          eventTitle={event?.title || ''}
          onClose={() => setReceiptRec(null)}
          formatName={formatName}
          formatChurch={formatChurch}
          showToast={showToast}
        />
      )}
      {editing && (
        <RecordEdit
          e={editing}
          set={(p) => setEditing((cur) => (cur ? { ...cur, ...p, error: '' } : cur))}
          channels={channels}
          onSave={saveEdit}
          onClose={() => !editing.saving && setEditing(null)}
          formatName={formatName}
        />
      )}
    </div>
  );
}

// ---- A recorded payment's receipt ----
// Who it was from (or where it was sent), when, by whom; each attendee with
// their registration fee and extras as their registration reads now, and what
// this payment took for them; the total. Printable.
function receiptLinesOf(reg) {
  if (!reg) return [];
  const extras = (Array.isArray(reg.addons) ? reg.addons : []).filter((a) => a && (a.question || a.id)).map((a) => ({
    label: addonShortLabel(a.question),
    amount: extraNetFee(a),
    note: Number(a.waived) > 0 ? (extraNetFee(a) > 0 ? `${peso(a.waived)} exempted` : 'free · exempted') : '',
  }));
  const amount = Number(reg.amount) || 0;
  const discount = Number(reg.discount_amount) || 0;
  const fee = Math.max(0, amount - extras.reduce((t, e) => t + e.amount, 0)) + discount;
  return [
    { label: `Registration fee${reg.price_tier ? ` · ${reg.price_tier}` : ''}`, amount: fee },
    ...extras,
    ...(discount > 0 ? [{ label: `Discount${reg.discount_note ? ` · ${reg.discount_note}` : ''}`, amount: -discount }] : []),
  ];
}
const signedPeso = (n) => `${n < 0 ? '−' : ''}${peso(Math.abs(Number(n) || 0))}`;

function RecordReceipt({ rec, regById, eventTitle, onClose, formatName, formatChurch, showToast }) {
  const items = Array.isArray(rec.items) ? rec.items : [];
  const cash = rec.kind === 'cash';
  const fromReg = rec.source === 'registration';
  const title = cash ? `Cash on hand from ${formatName(rec.holder_name)}`
    : fromReg ? `${rec.bank_name} · sent by ${formatName(rec.sender_name) || 'the attendee'}`
      : `${rec.bank_name} → ${rec.recipient_name}`;
  const people = items.map((it) => {
    const reg = regById.get(it.id);
    const lines = receiptLinesOf(reg);
    const total = reg ? Number(reg.amount) || 0 : Number(it.total) || Number(it.amount) || 0;
    return { it, reg, lines, total, paid: Number(it.amount) || 0, bed: Number(it.bedFee) || 0 };
  });
  const by = fromReg ? (rec.recorded_by_name ? `verified by ${formatName(rec.recorded_by_name)}` : 'verified')
    : `recorded by ${formatName(rec.recorded_by_name) || 'Super Admin'}`;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const print = () => {
    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const row = (label, amount, cls = '') => `<tr class="${cls}"><td>${esc(label)}</td><td class="amt">${esc(signedPeso(amount))}</td></tr>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Receipt - ${esc(title)}</title>
<style>
  body { font-family: Arial, sans-serif; color: #222; max-width: 440px; margin: 24px auto; padding: 0 16px; font-size: 13px; }
  h1 { font-size: 17px; margin: 0; } .sub { color: #666; margin: 2px 0 14px; } .ref { margin: 0 0 12px; }
  h2 { font-size: 13px; margin: 14px 0 2px; } .church { color: #777; font-size: 11px; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; } td { padding: 3px 0; } .amt { text-align: right; white-space: nowrap; }
  .paid td { border-top: 1px dashed #bbb; font-weight: bold; } .grand td { border-top: 2px solid #222; font-size: 15px; font-weight: bold; padding-top: 6px; }
  .notes { margin-top: 12px; color: #444; white-space: pre-wrap; } .muted { color: #777; font-size: 11px; margin-top: 12px; }
</style></head><body>
<h1>${esc(eventTitle)}</h1>
<div class="sub">${esc(title)} · ${esc(stamp(rec.created_at))} · ${esc(by)}</div>
${!cash && rec.reference ? `<div class="ref">Reference: <b>${esc(rec.reference)}</b></div>` : ''}
${people.map((p) => `<h2>${esc(formatName(p.it.name))}</h2><div class="church">${esc(formatChurch(p.it.church) || '')}</div><table>${p.lines.map((l) => row(l.note ? `${l.label} (${l.note})` : l.label, l.amount)).join('')}${p.bed > 0 ? row('Accommodation (waiting list)', p.bed) : ''}${row('Paid on this payment', p.paid, 'paid')}</table>`).join('')}
<table style="margin-top:14px">${row(cash ? 'Total money on hand' : 'Total amount sent', rec.total_amount, 'grand')}</table>
${rec.notes ? `<div class="notes"><b>Notes:</b> ${esc(rec.notes)}</div>` : ''}
<div class="muted">${items.length} attendee${items.length === 1 ? '' : 's'}</div>
</body></html>`;
    const w = window.open('', '_blank', 'width=540,height=720');
    if (!w) { showToast?.('Allow pop-ups to print the receipt', 'warning'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="pay-modal-overlay" onClick={onClose}>
      <div className="pay-modal pay-receipt" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Receipt">
        <div className="pay-modal-head">
          <div>
            <h3><i className="fas fa-receipt"></i> Receipt</h3>
            <p>{eventTitle}</p>
          </div>
          <button type="button" className="pay-modal-x" onClick={onClose} aria-label="Close"><i className="fas fa-xmark"></i></button>
        </div>
        <div className="pay-modal-body">
          <div className="pay-receipt-top">
            <b>{title}</b>
            <span>{stamp(rec.created_at)} · {by}</span>
            {!cash && rec.reference && <span>Reference <code>{rec.reference}</code></span>}
          </div>
          {people.map((p) => (
            <div key={p.it.id} className="pay-receipt-person">
              <div className="pay-receipt-name">
                <b>{formatName(p.it.name)}</b>
                <em>{formatChurch(p.it.church) || 'No church given'}</em>
              </div>
              {p.lines.map((l, i) => (
                <div key={i} className={`pay-receipt-line ${l.amount < 0 ? 'minus' : ''}`}>
                  <span>{l.label}{l.note && <small> · {l.note}</small>}</span>
                  <b>{signedPeso(l.amount)}</b>
                </div>
              ))}
              {p.bed > 0 && (
                <div className="pay-receipt-line"><span>Accommodation · waiting list</span><b>{peso(p.bed)}</b></div>
              )}
              {!p.reg && <div className="pay-receipt-line"><span><small>No longer on the event</small></span><b /></div>}
              <div className="pay-receipt-line paid">
                <span>Paid on this payment{p.reg && cents(p.paid - p.bed) < cents(p.total) ? <small> · of {peso(p.total)}</small> : null}</span>
                <b>{peso(p.paid)}</b>
              </div>
            </div>
          ))}
          <div className="pay-receipt-total">
            <span>{cash ? 'Total money on hand' : 'Total amount sent'}</span>
            <b>{peso(rec.total_amount)}</b>
          </div>
          {rec.notes && <p className="pay-receipt-notes"><i className="fas fa-note-sticky"></i> {rec.notes}</p>}
          {rec.proof_url && (
            <a href={rec.proof_url} target="_blank" rel="noopener noreferrer" className="pay-link">
              <i className={`fas ${isImageProof(rec.proof_url) ? 'fa-image' : 'fa-file-lines'}`}></i> View proof of payment
            </a>
          )}
        </div>
        <div className="pay-modal-foot">
          <button type="button" className="pay-btn ghost" onClick={onClose}>Close</button>
          <button type="button" className="pay-btn primary" onClick={print}><i className="fas fa-print"></i> Print</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---- Editing a recorded payment: the names on it, and its notes ----
function RecordEdit({ e, set, channels, onSave, onClose, formatName }) {
  const cash = e.rec.kind === 'cash';
  useEffect(() => {
    const onKey = (ev) => { if (ev.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="pay-modal-overlay" onClick={onClose}>
      <form className="pay-modal pay-edit" onClick={(ev) => ev.stopPropagation()} onSubmit={(ev) => { ev.preventDefault(); onSave(); }} role="dialog" aria-modal="true" aria-label="Edit payment">
        <div className="pay-modal-head">
          <div>
            <h3><i className="fas fa-pen"></i> Edit payment</h3>
            <p>{peso(e.rec.total_amount)} · {(e.rec.items || []).length} attendee{(e.rec.items || []).length === 1 ? '' : 's'} · {stamp(e.rec.created_at)}</p>
          </div>
          <button type="button" className="pay-modal-x" onClick={onClose} aria-label="Close"><i className="fas fa-xmark"></i></button>
        </div>
        <div className="pay-modal-body">
          {cash ? (
            <label className="pay-field">
              <span>Name of the person holding the money <i>*</i></span>
              <input className="pay-input" value={e.holder} onChange={(ev) => set({ holder: ev.target.value })} maxLength={120} disabled={e.saving} autoFocus />
            </label>
          ) : (
            <>
              <label className="pay-field">
                <span>Bank / e-wallet <i>*</i></span>
                <input className="pay-input" value={e.bank} onChange={(ev) => set({ bank: ev.target.value })} maxLength={80} disabled={e.saving} list="pay-edit-banks" autoFocus />
                <datalist id="pay-edit-banks">{channels.map((m) => <option key={m.id} value={m.name} />)}</datalist>
              </label>
              <label className="pay-field">
                <span>Name of recipient <i>*</i></span>
                <input className="pay-input" value={e.recipient} onChange={(ev) => set({ recipient: ev.target.value })} maxLength={120} disabled={e.saving} />
              </label>
              <label className="pay-field">
                <span>Reference ID <i>*</i></span>
                <input className="pay-input" value={e.reference} onChange={(ev) => set({ reference: ev.target.value })} maxLength={120} disabled={e.saving} />
              </label>
            </>
          )}
          <label className="pay-field">
            <span>Notes</span>
            <textarea className="pay-input" rows={3} value={e.notes} onChange={(ev) => set({ notes: ev.target.value })} maxLength={2000} disabled={e.saving} />
          </label>
          <p className="pay-hint">
            <i className="fas fa-circle-info"></i> The attendees it paid are changed with it, where they still show {cash ? `${formatName(e.rec.holder_name)} as holding the money` : 'this bank and reference'}.
            To change who it paid for, take an attendee off it - or delete it and record it again.
          </p>
          {e.error && <p className="pay-hint is-error"><i className="fas fa-triangle-exclamation"></i> {e.error}</p>}
        </div>
        <div className="pay-modal-foot">
          <button type="button" className="pay-btn ghost" onClick={onClose} disabled={e.saving}>Cancel</button>
          <button type="submit" className="pay-btn primary" disabled={e.saving}>
            <i className={`fas ${e.saving ? 'fa-spinner fa-spin' : 'fa-check'}`}></i> {e.saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

// The bed somebody on the accommodation waiting list is paying for now.
function BedTag({ fee, reg }) {
  if (!(fee > 0)) return null;
  return (
    <span
      className="pay-tag bed"
      title={`Includes ${peso(fee)} for accommodation they are on the waiting list for${reg != null ? ` (registration ${peso(reg)} + bed ${peso(fee)})` : ''} - kept as paid in advance until a bed is given.`}
    >
      <i className="fas fa-bed"></i> +{peso(fee)} waiting list
    </span>
  );
}

function StatusTag({ status }) {
  const t = STATUS_TAGS[status];
  if (!t) return null;
  return <span className={`pay-tag ${t.tone}`}>{t.label}</span>;
}

function RecordRow({ rec, reviews, formatName, formatChurch, busy, onReceipt, onEdit, onDelete, onRemove }) {
  const items = Array.isArray(rec.items) ? rec.items : [];
  const cash = rec.kind === 'cash';
  // Sent online with the registration and verified, not recorded on this tab
  // (transferRecord) - it has no record of its own to disagree with, and
  // nothing here to edit or delete: it is changed where it was verified.
  const fromReg = rec.source === 'registration';
  const deleting = busy === rec.id;
  // Attendees on this payment whose registration no longer agrees with it.
  const flagged = fromReg ? [] : items.filter((it) => reviews.get(it.id)?.record?.id === rec.id);
  return (
    <details className={`pay-record ${fromReg ? 'from-reg' : ''}`}>
      <summary>
        <span className={`pay-record-icon ${cash ? 'cash' : fromReg ? 'reg' : 'online'}`}>
          <i className={`fas ${cash ? 'fa-money-bill-wave' : fromReg ? 'fa-receipt' : 'fa-mobile-screen-button'}`}></i>
        </span>
        <span className="pay-record-main">
          <b>
            {cash ? `From ${formatName(rec.holder_name)}`
              : fromReg ? `${rec.bank_name} · sent by ${formatName(rec.sender_name) || 'the attendee'}`
                : `${rec.bank_name} → ${rec.recipient_name}`}
          </b>
          <em>
            {items.length} attendee{items.length === 1 ? '' : 's'}
            {!cash && rec.reference ? ` · Ref ${rec.reference}` : ''}
            {' · '}{fromReg ? `Verified ${stamp(rec.created_at)}` : stamp(rec.created_at)}
          </em>
        </span>
        {!cash && <SourceTag source={fromReg ? 'registration' : 'admin'} />}
        {flagged.length > 0 && (
          <span className="pay-tag review" title="Some attendees on this payment do not match their registration">
            <i className="fas fa-triangle-exclamation"></i> {flagged.length} to review
          </span>
        )}
        {rec.notes && <span className="pay-record-note" title="Has notes"><i className="fas fa-note-sticky"></i></span>}
        <span className="pay-record-amt">{peso(rec.total_amount)}</span>
        <i className="fas fa-chevron-down pay-record-caret"></i>
      </summary>
      <div className="pay-record-body">
        <ul>
          {items.map((it) => {
            const review = reviews.get(it.id);
            const mine = review?.record?.id === rec.id;
            return (
              <li key={it.id} className={mine ? 'is-review' : ''}>
                <span>
                  <b>{formatName(it.name)}</b>
                  <em>{formatChurch(it.church) || 'No church given'}</em>
                  {mine && review.reasons.map((why) => (
                    <small key={why} className="pay-review-why"><i className="fas fa-triangle-exclamation"></i> {why}</small>
                  ))}
                </span>
                <span className="pay-record-itemend">
                  {peso(it.amount)}
                  {!fromReg && onRemove && (
                    <button
                      type="button"
                      className="pay-record-x"
                      onClick={() => onRemove(it)}
                      disabled={!!busy}
                      title="Take them off this payment - their payment is undone"
                      aria-label={`Take ${formatName(it.name)} off this payment`}
                    >
                      <i className={`fas ${busy === `${rec.id}:${it.id}` ? 'fa-spinner fa-spin' : 'fa-user-minus'}`}></i>
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {rec.notes && (
          <div className="pay-record-notes">
            <span>Notes</span>
            <p>{rec.notes}</p>
          </div>
        )}
        <div className="pay-record-foot">
          {fromReg ? (
            <span>
              Paid at registration{rec.registered_at ? ` (${stamp(rec.registered_at)})` : ''}
              {' · '}verified{rec.recorded_by_name ? <> by <b>{formatName(rec.recorded_by_name)}</b></> : ''}
            </span>
          ) : (
            <span>Recorded by <b>{formatName(rec.recorded_by_name) || 'Super Admin'}</b>{cash ? '' : ' on the Online Payment tab'}</span>
          )}
          {rec.proof_url && (
            <a href={rec.proof_url} target="_blank" rel="noopener noreferrer" className="pay-link">
              <i className={`fas ${isImageProof(rec.proof_url) ? 'fa-image' : 'fa-file-lines'}`}></i> View proof of payment
            </a>
          )}
        </div>
        <div className="pay-record-acts">
          {onReceipt && (
            <button type="button" className="pay-btn ghost sm" onClick={onReceipt}>
              <i className="fas fa-receipt"></i> View receipt
            </button>
          )}
          {!fromReg && onEdit && (
            <button type="button" className="pay-btn ghost sm" onClick={onEdit} disabled={!!busy}>
              <i className="fas fa-pen"></i> Edit
            </button>
          )}
          {!fromReg && onDelete && (
            <button type="button" className="pay-btn ghost sm danger" onClick={onDelete} disabled={!!busy}>
              <i className={`fas ${deleting ? 'fa-spinner fa-spin' : 'fa-trash'}`}></i> Delete
            </button>
          )}
        </div>
      </div>
    </details>
  );
}

// ---- Online Payment Verification ----
// Every receipt sent at registration that nobody has checked yet, one card per
// transfer. Verifying moves the ticked attendees to Paid, one PUT each with
// groupCascade off - the ticks already say exactly who the transfer covers,
// as in the proof window. "Not received" sends them back to Awaiting payment.
//
// Verified is every online payment, for looking back at what has been checked:
// the receipts verified here (or in the proof window), and the payments an
// admin recorded on the Online Payment tab - the same list as Recorded Online
// Payments, each tagged with where it came from.
const PAGE = 10;

function VerifyPanel({ waiting, verified, initialQuery = '', actorId, toastRef, askConfirm, onChanged, formatName, formatChurch }) {
  const [view, setView] = useState('waiting'); // 'waiting' | 'verified'
  const [q, setQ] = useState(initialQuery);
  const [sort, setSort] = useState('oldest');
  const [unticked, setUnticked] = useState(() => new Set());
  const [busy, setBusy] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [viewing, setViewing] = useState(null); // a proof URL

  useEffect(() => { setShown(PAGE); }, [view, q, sort]);

  const words = norm(q).split(' ').filter(Boolean);
  const list = (view === 'waiting' ? waiting : verified)
    .filter((g) => {
      if (!words.length) return true;
      const hay = [g.sender, g.record?.bank_name || g.lead.payment_method, g.record?.recorded_by_name, ...g.refs, ...g.rows.flatMap((r) => [
        r.attendee_name, r.church_name, r.church_pastor, r.attendee_mobile, r.attendee_email,
      ])].map(norm).join(' | ');
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => {
      const d = String(a.when || '').localeCompare(String(b.when || ''));
      return sort === 'oldest' ? d : -d;
    });

  const toggle = (id) => setUnticked((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const run = async (g, rows, status) => {
    setBusy(g.key);
    let ok = 0;
    const failed = [];
    try {
      for (const r of rows) {
        try {
          const res = await fetch('/api/events/registrations', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: r.id, actorId, status, groupCascade: false }),
          });
          const data = await res.json();
          if (data.success) ok += 1; else failed.push(formatName(r.attendee_name));
        } catch { failed.push(formatName(r.attendee_name)); }
      }
      const total = rows.reduce((t, r) => t + (Number(r.amount) || 0), 0);
      if (ok) {
        toastRef.current?.(status === 'payment_verified'
          ? `${peso(total)} verified - ${ok} attendee${ok === 1 ? '' : 's'} marked paid`
          : `${ok} attendee${ok === 1 ? '' : 's'} moved back to Awaiting payment`, failed.length ? 'warning' : 'success');
      }
      if (failed.length) toastRef.current?.(`Could not update: ${failed.join(', ')}`, 'danger');
      setUnticked((s) => {
        const next = new Set(s);
        rows.forEach((r) => next.delete(r.id));
        return next;
      });
      onChanged?.();
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="pay-verify">
      <div className="pay-vbar">
        <div className="pay-vviews" role="tablist" aria-label="Show">
          <button type="button" role="tab" aria-selected={view === 'waiting'} className={view === 'waiting' ? 'on' : ''} onClick={() => setView('waiting')}>
            <i className="fas fa-hourglass-half"></i> Awaiting verification <em>{waiting.length}</em>
          </button>
          <button type="button" role="tab" aria-selected={view === 'verified'} className={view === 'verified' ? 'on' : ''} onClick={() => setView('verified')}>
            <i className="fas fa-circle-check"></i> Verified <em>{verified.length}</em>
          </button>
        </div>
        <div className="pay-search pay-vsearch">
          <i className="fas fa-magnifying-glass"></i>
          <input
            type="search"
            autoComplete="off"
            data-lpignore="true"
            data-form-type="other"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search sender, attendee, church or reference"
            aria-label="Search payments"
          />
        </div>
        <select className="pay-input pay-vsort" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="oldest">Oldest first</option>
          <option value="newest">Newest first</option>
        </select>
      </div>

      {list.length === 0 ? (
        <div className="pay-card pay-vempty">
          <i className={`fas ${view === 'waiting' ? 'fa-circle-check' : 'fa-receipt'}`}></i>
          <p>
            {words.length ? <>No payment matches &ldquo;{q.trim()}&rdquo;.</>
              : view === 'waiting' ? 'No online payments are waiting for verification.'
                : 'No online payment has been verified yet.'}
          </p>
        </div>
      ) : (
        <div className="pay-vlist">
          {list.slice(0, shown).map((g) => (
            <TransferCard
              key={g.key}
              g={g}
              view={view}
              unticked={unticked}
              toggle={toggle}
              busy={busy}
              onVerify={(rows) => run(g, rows, 'payment_verified')}
              onReject={(rows) => {
                const total = rows.reduce((t, r) => t + (Number(r.amount) || 0), 0);
                const n = rows.length;
                const go = () => run(g, rows, 'pending_payment');
                if (!askConfirm) { go(); return; }
                askConfirm(
                  `Mark ${formatName(g.sender)}'s ${peso(total)} payment as not received? ${n === 1 ? 'This attendee goes' : `These ${n} attendees go`} back to Awaiting payment and no longer hold a seat until they pay again.`,
                  go,
                  { title: 'Payment not received?', subtitle: 'Online Payment Verification', confirmLabel: 'Mark not received', icon: 'fa-ban', confirmIcon: 'fa-ban' },
                );
              }}
              onView={setViewing}
              formatName={formatName}
              formatChurch={formatChurch}
            />
          ))}
          {list.length > shown && (
            <button type="button" className="pay-btn ghost pay-vmore" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, list.length - shown)} more <span>({list.length - shown} left)</span>
            </button>
          )}
        </div>
      )}

      {viewing && <ProofViewer url={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function TransferCard({ g, view, unticked, toggle, busy, onVerify, onReject, onView, formatName, formatChurch }) {
  const waitingView = view === 'waiting';
  // Recorded on the Online Payment tab by an admin (recordTransfer), rather
  // than sent with the registration.
  const rec = g.record || null;
  // Waiting: everyone on the booking still to be checked. Verified: the rows
  // this transfer actually paid (not a group-mate who paid in cash).
  const covered = waitingView ? g.rows.filter((r) => VERIFIABLE.has(r.status)) : g.leadRows;
  const others = g.rows.filter((r) => !covered.includes(r));
  const picked = waitingView ? covered.filter((r) => !unticked.has(r.id)) : covered;
  // What each paid on it: a recorded payment says; otherwise their total.
  const amountOf = (r) => (g.amounts ? g.amounts.get(r.id) || 0 : Number(r.amount) || 0);
  const total = rec ? Number(rec.total_amount) || 0 : covered.reduce((t, r) => t + amountOf(r), 0);
  const pickedTotal = picked.reduce((t, r) => t + amountOf(r), 0);
  const saving = busy === g.key;
  const lead = g.lead;
  const proof = rec ? rec.proof_url : lead.payment_proof_url;
  const verifiedBy = !waitingView && lead.paid_by_name ? formatName(lead.paid_by_name) : '';

  return (
    <article className={`pay-card pay-vcard ${saving ? 'is-busy' : ''}`}>
      {/* ---- The payment: who sent it, the receipt, what it comes to ---- */}
      <div className="pay-vleft">
        <button
          type="button"
          className={`pay-vproof ${proof ? '' : 'none'}`}
          onClick={() => proof && (isImageProof(proof) ? onView(proof) : window.open(proof, '_blank', 'noopener'))}
          disabled={!proof}
          title={proof ? 'View the receipt' : 'No receipt attached'}
        >
          {proof && isImageProof(proof)
            ? <img src={proof} alt="Payment receipt" loading="lazy" />
            : (
              <span>
                <i className={`fas ${!proof ? 'fa-receipt' : isPdfProof(proof) ? 'fa-file-pdf' : 'fa-file-lines'}`}></i>
                <small>{proof ? proofFileName(proof) : 'No receipt'}</small>
              </span>
            )}
          {proof && <em><i className="fas fa-magnifying-glass-plus"></i></em>}
        </button>
        <div className="pay-vinfo">
          {!waitingView && <span className="pay-vsource"><SourceTag source={rec ? 'admin' : 'registration'} /></span>}
          <span className="pay-vlabel">{rec ? 'Sent to' : 'Sender'}</span>
          <b className="pay-vsender">{(rec ? rec.recipient_name : formatName(g.sender)) || '—'}</b>
          <em className="pay-vsub">
            {rec ? 'Recorded on the Online Payment tab' : (
              <>
                {isBulk(lead) ? `Representative · ${g.rows.length} registered` : formatChurch(lead.church_name) || 'No church given'}
                {lead.attendee_mobile ? ` · ${lead.attendee_mobile}` : ''}
              </>
            )}
          </em>
          <dl className="pay-vfacts">
            <div><dt>Bank / e-wallet</dt><dd>{(rec ? rec.bank_name : lead.payment_method) || '—'}</dd></div>
            <div>
              <dt>Reference ID</dt>
              <dd className={g.refs.length ? 'ref' : 'missing'}>{g.refs.length ? g.refs.join(', ') : 'Not given'}</dd>
            </div>
            <div><dt>{rec ? 'Recorded' : 'Registered'}</dt><dd>{stamp(g.when)}</dd></div>
          </dl>
          <div className="pay-vtotal">
            <span>Total amount</span>
            <b>{peso(total)}</b>
          </div>
        </div>
      </div>

      {/* ---- Everyone this transfer covers ---- */}
      <div className="pay-vright">
        <h5>
          <i className="fas fa-users"></i> Attendees on this payment <em className="pay-count">{covered.length}</em>
        </h5>
        <ul className="pay-vrows">
          {covered.map((r) => {
            const on = picked.includes(r);
            return (
              <li key={r.id}>
                <label className={`pay-vrow ${on ? 'on' : ''} ${waitingView ? '' : 'done'}`}>
                  {waitingView
                    ? <input type="checkbox" checked={on} onChange={() => toggle(r.id)} disabled={saving} />
                    : <span className="pay-vtick"><i className="fas fa-circle-check"></i></span>}
                  <span className="pay-item-who">
                    <b>{formatName(r.attendee_name)}</b>
                    <em>
                      {[
                        norm(repOf(r)) && norm(repOf(r)) === norm(r.attendee_name) ? 'Representative' : null,
                        r.price_tier || formatChurch(r.church_name) || null,
                        (r.addons || []).length ? `+ ${(r.addons || []).map((a) => a.question).join(', ')}` : null,
                      ].filter(Boolean).join(' · ') || '—'}
                    </em>
                  </span>
                  <span className="pay-item-amt">{peso(amountOf(r))}</span>
                </label>
              </li>
            );
          })}
          {/* The rest of the booking, settled some other way - for context. */}
          {others.map((r) => (
            <li key={r.id}>
              <div className="pay-vrow other">
                <span className="pay-vtick muted"><i className="fas fa-minus"></i></span>
                <span className="pay-item-who">
                  <b>{formatName(r.attendee_name)}</b>
                  <em>{r.status === 'payment_verified' ? 'Paid' : STATUS_TAGS[r.status]?.label || String(r.status || '').replace(/_/g, ' ')}</em>
                </span>
                <span className="pay-item-amt muted">{peso(r.amount)}</span>
              </div>
            </li>
          ))}
        </ul>

        {waitingView ? (
          <>
            <div className="pay-vsum">
              <span>Selected <b>{picked.length} of {covered.length}</b></span>
              <span>To verify <b>{peso(pickedTotal)}</b></span>
            </div>
            {picked.length < covered.length && picked.length > 0 && (
              <p className="pay-hint"><i className="fas fa-circle-info"></i> Only the ticked attendees are verified - the rest stay waiting.</p>
            )}
            <div className="pay-actions">
              <button type="button" className="pay-btn ghost danger" onClick={() => onReject(picked)} disabled={saving || picked.length === 0}>
                <i className="fas fa-ban"></i> Not received
              </button>
              <button type="button" className="pay-btn verify" onClick={() => onVerify(picked)} disabled={saving || picked.length === 0}>
                <i className={`fas ${saving ? 'fa-spinner fa-spin' : 'fa-circle-check'}`}></i>
                {saving ? 'Saving…' : `Verify ${peso(pickedTotal)}`}
              </button>
            </div>
          </>
        ) : rec ? (
          <>
            {rec.notes && <p className="pay-hint pay-vnote"><i className="fas fa-note-sticky"></i> <span>{rec.notes}</span></p>}
            <p className="pay-hint ok">
              <i className="fas fa-user-shield"></i>
              <span>
                Recorded by <b>{formatName(rec.recorded_by_name) || 'Super Admin'}</b> on the Online Payment tab
                {rec.created_at ? ` · ${stamp(rec.created_at)}` : ''}
              </span>
            </p>
          </>
        ) : (
          <p className="pay-hint ok">
            <i className="fas fa-circle-check"></i>
            <span>
              Paid at registration · verified{verifiedBy ? <> by <b>{verifiedBy}</b></> : ''}
              {lead.paid_at || lead.verified_at ? ` · ${stamp(lead.paid_at || lead.verified_at)}` : ''}
            </span>
          </p>
        )}
      </div>
    </article>
  );
}

// A receipt, full size, over the page. Esc or a click outside closes it.
function ProofViewer({ url, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = before; };
  }, [onClose]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="pay-viewer" role="dialog" aria-modal="true" aria-label="Payment receipt" onClick={onClose}>
      <img src={url} alt="Payment receipt" onClick={(e) => e.stopPropagation()} />
      <div className="pay-viewer-bar" onClick={(e) => e.stopPropagation()}>
        <a href={url} target="_blank" rel="noopener noreferrer"><i className="fas fa-up-right-from-square"></i> Open full size</a>
        <button type="button" onClick={onClose}><i className="fas fa-xmark"></i> Close</button>
      </div>
    </div>,
    document.body,
  );
}
