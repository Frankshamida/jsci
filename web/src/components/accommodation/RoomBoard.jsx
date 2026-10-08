'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PickList from '@/components/eventDesk/PickList';
import { bedsToText, occupancyLabel, roomHold, withKids } from '@/lib/rooms';
import { formatChurchName, STATUS_LABELS } from '@/lib/eventFormat';
import { exemptCreditLeft, extraNetFee, registrationFeeOf } from '@/lib/exemption';
import './roomBoard.css';

// The rooms of one event, as people look for them: which rooms are full,
// which have a bed, who is in each - and putting somebody in one.
//
// The same board in both places rooms are handled - Events & Content >
// Accommodation, and an event's Registrations > Accommodation tab - so the
// two can never disagree about who is where. It loads its own data
// (api/events/room-board) and writes through the same routes the desk uses:
//
//   assign   anybody who availed accommodation, verified at the desk or not
//            (api/events/room-guests - the server checks the extra, the
//            room's pax and its beds kept back)
//   add      somebody who is not an attendee - a speaker, an usher - put in the
//            room with everybody else (api/events/room-holds, a bed with a
//            name and no registration)
//   reserve  a bed held for an attendee, even one who has not availed
//            accommodation yet (api/events/room-holds, with the registration)
//   Both take a bed, and their names go on the rooming list and the live
//   Google Sheets.
//   exempt   an attendee serving at the event - an usher, the worship team -
//            pays no registration fee, only their accommodation
//            (api/events/registrations/exempt, with what they serve as; the
//            verification desk shows "Exemption: Usher")
//
//   eventId, actorId
//   canEdit          assign, move, reserve and remove (Admin / Super Admin)
//   refreshKey       anything that changes when the rooms changed elsewhere
//   onChanged()      after this board changed something
//   onToast(msg, tone)
//   onLoaded(data)   each time the rooms are read - for counts shown outside
//   onRoomsChanged() after a room itself changed (beds kept back released)
//   onRegistrationChanged(row)  after a registration itself changed (exempted)
//   roomActions      optional { onEdit(room), onHoldBeds(room), onRemove(room) }

const PAID = ['registered', 'payment_verified', 'paid_pending_turnover'];
const OWING = ['pending_cash', 'installment', 'pending_payment'];
const VIEW_KEY = 'roomBoardView';
const LIST_LIMIT = 8;
// What somebody exempted usually serves as - one tap, or typed.
const EXEMPT_ROLES = ['Committee', 'Usher', 'Worship Team', 'Technical Team', 'Speaker'];

// Every word with its capital, as the dashboard writes names.
const fmtName = (name) => String(name || '').trim().replace(/\s+/g, ' ').split(' ')
  .map((w) => w.toLowerCase().split('-').map((p) => p.split("'").map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join("'")).join('-'))
  .join(' ');
const initials = (name) => {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  return w.length ? `${w[0][0]}${w.length > 1 ? w[w.length - 1][0] : ''}`.toUpperCase() : '?';
};
const peso = (n) => `₱${Number(n || 0).toLocaleString()}`;

function payChip(p) {
  if (!p) return null;
  // Exempted with no extras to pay: nothing was ever owed, so not "Paid".
  if (p.exempt && p.due <= 0 && p.status === 'registered') return null;
  if (PAID.includes(p.status) || (p.due <= 0 && OWING.includes(p.status))) {
    return { tone: 'ok', text: p.status === 'paid_pending_turnover' ? 'Paid · turnover' : 'Paid' };
  }
  if (p.status === 'pending_cash') return { tone: 'warn', text: p.due ? `To collect ${peso(p.due)}` : 'Cash to collect' };
  const label = STATUS_LABELS[p.status] || String(p.status || '').replace(/_/g, ' ');
  return { tone: 'warn', text: label.charAt(0).toUpperCase() + label.slice(1) };
}

// Registration fee waived - serving at the event. Their extras they still pay,
// so this sits beside payChip, not in place of it.
const exemptChip = (p) => (p?.exempt ? (
  <span
    className="rb-chip is-exempt"
    title={[p.exempt.waived > 0 && `₱${p.exempt.waived.toLocaleString()} waived`, p.exempt.credit > 0 && `an extra added later is free up to ₱${p.exempt.credit.toLocaleString()}`].filter(Boolean).join(' · ') || undefined}
  >
    {p.exempt.note ? `Exempted · ${p.exempt.note}` : 'Exempted'}
  </span>
) : null);

// What exempting them will do - the same sums the server makes
// (api/events/registrations/exempt): worth the registration fee, it pays
// what they still owe up to that, and gives nothing back.
function exemptPreview(p) {
  const paidAll = PAID.includes(p.status);
  const paidBefore = paidAll || p.paid > 0;
  const owed = paidAll ? 0 : p.due;
  const waive = Math.min(p.fee, owed);
  const left = owed - waive;
  if (p.fee <= 0) return <>No registration fee to waive.</>;
  if (waive <= 0) return <>Already paid - nothing is given back. Accommodation added later is <b>free</b> (up to {peso(p.fee)}).</>;
  if (paidBefore) {
    return <>Registration fee already paid, so their <b>{peso(waive)}</b> accommodation is <b>free</b>{left > 0 ? <> - {peso(left)} still to pay</> : ''}.</>;
  }
  return <>The <b>{peso(waive)}</b> registration fee is waived{left > 0 ? <> - they still pay <b>{peso(left)}</b> for their accommodation</> : ''}.</>;
}

const STATUS_TEXT = {
  full: () => 'Full',
  held: (v) => `${v.held} held`,
  empty: () => 'Empty',
  space: (v) => `${v.open} ${v.open === 1 ? 'bed' : 'beds'} left`,
};

