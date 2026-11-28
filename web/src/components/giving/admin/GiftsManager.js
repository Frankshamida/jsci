'use client';

// Dashboard > Giving > Gifts: every gift sent to the church, newest first,
// in a table with pages. Match each with the church's GCash, Maya or bank
// history by its reference number, then Confirm it: the giver is emailed a
// thank-you with a link to the giving jar. Mark it failed if the money never
// came, refunded if it was given back. Record a gift handed over in person
// (cash, a card at church) with "Record a gift".
//
// A donation shows its drive, with the drive's photo; clicking it shows only
// that drive's gifts. A row opens the gift's details in a side panel.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FUNDS, giftWhen, jarPath, methodLabel, peso, phYear, receiptPath,
} from '@/lib/giving';
import { Field, Modal, Notice, Switch } from '@/components/social/kit';
import { DeskHead, Drawer, DriveThumb, Pager, Pill, Strip, Tabs, pageOf } from '@/components/giving/desk';

const API = '/api/giving/manage/gifts';
const FORM_ID = 'gvg';
const IN_PERSON = ['Cash', 'Card'];
const STATUS = {
  pending: { tone: 'wa', label: 'To confirm' },
  successful: { tone: 'ok', label: 'Confirmed' },
  failed: { tone: 'ba', label: 'Failed' },
  refunded: { tone: 'of', label: 'Refunded' },
};
const FUND_COLORS = { Tithes: 'var(--gd-f1)', Offering: 'var(--gd-f2)', Donation: 'var(--gd-f3)' };
const FIXED_FUNDS = ['all', 'Tithes', 'Offering', 'drives'];

// "2026-11-26T15:30", in Philippine time, for <input type="datetime-local">.
const phLocal = (iso) => {
  const d = iso ? new Date(iso) : new Date();
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
const phMonth = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit' }).format(iso ? new Date(iso) : new Date());
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
const prevMonth = (ym) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); };
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const isDonation = (g) => !!g.campaign_id || g.fund === 'Donation';

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

export default function GiftsManager({ actorId, onPending, fund = 'all', onFund, onOpenDrives }) {
  const [gifts, setGifts] = useState([]);
  const [methods, setMethods] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [emailReady, setEmailReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [setupNote, setSetupNote] = useState('');
  const [notice, setNotice] = useState(null);
  // Opened from a drive (its "Gifts"): all its gifts. Otherwise the ones to
  // confirm first, when there are any (set once they load).
  const [filter, setFilter] = useState(fund !== 'all' ? 'all' : null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(10);
  const [openId, setOpenId] = useState(null);
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

  const driveById = useMemo(() => new Map(campaigns.map((c) => [c.id, c])), [campaigns]);
  const driveOf = (g) => {
    if (!g.campaign_id) return null;
    const c = driveById.get(g.campaign_id);
    return { id: g.campaign_id, title: c?.title || g.campaign_title || 'Donation drive', image: c?.image_url || c?.images?.[0] || null };
  };

  // The strip: what waits, this month against last, this year by fund.
  const sums = useMemo(() => {
    const month = phMonth();
    const before = prevMonth(month);
    const year = phYear();
    const c = { pending: 0, successful: 0, failed: 0, refunded: 0, waiting: 0 };
    const m = { now: 0, nowN: 0, prev: 0 };
    const y = { total: 0, n: 0, Tithes: 0, Offering: 0, Donation: 0 };
    gifts.forEach((g) => {
      c[g.status] = (c[g.status] || 0) + 1;
      if (g.status === 'pending') c.waiting += g.amount;
      if (g.status !== 'successful') return;
      const gm = phMonth(g.given_at);
      if (gm === month) { m.now += g.amount; m.nowN += 1; }
      if (gm === before) m.prev += g.amount;
      if (phYear(g.given_at) === year) {
        y.total += g.amount; y.n += 1;
        y[isDonation(g) ? 'Donation' : g.fund === 'Tithes' ? 'Tithes' : 'Offering'] += g.amount;
      }
    });
    return { c, m, y, month, before, year };
  }, [gifts]);
  useEffect(() => { onPending?.(sums.c.pending); }, [sums.c.pending, onPending]);

  const shown = gifts.filter((g) => {
    if (filter && filter !== 'all' && g.status !== filter) return false;
    if (fund === 'drives' && !isDonation(g)) return false;
    if ((fund === 'Tithes' || fund === 'Offering') && (g.fund !== fund || g.campaign_id)) return false;
    if (!FIXED_FUNDS.includes(fund) && g.campaign_id !== fund) return false;
    const q = query.trim().toLowerCase();
    return !q || [g.donor_name, g.donor_email, g.reference_no, g.receipt_no, g.method_name, String(g.amount), peso(g.amount)]
      .filter(Boolean).join(' ').toLowerCase().includes(q);
  });
  // Back to the first page whenever what is shown changes.
  useEffect(() => { setPage(1); }, [filter, fund, query, per]);
  const paged = pageOf(shown, page, per);
  const drive = !FIXED_FUNDS.includes(fund) ? (driveById.get(fund) || null) : null;

  const replace = (saved) => setGifts((list) => list.map((g) => (g.id === saved.id ? saved : g)));
  const who = (g) => g.donor_name || g.donor_email || 'Anonymous';
  const emailLine = (email, g) => {
    if (!email) return '';
    if (email.sent) return ` ${who(g)} was emailed a thank-you.`;
    return ` The thank-you email was not sent: ${email.reason} You can copy the thank-you link from the gift's details and send it yourself.`;
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
        reopen: `${peso(gift.amount)} from ${who(gift)} is waiting to be confirmed again.`,
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
      setOpenId(null);
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
  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); setNotice({ type: 'ok', text: `Copied ${text}.` }); } catch { setNotice({ type: 'warn', text }); }
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

  const method = form ? methods.find((m) => m.id === form.how) : null;
  const change = sums.m.prev ? Math.round(((sums.m.now - sums.m.prev) / sums.m.prev) * 100) : null;
  const open = openId ? gifts.find((g) => g.id === openId) : null;

  const forCell = (g, close = false) => {
    const d = driveOf(g);
    if (!d) return g.fund || 'Offering';
    return (
      <button type="button" className="gd-drv" title={`${d.title}: show only its gifts`}
        onClick={(e) => { e.stopPropagation(); onFund?.(d.id); if (close) setOpenId(null); }}>
        <DriveThumb src={d.image} /><span className="gd-drv-name">{d.title}</span>
      </button>
    );
  };

  return (
    <div className="gd gd-page">
      <DeskHead title="Gifts" sub="Confirm each gift once you find it in the church's account.">
        <a className="gd-btn" href="/donation" target="_blank" rel="noopener noreferrer">View the giving page</a>
        <button type="button" className="gd-btn is-primary" onClick={() => openForm()} disabled={!!setupNote || loading}>Record a gift</button>
      </DeskHead>

      {setupNote && <Notice notice={{ type: 'warn', text: setupNote }} />}
      {!setupNote && !emailReady && !loading && (
        <Notice notice={{ type: 'warn', text: 'Thank-you emails are not set up yet, so confirming a gift sends nothing. Until they are, copy the thank-you link from the gift\'s details and send it yourself.' }} />
      )}

      {!setupNote && (
        <Strip
          stats={[
            {
              k: 'To confirm',
              v: peso(sums.c.waiting),
              s: sums.c.pending ? <>{plural(sums.c.pending, 'gift')}<button type="button" className="gd-link" onClick={() => setFilter('pending')}>Review</button></> : 'Nothing waiting',
              hot: sums.c.pending > 0,
            },
            {
              k: `Confirmed in ${monthName(sums.month)}`,
              v: peso(sums.m.now),
              s: <>{plural(sums.m.nowN, 'gift')}{change != null && <span><b className={change >= 0 ? 'gd-up' : 'gd-down'}>{change >= 0 ? '+' : '−'}{Math.abs(change)}%</b> vs {monthName(sums.before)}</span>}</>,
            },
            { k: `Confirmed in ${sums.year}`, v: peso(sums.y.total), s: plural(sums.y.n, 'gift') },
          ]}
          split={{
            label: `${sums.year} by fund`,
            parts: [
              { name: 'Tithes', value: sums.y.Tithes, color: FUND_COLORS.Tithes },
              { name: 'Offerings', value: sums.y.Offering, color: FUND_COLORS.Offering },
              { name: 'Donation drives', value: sums.y.Donation, color: FUND_COLORS.Donation },
            ],
          }}
        />
      )}

      <Notice notice={notice} onClose={() => setNotice(null)} />

      <section className="gd-card" aria-label="Gifts">
        <div className="gd-tools-bar">
          <Tabs
            label="Status"
            value={filter || 'all'}
            onChange={setFilter}
            items={[
              { key: 'all', label: 'All', count: gifts.length },
              { key: 'pending', label: 'To confirm', count: sums.c.pending },
              { key: 'successful', label: 'Confirmed', count: sums.c.successful },
              { key: 'failed', label: 'Failed', count: sums.c.failed },
              { key: 'refunded', label: 'Refunded', count: sums.c.refunded },
            ]}
          />
          <div className="gd-tools">
            <select className="gd-input" value={fund} onChange={(e) => onFund?.(e.target.value)} aria-label="Fund">
              <option value="all">All funds</option>
              <option value="Tithes">Tithes</option>
              <option value="Offering">Offering</option>
              <option value="drives">All donation drives</option>
              {campaigns.length > 0 && (
                <optgroup label="One drive">
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </optgroup>
              )}
            </select>
            <input className="gd-input gd-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email or reference" aria-label="Search gifts" />
          </div>
        </div>

        {drive && (
          <div className="gd-filter">
            <DriveThumb src={drive.image_url || drive.images?.[0]} />
            <span className="gd-filter-text">Gifts to <b>{drive.title}</b>: {peso(gifts.filter((g) => g.campaign_id === drive.id && g.status === 'successful').reduce((a, g) => a + g.amount, 0))} confirmed{drive.goal_amount ? ` of ${peso(drive.goal_amount)}` : ''}</span>
            {onOpenDrives && <button type="button" className="gd-link" onClick={onOpenDrives}>Open drives</button>}
            <button type="button" className="gd-link" onClick={() => onFund?.('all')}>Clear</button>
          </div>
        )}

        {loading ? (
          <div className="gd-empty">Loading…</div>
        ) : shown.length === 0 ? (
          <div className="gd-empty">
            {gifts.length === 0 && !setupNote ? (
              <><strong>No gifts yet</strong>Tithes, offerings and donations sent online appear here, waiting for you to confirm them.</>
            ) : !setupNote && (filter === 'pending' && !query && fund === 'all' ? <><strong>Nothing to confirm</strong>Every gift has been checked.</> : <><strong>No gifts match</strong>Try another status or fund, or clear the search.</>)}
          </div>
        ) : (
          <>
            <table className="gd-table">
              <colgroup><col style={{ width: '22%' }} /><col /><col style={{ width: '17%' }} /><col style={{ width: '104px' }} /><col style={{ width: '124px' }} /><col style={{ width: '100px' }} /></colgroup>
              <thead>
                <tr><th scope="col">Giver</th><th scope="col">For</th><th scope="col">Paid through</th><th scope="col" className="gd-r">Amount</th><th scope="col">Status</th><th scope="col"><span className="gd-sr">Action</span></th></tr>
              </thead>
              <tbody>
                {paged.rows.map((g) => (
                  <tr
                    key={g.id}
                    className={`is-link ${g.status === 'pending' ? 'is-pending' : ''} ${g.status === 'failed' || g.status === 'refunded' ? 'is-off' : ''} ${busyId === g.id ? 'is-busy' : ''}`}
                    onClick={() => setOpenId(g.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setOpenId(g.id); }}
                    tabIndex={0}
                    aria-label={`${peso(g.amount)} from ${who(g)}, ${STATUS[g.status]?.label}. Open details`}
                  >
                    <td className="gd-c1"><b>{who(g)}</b><small>{giftWhen(g.given_at, { short: true })}</small></td>
                    <td className="gd-c2">{forCell(g)}</td>
                    <td className="gd-c3">{methodLabel(g)}<small>{g.reference_no || (g.source === 'admin' ? `Recorded by ${g.recorded_by_name || 'staff'}` : 'No reference')}</small></td>
                    <td className="gd-c4 gd-r gd-amt">{peso(g.amount)}</td>
                    <td className="gd-c5"><Pill tone={STATUS[g.status]?.tone || 'wa'}>{STATUS[g.status]?.label || 'To confirm'}</Pill></td>
                    <td className="gd-act">
                      {g.status === 'pending' && (
                        <button type="button" className="gd-btn is-primary is-small" onClick={(e) => { e.stopPropagation(); openAsk(g, 'confirm'); }} disabled={busyId === g.id}>Confirm</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager total={shown.length} page={paged.page} per={per} onPage={setPage} onPer={setPer} />
          </>
        )}
      </section>

      {open && (
        <Drawer
          label={`Gift from ${who(open)}`}
          onClose={() => setOpenId(null)}
          head={(
            <>
              <Pill tone={STATUS[open.status]?.tone || 'wa'}>{STATUS[open.status]?.label}</Pill>
              <div className="gd-dr-big">{peso(open.amount)}</div>
              <div className="gd-dr-who">from {who(open)}</div>
            </>
          )}
          foot={(
            <>
              {(open.status === 'pending' || open.status === 'failed') && (
                <button type="button" className="gd-btn is-primary" onClick={() => openAsk(open, 'confirm')} disabled={busyId === open.id}>{open.status === 'failed' ? 'Confirm it after all' : 'Confirm'}</button>
              )}
              {open.status === 'pending' && <button type="button" className="gd-btn" onClick={() => openAsk(open, 'fail')} disabled={busyId === open.id}>Not found</button>}
              {open.status === 'successful' && open.donor_email && <button type="button" className="gd-btn" onClick={() => act(open, 'resend')} disabled={busyId === open.id}>Resend thank-you</button>}
              {open.status === 'successful' && <button type="button" className="gd-btn" onClick={() => openAsk(open, 'refund')} disabled={busyId === open.id}>Mark refunded</button>}
              {open.status !== 'pending' && <button type="button" className="gd-btn" onClick={() => act(open, 'reopen')} disabled={busyId === open.id}>Back to To confirm</button>}
            </>
          )}
        >
          {open.status === 'pending' && (
            <div className="gd-check">
              Find <b>{peso(open.amount)}</b> in the {open.method_name || 'account'} history{open.reference_no ? <> with reference <b>{open.reference_no}</b></> : ''}, then confirm.
            </div>
          )}
          <dl className="gd-kv">
            <div><dt>For</dt><dd>{forCell(open, true)}</dd></div>
            <div><dt>Email</dt><dd>{open.donor_email || '—'}</dd></div>
            <div><dt>Paid through</dt><dd>{methodLabel(open)}</dd></div>
            <div><dt>Reference</dt><dd>{open.reference_no ? <>{open.reference_no}<button type="button" className="gd-copy" onClick={() => copyText(open.reference_no)} aria-label="Copy the reference">Copy</button></> : '—'}</dd></div>
            <div><dt>Receipt no.</dt><dd>{open.receipt_no}</dd></div>
            <div><dt>Sent</dt><dd>{giftWhen(open.given_at, { short: true })}</dd></div>
            {open.source === 'admin' && <div><dt>Recorded by</dt><dd>{open.recorded_by_name || 'Staff'}</dd></div>}
            {open.status === 'successful' && open.donor_email && <div><dt>Thank-you</dt><dd>{open.email_sent_at ? 'Emailed' : 'Not emailed'}</dd></div>}
            {open.status_note && <div><dt>Note</dt><dd>{open.status_note}</dd></div>}
          </dl>
          {open.message && <p className="gd-msg">&ldquo;{open.message}&rdquo;</p>}
          {open.proof_url && (
            <a className="gd-proof" href={open.proof_url} target="_blank" rel="noopener noreferrer" aria-label="Open the screenshot the giver sent">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={open.proof_url} alt="The screenshot the giver sent" />
            </a>
          )}
          <div className="gd-dr-links">
            <a className="gd-link" href={receiptPath(open.token)} target="_blank" rel="noopener noreferrer">View receipt</a>
            {open.status === 'successful' && <button type="button" className="gd-link" onClick={() => copyLink(open)}>Copy thank-you link</button>}
            <button type="button" className="gd-link" onClick={() => openForm(open)}>Edit details</button>
            <button type="button" className="gd-link is-danger" onClick={() => openAsk(open, 'delete')}>Delete</button>
          </div>
        </Drawer>
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
                {busyId === ask.gift.id ? 'Working…' : { confirm: 'Yes, it arrived', fail: 'Mark as failed', refund: 'Mark as refunded', delete: 'Delete' }[ask.action]}
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
                    text={emailReady ? 'With the receipt, and a link to see the gift drop into the giving jar.' : 'Emails are not set up yet, so nothing will be sent.'}
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
          subtitle={form.id ? 'Correct the details. Confirming, failing and refunding are in the gift\'s details.' : 'For a gift given in person, or one you found before it was sent through the page.'}
          onClose={() => { if (!saving) setForm(null); }}
          busy={saving}
          dirty={dirty}
          initialFocus={`#${FORM_ID}-amount`}
          footer={(
            <>
              {formError && <p className="sm-foot-error" role="alert">{formError}</p>}
              <button type="button" className="sm-btn" onClick={() => setForm(null)} disabled={saving}>Cancel</button>
              <button type="button" className="sm-btn is-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : form.id ? 'Save changes' : form.status === 'successful' ? 'Record as confirmed' : 'Record to confirm later'}
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
                  text={form.status === 'successful' ? 'Recorded as confirmed.' : 'Recorded as To confirm, to check later.'}
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