async function call(url, options) {
  try {
    const res = await fetch(url, { cache: 'no-store', ...options });
    return await res.json().catch(() => ({ success: false, message: `The server answered ${res.status}` }));
  } catch (err) {
    return { success: false, message: err.message || 'Could not reach the server' };
  }
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export default function RoomBoard({ eventId, actorId, canEdit = false, refreshKey, onChanged, onToast, onLoaded, onRoomsChanged, onRegistrationChanged, roomActions }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState('grid');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState('');
  const [waitingOpen, setWaitingOpen] = useState(false);
  const [waitPick, setWaitPick] = useState({}); // registrationId -> roomId
  const [busy, setBusy] = useState('');

  // ---- Loading ----
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    if (!eventId) return;
    const mine = ++loadSeq.current;
    const res = await call(`/api/events/room-board?eventId=${encodeURIComponent(eventId)}&t=${Date.now()}`);
    if (mine !== loadSeq.current) return; // a newer read was asked for since
    if (res.success) { setData(res.data); setError(''); onLoadedRef.current?.(res.data); } else setError(res.message);
    setLoading(false);
  }, [eventId]);
  // What was just done shows at once; the read that follows confirms it.
  const patchData = (fn) => setData((d) => (d ? fn(d) : d));

  useEffect(() => { setLoading(true); setData(null); setOpenId(''); load(); }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (refreshKey !== undefined) load(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Somebody else at another desk moves people too: kept fresh while on screen.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') load(); };
    const t = setInterval(tick, 30000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(t); window.removeEventListener('focus', tick); };
  }, [load]);
  useEffect(() => {
    try { const v = window.localStorage.getItem(VIEW_KEY); if (v === 'grid' || v === 'list') setView(v); } catch { /* private mode */ }
  }, []);
  const pickView = (v) => { setView(v); try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } };

  const toast = (msg, tone = 'success') => onToast?.(msg, tone);
  const changed = async () => { await load(); onChanged?.(); };

  // ---- What the rooms hold ----
  const model = useMemo(() => {
    if (!data) return null;
    const people = new Map(data.people.map((p) => [p.id, p]));
    // Kids in an adult's bed: with the adult, taking no bed of their own.
    const kidsOf = new Map();
    (data.kids || []).forEach((k) => {
      if (!kidsOf.has(k.guestId)) kidsOf.set(k.guestId, []);
      kidsOf.get(k.guestId).push({ ...k, person: people.get(k.registrationId) });
    });
    const guestsBy = new Map();
    data.guests.forEach((g) => {
      if (!guestsBy.has(g.roomId)) guestsBy.set(g.roomId, []);
      guestsBy.get(g.roomId).push({ ...g, person: people.get(g.registrationId), kids: kidsOf.get(g.id) || [] });
    });
    const holdsBy = new Map();
    data.holds.forEach((h) => { if (!holdsBy.has(h.roomId)) holdsBy.set(h.roomId, []); holdsBy.get(h.roomId).push({ ...h, person: h.registrationId ? people.get(h.registrationId) : null }); });
    const views = data.rooms.map((room) => {
      const guests = guestsBy.get(room.id) || [];
      const holds = holdsBy.get(room.id) || [];
      const pax = Math.max(1, Number(room.pax) || 1);
      const taken = guests.length + holds.length;
      const h = roomHold(room, taken);
      let status = 'space';
      if (taken >= pax) status = 'full';
      else if (h.open === 0) status = 'held';
      else if (taken === 0 && h.held === 0) status = 'empty';
      const names = [
        ...guests.map((g) => fmtName(g.person?.name)),
        ...guests.flatMap((g) => g.kids.map((k) => fmtName(k.person?.name))),
        ...holds.map((x) => fmtName(x.name)),
      ].join(' ').toLowerCase();
      const kidCount = guests.reduce((t, g) => t + g.kids.length, 0);
      // Not an attendee: in the room like anybody. An attendee's held bed: reserved.
      const visitors = holds.filter((x) => !x.registrationId);
      const reservedNamed = holds.filter((x) => x.registrationId);
      return {
        room, guests, holds, visitors, reservedNamed, pax, taken, status, kidCount,
        free: Math.max(0, pax - taken), open: h.open, held: h.held, reservedAnon: h.reserved,
        text: `${room.room_number} ${room.room_type} ${room.floor || ''} ${room.reserved_for || ''} ${occupancyLabel(room.occupancy)} ${names}`.toLowerCase(),
      };
    });
    const entitled = data.people.filter((p) => p.entitled);
    const waiting = entitled.filter((p) => !p.roomId && !p.heldRoomId && !p.withAdult)
      .sort((a, b) => (b.verified - a.verified) || fmtName(a.name).localeCompare(fmtName(b.name)));
    const totals = views.reduce((t, v) => ({
      beds: t.beds + v.pax, taken: t.taken + v.taken, open: t.open + v.open, held: t.held + v.held,
    }), { beds: 0, taken: 0, open: 0, held: 0 });
    return { people, views, waiting, totals };
  }, [data]);

  const filters = model ? {
    all: model.views,
    space: model.views.filter((v) => v.open > 0),
    full: model.views.filter((v) => v.status === 'full'),
    empty: model.views.filter((v) => v.status === 'empty'),
    reserved: model.views.filter((v) => v.reservedNamed.length > 0 || v.reservedAnon > 0),
  } : null;
  const q = query.trim().toLowerCase();
  const shown = filters ? filters[filter].filter((v) => !q || v.text.includes(q)) : [];
  const groups = [];
  shown.forEach((v) => {
    const g = groups.find((x) => x.type === v.room.room_type);
    if (g) g.views.push(v); else groups.push({ type: v.room.room_type, views: [v] });
  });

  const roomOptions = (exceptId) => (model ? model.views.filter((v) => v.room.id !== exceptId).map((v) => ({
    value: v.room.id,
    label: v.room.room_number,
    sub: [v.room.room_type, v.room.floor, occupancyLabel(v.room.occupancy)].filter(Boolean).join(' · '),
    badge: v.status === 'full' ? 'Full' : v.open > 0 ? `${v.open} free` : `${v.held} held`,
    tone: v.open > 0 ? 'ok' : v.status === 'full' ? 'muted' : 'warn',
    disabled: v.free <= 0,
    group: v.room.room_type,
  })) : []);

  // ---- Writing ----
  const [askHeld, setAskHeld] = useState(null); // { person, roomId, message }

  const assign = async (person, roomId, useReserved = false) => {
    if (!person || !roomId) return;
    const moving = person.roomId && person.roomId !== roomId;
    const guest = moving ? data.guests.find((g) => g.registrationId === person.id) : null;
    setBusy(`assign:${person.id}`);
    const res = moving
      ? await call('/api/events/room-guests', json('PATCH', { id: guest?.id, roomId, actorId, useReserved }))
      : await call('/api/events/room-guests', json('POST', { eventId, roomId, registrationId: person.id, actorId, useReserved }));
    setBusy('');
    if (!res.success && res.result === 'reserved') { setAskHeld({ person, roomId, message: res.message }); return false; }
    if (!res.success) { toast(res.message, 'danger'); return false; }
    setAskHeld(null);
    toast(res.message || `${fmtName(person.name)} assigned`);
    await changed();
    return true;
  };

  // Somebody who did not avail accommodation: the bed extra goes on their
  // registration first - owed, as the desk adds it (desk_addons: paid before
  // means the bed is cash still to collect) - and then the room.
  const addBedAndAssign = async (person, roomId) => {
    if (!data?.bed || !person || !roomId) return false;
    setBusy(`assign:${person.id}`);
    const res = await call('/api/events/registrations', json('PUT', { id: person.id, actorId, action: 'desk_addons', addIds: [data.bed.id] }));
    setBusy('');
    if (!res.success) { toast(res.message, 'danger'); return false; }
    const r = res.data || {};
    // What it costs them - an exemption may have paid for it.
    const fee = (res.added || []).reduce((t, a) => t + extraNetFee(a), 0);
    const free = (res.added || []).some((a) => Number(a.waived) > 0);
    onRegistrationChanged?.(r);
    const now = {
      ...person, entitled: true, why: '', status: r.status || person.status,
      due: Math.max(0, (Number(r.amount) || 0) - (Number(r.amount_paid) || 0)), bedFee: 0,
      exempt: r.exempted_at ? { ...(person.exempt || {}), waived: Number(r.exempt_amount) || 0, credit: exemptCreditLeft(r) } : person.exempt,
    };
    patchData((d) => ({ ...d, people: d.people.map((p) => (p.id === person.id ? { ...p, ...now } : p)) }));
    toast(`${data.bed.question} added for ${fmtName(person.name)}${fee > 0 ? ` - ${peso(fee)} to collect` : free ? ' - free, exempted' : ''}`);
    return assign(now, roomId);
  };

  // A kid in an adult's bed (api/events/room-kids): no bed of their own,
  // written with the adult - "Frank Gomez [Kid: Miaka Arquilano]".
  const addKid = async (guest, kid) => {
    if (!guest || !kid) return false;
    setBusy(`kid:${kid.id}`);
    const res = await call('/api/events/room-kids', json('POST', { eventId, guestId: guest.id, registrationId: kid.id, actorId }));
    setBusy('');
    if (!res.success) { toast(res.message, 'danger'); return false; }
    toast(res.message);
    await changed();
    return true;
  };
  const removeKid = async (k) => {
    setBusy(`kidout:${k.id}`);
    const res = await call(`/api/events/room-kids?id=${encodeURIComponent(k.id)}&actorId=${encodeURIComponent(actorId || '')}`, { method: 'DELETE' });
    setBusy('');
    if (!res.success) { toast(res.message, 'danger'); return; }
    patchData((d) => ({
      ...d,
      kids: (d.kids || []).filter((x) => x.id !== k.id),
      people: d.people.map((p) => (p.id === k.registrationId ? { ...p, withAdult: null, kidRoomId: null } : p)),
    }));
    toast(res.message);
    changed(); // the screen already shows it; the re-read confirms it in the background
  };

  const unassign = async (guest) => {
    setBusy(`guest:${guest.id}`);
    const res = await call(`/api/events/room-guests?id=${encodeURIComponent(guest.id)}&actorId=${encodeURIComponent(actorId || '')}`, { method: 'DELETE' });
    setBusy('');
    if (!res.success) { toast(res.message, 'danger'); return; }
    patchData((d) => ({
      ...d,
      guests: d.guests.filter((x) => x.id !== guest.id),
      people: d.people.map((p) => (p.id === guest.registrationId ? { ...p, roomId: null } : p)),
    }));
    toast(res.message);
    changed(); // the screen already shows it; the re-read confirms it in the background
  };

  const hold = async (roomId, body) => {
    setBusy('hold');
    const res = await call('/api/events/room-holds', json('POST', { eventId, roomId, actorId, ...body }));
    setBusy('');
    if (!res.success) { toast(res.message, 'danger'); return false; }
    toast(res.message);
    await changed();
    return true;
  };

  // Beds kept back without a name: let some (or all) of them go. beds is how
  // many stay kept back afterwards.
  const keepBack = async (room, beds) => {
    setBusy(`kept:${room.id}`);
    const res = await call('/api/events/rooms', json('PATCH', {
      id: room.id, actorId, reservedBeds: Math.max(0, beds), reservedFor: beds > 0 ? (room.reserved_for || '') : '',
    }));
    setBusy('');
    if (!res.success) { toast(res.message, 'danger'); return; }
    const left = Math.max(0, beds);
    patchData((d) => ({
      ...d,
      rooms: d.rooms.map((r) => (r.id === room.id ? { ...r, reserved_beds: left, reserved_for: left ? r.reserved_for : null } : r)),
    }));
    toast(beds > 0
      ? `A bed in ${room.room_number} is free now - ${beds} still kept back${room.reserved_for ? ` for ${room.reserved_for}` : ''}`
      : `Room ${room.room_number}: no beds kept back any more`);
    changed(); // the screen already shows it; the re-read confirms it in the background
    onRoomsChanged?.();
  };

  // Serving at the event: what they owe goes to 0, with what they serve as.
  // restore puts back what was waived.
  const exempt = async (person, note, restore = false) => {
    setBusy(`exempt:${person.id}`);
    const res = await call('/api/events/registrations/exempt', json('POST', restore
      ? { actorId, registrationId: person.id, restore: true }
      : { actorId, registrationId: person.id, note }));
    setBusy('');
    if (!res.success) { toast(res.message, 'danger'); return false; }
    const r = res.data || {};
    patchData((d) => ({
      ...d,
      people: d.people.map((p) => (p.id === person.id ? {
        ...p,
        status: r.status,
        due: Math.max(0, (Number(r.amount) || 0) - (Number(r.amount_paid) || 0)),
        fee: registrationFeeOf(r),
        paid: Number(r.amount_paid) || 0,
        exempt: r.exempted_at ? { note: r.exempt_note || '', waived: Number(r.exempt_amount) || 0, credit: exemptCreditLeft(r) } : null,
      } : p)),
    }));
    toast(res.message);
    onRegistrationChanged?.(r);
    changed(); // the screen already shows it; the re-read confirms it in the background
    return true;
  };

  const release = async (h) => {
    setBusy(`hold:${h.id}`);
    const res = await call(`/api/events/room-holds?id=${encodeURIComponent(h.id)}&actorId=${encodeURIComponent(actorId || '')}`, { method: 'DELETE' });
    setBusy('');
    if (!res.success) { toast(res.message, 'danger'); return; }
    patchData((d) => ({
      ...d,
      holds: d.holds.filter((x) => x.id !== h.id),
      people: d.people.map((p) => (p.id === h.registrationId ? { ...p, heldRoomId: null } : p)),
    }));
    toast(res.message);
    changed(); // the screen already shows it; the re-read confirms it in the background
  };

  // ---- Screens ----
  if (loading && !data) return <p className="rb-loading"><i className="fas fa-spinner fa-spin"></i> Loading the rooms&hellip;</p>;
  if (error && !data) {
    return (
      <p className="rb-error">
        <i className="fas fa-triangle-exclamation"></i> {error}
        <button type="button" className="btn-secondary" onClick={() => { setLoading(true); load(); }}>Try again</button>
      </p>
    );
  }
  if (!model) return null;
  const openView = openId ? model.views.find((v) => v.room.id === openId) || null : null;

  const statusPill = (v) => <span className={`rb-status is-${v.status}`}>{STATUS_TEXT[v.status](v)}</span>;
  const bedDots = (v) => {
    if (v.pax > 10) {
      const pct = Math.min(100, Math.round((v.taken / v.pax) * 100));
      return <span className={`rb-bar is-${v.status}`} aria-hidden="true"><span style={{ width: `${pct}%` }}></span></span>;
    }
    const dots = [];
    for (let i = 0; i < v.pax; i += 1) {
      const kind = i < v.guests.length + v.visitors.length ? 'in' : i < v.taken ? 'res' : i < v.taken + v.held ? 'held' : 'free';
      dots.push(<i key={i} className={`rb-dot is-${kind}`}></i>);
    }
    return <span className="rb-dots" aria-hidden="true">{dots}</span>;
  };
  const namesOf = (v) => [
    // A kid in their bed is written with them: "Frank Gomez [Kid: Miaka Arquilano]".
    ...v.guests.map((g) => ({ key: g.id, name: withKids(fmtName(g.person?.name) || 'Attendee', g.kids.map((k) => fmtName(k.person?.name))), held: false })),
    ...v.visitors.map((h) => ({ key: h.id, name: fmtName(h.name), held: false, visitor: true })),
    ...v.reservedNamed.map((h) => ({ key: h.id, name: fmtName(h.name), held: true })),
  ];

  return (
    <div className="rb">
      {/* ---- The whole block at a glance ---- */}
      <div className="rb-summary">
        <div className="rb-sum-beds">
          <span className="rb-bar is-big" aria-hidden="true">
            <span style={{ width: `${model.totals.beds ? Math.round((model.totals.taken / model.totals.beds) * 100) : 0}%` }}></span>
          </span>
          <span><b>{model.totals.taken}</b> of {model.totals.beds} beds taken</span>
          <em>{model.totals.open} free{model.totals.held ? ` · ${model.totals.held} held` : ''}</em>
        </div>
        <button
          type="button"
          className={`rb-waiting ${model.waiting.length ? 'has' : ''} ${waitingOpen ? 'on' : ''}`}
          onClick={() => setWaitingOpen((o) => !o)}
          disabled={!model.waiting.length}
          aria-expanded={waitingOpen}
        >
          <i className={`fas ${model.waiting.length ? 'fa-user-clock' : 'fa-circle-check'}`}></i>
          {model.waiting.length
            ? <span><b>{model.waiting.length}</b> availed accommodation, no room yet</span>
            : <span>Everybody who availed accommodation has a room</span>}
          {model.waiting.length > 0 && <i className={`fas fa-chevron-${waitingOpen ? 'up' : 'down'}`}></i>}
        </button>
      </div>

      {/* ---- Who still needs a room: pick a room for each ---- */}
      {waitingOpen && model.waiting.length > 0 && (
        <div className="rb-waitlist">
          <p className="rb-hint">
            <i className="fas fa-circle-info"></i> Verified at the desk or not yet - anybody who availed accommodation can be given a room.
          </p>
          <ul>
            {model.waiting.map((p) => {
              const pay = payChip(p);
              const pick = waitPick[p.id] || '';
              return (
                <li key={p.id}>
                  <span className="rb-avatar">{initials(fmtName(p.name))}</span>
                  <span className="rb-who">
                    <b>{fmtName(p.name)}</b>
                    <small>{[p.church && formatChurchName(p.church), p.bulk && p.representative && `${fmtName(p.representative)}'s booking`].filter(Boolean).join(' · ')}</small>
                  </span>
                  <span className={`rb-chip ${p.verified ? 'is-ok' : 'is-muted'}`}>{p.verified ? 'Verified' : 'Not verified yet'}</span>
                  {exemptChip(p)}
                  {pay && <span className={`rb-chip is-${pay.tone}`}>{pay.text}</span>}
                  {canEdit && (
                    <span className="rb-waitacts">
                      <PickList
                        size="sm"
                        value={pick}
                        onChange={(val) => setWaitPick((m) => ({ ...m, [p.id]: val }))}
                        options={roomOptions(null)}
                        placeholder="Choose a room"
                        searchable
                        ariaLabel={`Room for ${fmtName(p.name)}`}
                      />
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={!pick || busy === `assign:${p.id}`}
                        onClick={async () => { if (await assign(p, pick)) setWaitPick((m) => { const n = { ...m }; delete n[p.id]; return n; }); }}
                      >
                        <i className={`fas ${busy === `assign:${p.id}` ? 'fa-spinner fa-spin' : 'fa-user-plus'}`}></i> Assign
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ---- Find, filter, and how to look at them ---- */}
      <div className="rb-tools">
        <div className="rb-search">
          <i className="fas fa-magnifying-glass"></i>
          <input
            type="search"
            autoComplete="new-password"
            data-lpignore="true"
            data-form-type="other"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a room, type or a person's name"
            aria-label="Search rooms and people"
          />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><i className="fas fa-xmark"></i></button>}
        </div>
        <div className="rb-view" role="group" aria-label="View">
          <button type="button" className={view === 'grid' ? 'on' : ''} onClick={() => pickView('grid')} aria-pressed={view === 'grid'} title="Cards">
            <i className="fas fa-grip"></i> Grid
          </button>
          <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => pickView('list')} aria-pressed={view === 'list'} title="Rows">
            <i className="fas fa-list"></i> List
          </button>
        </div>
      </div>
      <div className="rb-filters" role="tablist">
        {[
          ['all', 'All rooms'], ['space', 'Has space'], ['full', 'Full'], ['empty', 'Empty'], ['reserved', 'Reserved'],
        ].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={filter === key} className={`is-${key} ${filter === key ? 'on' : ''}`} onClick={() => setFilter(key)}>
            {label} <b>{filters[key].length}</b>
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <p className="rb-empty">
          {model.views.length === 0 ? 'No rooms yet - add the block the venue gave you.' : q ? `No room matches "${query.trim()}".` : 'No rooms here.'}
        </p>
      )}

      {/* ---- Grid: a card per room, grouped by type ---- */}
      {view === 'grid' && groups.map((g) => {
        const pax = g.views.reduce((t, v) => t + v.pax, 0);
        const taken = g.views.reduce((t, v) => t + v.taken, 0);
        return (
          <section className="rb-group" key={g.type}>
            <header>
              <h4>{g.type}</h4>
              <span>{g.views.length} {g.views.length === 1 ? 'room' : 'rooms'} · {taken} of {pax} beds taken</span>
            </header>
            <div className="rb-grid">
              {g.views.map((v) => {
                const names = namesOf(v);
                return (
                  <button type="button" key={v.room.id} className={`rb-card is-${v.status}`} onClick={() => setOpenId(v.room.id)}>
                    <span className="rb-card-top">
                      <span className="rb-num">{v.room.room_number}</span>
                      {statusPill(v)}
                    </span>
                    {(v.room.floor || v.room.occupancy) && (
                      <span className="rb-card-sub">
                        {v.room.floor && <span><i className="fas fa-layer-group"></i> {v.room.floor}</span>}
                        {v.room.occupancy && <span className={`rb-occ is-${v.room.occupancy}`}>{occupancyLabel(v.room.occupancy)}</span>}
                      </span>
                    )}
                    <span className="rb-card-beds">
                      {bedDots(v)}
                      <span className="rb-count"><b>{v.taken}</b> / {v.pax} pax{v.kidCount > 0 && <em className="rb-kidcount"> + {v.kidCount} {v.kidCount === 1 ? 'kid' : 'kids'}</em>}</span>
                    </span>
                    {names.length > 0 ? (
                      <span className="rb-names">
                        {names.slice(0, 4).map((n) => (
                          <span key={n.key} className={n.held ? 'is-held' : ''}>
                            <i className={`fas ${n.held ? 'fa-lock' : n.visitor ? 'fa-user-tie' : 'fa-user'}`}></i>{n.name}
                          </span>
                        ))}
                        {names.length > 4 && <em>+{names.length - 4} more</em>}
                      </span>
                    ) : (
                      <span className="rb-names is-none">Nobody in this room yet</span>
                    )}
                    {v.reservedAnon > 0 && (
                      <span className="rb-anon"><i className="fas fa-lock"></i> {v.reservedAnon} {v.reservedAnon === 1 ? 'bed' : 'beds'} kept{v.room.reserved_for ? ` for ${v.room.reserved_for}` : ''}</span>
                    )}
                    <span className="rb-card-go">{canEdit && v.free > 0 ? 'Open · add people' : 'Open'} <i className="fas fa-arrow-right"></i></span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* ---- List: a row per room ---- */}
      {view === 'list' && shown.length > 0 && (
        <div className="rb-table-wrap">
          <table className="rb-table">
            <thead>
              <tr><th>Room</th><th>Type</th><th>Beds</th><th>Who is in it</th><th>Status</th><th aria-label="Open"></th></tr>
            </thead>
            <tbody>
              {shown.map((v) => {
                const names = namesOf(v);
                return (
                  <tr key={v.room.id} className={`is-${v.status}`} onClick={() => setOpenId(v.room.id)}>
                    <td data-label="Room">
                      <span className="rb-num">{v.room.room_number}</span>
                      {v.room.floor && <small className="rb-floor">{v.room.floor}</small>}
                    </td>
                    <td data-label="Type">
                      {v.room.room_type}
                      {v.room.occupancy && <span className={`rb-occ is-${v.room.occupancy}`}>{occupancyLabel(v.room.occupancy)}</span>}
                    </td>
                    <td data-label="Beds">
                      <span className="rb-card-beds">{bedDots(v)}<span className="rb-count"><b>{v.taken}</b> / {v.pax}</span></span>
                    </td>
                    <td data-label="Who is in it">
                      {names.length ? (
                        <span className="rb-names is-inline">
                          {names.map((n) => <span key={n.key} className={n.held ? 'is-held' : ''}>{n.held && <i className="fas fa-lock"></i>}{n.name}</span>)}
                        </span>
                      ) : <span className="rb-muted">Nobody yet</span>}
                    </td>
                    <td data-label="Status">{statusPill(v)}</td>
                    <td className="rb-go"><button type="button" onClick={(e) => { e.stopPropagation(); setOpenId(v.room.id); }} aria-label={`Open room ${v.room.room_number}`}><i className="fas fa-chevron-right"></i></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {openView && (
        <RoomPanel
          v={openView}
          model={model}
          canEdit={canEdit}
          busy={busy}
          askHeld={askHeld && askHeld.roomId === openView.room.id ? askHeld : null}
          setAskHeld={setAskHeld}
          roomOptions={roomOptions}
          onClose={() => { setOpenId(''); setAskHeld(null); }}
          assign={assign}
          addBedAndAssign={data.bed ? addBedAndAssign : null}
          bed={data.bed}
          addKid={addKid}
          removeKid={removeKid}
          unassign={unassign}
          hold={hold}
          release={release}
          keepBack={keepBack}
          exempt={exempt}
          // The page's own dialogs (edit, keep beds back, remove) open in its
          // place, not underneath it.
          roomActions={roomActions && Object.fromEntries(Object.entries(roomActions)
            .filter(([, fn]) => typeof fn === 'function')
            .map(([k, fn]) => [k, (room) => { setOpenId(''); setAskHeld(null); fn(room); }]))}
          statusPill={statusPill}
          bedDots={bedDots}
        />
      )}
    </div>
  );
}

// ---- One room, opened ----
function RoomPanel({ v, model, canEdit, busy, askHeld, setAskHeld, roomOptions, onClose, assign, addBedAndAssign, bed, addKid, removeKid, unassign, hold, release, keepBack, exempt, roomActions, statusPill, bedDots }) {
  const [mode, setMode] = useState('assign'); // assign | guest | reserve
  const [search, setSearch] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestNote, setGuestNote] = useState('');
  const [confirm, setConfirm] = useState(''); // key of a line asking "Remove?"
  const [exempting, setExempting] = useState(''); // registration id picking what they serve as
  const [exemptNote, setExemptNote] = useState('');
  const [kidFor, setKidFor] = useState(''); // guest id picking a kid for their bed
  const [kidSearch, setKidSearch] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => { setSearch(''); setConfirm(''); setExempting(''); setKidFor(''); }, [v.room.id, mode]);

  const { room } = v;
  const s = search.trim().toLowerCase();
  const matches = (p) => !s || `${p.name} ${p.church} ${p.representative}`.toLowerCase().includes(s);
  const roomNo = (id) => model.views.find((x) => x.room.id === id)?.room.room_number || '';

  // Assign: who availed accommodation. Nobody with a room first, verified
  // ones first; then the ones in another room, to move here.
  const assignList = (() => {
    const all = [...model.people.values()].filter((p) => p.entitled && p.roomId !== room.id && matches(p));
    const rank = (p) => (p.roomId || p.withAdult ? 2 : p.heldRoomId && p.heldRoomId !== room.id ? 1 : 0);
    return all
      .sort((a, b) => rank(a) - rank(b) || (b.verified - a.verified) || fmtName(a.name).localeCompare(fmtName(b.name)))
      .slice(0, s ? 30 : LIST_LIMIT);
  })();
  const assignTotal = [...model.people.values()].filter((p) => p.entitled && !p.roomId && !p.heldRoomId).length;
  // Searching: who matches but did not avail accommodation - shown too, so
  // nobody seems missing, with the bed added for them on the way in.
  const notAvailedList = s.length >= 2
    ? [...model.people.values()].filter((p) => !p.entitled && !p.roomId && !p.withAdult && matches(p))
      .sort((a, b) => fmtName(a.name).localeCompare(fmtName(b.name))).slice(0, 12)
    : [];
  // Reserve: anybody on the event without a room or a held bed.
  const reserveList = s.length >= 2
    ? [...model.people.values()].filter((p) => !p.roomId && !p.heldRoomId && !p.withAdult && matches(p))
      .sort((a, b) => fmtName(a.name).localeCompare(fmtName(b.name))).slice(0, 12)
    : [];

  const canAdd = canEdit && v.free > 0;
  const full = v.free <= 0;

  const personRow = (p, action) => {
    const pay = payChip(p);
    return (
      <li key={p.id}>
        <span className="rb-avatar">{initials(fmtName(p.name))}</span>
        <span className="rb-who">
          <b>{fmtName(p.name)}</b>
          <small>{[p.church && formatChurchName(p.church), p.bulk && p.representative && `${fmtName(p.representative)}'s booking`].filter(Boolean).join(' · ')}</small>
        </span>
        <span className="rb-chips">
          <span className={`rb-chip ${p.verified ? 'is-ok' : 'is-muted'}`}>{p.verified ? 'Verified' : 'Not verified yet'}</span>
          {exemptChip(p)}
          {pay && <span className={`rb-chip is-${pay.tone}`}>{pay.text}</span>}
          {p.roomId &&<span className="rb-chip is-info">In {roomNo(p.roomId)}</span>}
          {p.withAdult && <span className="rb-chip is-info">With {fmtName(model.people.get(p.withAdult)?.name)} · {roomNo(p.kidRoomId)}</span>}
          {!p.roomId && p.heldRoomId && <span className="rb-chip is-held">Held in {roomNo(p.heldRoomId)}</span>}
          {!p.entitled && <span className="rb-chip is-muted" title={p.why}>No accommodation extra</span>}
        </span>
        {action}
      </li>
    );
  };

  return createPortal(
    <div className="evt-modal-overlay rb-overlay" onClick={onClose}>
      <div className="evt-modal rb-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="rb-panel-title">
        <div className="evt-modal-head">
          <div>
            <h3 id="rb-panel-title"><i className="fas fa-door-closed"></i> Room {room.room_number}</h3>
            <p>{[room.room_type, room.floor, bedsToText(room.beds), occupancyLabel(room.occupancy)].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" className="evt-modal-close" onClick={onClose} aria-label="Close"><i className="fas fa-times"></i></button>
        </div>

        <div className="evt-modal-body rb-panel-body">
          <div className={`rb-panel-sum is-${v.status}`}>
            {bedDots(v)}
            <span><b>{v.taken}</b> of {v.pax} beds taken</span>
            {statusPill(v)}
          </div>
          {room.notes && <p className="rb-note"><i className="fas fa-note-sticky"></i> {room.notes}</p>}

          {/* ---- Who is in it, a line per bed ---- */}
          <ul className="rb-beds">
            {v.guests.map((g) => {
              const p = g.person || { id: g.registrationId, name: 'Attendee', church: '', status: '' };
              const key = `g:${g.id}`;
              return (
                <li key={g.id} className="is-in">
                  <span className="rb-avatar">{initials(fmtName(p.name))}</span>
                  <span className="rb-who">
                    <b>{fmtName(p.name)}</b>
                    <small>{[p.church && formatChurchName(p.church), p.bulk && p.representative && `${fmtName(p.representative)}'s booking`].filter(Boolean).join(' · ')}</small>
                    {/* Kids in their bed: no bed of their own. */}
                    {g.kids.length > 0 && (
                      <span className="rb-kids">
                        {g.kids.map((k) => (
                          <span key={k.id} className="rb-kid">
                            <i className="fas fa-child"></i> Kid: {fmtName(k.person?.name) || 'Kid'}
                            {canEdit && (
                              <button type="button" onClick={() => removeKid(k)} disabled={busy === `kidout:${k.id}`} title="Take the kid out of this bed" aria-label={`Take ${fmtName(k.person?.name)} out`}>
                                <i className={`fas ${busy === `kidout:${k.id}` ? 'fa-spinner fa-spin' : 'fa-xmark'}`}></i>
                              </button>
                            )}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="rb-chips">
                    <span className={`rb-chip ${p.verified ? 'is-ok' : 'is-muted'}`}>{p.verified ? 'Verified' : 'Not verified yet'}</span>
                    {exemptChip(p)}
                    {payChip(p) && <span className={`rb-chip is-${payChip(p).tone}`}>{payChip(p).text}</span>}
                  </span>
                  {canEdit && (
                    confirm === key ? (
                      <span className="rb-acts">
                        <span className="rb-confirm">Take out of {room.room_number}?</span>
                        <button type="button" className="btn-secondary" onClick={() => setConfirm('')}>No</button>
                        <button type="button" className="btn-danger" disabled={busy === `guest:${g.id}`} onClick={() => unassign(g).finally(() => setConfirm(''))}>
                          <i className={`fas ${busy === `guest:${g.id}` ? 'fa-spinner fa-spin' : 'fa-user-minus'}`}></i> Yes
                        </button>
                      </span>
                    ) : confirm === `x:${g.id}` ? (
                      <span className="rb-acts">
                        <span className="rb-confirm">
                          {p.exempt?.waived > 0 ? `Take the exemption back? They owe the ${peso(p.exempt.waived)} it waived again.` : 'Take the exemption back?'}
                        </span>
                        <button type="button" className="btn-secondary" onClick={() => setConfirm('')}>No</button>
                        <button type="button" className="btn-danger" disabled={busy === `exempt:${p.id}`} onClick={() => exempt(p, '', true).finally(() => setConfirm(''))}>
                          <i className={`fas ${busy === `exempt:${p.id}` ? 'fa-spinner fa-spin' : 'fa-rotate-left'}`}></i> Yes
                        </button>
                      </span>
                    ) : (
                      <span className="rb-acts">
                        {p.exempt ? (
                          <button
                            type="button"
                            className="rb-iconbtn"
                            onClick={() => { setExempting(''); setConfirm(`x:${g.id}`); }}
                            title={`Take the exemption back${p.exempt.waived > 0 ? ` - they owe the ${peso(p.exempt.waived)} it waived again` : ''}`}
                            aria-label={`Take back ${fmtName(p.name)}'s exemption`}
                          >
                            <i className="fas fa-rotate-left"></i>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={`rb-exbtn ${exempting === p.id ? 'on' : ''}`}
                            onClick={() => { setConfirm(''); setExemptNote(''); setExempting(exempting === p.id ? '' : p.id); }}
                            title="Serving at the event - committee, usher, worship team. Worth their registration fee: not paid yet, the fee is waived; already paid, their accommodation is free."
                            aria-expanded={exempting === p.id}
                          >
                            <i className="fas fa-id-badge"></i> Exempt
                          </button>
                        )}
                        <button
                          type="button"
                          className={`rb-kidbtn ${kidFor === g.id ? 'on' : ''}`}
                          onClick={() => { setConfirm(''); setExempting(''); setKidSearch(''); setKidFor(kidFor === g.id ? '' : g.id); }}
                          title="A kid or 6-10 year old who sleeps in their bed - takes no bed of their own"
                          aria-expanded={kidFor === g.id}
                        >
                          <i className="fas fa-child"></i> Kid
                        </button>
                        <PickList
                          size="sm"
                          value=""
                          onChange={(to) => { if (to) assign(p, to); }}
                          options={roomOptions(room.id)}
                          placeholder="Move to…"
                          searchable
                          disabled={busy === `assign:${p.id}`}
                          ariaLabel={`Move ${fmtName(p.name)} to another room`}
                        />
                        <button type="button" className="rb-iconbtn danger" onClick={() => setConfirm(key)} title="Take them out of this room" aria-label={`Take ${fmtName(p.name)} out`}>
                          <i className="fas fa-user-minus"></i>
                        </button>
                      </span>
                    )
                  )}
                  {/* Exempt: what they serve as, then no registration fee - their accommodation they still pay. */}
                  {canEdit && exempting === p.id && !p.exempt && (
                    <form
                      className="rb-exform"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (await exempt(p, exemptNote)) { setExempting(''); setExemptNote(''); }
                      }}
                    >
                      <span className="rb-exform-label">Exempt as</span>
                      <span className="rb-exroles" role="group" aria-label="What they serve as">
                        {EXEMPT_ROLES.map((r) => (
                          <button key={r} type="button" className={exemptNote === r ? 'on' : ''} aria-pressed={exemptNote === r} onClick={() => setExemptNote(r)}>{r}</button>
                        ))}
                      </span>
                      <input
                        className="form-control"
                        value={exemptNote}
                        onChange={(e) => setExemptNote(e.target.value)}
                        placeholder="Or type it - e.g. Sound Team, Registration Desk"
                        maxLength={80}
                        aria-label="What they serve as"
                        autoFocus
                      />
                      <small>
                        {exemptPreview(p)}
                        {' '}Shows at Registration Verification as <b>Exemption: {exemptNote.trim() || '…'}</b>.
                      </small>
                      <span className="rb-exform-acts">
                        <button type="button" className="btn-secondary" onClick={() => setExempting('')}>Cancel</button>
                        <button type="submit" className="btn-primary" disabled={!exemptNote.trim() || busy === `exempt:${p.id}`}>
                          <i className={`fas ${busy === `exempt:${p.id}` ? 'fa-spinner fa-spin' : 'fa-id-badge'}`}></i> Exempt
                        </button>
                      </span>
                    </form>
                  )}
                  {/* A kid in their bed: the kids registered at the event - their
                      own booking first - with where each is now. */}
                  {canEdit && kidFor === g.id && (() => {
                    const ks = kidSearch.trim().toLowerCase();
                    const sameBooking = (k) => !!p.representative && fmtName(k.representative) === fmtName(p.representative);
                    const where = (k) => (k.withAdult ? 2 : k.roomId ? 1 : 0);
                    const kids = [...model.people.values()]
                      .filter((k) => k.child && k.id !== p.id && k.withAdult !== p.id
                        && (!ks || `${k.name} ${k.church} ${k.representative}`.toLowerCase().includes(ks)))
                      .sort((a, b) => (sameBooking(b) - sameBooking(a)) || (where(a) - where(b)) || fmtName(a.name).localeCompare(fmtName(b.name)))
                      .slice(0, ks ? 20 : 8);
                    return (
                      <div className="rb-exform rb-kidform">
                        <span className="rb-exform-label"><i className="fas fa-child"></i> A kid in {fmtName(p.name)}&apos;s bed</span>
                        <input
                          className="form-control"
                          value={kidSearch}
                          onChange={(e) => setKidSearch(e.target.value)}
                          placeholder="Search a kid's name"
                          aria-label="Search a kid"
                          autoFocus
                        />
                        <ul className="rb-kidlist">
                          {kids.length === 0 && <li className="rb-muted">{ks ? 'No kid matches.' : 'No Kid or 6-10 years old attendees at this event.'}</li>}
                          {kids.map((k) => (
                            <li key={k.id}>
                              <span className="rb-who">
                                <b>{fmtName(k.name)}</b>
                                <small>{[k.tier, k.bulk && k.representative && `${fmtName(k.representative)}'s booking`].filter(Boolean).join(' · ')}</small>
                              </span>
                              {k.withAdult
                                ? <span className="rb-chip is-info">With {fmtName(model.people.get(k.withAdult)?.name)}</span>
                                : k.roomId ? <span className="rb-chip is-info">Own bed in {roomNo(k.roomId)}</span> : null}
                              <button type="button" className="btn-primary rb-small" disabled={busy === `kid:${k.id}`} onClick={async () => { if (await addKid(g, k)) setKidFor(''); }}>
                                <i className={`fas ${busy === `kid:${k.id}` ? 'fa-spinner fa-spin' : 'fa-child'}`}></i> {k.withAdult || k.roomId ? 'Move here' : 'Add'}
                              </button>
                            </li>
                          ))}
                        </ul>
                        <small>
                          Shares this bed - takes no bed of their own - and is written as <b>{fmtName(p.name)} [Kid: …]</b> on the rooming list and the live Google Sheets.
                        </small>
                        <span className="rb-exform-acts">
                          <button type="button" className="btn-secondary" onClick={() => setKidFor('')}>Close</button>
                        </span>
                      </div>
                    );
                  })()}
                </li>
              );
            })}
            {v.visitors.map((h) => {
              const key = `h:${h.id}`;
              return (
                <li key={h.id} className="is-in is-visitor">
                  <span className="rb-avatar">{initials(fmtName(h.name))}</span>
                  <span className="rb-who">
                    <b>{fmtName(h.name)}</b>
                    <small>{h.note || 'Not registered for the event'}</small>
                  </span>
                  <span className="rb-chips">
                    <span className="rb-chip is-guest">Not an attendee</span>
                  </span>
                  {canEdit && (
                    confirm === key ? (
                      <span className="rb-acts">
                        <span className="rb-confirm">Take out of {room.room_number}?</span>
                        <button type="button" className="btn-secondary" onClick={() => setConfirm('')}>No</button>
                        <button type="button" className="btn-danger" disabled={busy === `hold:${h.id}`} onClick={() => release(h).finally(() => setConfirm(''))}>
                          <i className={`fas ${busy === `hold:${h.id}` ? 'fa-spinner fa-spin' : 'fa-user-minus'}`}></i> Yes
                        </button>
                      </span>
                    ) : (
                      <span className="rb-acts">
                        <button type="button" className="rb-iconbtn danger" onClick={() => setConfirm(key)} title="Take them out of this room" aria-label={`Take ${fmtName(h.name)} out`}>
                          <i className="fas fa-user-minus"></i>
                        </button>
                      </span>
                    )
                  )}
                </li>
              );
            })}
            {v.reservedNamed.map((h) => {
              const p = h.person;
              const key = `h:${h.id}`;
              return (
                <li key={h.id} className="is-held">
                  <span className="rb-avatar is-held"><i className="fas fa-lock"></i></span>
                  <span className="rb-who">
                    <b>{fmtName(h.name)}</b>
                    <small>
                      Reserved for this attendee
                      {h.note ? ` · ${h.note}` : ''}
                    </small>
                  </span>
                  <span className="rb-chips">
                    <span className="rb-chip is-held">Reserved</span>
                    {p && !p.entitled && <span className="rb-chip is-muted" title={p.why}>No accommodation extra yet</span>}
                  </span>
                  {canEdit && (
                    confirm === key ? (
                      <span className="rb-acts">
                        <span className="rb-confirm">Let this bed go?</span>
                        <button type="button" className="btn-secondary" onClick={() => setConfirm('')}>No</button>
                        <button type="button" className="btn-danger" disabled={busy === `hold:${h.id}`} onClick={() => release(h).finally(() => setConfirm(''))}>
                          <i className={`fas ${busy === `hold:${h.id}` ? 'fa-spinner fa-spin' : 'fa-unlock'}`}></i> Yes
                        </button>
                      </span>
                    ) : (
                      <span className="rb-acts">
                        {p && p.entitled && (
                          <button type="button" className="btn-primary rb-small" disabled={busy === `assign:${p.id}`} onClick={() => assign(p, room.id)} title="They availed accommodation - give them this bed">
                            <i className={`fas ${busy === `assign:${p.id}` ? 'fa-spinner fa-spin' : 'fa-user-check'}`}></i> Assign
                          </button>
                        )}
                        <button type="button" className="rb-iconbtn danger" onClick={() => setConfirm(key)} title="Let this bed go" aria-label={`Let ${fmtName(h.name)}'s bed go`}>
                          <i className="fas fa-xmark"></i>
                        </button>
                      </span>
                    )
                  )}
                </li>
              );
            })}
            {Array.from({ length: v.held }).map((_, i) => {
              const key = `k:${i}`;
              const working = busy === `kept:${room.id}`;
              return (
                <li key={`held-${i}`} className="is-anon">
                  <span className="rb-avatar is-anon"><i className="fas fa-lock"></i></span>
                  <span className="rb-who"><b>Kept back</b><small>{room.reserved_for ? `For ${room.reserved_for}` : 'Reserved - no name'}</small></span>
                  {canEdit && (
                    confirm === key ? (
                      <span className="rb-acts">
                        <span className="rb-confirm">Free this bed?</span>
                        <button type="button" className="btn-secondary" onClick={() => setConfirm('')}>No</button>
                        <button type="button" className="btn-danger" disabled={working} onClick={() => keepBack(room, v.held - 1).finally(() => setConfirm(''))}>
                          <i className={`fas ${working ? 'fa-spinner fa-spin' : 'fa-unlock'}`}></i> Yes
                        </button>
                      </span>
                    ) : (
                      <span className="rb-acts">
                        <button type="button" className="rb-iconbtn danger" onClick={() => setConfirm(key)} title="Free this bed - it is no longer kept back" aria-label="Free this kept-back bed">
                          <i className="fas fa-xmark"></i>
                        </button>
                      </span>
                    )
                  )}
                </li>
              );
            })}
            {canEdit && v.held > 1 && (
              <li className="rb-keptall">
                {confirm === 'k:all' ? (
                  <>
                    <span className="rb-confirm">Free all {v.held} kept-back beds{room.reserved_for ? ` (${room.reserved_for})` : ''}?</span>
                    <button type="button" className="btn-secondary" onClick={() => setConfirm('')}>No</button>
                    <button type="button" className="btn-danger" disabled={busy === `kept:${room.id}`} onClick={() => keepBack(room, 0).finally(() => setConfirm(''))}>
                      <i className={`fas ${busy === `kept:${room.id}` ? 'fa-spinner fa-spin' : 'fa-unlock'}`}></i> Yes, free all
                    </button>
                  </>
                ) : (
                  <button type="button" className="rb-linkbtn" onClick={() => setConfirm('k:all')}>
                    <i className="fas fa-unlock"></i> Free all {v.held} kept-back beds
                  </button>
                )}
              </li>
            )}
            {Array.from({ length: v.open }).map((_, i) => (
              <li key={`free-${i}`} className="is-free">
                <span className="rb-avatar is-free"><i className="fas fa-bed"></i></span>
                <span className="rb-who"><b>Empty bed</b></span>
              </li>
            ))}
          </ul>

          {/* A bed kept back: the desk says yes before it is used. */}
          {askHeld && (
            <div className="rb-askheld">
              <i className="fas fa-lock"></i>
              <span>{askHeld.message} Use a kept-back bed for <b>{fmtName(askHeld.person.name)}</b>?</span>
              <button type="button" className="btn-secondary" onClick={() => setAskHeld(null)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={() => assign(askHeld.person, askHeld.roomId, true)}>Use it</button>
            </div>
          )}

          {/* ---- Putting somebody in ---- */}
          {canEdit && (full ? (
            <p className="rb-fullnote"><i className="fas fa-circle-check"></i> Room {room.room_number} is full. Take somebody out, or move them, to free a bed.</p>
          ) : canAdd && (
            <div className="rb-add">
              <div className="rb-seg" role="tablist">
                <button type="button" role="tab" aria-selected={mode === 'assign'} className={mode === 'assign' ? 'on' : ''} onClick={() => setMode('assign')}>
                  <i className="fas fa-user-plus"></i> Attendee
                </button>
                <button type="button" role="tab" aria-selected={mode === 'guest'} className={mode === 'guest' ? 'on' : ''} onClick={() => setMode('guest')}>
                  <i className="fas fa-user-tie"></i> Not an attendee
                </button>
                <button type="button" role="tab" aria-selected={mode === 'reserve'} className={mode === 'reserve' ? 'on' : ''} onClick={() => setMode('reserve')}>
                  <i className="fas fa-lock"></i> Reserve a bed
                </button>
              </div>

              {mode === 'assign' ? (
                <>
                  <div className="rb-search">
                    <i className="fas fa-magnifying-glass"></i>
                    <input
                      type="search"
                      autoComplete="new-password"
                      data-lpignore="true"
                      data-form-type="other"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search who availed accommodation"
                      aria-label="Search attendees who availed accommodation"
                      autoFocus
                    />
                  </div>
                  <p className="rb-hint">
                    {s ? 'Matching attendees who availed accommodation.' : `${assignTotal} ${assignTotal === 1 ? 'has' : 'have'} no room yet - verified at the desk or not, they can be given one.`}
                  </p>
                  <ul className="rb-people">
                    {assignList.length === 0 && <li className="rb-muted">{s ? 'Nobody who availed accommodation matches.' : 'Nobody is waiting for a room.'}</li>}
                    {assignList.map((p) => personRow(p, (
                      <button
                        type="button"
                        className="btn-primary rb-small"
                        disabled={busy === `assign:${p.id}`}
                        onClick={() => assign(p, room.id)}
                      >
                        <i className={`fas ${busy === `assign:${p.id}` ? 'fa-spinner fa-spin' : p.roomId ? 'fa-right-left' : 'fa-user-plus'}`}></i>
                        {p.roomId ? ' Move here' : ' Assign'}
                      </button>
                    )))}
                  </ul>
                  {notAvailedList.length > 0 && (
                    <>
                      <p className="rb-hint rb-hint-head">
                        <i className="fas fa-circle-info"></i> Did not avail accommodation{addBedAndAssign
                          ? <> - <b>Add bed &amp; assign</b> puts {bed?.question || 'accommodation'} on their registration (cash to collect) and gives them this room.</>
                          : ' - reserve a bed for them, or add accommodation on their registration first.'}
                      </p>
                      <ul className="rb-people">
                        {notAvailedList.map((p) => personRow(p, addBedAndAssign ? (
                          <button
                            type="button"
                            className="btn-primary rb-small"
                            disabled={busy === `assign:${p.id}`}
                            onClick={() => addBedAndAssign(p, room.id)}
                            title={`Add ${bed?.question || 'accommodation'}${p.bedFee > 0 ? ` (+${peso(p.bedFee)})` : ''} and put them in ${room.room_number}`}
                          >
                            <i className={`fas ${busy === `assign:${p.id}` ? 'fa-spinner fa-spin' : 'fa-bed'}`}></i>
                            {' '}Add bed{p.bedFee > 0 ? ` +${peso(p.bedFee)}` : ''} &amp; assign
                          </button>
                        ) : !p.heldRoomId && (
                          <button type="button" className="btn-primary rb-small" disabled={busy === 'hold'} onClick={() => hold(room.id, { registrationId: p.id })}>
                            <i className={`fas ${busy === 'hold' ? 'fa-spinner fa-spin' : 'fa-lock'}`}></i> Reserve
                          </button>
                        )))}
                      </ul>
                    </>
                  )}
                </>
              ) : mode === 'guest' ? (
                <>
                  <form
                    className="rb-guestform"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (await hold(room.id, { name: guestName, note: guestNote })) { setGuestName(''); setGuestNote(''); }
                    }}
                  >
                    <input className="form-control" value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Their name" maxLength={120} aria-label="Name of the person to add" autoFocus />
                    <input className="form-control" value={guestNote} onChange={(e) => setGuestNote(e.target.value)} placeholder="Who they are (optional) - e.g. Usher, Speaker" maxLength={200} aria-label="Who they are" />
                    <button type="submit" className="btn-primary" disabled={!guestName.trim() || busy === 'hold'}>
                      <i className={`fas ${busy === 'hold' ? 'fa-spinner fa-spin' : 'fa-user-plus'}`}></i> Add to room
                    </button>
                  </form>
                  <p className="rb-hint">
                    <i className="fas fa-circle-info"></i> Somebody not registered for the event - a speaker, an usher, a driver. They go in
                    {' '}{room.room_number} with everybody else, take a bed, and show on the rooming list and the live Google Sheets.
                  </p>
                </>
              ) : (
                <>
                  <div className="rb-search">
                    <i className="fas fa-magnifying-glass"></i>
                    <input
                      type="search"
                      autoComplete="new-password"
                      data-lpignore="true"
                      data-form-type="other"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search any attendee to reserve a bed for"
                      aria-label="Search any attendee"
                      autoFocus
                    />
                  </div>
                  <ul className="rb-people">
                    {s.length < 2 && <li className="rb-muted">Type a name. A bed can be held for any attendee - even before they avail accommodation.</li>}
                    {s.length >= 2 && reserveList.length === 0 && <li className="rb-muted">Nobody without a room or a reserved bed matches.</li>}
                    {reserveList.map((p) => personRow(p, (
                      <button type="button" className="btn-primary rb-small" disabled={busy === 'hold'} onClick={() => hold(room.id, { registrationId: p.id })}>
                        <i className={`fas ${busy === 'hold' ? 'fa-spinner fa-spin' : 'fa-lock'}`}></i> Reserve
                      </button>
                    )))}
                  </ul>
                  <p className="rb-hint"><i className="fas fa-file-excel"></i> A reserved bed is taken, and the name shows on the rooming list and the live Google Sheets.</p>
                </>
              )}
            </div>
          ))}
        </div>

        {canEdit && roomActions && (
          <div className="evt-modal-foot rb-panel-foot">
            {roomActions.onRemove && (
              <button type="button" className="btn-secondary rb-danger-text" onClick={() => roomActions.onRemove(room)}>
                <i className="fas fa-trash"></i> Remove room
              </button>
            )}
            {roomActions.onHoldBeds && (
              <button type="button" className="btn-secondary" onClick={() => roomActions.onHoldBeds(room)} title="Keep beds back without a name - e.g. for Speakers">
                <i className="fas fa-lock"></i> Keep beds back
              </button>
            )}
            {roomActions.onEdit && (
              <button type="button" className="btn-secondary" onClick={() => roomActions.onEdit(room)}>
                <i className="fas fa-pen"></i> Edit room
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
