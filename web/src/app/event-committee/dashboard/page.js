'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
// The main dashboard's stylesheet, not a second one of our own. The committee
// screen IS the main dashboard as far as the eye is concerned - same sidebar,
// same hero, same tables, same modals - so it reads from the same file. A
// separate committee stylesheet would only be a copy that drifts.
import '../../dashboard/dashboard.css';
// The store's own pieces - a product card and a basket, which the main
// dashboard has no component for. Same tokens, same dark-mode convention.
import './apparel.css';
// The contributions tab: drive cards, the share table and its payment history.
// Committee-only, so it stays out of the main dashboard's stylesheet - nothing
// on the Admin side renders any of it.
import './contributions.css';
// One reading of what a proof of payment is, shared with the main dashboard:
// a receipt can be a photo, a PDF from a bank, or another file entirely.
import { isImageProof, isPdfProof, proofFileName } from '@/lib/proofFile';
import ProofDrop from '@/components/ProofDrop';
// The figures on a receipt, said again in words. A receipt carries the amount
// twice because a pen stroke can turn 100 into 1000 and cannot do that to
// "One Hundred Pesos Only".
import { amountInWords } from '@/lib/amountInWords';
// The event door, shared with the Admin dashboard: the RFID reader, the
// per-day attendance columns, the kit and meal counters and the corrections
// lock. One component, so the two desks cannot drift apart again.
import EventAttendanceTab from '@/components/eventDesk/EventAttendanceTab';

// The Event Committee dashboard.
//
// Same account as the main site, a narrower job: this screen is the
// registration table at the door. It does not create, publish or delete
// events - it works the ones an Admin has already set up. What it can do is
// exactly what the committee is for:
//
//   Events        the ones assigned to them, and nothing else
//   Registrations verify a payment, put one back, read the proof
//   Attendance    check people in, by hand or by QR
//   Installments  collect against a flexible plan
//   Walk-ins      add somebody who turned up without registering
//   Team          Admins only - where committee members are added
//
// Everything destructive (cancelling, deleting, the recycle bin, editing the
// event itself) stays in the main dashboard where the Admins are.

/* ------------------------------------------------------------------ *
 * Helpers shared with the main dashboard.
 *
 * Copied rather than imported because the main dashboard keeps them inside
 * its component. Same rules, so a name, a church or a status reads the same
 * on both screens.
 * ------------------------------------------------------------------ */

// Churches are typed by hand, so "joyful sound church" and "Joyful Sound
// Church" are the same place. Shown in Title Case, leaving small joining words
// and anything deliberately capitalised (JSCI, ISOM) alone.
const CHURCH_MINOR_WORDS = new Set(['of', 'the', 'and', 'in', 'for', 'a', 'an', 'at', 'on', 'to']);
const titleCaseChurch = (name) => {
  const raw = (name || '').trim();
  if (!raw) return '';
  return raw.split(/(\s+)/).map((chunk) => {
    if (!chunk.trim()) return chunk;
    return chunk.split('-').map((word, wi) => {
      if (!word) return word;
      if (word.length > 1 && word === word.toUpperCase()) return word;
      const lower = word.toLowerCase();
      if (wi !== 0 && CHURCH_MINOR_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    }).join('-');
  }).join('');
};
const formatChurchName = (name) => {
  const t = titleCaseChurch(name);
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
};

// Names as they should read on a badge.
const NAME_PARTICLES = new Set(['de', 'del', 'dela', 'delos', 'delas', 'da', 'di', 'van', 'von', 'y', 'la', 'las', 'los', 'san', 'santa']);
const formatPersonName = (name) => {
  const raw = String(name || '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  const capWord = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  return raw.split(' ').map((word, i, all) => {
    const lower = word.toLowerCase();
    if (i > 0 && i < all.length - 1 && NAME_PARTICLES.has(lower)) return lower;
    return lower.split('-').map((part) => part.split("'").map(capWord).join("'")).join('-');
  }).join(' ');
};

// 'payment_verified' is the end of the road for money, so it reads as "paid"
// rather than describing the checking that got it there.
const STATUS_LABELS = {
  payment_verified: 'paid',
  payment_submitted: 'for verification',
  pending_payment: 'awaiting payment',
  installment: 'installment',
};
const statusLabel = (status) => STATUS_LABELS[status] || String(status || '').replace(/_/g, ' ');

const peso = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH')}`;

// A registration holding a seat. Mirrors lib/eventSlots, so the counters here
// agree with the ones on the admin dashboard.
const SLOT_HOLDING = ['registered', 'payment_verified', 'payment_submitted', 'installment'];

// Event datetimes are WALL-CLOCK: the column holds "the time the admin typed"
// and Postgres stamps it +00:00 on the way in. Reading one with `new Date()`
// would shift it by the viewer's offset, so the components are read off the
// string and rebuilt locally. Same rule as the main dashboard's evtDate().
const evtDate = (str) => {
  if (!str) return null;
  if (str instanceof Date) return Number.isNaN(str.getTime()) ? null : str;
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) { const f = new Date(str); return Number.isNaN(f.getTime()) ? null : f; }
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  return Number.isNaN(d.getTime()) ? null : d;
};
const evtMs = (str) => { const d = evtDate(str); return d ? d.getTime() : null; };

const formatEventDateTime = (str) => {
  const d = evtDate(str);
  return d ? d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
};

// "Oct 2, 2026, 10:00 AM" for one day; "Oct 2 – 3, 2026" across days.
const formatEventSpan = (startStr, endStr) => {
  if (!startStr) return '—';
  const s = evtDate(startStr);
  if (!s) return '—';
  const e = evtDate(endStr);
  const time = s.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (!e || s.toDateString() === e.toDateString()) {
    return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${time}`;
  }
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  const left = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const right = sameMonth
    ? `${e.getDate()}, ${e.getFullYear()}`
    : e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${left} – ${right}`;
};

// Rows written by the server (created_at, attended_at) are real instants.
const formatDateTime = (dateStr) => (dateStr
  ? new Date(dateStr).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '');

// A day with no clock on it. Payments are stored as a plain date - the
// question is which day the money came in - and putting "12:00 AM" beside
// every instalment reads as a time somebody recorded rather than as noise.
// Split by hand rather than through Date(), which reads a bare "2026-09-14" as
// UTC midnight and can show the day before in a timezone behind it.
const formatDateOnly = (dateStr) => {
  if (!dateStr) return '';
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return String(dateStr);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// Compared as words, not as a substring: "GCash" is an online wallet that
// happens to contain the letters of "cash".
const isCashMethod = (method) => {
  const m = String(method || '').trim().toLowerCase();
  return m === 'cash' || m.startsWith('cash ') || m.endsWith(' cash');
};

// Older rows predate registration_type, so fall back to what the row implies.
const regTypeOf = (r) => {
  const t = r.registration_type;
  if (t === 'bulk' || t === 'individual') return t;
  return r.group_size > 1 ? 'bulk' : 'individual';
};

const onlyDigits = (v) => (v || '').replace(/\D/g, '').slice(0, 11);

// A blank contribution, and the one payment channel nobody administers.
//
// Both live out here rather than inside the component on purpose: a constant
// rebuilt on every render is a NEW object every render, which makes anything
// deriving from it re-derive forever - contribMethods below is a useMemo, and
// a useMemo over a value that changes identity every render is just a slower
// way of not memoising.
const CONTRIB_BLANK = { id: null, title: '', description: '' };
// Cash is not a row in Mode of Payment and should not be: there is no account
// number to administer. It is offered beside the channels that ARE
// administered, carrying no id - see resolveMethod on the server.
const CASH_METHOD = { id: '', name: 'Cash' };
const isValidPhMobile = (v) => /^09\d{9}$/.test(v || '');

const eventStatusOf = (evt) => {
  const now = Date.now();
  const start = evtMs(evt.event_date);
  const end = evt.end_date ? evtMs(evt.end_date) : start;
  if (evt.is_published === false) return { label: 'Draft', cls: 'draft' };
  if (start && now < start) return { label: 'Upcoming', cls: 'upcoming' };
  if (start && end && now >= start && now <= end) return { label: 'Ongoing', cls: 'ongoing' };
  if (end && now > end) return { label: 'Completed', cls: 'completed' };
  return { label: 'Published', cls: 'published' };
};

const isEventOver = (evt) => {
  const end = evt?.end_date ? evtMs(evt.end_date) : (evt?.event_date ? evtMs(evt.event_date) : null);
  return !!end && end < Date.now();
};

const initialsOf = (first, last) => `${(first || '?').charAt(0)}${(last || '').charAt(0)}`.toUpperCase();

/* ---------- Committee roles & tasks ---------- */
// What somebody DOES on an event, as opposed to which events they may open.
// Free text, like the apparel categories - these are only the starting list.
const DEFAULT_COMMITTEE_ROLES = [
  'Registration', 'Cashier', 'Usher', 'Attendance / Check-in',
  'Documentation', 'Logistics', 'Team Lead',
];

const TASK_STATUSES = ['open', 'doing', 'done', 'cancelled'];
const TASK_STATUS_LABELS = { open: 'open', doing: 'in progress', done: 'done', cancelled: 'cancelled' };
const TASK_STATUS_PILL = {
  open: 'ap-status-pending', doing: 'ap-status-approved',
  done: 'ap-status-released', cancelled: 'ap-status-cancelled',
};

// The account's own standing in the church - "Guest", plus the ministry or
// sub-role that says PAW, Media, Song Leader. Shown beside the committee
// roles, because they answer different questions about the same person.
const accountRoleTags = (person) => [person?.role, person?.ministry, person?.sub_role]
  .map((v) => String(v || '').trim())
  .filter(Boolean)
  .filter((v, i, all) => all.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);

/* ---------- Apparel ---------- */
const APPAREL_CATEGORIES = ['Jacket', 'Polo Shirt', 'Shirt', 'ID', 'Other'];
const APPAREL_STATUSES = ['pending', 'approved', 'ready', 'released', 'cancelled'];
const APPAREL_STATUS_LABELS = {
  pending: 'pending', approved: 'approved', ready: 'ready for pickup',
  released: 'released', cancelled: 'cancelled',
};
const APPAREL_CATEGORY_ICONS = {
  Jacket: 'fa-vest', 'Polo Shirt': 'fa-shirt', Shirt: 'fa-shirt', ID: 'fa-id-badge', Other: 'fa-tag',
};
const APPAREL_STATUS_ICONS = {
  pending: 'fa-hourglass-half', approved: 'fa-thumbs-up', ready: 'fa-box-open',
  released: 'fa-handshake', cancelled: 'fa-ban',
};
// What each step actually means for the person choosing it - in particular
// what it does to the stock, which is the part that is easy to get wrong.
const APPAREL_STATUS_HINTS = {
  pending: 'Nobody has looked at it yet.',
  approved: 'Accepted and being made.',
  ready: 'It exists and can be collected.',
  released: 'Handed over. The stock stays spent.',
  cancelled: 'Called off. Everything goes back into stock.',
};

const MAX_APPAREL_IMAGES = 5;
// What cash is called when an Admin has not renamed it on the item.
const DEFAULT_CASH_LABEL = 'Pay Cash at Church';
// Pre-filled in this order, because this is the order people photograph a
// garment in. Every one of them is still editable.
const APPAREL_IMAGE_LABELS = ['Front', 'Back', 'Side', 'Detail', 'Sizing'];

// Every picture of one garment, as [{ url, label }]. Rows written before the
// `images` column existed carry a single image_url instead, so that is read as
// a one-picture list rather than as nothing.
const apparelImages = (item) => {
  const list = (Array.isArray(item?.images) ? item.images : [])
    .map((i) => ({ url: String(i?.url || '').trim(), label: String(i?.label || '').trim() }))
    .filter((i) => i.url);
  if (list.length > 0) return list;
  return item?.image_url ? [{ url: item.image_url, label: '' }] : [];
};

// The size list as the store reads it: [{ size, stock }], blanks dropped.
const apparelSizes = (item) => (Array.isArray(item?.sizes) ? item.sizes : [])
  .map((s) => ({ size: String(s?.size ?? '').trim(), stock: Math.max(0, Math.trunc(Number(s?.stock) || 0)) }))
  .filter((s) => s.size);

// An item with no named sizes is ordered as "One size" - an ID card, a pin.
const apparelIsOneSize = (item) => apparelSizes(item).length === 0;

const apparelStockFor = (item, size) => {
  if (apparelIsOneSize(item)) return Math.max(0, Math.trunc(Number(item?.one_size_stock) || 0));
  const row = apparelSizes(item).find((s) => s.size.toLowerCase() === String(size || '').trim().toLowerCase());
  return row ? row.stock : 0;
};

// The circle logo's fallback: initials of the channel name ("BDO" -> "BDO",
// "Bank of the Phil. Islands" -> "BP"). Same rule as the main dashboard's.
const getPaymentInitials = (name) => {
  const trimmed = (name || '').trim();
  if (!trimmed) return '$';
  if (trimmed.length <= 3 && !trimmed.includes(' ')) return trimmed.toUpperCase();
  const words = trimmed.split(/\s+/).filter((w) => !['of', 'the', 'and'].includes(w.toLowerCase()));
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
};

const apparelIdList = (raw) => {
  let list = raw;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  return Array.isArray(list) ? [...new Set(list.filter(Boolean).map(String))] : [];
};

const apparelTotalStock = (item) => (apparelIsOneSize(item)
  ? Math.max(0, Math.trunc(Number(item?.one_size_stock) || 0))
  : apparelSizes(item).reduce((sum, s) => sum + s.stock, 0));

// The same pager the main dashboard's tables use.
function TablePager({ page, pageSize, total, onPage, onSize, label = 'rows' }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);
  const start = Math.max(1, Math.min(current - 2, pages - 4));
  const shown = [];
  for (let i = start; i < start + 5 && i <= pages; i += 1) shown.push(i);

  return (
    <div className="evt-pager">
      <label className="evt-pager-size">
        Show
        <select value={pageSize} onChange={(e) => { onSize(Number(e.target.value)); onPage(1); }}>
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {label}
      </label>
      <span className="evt-pager-count">{from}–{to} of {total}</span>
      <div className="evt-pager-nav">
        <button type="button" disabled={current <= 1} onClick={() => onPage(1)} title="First page"><i className="fas fa-angles-left"></i></button>
        <button type="button" disabled={current <= 1} onClick={() => onPage(current - 1)} title="Previous page"><i className="fas fa-angle-left"></i></button>
        {shown.map((n) => (
          <button type="button" key={n} className={n === current ? 'on' : ''} onClick={() => onPage(n)}>{n}</button>
        ))}
        <button type="button" disabled={current >= pages} onClick={() => onPage(current + 1)} title="Next page"><i className="fas fa-angle-right"></i></button>
        <button type="button" disabled={current >= pages} onClick={() => onPage(pages)} title="Last page"><i className="fas fa-angles-right"></i></button>
      </div>
    </div>
  );
}

const EMPTY_ADD_FORM = {
  attendeeFirstName: '', attendeeLastName: '', attendeeEmail: '', attendeeMobile: '',
  churchName: '', churchPastor: '',
  paymentPlan: 'full', initialPayment: '',
  paymentMethod: '', paymentReference: '', markVerified: true,
};

export default function CommitteeDashboardPage() {
  const router = useRouter();

  // `undefined` = still reading storage, `null` = signed out. The two are kept
  // apart so the gate does not flash before we know either way.
  const [me, setMe] = useState(undefined);
  const isManager = !!me?.isEventManager;

  // True when this browser also holds a main-site session for the SAME
  // account - which is the case whenever somebody crossed over from the
  // member dashboard. Then the switch back is instant. Somebody who signed in
  // at the committee portal directly has no main session to return to, so the
  // button is not offered rather than sending them to a login screen.
  const [hasMainSession, setHasMainSession] = useState(false);

  // ---- Shell ----
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [activeSection, setActiveSection] = useState('home');
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // The main dashboard's generic confirm modal, same shape.
  const [confirmModal, setConfirmModal] = useState({ open: false, onConfirm: null });

  const showToast = useCallback((message, type = 'info') => {
    setToastMessage({ message, type });
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  const askConfirm = (message, onConfirm, opts = {}) => setConfirmModal({
    open: true,
    title: opts.title || 'Confirm Action',
    subtitle: opts.subtitle || 'Event Committee',
    message,
    confirmLabel: opts.confirmLabel || 'Confirm',
    icon: opts.icon || 'fa-circle-question',
    onConfirm,
  });
  const closeConfirm = () => setConfirmModal((c) => ({ ...c, open: false, onConfirm: null }));

  // ---- Events ----
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsView, setEventsView] = useState('list');
  const [eventSearch, setEventSearch] = useState('');
  const [eventStatusFilter, setEventStatusFilter] = useState('all');

  // The event being worked. Named after the main dashboard's own state so the
  // two files read alike.
  const [eventRegsModal, setEventRegsModal] = useState(null);
  const [eventRegs, setEventRegs] = useState([]);
  const [eventRegsLoading, setEventRegsLoading] = useState(false);
  const [manageTab, setManageTab] = useState('registrations');

  // ---- Registrations view ----
  const [regSearch, setRegSearch] = useState('');
  const [regSort, setRegSort] = useState('newest');
  const [regChurchFilter, setRegChurchFilter] = useState('all');
  const [regTypeFilter, setRegTypeFilter] = useState('all');
  const [regMoneyFilter, setRegMoneyFilter] = useState('all');
  const [regPage, setRegPage] = useState(1);
  const [regPageSize, setRegPageSize] = useState(10);
  const [openRowMenu, setOpenRowMenu] = useState(null);
  const [busyRow, setBusyRow] = useState('');


  // ---- Installments ----
  const [installments, setInstallments] = useState([]);
  const [installmentsLoading, setInstallmentsLoading] = useState(false);
  const [installmentsError, setInstallmentsError] = useState('');
  const [instSearch, setInstSearch] = useState('');
  const [instStatusFilter, setInstStatusFilter] = useState('all');
  const [instChurchFilter, setInstChurchFilter] = useState('all');
  const [instPage, setInstPage] = useState(1);
  const [instPageSize, setInstPageSize] = useState(10);
  const [payModal, setPayModal] = useState(null);
  const [payForm, setPayForm] = useState({ amount: '', paidOn: '', method: '', reference: '', note: '' });
  const [paySaving, setPaySaving] = useState(false);

  // ---- Proof ----
  const [proofModal, setProofModal] = useState(null);

  // ---- Walk-in ----
  const [showAddReg, setShowAddReg] = useState(false);
  const [addStep, setAddStep] = useState(0);
  const [addForm, setAddForm] = useState({ ...EMPTY_ADD_FORM });
  const [addAddons, setAddAddons] = useState([]);
  const [addErrors, setAddErrors] = useState({});
  const [addSaving, setAddSaving] = useState(false);
  const [churchOpen, setChurchOpen] = useState(false);
  const [churchOptions, setChurchOptions] = useState([]);
  const [dupName, setDupName] = useState(null);

  // ---- Committee apparel ----
  const [apparelTab, setApparelTab] = useState('store');
  const [items, setItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [apparelError, setApparelError] = useState('');
  const [apparelCat, setApparelCat] = useState('all');
  const [apparelSearch, setApparelSearch] = useState('');
  // The built-in categories plus whatever an Admin has invented, as the server
  // reports them.
  const [categories, setCategories] = useState(APPAREL_CATEGORIES);
  // Which size is picked on each card, before it goes in the basket.
  const [sizePick, setSizePick] = useState({});
  // Which photo of each garment is showing - front, back, whichever.
  const [imgPick, setImgPick] = useState({});
  // A picture opened full-size: { pics, index, title }. Null when closed.
  const [lightbox, setLightbox] = useState(null);
  const [cart, setCart] = useState([]);
  // On a phone the basket is a sheet you pull up, not a column beside the
  // grid - there is no room beside the grid.
  const [cartOpen, setCartOpen] = useState(false);
  const [checkout, setCheckout] = useState(null);
  const [placing, setPlacing] = useState(false);

  const [myOrders, setMyOrders] = useState([]);
  const [allOrders, setAllOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderStatus, setOrderStatus] = useState('all');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderPage, setOrderPage] = useState(1);
  const [orderPageSize, setOrderPageSize] = useState(10);
  const [orderOpen, setOrderOpen] = useState(null);
  const [orderBusy, setOrderBusy] = useState('');

  const [itemForm, setItemForm] = useState(null);
  const [itemSaving, setItemSaving] = useState(false);

  // Every channel a payer may be sent to, as the catalogue reports them. What
  // an individual garment accepts is a subset of these, stored on the item.
  const [payChannels, setPayChannels] = useState([]);
  // Which channel the payer picked at checkout, and whether the list is open.
  const [payPick, setPayPick] = useState(null);
  const [payPickerOpen, setPayPickerOpen] = useState(false);
  const [proofFile, setProofFile] = useState(null);
  const [orderProof, setOrderProof] = useState(null);
  const [qrLightbox, setQrLightbox] = useState(null);

  // ---- Mode of Payment (Admins only) ----
  // The same channels the main dashboard manages, managed from here too, so an
  // Admin working the committee store does not have to cross over to add the
  // GCash account the store is about to ask people to pay into.
  const [pmList, setPmList] = useState([]);
  const [pmLoading, setPmLoading] = useState(false);
  const [pmFilter, setPmFilter] = useState('all');
  const [pmForm, setPmForm] = useState(null);
  const [pmEditingId, setPmEditingId] = useState(null);
  const [pmSaving, setPmSaving] = useState(false);
  const [pmUsageOpen, setPmUsageOpen] = useState(null);
  const [pmLogoBusy, setPmLogoBusy] = useState(false);
  const [pmQrBusy, setPmQrBusy] = useState(false);

  // ---- Team (Admins only) ----
  const [team, setTeam] = useState({ members: [], waiting: [], matches: [], matchesTotal: 0, searching: false, roles: [] });
  const [teamQuery, setTeamQuery] = useState('');
  const [teamRole, setTeamRole] = useState('all');
  const [teamPage, setTeamPage] = useState(1);
  const [teamPageSize, setTeamPageSize] = useState(25);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamPoolLoading, setTeamPoolLoading] = useState(false);
  const [teamError, setTeamError] = useState('');
  const [scopeFor, setScopeFor] = useState(null);
  const [scopePick, setScopePick] = useState([]);
  // { [eventId]: ['Registration', 'Cashier'] } - what they do on each event
  // they are assigned to. A person can hold several roles on one event.
  const [rolePick, setRolePick] = useState({});
  const [newRole, setNewRole] = useState({});
  const [scopeSaving, setScopeSaving] = useState(false);

  // Every member's roles, in one read, so the table can show them without a
  // request per row.
  const [assignments, setAssignments] = useState([]);
  const [committeeRoles, setCommitteeRoles] = useState(DEFAULT_COMMITTEE_ROLES);

  // Tasks: what an Admin has asked somebody to do.
  const [tasks, setTasks] = useState([]);
  const [taskFor, setTaskFor] = useState(null);
  const [taskForm, setTaskForm] = useState(null);
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskBusy, setTaskBusy] = useState('');
  // The account picker. Everybody who is not on the committee lives in here
  // rather than under the members table, so the page answers "who IS on the
  // committee" and adding somebody is a deliberate act.
  const [inviteOpen, setInviteOpen] = useState(false);

  // ---- Committee contributions (Admins only) ----
  // Which half of the Team screen is showing. The members table and the
  // contributions are both "the committee", asked two different ways: who is
  // on it, and what they have put in.
  const [teamTab, setTeamTab] = useState('members');
  const [contribs, setContribs] = useState([]);
  const [contribsLoading, setContribsLoading] = useState(false);
  const [contribsError, setContribsError] = useState('');
  // The drive being looked at, by id. Held as an id rather than as the object
  // so a reload of the list refreshes what is on screen instead of leaving a
  // stale copy of it open.
  const [openContrib, setOpenContrib] = useState(null);
  const [contribSearch, setContribSearch] = useState('');
  // The "what is this collection" form - new drive when editingId is null.
  const [contribForm, setContribForm] = useState(null);
  const [contribSaving, setContribSaving] = useState(false);
  // Add Payment. One form for both jobs: opening somebody's share of a drive,
  // and adding an instalment to a share that already exists (payer set).
  const [payerForm, setPayerForm] = useState(null);
  const [payerSaving, setPayerSaving] = useState(false);
  const [payerPickOpen, setPayerPickOpen] = useState(false);
  // Whose instalment history is unfolded, by share id.
  const [openPayer, setOpenPayer] = useState(null);
  // The slip on screen: one payment, with the arithmetic as it stood WHEN that
  // payment was taken rather than as it stands now.
  const [receipt, setReceipt] = useState(null);

  /* ---------------- Session + theme ---------------- */
  useEffect(() => {
    let saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem('committeeUser') || localStorage.getItem('committeeUser') || 'null');
    } catch { saved = null; }

    if (!saved || !saved.id) {
      setMe(null);
      router.replace('/event-committee/login');
      return;
    }
    setMe(saved);

    try {
      const main = JSON.parse(sessionStorage.getItem('userData') || localStorage.getItem('userData') || 'null');
      setHasMainSession(!!main?.id && String(main.id) === String(saved.id));
    } catch { setHasMainSession(false); }

    const dark = localStorage.getItem('darkModeEnabled') === 'true';
    setDarkMode(dark);
    document.body.classList.toggle('dark-mode', dark);
    document.documentElement.classList.toggle('dark-mode', dark);
  }, [router]);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('darkModeEnabled', next);
    document.body.classList.toggle('dark-mode', next);
    document.documentElement.classList.toggle('dark-mode', next);
  };

  const confirmLogout = () => {
    sessionStorage.removeItem('committeeUser');
    localStorage.removeItem('committeeUser');
    router.replace('/event-committee/login');
  };

  const showSection = (section) => {
    setActiveSection(section);
    setSidebarOpen(false);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // One row menu at a time, closed by a click anywhere else.
  useEffect(() => {
    if (!openRowMenu) return undefined;
    const close = () => setOpenRowMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openRowMenu]);

  /* ---------------- Events ---------------- */
  const loadEvents = useCallback(async () => {
    if (!me) return;
    setEventsLoading(true);
    try {
      const res = await fetch('/api/events?limit=200');
      const data = await res.json();
      const all = data.success ? (data.data || []) : [];

      // A committee member scoped to particular events sees only those. An
      // empty list means every event - the same rule the server enforces.
      const scope = Array.isArray(me.committeeEvents) ? me.committeeEvents.map(String) : [];
      const mine = isManager || scope.length === 0 ? all : all.filter((e) => scope.includes(String(e.id)));

      // Soonest first, and anything already finished falls to the bottom - the
      // event being worked today is the one that should be at the top.
      const now = Date.now();
      const ended = (e) => (evtMs(e.end_date || e.event_date) || 0) < now;
      mine.sort((a, b) => (ended(a) - ended(b)) || ((evtMs(a.event_date) || 0) - (evtMs(b.event_date) || 0)));

      setEvents(mine);
    } catch (error) {
      showToast('Could not load events: ' + error.message, 'danger');
    } finally {
      setEventsLoading(false);
    }
  }, [me, isManager, showToast]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const loadInstallments = useCallback(async (eventId) => {
    if (!eventId || !me?.id) return;
    setInstallmentsLoading(true);
    try {
      const res = await fetch(`/api/events/installments?eventId=${eventId}&actorId=${me.id}`);
      const data = await res.json();
      setInstallments(data.success ? data.data || [] : []);
      // A missing column here means the flexible-payment migration has not
      // been run - worth saying so rather than showing a permanently empty tab.
      setInstallmentsError(data.success ? '' : (data.message || 'Could not load the installment plans.'));
    } catch (e) {
      setInstallments([]);
      setInstallmentsError(e.message);
    } finally {
      setInstallmentsLoading(false);
    }
  }, [me]);

  // Just the registration rows again, for when something on this page has
  // changed what they say. Recording a payment rewrites `amount_paid` and the
  // status, so the table and the hero totals are stale the moment it happens.
  const refreshEventRegs = useCallback(async (eventId) => {
    const id = eventId || eventRegsModal?.id;
    if (!id) return;
    try {
      const res = await fetch(`/api/events/registrations?eventId=${id}`);
      const data = await res.json();
      if (data.success) setEventRegs(data.data || []);
    } catch { /* the rows on screen stay as they were */ }
  }, [eventRegsModal]);

  const openEventManage = async (evt, tab = 'registrations') => {
    setEventRegsModal(evt);
    setManageTab(tab);
    setEventRegs([]);
    setEventRegsLoading(true);
    setRegPage(1); setAttPage(1); setInstPage(1);
    setRegSearch(''); setRegMoneyFilter('all'); setRegChurchFilter('all'); setRegTypeFilter('all');
    setActiveSection('events');
    try {
      const res = await fetch(`/api/events/registrations?eventId=${evt.id}`);
      const data = await res.json();
      setEventRegs(data.success ? data.data || [] : []);
      if (!data.success) showToast(data.message || 'Could not load registrations', 'danger');
    } catch (error) {
      showToast('Could not load registrations: ' + error.message, 'danger');
    } finally {
      setEventRegsLoading(false);
    }
    loadInstallments(evt.id);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeEventManage = () => {
    setEventRegsModal(null);
    setEventRegs([]);
    setInstallments([]);
    setManageTab('registrations');
  };

  /* ---------------- Money ---------------- */
  // An installment is settled one payment at a time, and each of those has its
  // own method - somebody can pay part in cash and part through GCash. So a
  // plan is split by what was actually recorded against it.
  const planSplit = useMemo(() => {
    const map = new Map();
    installments.forEach((r) => {
      let cash = 0, online = 0;
      (r.payments || []).forEach((pmt) => {
        const amt = Number(pmt.amount) || 0;
        if (isCashMethod(pmt.method)) cash += amt; else online += amt;
      });
      map.set(r.id, { cash, online });
    });
    return map;
  }, [installments]);

  // What this event has actually taken in, and what is still owed. Money only
  // counts as collected once it is verified (or actually handed over, for a
  // plan) - a "payment submitted" nobody has checked is not cash in hand.
  const eventMoney = useMemo(() => {
    const live = eventRegs.filter((r) => r.status !== 'cancelled');
    let cash = 0, online = 0, pending = 0, planDue = 0, expected = 0;
    live.forEach((r) => {
      const owed = Number(r.amount) || 0;
      expected += owed;
      const cashRow = isCashMethod(r.payment_method);
      if (r.payment_plan === 'flexible') {
        const paid = Number(r.amount_paid) || 0;
        const split = planSplit.get(r.id);
        if (split && (split.cash + split.online) > 0) {
          cash += split.cash;
          online += split.online;
        } else if (cashRow) cash += paid; else online += paid;
        planDue += Math.max(0, owed - paid);
        return;
      }
      if (r.status === 'payment_verified' || r.status === 'registered') {
        if (cashRow) cash += owed; else online += owed;
      } else pending += owed;
    });
    return { cash, online, total: cash + online, pending, planDue, expected };
  }, [eventRegs, planSplit]);

  const stats = useMemo(() => {
    const live = eventRegs.filter((r) => r.status !== 'cancelled');
    return {
      holding: live.filter((r) => SLOT_HOLDING.includes(r.status)).length,
      attended: live.filter((r) => r.attended).length,
      toVerify: live.filter((r) => r.status === 'payment_submitted').length,
      unpaid: live.filter((r) => r.status === 'pending_payment').length,
      plans: live.filter((r) => r.payment_plan === 'flexible').length,
    };
  }, [eventRegs]);

  /* ---------------- Events list view ---------------- */
  const visibleEvents = useMemo(() => {
    const q = eventSearch.trim().toLowerCase();
    return events.filter((evt) => {
      if (eventStatusFilter !== 'all' && eventStatusOf(evt).cls !== eventStatusFilter) return false;
      if (!q) return true;
      return [evt.title, evt.description, evt.location, evt.loc_city]
        .some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [events, eventSearch, eventStatusFilter]);

  /* ---------------- Registrations view ---------------- */
  // Every church represented at this event, with how many people it sent.
  const regChurchOptions = useMemo(() => {
    const counts = new Map();
    eventRegs.forEach((r) => {
      const name = formatChurchName(r.church_name) || 'No church given';
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    return [...counts.entries()].map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [eventRegs]);

  const visibleRegs = useMemo(() => {
    const q = regSearch.trim().toLowerCase();
    const rows = eventRegs.filter((r) => {
      if (regTypeFilter !== 'all' && regTypeOf(r) !== regTypeFilter) return false;
      if (regChurchFilter !== 'all' && (formatChurchName(r.church_name) || 'No church given') !== regChurchFilter) return false;
      if (regMoneyFilter !== 'all') {
        const settledRow = r.status === 'payment_verified' || r.status === 'registered' || r.payment_plan === 'flexible';
        if (regMoneyFilter === 'cash' && !(settledRow && isCashMethod(r.payment_method))) return false;
        if (regMoneyFilter === 'online' && !(settledRow && !isCashMethod(r.payment_method))) return false;
        if (regMoneyFilter === 'pending' && r.status !== 'payment_submitted') return false;
      }
      if (!q) return true;
      return [r.attendee_name, r.attendee_email, r.attendee_mobile, r.church_name, r.church_pastor, r.payment_reference, r.added_by]
        .some((v) => String(v || '').toLowerCase().includes(q));
    });
    rows.sort((a, b) => (regSort === 'oldest'
      ? new Date(a.created_at || 0) - new Date(b.created_at || 0)
      : new Date(b.created_at || 0) - new Date(a.created_at || 0)));
    return rows;
  }, [eventRegs, regSearch, regSort, regChurchFilter, regTypeFilter, regMoneyFilter]);

  const regPageSafe = Math.min(regPage, Math.max(1, Math.ceil(visibleRegs.length / regPageSize)));
  const pagedRegs = visibleRegs.slice((regPageSafe - 1) * regPageSize, regPageSafe * regPageSize);


  const instChurchOptions = useMemo(() => {
    const counts = new Map();
    installments.forEach((r) => {
      const name = formatChurchName(r.church_name) || 'No church given';
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    return [...counts.entries()].map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [installments]);

  const visibleInstallments = useMemo(() => {
    const q = instSearch.trim().toLowerCase();
    return installments.filter((r) => {
      if (instChurchFilter !== 'all' && (formatChurchName(r.church_name) || 'No church given') !== instChurchFilter) return false;
      if (instStatusFilter === 'settled' && (Number(r.balance) || 0) > 0) return false;
      if (instStatusFilter === 'progress' && (Number(r.balance) || 0) <= 0) return false;
      if (instStatusFilter === 'nothing' && (Number(r.paid) || 0) > 0) return false;
      if (!q) return true;
      return [r.attendee_name, r.church_name, r.attendee_mobile, r.payment_reference]
        .some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [installments, instSearch, instChurchFilter, instStatusFilter]);

  const instPageSafe = Math.min(instPage, Math.max(1, Math.ceil(visibleInstallments.length / instPageSize)));
  const pagedInstallments = visibleInstallments.slice((instPageSafe - 1) * instPageSize, instPageSafe * instPageSize);

  // The tab only exists once somebody is actually on a plan, or the event
  // charges - so a plan can be found even before anybody is on one.
  const hasFlexiblePlans = installments.length > 0
    || eventRegs.some((r) => r.payment_plan === 'flexible' && r.status !== 'cancelled');

  /* ---------------- Row actions ---------------- */

  const verifyRegistration = async (regId, status) => {
    setBusyRow(regId);
    try {
      const res = await fetch('/api/events/registrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: regId, actorId: me.id, status }),
      });
      const data = await res.json();
      if (!data.success) { showToast(data.message || 'Could not update', 'danger'); return; }
      setEventRegs((prev) => prev.map((r) => (r.id === regId ? { ...r, ...(data.data || { status }) } : r)));
      showToast(status === 'payment_verified' ? 'Payment verified' : `Marked as ${statusLabel(status)}`, 'success');
      if (proofModal?.id === regId) setProofModal(null);
    } catch (error) {
      showToast('Error: ' + error.message, 'danger');
    } finally {
      setBusyRow('');
    }
  };

  const markAttendance = useCallback(async (regId, attended = true, opts = {}) => {
    try {
      const res = await fetch('/api/events/registrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: regId, actorId: me?.id, attended }),
      });
      const data = await res.json();
      if (data.success) {
        setEventRegs((prev) => prev.map((r) => (r.id === regId
          ? { ...r, attended, attended_at: attended ? (data.data?.attended_at || new Date().toISOString()) : null }
          : r)));
        if (!opts.silent) showToast(attended ? 'Marked as attended' : 'Marked as not attended', 'success');
        return { ok: true };
      }
      if (!opts.silent) showToast(data.message, 'danger');
      return { ok: false, message: data.message };
    } catch (e) {
      if (!opts.silent) showToast('Error: ' + e.message, 'danger');
      return { ok: false, message: e.message };
    }
  }, [me, showToast]);


  /* ---------------- Installments ---------------- */
  const openPayModal = (plan) => {
    setPayForm({ amount: '', paidOn: new Date().toISOString().slice(0, 10), method: '', reference: '', note: '' });
    setPayModal(plan);
  };

  const submitInstallment = async () => {
    const amount = Number(payForm.amount) || 0;
    if (amount <= 0) { showToast('Enter the amount received', 'danger'); return; }
    if (amount > payModal.balance) { showToast(`That is more than the ${peso(payModal.balance)} balance`, 'danger'); return; }
    setPaySaving(true);
    try {
      const res = await fetch('/api/events/installments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: me?.id, registrationId: payModal.id, ...payForm, amount }),
      });
      const data = await res.json();
      if (!data.success) { showToast(data.message, 'danger'); return; }
      showToast(data.message || 'Payment recorded', 'success');
      setPayModal(null);
      // Both views read from the same registration, so both are refreshed.
      await Promise.all([loadInstallments(eventRegsModal?.id), refreshEventRegs()]);
    } catch (e) {
      showToast('Error: ' + e.message, 'danger');
    } finally {
      setPaySaving(false);
    }
  };

  // Removing a payment is an Admin correction, not door work - the server says
  // so too, so the button is only offered to a manager.
  const deleteInstallment = (payment) => askConfirm(
    `Remove the ${peso(payment.amount)} payment recorded on ${new Date(payment.paid_on).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}? The balance goes back up by that amount.`,
    async () => {
      try {
        const res = await fetch(`/api/events/installments?id=${payment.id}&actorId=${me?.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) { showToast(data.message, 'danger'); return; }
        showToast('Payment removed', 'success');
        await Promise.all([loadInstallments(eventRegsModal?.id), refreshEventRegs()]);
      } catch (e) { showToast('Error: ' + e.message, 'danger'); }
    },
    { title: 'Remove Payment?', confirmLabel: 'Remove Payment', icon: 'fa-trash' },
  );

  /* ---------------- Add an attendee ---------------- */
  const openAddReg = () => {
    if (!eventRegsModal) { showToast('Open an event first', 'warning'); return; }
    setAddForm({
      ...EMPTY_ADD_FORM,
      // Cash in hand is the usual case at the door, so it starts there.
      paymentMethod: '',
      paymentPlan: 'full',
    });
    // Required extras are charged to everyone, so they start ticked.
    setAddAddons((eventRegsModal.event_addons || []).filter((a) => a.is_required).map((a) => a.id));
    setAddErrors({});
    setAddStep(0);
    setDupName(null);
    setChurchOpen(false);
    setShowAddReg(true);
  };

  // Churches people already registered under, so the same one is always spelled
  // the same way. Mirrors the public form.
  useEffect(() => {
    if (!showAddReg || !churchOpen || !eventRegsModal) return undefined;
    const q = (addForm.churchName || '').trim();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/events/registrations?churches=1&eventId=${eventRegsModal.id}&q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setChurchOptions(data.success ? data.data || [] : []);
      } catch { setChurchOptions([]); }
    }, 220);
    return () => clearTimeout(timer);
  }, [showAddReg, churchOpen, addForm.churchName]);

  // The same name check the public form runs: nobody may hold two slots for
  // the same event.
  useEffect(() => {
    if (!showAddReg || !eventRegsModal) { setDupName(null); return undefined; }
    const full = `${addForm.attendeeFirstName || ''} ${addForm.attendeeLastName || ''}`.trim();
    if (!full.includes(' ')) { setDupName(null); return undefined; }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/events/registrations?eventId=${eventRegsModal.id}&duplicates=${encodeURIComponent(full)}`);
        const data = await res.json();
        setDupName(data.success && (data.details || []).length > 0 ? data.details[0] : null);
      } catch { setDupName(null); }
    }, 350);
    return () => clearTimeout(timer);
  }, [showAddReg, eventRegsModal, addForm.attendeeFirstName, addForm.attendeeLastName]);

  // Cash is always collectable at the desk, whatever the event's online options.
  const paymentMethodsFor = (evt) => {
    const listed = (evt?.payment_methods || []).filter(Boolean);
    return listed.some((m) => /^cash$/i.test(m)) ? listed : ['Cash', ...listed];
  };

  const baseAmountOf = (evt) => {
    if (!evt || !evt.has_fee) return 0;
    const early = evt.early_bird_price != null && evt.early_bird_deadline && new Date() <= new Date(evt.early_bird_deadline);
    return Number(early ? evt.early_bird_price : evt.registration_fee) || 0;
  };

  const totalAmountOf = (evt) => baseAmountOf(evt)
    + (evt?.event_addons || []).filter((a) => addAddons.includes(a.id))
      .reduce((sum, a) => sum + (Number(a.fee) || 0), 0);

  const toggleAddon = (addon) => {
    if (addon.is_required) return;
    setAddAddons((ids) => (ids.includes(addon.id) ? ids.filter((v) => v !== addon.id) : [...ids, addon.id]));
  };

  const addStepOneErrors = () => {
    const errs = {};
    if (!addForm.attendeeFirstName?.trim()) errs.firstName = 'First name is required.';
    if (!addForm.attendeeLastName?.trim()) errs.lastName = 'Last name is required.';
    if (!addForm.churchName?.trim()) errs.churchName = 'Church name is required.';
    if (!addForm.churchPastor?.trim()) errs.churchPastor = 'Church pastor is required.';
    if (!isValidPhMobile(addForm.attendeeMobile)) errs.mobile = 'Contact number must be 11 digits starting with 09.';
    if (dupName) errs.firstName = 'This person is already registered for this event.';
    return errs;
  };

  const addRegNext = () => {
    const errs = addStepOneErrors();
    setAddErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setAddStep(1);
  };

  const submitAddReg = async () => {
    if (!eventRegsModal) return;
    const errs = addStepOneErrors();
    if (Object.keys(errs).length > 0) { setAddErrors(errs); setAddStep(0); return; }

    const owed = totalAmountOf(eventRegsModal);
    if (owed > 0 && addForm.paymentPlan === 'full' && !addForm.paymentMethod) {
      showToast('Choose how the payment was made', 'danger');
      return;
    }
    const firstPay = Number(addForm.initialPayment) || 0;
    if (addForm.paymentPlan === 'flexible' && firstPay > owed) {
      showToast(`The first payment cannot be more than the ${peso(owed)} total`, 'danger');
      return;
    }

    setAddSaving(true);
    try {
      const res = await fetch('/api/events/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: eventRegsModal.id,
          actorId: me.id,
          addedByAdmin: true,
          attendeeFirstName: addForm.attendeeFirstName.trim(),
          attendeeLastName: addForm.attendeeLastName.trim(),
          attendeeEmail: addForm.attendeeEmail.trim() || null,
          attendeeMobile: addForm.attendeeMobile.trim() || null,
          churchName: addForm.churchName.trim() || null,
          churchPastor: addForm.churchPastor.trim() ? `Ptr. ${addForm.churchPastor.trim()}` : '',
          addonIds: addAddons,
          paymentPlan: owed > 0 ? addForm.paymentPlan : 'full',
          initialPayment: addForm.paymentPlan === 'flexible' ? firstPay : 0,
          paymentMethod: addForm.paymentMethod || null,
          paymentReference: addForm.paymentReference.trim() || null,
          // Unticking "verified" is how staff say the seat is taken but the
          // money has not arrived yet.
          markVerified: addForm.markVerified !== false,
        }),
      });
      const data = await res.json();
      if (!data.success) { showToast(data.message || 'Could not add the attendee', 'danger'); return; }
      if (data.warning) showToast(data.warning, 'warning');
      setShowAddReg(false);
      await Promise.all([refreshEventRegs(eventRegsModal.id), loadInstallments(eventRegsModal.id)]);
      showToast(`${formatPersonName(`${addForm.attendeeFirstName} ${addForm.attendeeLastName}`)} added`, 'success');
    } catch (error) {
      showToast('Error: ' + error.message, 'danger');
    } finally {
      setAddSaving(false);
    }
  };

  /* ---------------- Committee apparel ---------------- */
  // The catalogue. The store sees what is on sale; the Catalogue tab asks for
  // everything, retired items included, because that is where they come back.
  const loadItems = useCallback(async (includeRetired = false) => {
    if (!me) return;
    setItemsLoading(true);
    setApparelError('');
    try {
      const res = await fetch(`/api/apparel/items?actorId=${encodeURIComponent(me.id)}${includeRetired ? '&all=1' : ''}`);
      const data = await res.json();
      if (!data.success) { setApparelError(data.message || 'Could not load the apparel catalogue'); setItems([]); return; }
      setItems(data.data || []);
      if (Array.isArray(data.categories) && data.categories.length > 0) setCategories(data.categories);
      if (Array.isArray(data.channels)) setPayChannels(data.channels);
    } catch (error) {
      setApparelError(error.message);
    } finally {
      setItemsLoading(false);
    }
  }, [me]);

  const loadMyOrders = useCallback(async () => {
    if (!me) return;
    setOrdersLoading(true);
    try {
      const res = await fetch(`/api/apparel/orders?actorId=${encodeURIComponent(me.id)}&mine=1`);
      const data = await res.json();
      setMyOrders(data.success ? data.data || [] : []);
      if (!data.success) setApparelError(data.message || 'Could not load your orders');
    } catch (error) {
      setApparelError(error.message);
    } finally {
      setOrdersLoading(false);
    }
  }, [me]);

  const loadAllOrders = useCallback(async () => {
    if (!me || !isManager) return;
    setOrdersLoading(true);
    try {
      const res = await fetch(`/api/apparel/orders?actorId=${encodeURIComponent(me.id)}&all=1`);
      const data = await res.json();
      setAllOrders(data.success ? data.data || [] : []);
      if (!data.success) setApparelError(data.message || 'Could not load the orders');
    } catch (error) {
      setApparelError(error.message);
    } finally {
      setOrdersLoading(false);
    }
  }, [me, isManager]);

  // Each tab loads what it shows, and nothing else.
  useEffect(() => {
    if (activeSection !== 'apparel') return;
    if (apparelTab === 'store') loadItems(false);
    if (apparelTab === 'mine') loadMyOrders();
    if (apparelTab === 'orders') loadAllOrders();
    if (apparelTab === 'catalog') loadItems(true);
  }, [activeSection, apparelTab, loadItems, loadMyOrders, loadAllOrders]);

  // Admins should see a new order without opening the tab to look for one.
  useEffect(() => {
    if (!me || !isManager) return;
    loadAllOrders();
  }, [me, isManager, loadAllOrders]);

  const pendingOrderCount = useMemo(
    () => allOrders.filter((o) => o.status === 'pending').length,
    [allOrders],
  );

  const visibleItems = useMemo(() => {
    const q = apparelSearch.trim().toLowerCase();
    return items.filter((it) => {
      if (apparelCat !== 'all' && it.category !== apparelCat) return false;
      if (!q) return true;
      return [it.name, it.category, it.description].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [items, apparelCat, apparelSearch]);

  // How many of each category there are, so the chips can say so.
  const itemCounts = useMemo(() => {
    const counts = new Map();
    items.forEach((it) => counts.set(it.category, (counts.get(it.category) || 0) + 1));
    return counts;
  }, [items]);

  /* ---- The basket ---- */
  const cartTotal = useMemo(
    () => cart.reduce((sum, l) => sum + (Number(l.unitPrice) || 0) * l.quantity, 0),
    [cart],
  );
  const cartCount = useMemo(() => cart.reduce((sum, l) => sum + l.quantity, 0), [cart]);

  /* ---- Looking at a picture properly ----
     A card crops nothing, but it is still 230px wide. Anything worth printing
     on a shirt deserves a look at full size, so every picture on the store and
     in the catalogue form opens into an overlay that shows the whole of it. */
  const openLightbox = (pics, index, title) => {
    const list = (pics || []).filter((p) => p?.url);
    if (list.length === 0) return;
    setLightbox({ pics: list, index: Math.min(Math.max(0, index || 0), list.length - 1), title: title || '' });
  };
  const stepLightbox = (delta) => setLightbox((lb) => (lb
    ? { ...lb, index: (lb.index + delta + lb.pics.length) % lb.pics.length }
    : lb));

  // Escape closes it, the arrows walk it - the keys anyone would try.
  useEffect(() => {
    if (!lightbox) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setLightbox(null);
      else if (e.key === 'ArrowRight') stepLightbox(1);
      else if (e.key === 'ArrowLeft') stepLightbox(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const addToCart = (item) => {
    const oneSize = apparelIsOneSize(item);
    const size = oneSize ? null : (sizePick[item.id] || '');
    if (!oneSize && !size) { showToast('Pick a size first', 'warning'); return false; }

    const available = apparelStockFor(item, size);
    if (available <= 0) { showToast('That size is out of stock', 'warning'); return false; }

    const key = `${item.id}::${size || ''}`;
    const already = cart.find((l) => l.key === key);
    // The basket cannot hold more than the stock behind it - the server checks
    // this too, but being told at the door beats being told at checkout.
    if (already && already.quantity >= available) {
      showToast(`Only ${available} left of ${item.name}${size ? ` (${size})` : ''}`, 'warning');
      return false;
    }

    setCart((prev) => (already
      ? prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l))
      : [...prev, {
        key,
        itemId: item.id,
        name: item.name,
        category: item.category,
        // The first picture, not the legacy single column - an item added
        // through the picture list has no image_url at all, and a basket line
        // with no thumbnail is harder to check over than one with.
        imageUrl: apparelImages(item)[0]?.url || item.image_url || '',
        size: size || null,
        unitPrice: Number(item.price) || 0,
        quantity: 1,
        available,
      }]));
    showToast(`${item.name}${size ? ` (${size})` : ''} added`, 'success');
    return true;
  };

  const setCartQty = (key, quantity) => setCart((prev) => prev
    .map((l) => (l.key === key ? { ...l, quantity: Math.max(1, Math.min(quantity, l.available)) } : l)));

  const dropCartLine = (key) => setCart((prev) => prev.filter((l) => l.key !== key));

  const openCheckout = () => {
    setPayPick(null);
    setPayPickerOpen(false);
    setProofFile(null);
    setCheckout({ contact: '', note: '', reference: '' });
  };

  // What THIS basket can be paid with: only what EVERY item in it accepts.
  // Two garments with nothing in common cannot go on one payment, and saying
  // so beats taking money through a channel one of them does not use.
  const basketPayments = useMemo(() => {
    const chosen = [...new Set(cart.map((l) => l.itemId))]
      .map((id) => items.find((i) => i.id === id))
      .filter(Boolean);
    if (chosen.length === 0) return { cash: true, channels: [], cashLabel: DEFAULT_CASH_LABEL };
    const cash = chosen.every((i) => i.allow_cash !== false);
    const shared = chosen
      .map((i) => new Set(apparelIdList(i.payment_method_ids)))
      .reduce((acc, set) => (acc === null ? set : new Set([...acc].filter((id) => set.has(id)))), null);
    const channels = payChannels.filter((m) => shared?.has(String(m.id)));
    return {
      cash,
      channels,
      cashLabel: String(chosen[0].cash_label || '').trim() || DEFAULT_CASH_LABEL,
    };
  }, [cart, items, payChannels]);

  const placeOrder = async (e) => {
    e.preventDefault();
    if (cart.length === 0) { showToast('Your basket is empty', 'warning'); return; }
    // Nothing to pay means nothing to ask about.
    if (cartTotal > 0 && !payPick) { showToast('Choose how you are paying', 'warning'); return; }
    // Paying into an account without showing the receipt leaves an Admin
    // nothing to check, so it is asked for here as well as on the server.
    if (cartTotal > 0 && payPick !== 'cash' && !proofFile) {
      showToast('Upload a screenshot of your payment receipt', 'warning');
      return;
    }
    setPlacing(true);
    try {
      // The receipt has to travel as form-data; the rest goes along with it so
      // there is one request either way.
      const fd = new FormData();
      fd.append('actorId', me.id);
      if (checkout.contact.trim()) fd.append('contact', checkout.contact.trim());
      if (checkout.note.trim()) fd.append('note', checkout.note.trim());
      // The id, not the label - the server decides what this order says it was
      // paid through.
      fd.append('payCash', payPick === 'cash' ? 'true' : 'false');
      if (payPick && payPick !== 'cash') fd.append('paymentChannelId', payPick);
      if (checkout.reference.trim()) fd.append('paymentReference', checkout.reference.trim());
      fd.append('lines', JSON.stringify(cart.map((l) => ({ itemId: l.itemId, size: l.size, quantity: l.quantity }))));
      if (proofFile) fd.append('proof', proofFile);

      const res = await fetch('/api/apparel/orders', { method: 'POST', body: fd });
      const data = await res.json();
      if (!data.success) { showToast(data.message || 'Could not place the order', 'danger'); return; }
      setCart([]);
      setSizePick({});
      setCheckout(null);
      setPayPick(null);
      setProofFile(null);
      showToast(data.message || 'Order placed', 'success');
      // The stock the store shows has just changed, and so has the list of
      // orders behind the other tabs.
      await Promise.all([loadItems(false), loadMyOrders(), isManager ? loadAllOrders() : Promise.resolve()]);
      setApparelTab('mine');
    } catch (error) {
      showToast('Error: ' + error.message, 'danger');
    } finally {
      setPlacing(false);
    }
  };

  /* ---- Orders ---- */
  const patchOrder = async (payload, label) => {
    setOrderBusy(payload.id || payload.lineId || 'x');
    try {
      const res = await fetch('/api/apparel/orders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: me.id, ...payload }),
      });
      const data = await res.json();
      if (!data.success) { showToast(data.message || 'Could not update the order', 'danger'); return false; }
      showToast(label || data.message || 'Order updated', 'success');
      if (data.data) {
        const merge = (list) => list.map((o) => (o.id === data.data.id ? data.data : o));
        setAllOrders(merge);
        setMyOrders(merge);
        setOrderOpen((open) => (open && open.id === data.data.id ? data.data : open));
      }
      // A status change hands stock back or takes it again.
      if (payload.status || payload.lineId) loadItems(apparelTab === 'catalog');
      return true;
    } catch (error) {
      showToast('Error: ' + error.message, 'danger');
      return false;
    } finally {
      setOrderBusy('');
    }
  };

  const deleteOrder = (order) => askConfirm(
    `Delete order ${order.order_no}? Anything it is holding goes back into stock, and the record is gone for good.`,
    async () => {
      try {
        const res = await fetch(`/api/apparel/orders?id=${order.id}&actorId=${me.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) { showToast(data.message || 'Could not delete the order', 'danger'); return; }
        showToast(data.message || 'Order deleted', 'success');
        setOrderOpen(null);
        await Promise.all([loadAllOrders(), loadItems(apparelTab === 'catalog')]);
      } catch (error) { showToast('Error: ' + error.message, 'danger'); }
    },
    { title: 'Delete Order?', subtitle: 'Committee Apparel', confirmLabel: 'Delete Order', icon: 'fa-trash' },
  );

  const visibleOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return allOrders.filter((o) => {
      if (orderStatus !== 'all' && o.status !== orderStatus) return false;
      if (!q) return true;
      return [o.order_no, o.ordered_by_name, o.contact, o.note].some((v) => String(v || '').toLowerCase().includes(q))
        || (o.lines || []).some((l) => String(l.item_name || '').toLowerCase().includes(q));
    });
  }, [allOrders, orderStatus, orderSearch]);

  const orderPageSafe = Math.min(orderPage, Math.max(1, Math.ceil(visibleOrders.length / orderPageSize)));
  const pagedOrders = visibleOrders.slice((orderPageSafe - 1) * orderPageSize, orderPageSafe * orderPageSize);

  const orderMoney = useMemo(() => {
    const live = allOrders.filter((o) => o.status !== 'cancelled');
    return {
      orders: live.length,
      pending: allOrders.filter((o) => o.status === 'pending').length,
      ready: allOrders.filter((o) => o.status === 'ready').length,
      value: live.reduce((sum, o) => sum + (Number(o.total) || 0), 0),
      collected: live.filter((o) => o.is_paid).reduce((sum, o) => sum + (Number(o.total) || 0), 0),
    };
  }, [allOrders]);

  /* ---- Catalogue (Admins only) ---- */
  const blankItemForm = () => ({
    id: null, name: '', category: 'Shirt', newCategory: '', description: '', price: '',
    sizes: [{ size: 'S', stock: 0 }, { size: 'M', stock: 0 }, { size: 'L', stock: 0 }, { size: 'XL', stock: 0 }],
    oneSizeStock: 0, isActive: true,
    // [{ key, url?, file?, preview, label }] - a mix of the pictures the item
    // already has and the ones being added now.
    images: [],
    // Everything on offer to begin with: it is easier to untick the channel
    // you do not want than to remember to tick the four you do.
    allowCash: true,
    cashLabel: DEFAULT_CASH_LABEL,
    paymentMethodIds: payChannels.map((m) => String(m.id)),
  });

  const openItemForm = (item) => {
    setItemForm(item
      ? {
        id: item.id,
        name: item.name || '',
        category: item.category || 'Other',
        newCategory: '',
        description: item.description || '',
        price: String(item.price ?? ''),
        sizes: apparelSizes(item),
        oneSizeStock: Number(item.one_size_stock) || 0,
        isActive: item.is_active !== false,
        images: apparelImages(item).map((img, i) => ({
          key: `have-${i}-${img.url}`, url: img.url, preview: img.url, label: img.label,
        })),
        allowCash: item.allow_cash !== false,
        cashLabel: String(item.cash_label || '').trim() || DEFAULT_CASH_LABEL,
        paymentMethodIds: apparelIdList(item.payment_method_ids),
      }
      : blankItemForm());
  };

  // A preview of a file being added is a blob URL, and every one of those has
  // to be handed back or the tab keeps the file alive for its own lifetime.
  const revokeItemPreviews = (images) => (images || [])
    .filter((img) => img.file && img.preview)
    .forEach((img) => URL.revokeObjectURL(img.preview));

  const closeItemForm = () => {
    revokeItemPreviews(itemForm?.images);
    setItemForm(null);
  };

  const addItemImages = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setItemForm((f) => {
      const room = MAX_APPAREL_IMAGES - f.images.length;
      if (room <= 0) {
        showToast(`Up to ${MAX_APPAREL_IMAGES} pictures per item`, 'warning');
        return f;
      }
      if (files.length > room) showToast(`Only ${room} more picture${room === 1 ? '' : 's'} would fit`, 'warning');
      const added = files.slice(0, room).map((file, i) => ({
        key: `new-${Date.now()}-${i}`,
        file,
        preview: URL.createObjectURL(file),
        // Front, then Back, then Side... which is the order these get shot in.
        label: APPAREL_IMAGE_LABELS[f.images.length + i] || '',
      }));
      return { ...f, images: [...f.images, ...added] };
    });
  };

  const dropItemImage = (key) => setItemForm((f) => {
    const going = f.images.find((img) => img.key === key);
    if (going?.file && going.preview) URL.revokeObjectURL(going.preview);
    return { ...f, images: f.images.filter((img) => img.key !== key) };
  });

  const labelItemImage = (key, label) => setItemForm((f) => ({
    ...f,
    images: f.images.map((img) => (img.key === key ? { ...img, label } : img)),
  }));

  const saveItem = async (e) => {
    e.preventDefault();
    if (!itemForm.name.trim()) { showToast('Give the item a name', 'warning'); return; }
    // A brand new category is only real once it has been typed.
    const category = itemForm.category === '__new'
      ? itemForm.newCategory.trim()
      : itemForm.category;
    if (!category) { showToast('Name the new category, or pick an existing one', 'warning'); return; }
    // A priced item with no way to pay for it cannot be ordered at all, so it
    // is caught here rather than discovered at somebody's checkout.
    if ((Number(itemForm.price) || 0) > 0 && !itemForm.allowCash && itemForm.paymentMethodIds.length === 0) {
      showToast('Choose at least one mode of payment for this item', 'warning');
      return;
    }

    setItemSaving(true);
    try {
      // Pictures have to travel as form-data; everything else is happy either
      // way, so one shape is used for both to keep the route simple.
      const fd = new FormData();
      fd.append('actorId', me.id);
      if (itemForm.id) fd.append('id', itemForm.id);
      fd.append('name', itemForm.name.trim());
      fd.append('category', category);
      fd.append('description', itemForm.description.trim());
      fd.append('price', String(Number(itemForm.price) || 0));
      fd.append('sizes', JSON.stringify(itemForm.sizes.filter((s) => String(s.size || '').trim())));
      fd.append('oneSizeStock', String(Number(itemForm.oneSizeStock) || 0));
      fd.append('isActive', itemForm.isActive ? 'true' : 'false');

      // What this garment may be paid with. Ids only - the accounts behind
      // them live under Mode of Payment.
      fd.append('allowCash', itemForm.allowCash ? 'true' : 'false');
      fd.append('cashLabel', itemForm.cashLabel.trim() || DEFAULT_CASH_LABEL);
      fd.append('paymentMethodIds', JSON.stringify(itemForm.paymentMethodIds));

      // The pictures it keeps (relabelling one of these costs no upload), then
      // the files being added, each with the label beside it.
      fd.append('existingImages', JSON.stringify(itemForm.images
        .filter((img) => img.url)
        .map((img) => ({ url: img.url, label: img.label }))));
      itemForm.images.filter((img) => img.file).forEach((img) => {
        fd.append('newImage', img.file);
        fd.append('newImageLabel', img.label || '');
      });

      const res = await fetch('/api/apparel/items', { method: itemForm.id ? 'PUT' : 'POST', body: fd });
      const data = await res.json();
      if (!data.success) { showToast(data.message || 'Could not save the item', 'danger'); return; }
      showToast(data.message || 'Saved', 'success');
      revokeItemPreviews(itemForm.images);
      setItemForm(null);
      await loadItems(true);
    } catch (error) {
      showToast('Error: ' + error.message, 'danger');
    } finally {
      setItemSaving(false);
    }
  };


  // Taking something out of the store without deleting it - the usual way a
  // garment goes away, since last year's jacket is not this year's.
  const toggleItemVisible = async (item) => {
    const next = item.is_active === false;
    try {
      const fd = new FormData();
      fd.append('actorId', me.id);
      fd.append('id', item.id);
      fd.append('isActive', next ? 'true' : 'false');
      const res = await fetch('/api/apparel/items', { method: 'PUT', body: fd });
      const data = await res.json();
      if (!data.success) { showToast(data.message || 'Could not save', 'danger'); return; }
      showToast(next ? `${item.name} is back on sale` : `${item.name} hidden from the store`, 'success');
      await loadItems(true);
    } catch (error) {
      showToast('Error: ' + error.message, 'danger');
    }
  };

    const copyPayDetail = async (what, value) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      showToast(`${what} copied`, 'success');
    } catch { /* clipboard blocked - the number is still readable */ }
  };

  // Opening an order needs the catalogue behind it, so a size can be changed
  // to one that actually exists.
  const openOrder = (order) => {
    setOrderOpen(order);
    if (isManager && items.length === 0) loadItems(true);
  };

  const deleteItem = (item) => askConfirm(
    `Delete "${item.name}" from the catalogue? If anybody has ordered it before, it is hidden from the store instead, so their order still reads correctly.`,
    async () => {
      try {
        const res = await fetch(`/api/apparel/items?id=${item.id}&actorId=${me.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) { showToast(data.message || 'Could not delete the item', 'danger'); return; }
        showToast(data.message, data.retired ? 'warning' : 'success');
        await loadItems(true);
      } catch (error) { showToast('Error: ' + error.message, 'danger'); }
    },
    { title: 'Delete Item?', subtitle: 'Committee Apparel', confirmLabel: 'Delete', icon: 'fa-trash' },
  );

  /* ---------------- Mode of Payment (Admins only) ---------------- */
  const PM_BLANK = {
    category: 'bank', name: '', accountNumber: '', accountName: '',
    logoUrl: '', qrUrl: '', logoColor: '#1e3a8a', notes: '', isActive: true, sortOrder: 0,
  };

  const loadPaymentMethods = useCallback(async () => {
    if (!me || !isManager) return;
    setPmLoading(true);
    try {
      // With an actorId the route also reports where each channel is in use,
      // which is what makes "In use" instead of "Delete" possible.
      const res = await fetch(`/api/payment-methods?actorId=${encodeURIComponent(me.id)}`);
      const data = await res.json();
      if (!data.success) { showToast(data.message || 'Unable to load payment methods', 'warning'); return; }
      setPmList(data.data || []);
    } catch (error) {
      showToast('Error: ' + error.message, 'danger');
    } finally {
      setPmLoading(false);
    }
  }, [me, isManager, showToast]);

  useEffect(() => {
    if (activeSection !== 'payment-methods') return;
    loadPaymentMethods();
    // The cards say how many garments accept each channel, which needs the
    // catalogue loaded even when the Catalogue tab was never opened.
    if (items.length === 0) loadItems(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, loadPaymentMethods]);

  const openPmForm = (method) => {
    setPmEditingId(method?.id || null);
    setPmForm(method
      ? {
        category: method.category || 'bank',
        name: method.name || '',
        accountNumber: method.account_number || '',
        accountName: method.account_name || '',
        logoUrl: method.logo_url || '',
        qrUrl: method.qr_url || '',
        logoColor: method.logo_color || '#1e3a8a',
        notes: method.notes || '',
        isActive: method.is_active !== false,
        sortOrder: method.sort_order || 0,
      }
      : { ...PM_BLANK });
  };

  const closePmForm = () => { setPmForm(null); setPmEditingId(null); };

  // The logo endpoint only accepts WebP, so the picked file is squared and
  // converted here. `contain` for a QR - a cropped QR does not scan - and
  // `cover` for a logo, which is what a circle wants.
  const imageToWebp = (file, { size = 512, fit = 'cover', background = null } = {}) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, size, size); }
      const scale = fit === 'contain'
        ? Math.min(size / img.width, size / img.height)
        : Math.max(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      canvas.toBlob(
        (blob) => (blob ? resolve(new File([blob], 'upload.webp', { type: 'image/webp' })) : reject(new Error('Could not convert that image'))),
        'image/webp',
        0.92,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image')); };
    img.src = url;
  });

  const uploadPmImage = async (file, opts) => {
    const webp = await imageToWebp(file, opts);
    const fd = new FormData();
    fd.append('file', webp);
    fd.append('actorId', me.id);
    const res = await fetch('/api/payment-methods/upload-logo', { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Upload failed');
    return data.url;
  };

  const pickPmLogo = async (file) => {
    if (!file) return;
    setPmLogoBusy(true);
    try {
      const url = await uploadPmImage(file, { size: 512, fit: 'cover' });
      setPmForm((f) => ({ ...f, logoUrl: url }));
    } catch (error) {
      showToast(error.message, 'danger');
    } finally {
      setPmLogoBusy(false);
    }
  };

  const pickPmQr = async (file) => {
    if (!file) return;
    setPmQrBusy(true);
    try {
      // On a white plate, whole and uncropped, or a scanner will not read it.
      const url = await uploadPmImage(file, { size: 720, fit: 'contain', background: '#ffffff' });
      setPmForm((f) => ({ ...f, qrUrl: url }));
    } catch (error) {
      showToast(error.message, 'danger');
    } finally {
      setPmQrBusy(false);
    }
  };

  const savePaymentMethod = async () => {
    if (!pmForm.name.trim()) { showToast('Bank / channel name is required', 'warning'); return; }
    setPmSaving(true);
    try {
      const editing = !!pmEditingId;
      const res = await fetch('/api/payment-methods', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...pmForm, id: pmEditingId, actorId: me.id }),
      });
      const data = await res.json();
      if (!data.success) { showToast(data.message || 'Failed to save payment method', 'danger'); return; }
      setPmList((prev) => (editing
        ? prev.map((m) => (m.id === pmEditingId ? data.data : m))
        : [...prev, data.data]));
      showToast(data.message || 'Saved', 'success');
      closePmForm();
      // The store's pickers read this list, so the catalogue is refreshed.
      loadItems(apparelTab === 'catalog');
    } catch (error) {
      showToast('Error: ' + error.message, 'danger');
    } finally {
      setPmSaving(false);
    }
  };

  const togglePaymentMethodActive = async (method) => {
    try {
      const res = await fetch('/api/payment-methods', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: method.id, actorId: me.id, isActive: !(method.is_active !== false) }),
      });
      const data = await res.json();
      if (!data.success) { showToast(data.message || 'Failed to update', 'danger'); return; }
      setPmList((prev) => prev.map((m) => (m.id === method.id ? data.data : m)));
      showToast(data.data.is_active ? 'Now visible to payers' : 'Hidden from payers', 'success');
      loadItems(apparelTab === 'catalog');
    } catch (error) {
      showToast('Error: ' + error.message, 'danger');
    }
  };

  const deletePaymentMethod = (method) => {
    // A channel an event points at cannot be removed - its registrants would
    // be left with no account to pay into. The server enforces this too (409).
    const used = method.used_by_events || [];
    if (used.length > 0) {
      showToast(`"${method.name}" is used by ${used.length} event${used.length === 1 ? '' : 's'}. Hide it instead, or remove it from those events first.`, 'warning');
      setPmUsageOpen(method.id);
      return;
    }
    askConfirm(`Delete "${method.name}"? This cannot be undone.`, async () => {
      try {
        const res = await fetch(`/api/payment-methods?id=${method.id}&actorId=${me.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) {
          if (data.inUse) {
            // Somebody attached it to an event since this list was loaded.
            setPmList((prev) => prev.map((m) => (m.id === method.id ? { ...m, used_by_events: data.usedByEvents || [] } : m)));
            setPmUsageOpen(method.id);
          }
          showToast(data.message || 'Failed to delete', 'danger');
          return;
        }
        setPmList((prev) => prev.filter((m) => m.id !== method.id));
        showToast('Payment method deleted', 'success');
        loadItems(apparelTab === 'catalog');
      } catch (error) {
        showToast('Error: ' + error.message, 'danger');
      }
    }, { title: 'Delete Payment Method?', subtitle: 'Mode of Payment', confirmLabel: 'Delete', icon: 'fa-trash' });
  };

  /* ---------------- Team (Admins only) ---------------- */
  // `poolOnly` is what typing in the picker uses: it asks for the account list
  // and nothing else, so the member table on the page is neither re-fetched
  // nor blanked while somebody is still typing a name.
  const loadTeam = useCallback(async (q = '', page = 1, size = 25, role = 'all', poolOnly = false) => {
    if (!me || !isManager) return;
    if (poolOnly) setTeamPoolLoading(true); else setTeamLoading(true);
    setTeamError('');
    try {
      const url = `/api/event-committee/team?actorId=${encodeURIComponent(me.id)}&page=${page}&limit=${size}`
        + (q ? `&q=${encodeURIComponent(q)}` : '')
        + (role && role !== 'all' ? `&role=${encodeURIComponent(role)}` : '')
        + (poolOnly ? '&pool=1' : '');
      const res = await fetch(url);
      const data = await res.json();
      if (!data.success) { setTeamError(data.message || 'Could not load the committee'); return; }
      // A pool-only answer carries no members or waiting list, so it is merged
      // over what is already on screen rather than replacing it.
      setTeam((prev) => (poolOnly ? { ...prev, ...data.data } : data.data));
    } catch (error) {
      setTeamError(error.message);
    } finally {
      if (poolOnly) setTeamPoolLoading(false); else setTeamLoading(false);
    }
  }, [me, isManager]);

  // Typing narrows the list as you go, rather than after a button - and a new
  // search always starts on page one, or page 3 of the old results would be
  // asked for from a list that no longer has three pages.
  // Opening the tab reads everything. After that, a keystroke or a page turn
  // only re-reads the pool - the members table is left exactly as it is.
  const teamLoadedOnce = useRef(false);
  useEffect(() => {
    if (activeSection !== 'team') { teamLoadedOnce.current = false; return undefined; }
    const first = !teamLoadedOnce.current;
    const timer = setTimeout(() => {
      loadTeam(teamQuery.trim(), teamPage, teamPageSize, teamRole, !first);
      // Roles and tasks belong to the member list, so they are read with it -
      // and left alone while somebody is typing in the picker.
      if (first) { loadAssignments(); loadTasks(); if (events.length === 0) loadEvents(); }
      teamLoadedOnce.current = true;
    }, first ? 0 : 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, teamQuery, teamRole, teamPage, teamPageSize, loadTeam]);

  // A new search or a new role starts on page one, or page 3 of the old
  // results would be asked for from a list that no longer has three pages.
  useEffect(() => { setTeamPage(1); }, [teamQuery, teamRole]);

  // Roles and tasks for the whole committee, in one read each. Both are read
  // alongside the member list rather than per row.
  const loadAssignments = useCallback(async () => {
    if (!me || !isManager) return;
    try {
      const res = await fetch(`/api/event-committee/assignments?actorId=${encodeURIComponent(me.id)}`);
      const data = await res.json();
      if (!data.success) {
        // A missing table is worth saying once, not on every row.
        if (data.code === 'NEEDS_MIGRATION') setTeamError(data.message);
        return;
      }
      setAssignments(data.data || []);
      if (Array.isArray(data.roles) && data.roles.length > 0) setCommitteeRoles(data.roles);
    } catch { /* the table falls back to showing no roles */ }
  }, [me, isManager]);

  const loadTasks = useCallback(async () => {
    if (!me || !isManager) return;
    try {
      const res = await fetch(`/api/event-committee/tasks?actorId=${encodeURIComponent(me.id)}&all=1`);
      const data = await res.json();
      if (!data.success) {
        if (data.code === 'NEEDS_MIGRATION') setTeamError(data.message);
        return;
      }
      setTasks(data.data || []);
    } catch { /* the table falls back to showing no tasks */ }
  }, [me, isManager]);

  // What one person does, and what they have been asked to do.
  const rolesFor = useCallback((userId) => assignments
    .filter((a) => String(a.user_id) === String(userId))
    .map((a) => ({ eventId: a.event_id, roles: Array.isArray(a.roles) ? a.roles : [] })), [assignments]);

  const tasksFor = useCallback((userId) => tasks
    .filter((tk) => String(tk.user_id) === String(userId)), [tasks]);

  const updateMember = async (userId, patch, label) => {
    try {
      const res = await fetch('/api/event-committee/team', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: me.id, userId, ...patch }),
      });
      const data = await res.json();
      if (!data.success) { showToast(data.message || 'Could not save', 'danger'); return false; }
      showToast(data.message || label || 'Saved', 'success');
      await loadTeam(teamQuery.trim(), teamPage, teamPageSize, teamRole);
      return true;
    } catch (error) {
      showToast('Error: ' + error.message, 'danger');
      return false;
    }
  };

  const openScope = (person) => {
    setScopeFor(person);
    setScopePick((person.committee_events || []).map(String));
    // Their current roles, keyed by event, so the modal opens on what is
    // already true rather than on a blank slate.
    const held = {};
    rolesFor(person.id).forEach((a) => { held[String(a.eventId)] = a.roles; });
    setRolePick(held);
    setNewRole({});
  };

  const toggleScopeEvent = (eventId) => setScopePick((ids) => (ids.includes(eventId)
    ? ids.filter((v) => v !== eventId)
    : [...ids, eventId]));

  const toggleRole = (eventId, role) => setRolePick((prev) => {
    const held = prev[eventId] || [];
    return {
      ...prev,
      [eventId]: held.some((r) => r.toLowerCase() === role.toLowerCase())
        ? held.filter((r) => r.toLowerCase() !== role.toLowerCase())
        : [...held, role],
    };
  });

  const addNewRole = (eventId) => {
    const typed = String(newRole[eventId] || '').trim();
    if (!typed) return;
    // A role invented here is offered on every other event from now on.
    if (!committeeRoles.some((r) => r.toLowerCase() === typed.toLowerCase())) {
      setCommitteeRoles((prev) => [...prev, typed]);
    }
    const held = rolePick[eventId] || [];
    if (!held.some((r) => r.toLowerCase() === typed.toLowerCase())) {
      setRolePick((prev) => ({ ...prev, [eventId]: [...held, typed] }));
    }
    setNewRole((prev) => ({ ...prev, [eventId]: '' }));
  };

  const saveScope = async () => {
    setScopeSaving(true);
    try {
      // The scope first: which events they may open at all.
      const ok = await updateMember(scopeFor.id, { committeeEvents: scopePick }, 'Assignments updated');
      if (!ok) return;

      // Then the roles, one event at a time. An event they are no longer on
      // has its roles removed rather than left behind as a stale roster entry.
      const had = rolesFor(scopeFor.id).map((a) => String(a.eventId));
      const wanted = scopePick.map(String);
      const writes = wanted.map((eventId) => fetch('/api/event-committee/assignments', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: me.id, userId: scopeFor.id, eventId, roles: rolePick[eventId] || [] }),
      }));
      const drops = had.filter((eventId) => !wanted.includes(eventId))
        .map((eventId) => fetch(`/api/event-committee/assignments?actorId=${me.id}&userId=${scopeFor.id}&eventId=${eventId}`, { method: 'DELETE' }));

      await Promise.all([...writes, ...drops]);
      await loadAssignments();
      setScopeFor(null);
    } catch (error) {
      showToast('Error: ' + error.message, 'danger');
    } finally {
      setScopeSaving(false);
    }
  };

  /* ---- Tasks ---- */
  const openTasks = (person) => {
    setTaskFor(person);
    setTaskForm({ title: '', details: '', eventId: '', dueAt: '' });
    if (events.length === 0) loadEvents();
  };

  const submitTask = async (e) => {
    e.preventDefault();
    if (!taskForm.title.trim()) { showToast('Give the task a title', 'warning'); return; }
    setTaskSaving(true);
    try {
      const res = await fetch('/api/event-committee/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorId: me.id,
          userId: taskFor.id,
          eventId: taskForm.eventId || null,
          title: taskForm.title.trim(),
          details: taskForm.details.trim() || null,
          dueAt: taskForm.dueAt || null,
        }),
      });
      const data = await res.json();
      if (!data.success) { showToast(data.message || 'Could not assign the task', 'danger'); return; }
      showToast(data.message || 'Task assigned', 'success');
      setTaskForm({ title: '', details: '', eventId: '', dueAt: '' });
      await loadTasks();
    } catch (error) {
      showToast('Error: ' + error.message, 'danger');
    } finally {
      setTaskSaving(false);
    }
  };

  const patchTask = async (id, patch, label) => {
    setTaskBusy(id);
    try {
      const res = await fetch('/api/event-committee/tasks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: me.id, id, ...patch }),
      });
      const data = await res.json();
      if (!data.success) { showToast(data.message || 'Could not update the task', 'danger'); return; }
      setTasks((prev) => prev.map((tk) => (tk.id === id ? data.data : tk)));
      showToast(label || data.message || 'Task updated', 'success');
    } catch (error) {
      showToast('Error: ' + error.message, 'danger');
    } finally {
      setTaskBusy('');
    }
  };

  const deleteTask = (task) => askConfirm(
    `Delete the task "${task.title}"? This cannot be undone.`,
    async () => {
      try {
        const res = await fetch(`/api/event-committee/tasks?id=${task.id}&actorId=${me.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) { showToast(data.message || 'Could not delete the task', 'danger'); return; }
        setTasks((prev) => prev.filter((tk) => tk.id !== task.id));
        showToast('Task deleted', 'success');
      } catch (error) { showToast('Error: ' + error.message, 'danger'); }
    },
    { title: 'Delete Task?', subtitle: 'Committee Team', confirmLabel: 'Delete', icon: 'fa-trash' },
  );

  /* ---------------- Committee contributions (Admins only) ---------------- */
  // A contribution is money collected from the committee for a named purpose.
  // It borrows the installment arithmetic from the events side - amount due,
  // paid so far, balance - because a member paying ₱2,000 off at ₱500 a month
  // is the same problem whether the ₱2,000 is a conference fee or a Christmas
  // drive. What it does NOT borrow is the event: nobody is being booked onto
  // anything here, so there is no slot, no attendance and no confirmation.

  // What the Add Payment dialog offers: every channel an Admin has set up and
  // left active, plus Cash. Read from the same Mode of Payment screen in this
  // dashboard, so adding Maribank there puts it here without a second edit.
  const contribMethods = useMemo(
    () => [CASH_METHOD, ...pmList.filter((m) => m.is_active !== false).map((m) => ({ id: m.id, name: m.name, category: m.category }))],
    [pmList],
  );

  const loadContribs = useCallback(async (quiet = false) => {
    if (!me || !isManager) return;
    if (!quiet) setContribsLoading(true);
    setContribsError('');
    try {
      const res = await fetch(`/api/event-committee/contributions?actorId=${encodeURIComponent(me.id)}`);
      const data = await res.json();
      if (!data.success) { setContribsError(data.message || 'Could not load contributions'); return; }
      setContribs(data.data || []);
    } catch (error) {
      setContribsError(error.message);
    } finally {
      setContribsLoading(false);
    }
  }, [me, isManager]);

  // The contributions tab needs the payment channels as well - it is the same
  // list the Mode of Payment screen edits, and waiting until somebody visits
  // that screen would leave the dropdown holding nothing but Cash.
  useEffect(() => {
    if (activeSection !== 'team' || teamTab !== 'contributions') return;
    loadContribs();
    if (pmList.length === 0) loadPaymentMethods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, teamTab, loadContribs]);

  // The drive on screen, re-read from the list on every render so that
  // recording a payment updates what is open without a second copy to keep in
  // step.
  const currentContrib = useMemo(
    () => (openContrib ? contribs.find((c) => c.id === openContrib) || null : null),
    [openContrib, contribs],
  );

  const visibleContribs = useMemo(() => {
    const q = contribSearch.trim().toLowerCase();
    if (!q) return contribs;
    return contribs.filter((c) => `${c.title} ${c.description || ''}`.toLowerCase().includes(q));
  }, [contribs, contribSearch]);

  /* ---- The drive itself ---- */
  const saveContrib = async () => {
    if (!contribForm) return;
    const title = contribForm.title.trim();
    if (!title) { showToast('Give the contribution a title', 'warning'); return; }
    setContribSaving(true);
    try {
      const editing = !!contribForm.id;
      const res = await fetch('/api/event-committee/contributions', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorId: me.id,
          ...(editing ? { id: contribForm.id } : {}),
          title,
          description: contribForm.description.trim(),
        }),
      });
      const data = await res.json();
      if (!data.success) { showToast(data.message || 'Could not save', 'danger'); return; }
      await loadContribs(true);
      setContribForm(null);
      showToast(data.message || 'Saved', 'success');
      // A brand new drive opens straight away: the next thing anybody wants is
      // to put somebody on it, and that is a screen away otherwise.
      if (!editing && data.data?.id) setOpenContrib(data.data.id);
    } catch (error) {
      showToast('Error: ' + error.message, 'danger');
    } finally {
      setContribSaving(false);
    }
  };

  const removeContrib = (contrib, force = false) => askConfirm(
    force
      ? `Delete "${contrib.title}" along with every payment recorded against it? This cannot be undone.`
      : `Delete "${contrib.title}"?`,
    async () => {
      try {
        const res = await fetch(
          `/api/event-committee/contributions?id=${contrib.id}&actorId=${me.id}${force ? '&force=1' : ''}`,
          { method: 'DELETE' },
        );
        const data = await res.json();
        // Money on the drive stops the first press and asks again with what is
        // actually at stake spelled out.
        if (!data.success && data.code === 'HAS_PAYMENTS') {
          showToast(data.message, 'warning');
          setTimeout(() => removeContrib(contrib, true), 400);
          return;
        }
        if (!data.success) { showToast(data.message || 'Could not delete', 'danger'); return; }
        setContribs((prev) => prev.filter((c) => c.id !== contrib.id));
        if (openContrib === contrib.id) setOpenContrib(null);
        showToast(data.message || 'Deleted', 'success');
      } catch (error) { showToast('Error: ' + error.message, 'danger'); }
    },
    {
      title: force ? 'Delete Everything?' : 'Delete Contribution?',
      subtitle: 'Committee Contribution',
      confirmLabel: force ? 'Delete it all' : 'Delete',
      icon: 'fa-trash',
    },
  );

  /* ---- Shares, and the money against them ---- */
  // Opened two ways. With no `payer` it is a new share of the drive and asks
  // who, how much and on what plan; with one it is another instalment against
  // a share that already exists, so the person and the amount due are settled
  // and only the money is in question.
  const openPayerForm = (contribution, payer = null) => {
    setPayerPickOpen(false);
    setPayerForm({
      contributionId: contribution.id,
      payerId: payer?.id || null,
      payerLabel: payer ? payer.payer_name : '',
      userId: payer?.user_id || '',
      userQuery: '',
      amountDue: payer ? String(payer.amount_due) : '',
      plan: payer ? payer.plan : 'full',
      // A fresh instalment defaults to what is left, which is the figure the
      // person at the desk is holding the money against.
      amount: payer ? String(payer.balance || '') : '',
      methodId: '',
      methodName: 'Cash',
      paidOn: new Date().toISOString().slice(0, 10),
      reference: '',
      note: '',
    });
  };

  // Who can be put on a contribution: the committee itself. This screen is the
  // Committee Team, and a drive here is the committee's own collection - a
  // member of the wider church paying into one is a different feature with a
  // different pool behind it.
  const payerPool = useMemo(() => {
    const already = new Set(
      (currentContrib?.payers || []).map((p) => String(p.user_id)),
    );
    const q = (payerForm?.userQuery || '').trim().toLowerCase();
    return (team.members || [])
      .filter((m) => !already.has(String(m.id)))
      .filter((m) => !q || `${m.firstname} ${m.lastname} ${m.email} ${m.member_id || ''}`.toLowerCase().includes(q))
      .slice(0, 40);
  }, [team.members, currentContrib, payerForm?.userQuery]);

  // What the dialog says is left after this payment. Live, because the number
  // somebody is checking against the cash in their hand should not wait for a
  // round trip.
  const payerPreview = useMemo(() => {
    if (!payerForm) return { due: 0, paid: 0, after: 0 };
    const due = Number(payerForm.amountDue) || 0;
    const payer = payerForm.payerId
      ? (currentContrib?.payers || []).find((p) => p.id === payerForm.payerId)
      : null;
    const paid = payer ? payer.paid : 0;
    const now = payerForm.plan === 'full' && !payerForm.payerId
      ? due
      : (Number(payerForm.amount) || 0);
    return { due, paid, now, after: Math.max(0, due - paid - now) };
  }, [payerForm, currentContrib]);

  const submitPayer = async () => {
    if (!payerForm) return;
    const isInstalment = !!payerForm.payerId;
    if (!isInstalment && !payerForm.userId) { showToast('Choose who is paying', 'warning'); return; }
    if (!isInstalment && !(Number(payerForm.amountDue) > 0)) { showToast('Enter the payment to pay', 'warning'); return; }
    // An instalment of nothing is not a record of anything. A NEW share on the
    // instalment plan may legitimately start at zero - somebody signed up who
    // has not paid yet - so only the instalment itself is required to be real.
    if (isInstalment && !(Number(payerForm.amount) > 0)) { showToast('Enter how much was received', 'warning'); return; }

    setPayerSaving(true);
    try {
      const res = await fetch('/api/event-committee/contributions/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorId: me.id,
          ...(isInstalment
            ? { payerId: payerForm.payerId }
            : {
              contributionId: payerForm.contributionId,
              userId: payerForm.userId,
              amountDue: payerForm.amountDue,
              plan: payerForm.plan,
            }),
          amount: payerForm.amount,
          methodId: payerForm.methodId || null,
          methodName: payerForm.methodName,
          paidOn: payerForm.paidOn,
          reference: payerForm.reference,
          note: payerForm.note,
        }),
      });
      const data = await res.json();
      if (!data.success) { showToast(data.message || 'Could not save the payment', 'danger'); return; }
      await loadContribs(true);
      setPayerForm(null);
      showToast(data.message || 'Payment recorded', 'success');
    } catch (error) {
      showToast('Error: ' + error.message, 'danger');
    } finally {
      setPayerSaving(false);
    }
  };

  // The slip for one payment.
  //
  // The balance on a receipt is the balance AS OF that payment, not the
  // balance now. Somebody who paid ₱200 against ₱1,000 was handed a slip
  // saying ₱800 remained; paying another ₱300 next month must not rewrite the
  // one in their wallet. So it is summed over the payments up to and including
  // this one, in the order they were taken, rather than read off the share.
  const openReceipt = (contribution, payer, payment) => {
    const upTo = payer.payments.slice(0, payer.payments.findIndex((p) => p.id === payment.id) + 1);
    const paidUpTo = upTo.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const balanceAfter = Math.max(0, (Number(payer.amount_due) || 0) - paidUpTo);
    setReceipt({
      contribution,
      payer,
      payment,
      balanceAfter,
      settled: balanceAfter <= 0,
      // Four digits, like the pad of pre-printed slips this replaces. The
      // number itself comes from the database, never from the position in this
      // list - a deleted payment must not renumber the ones after it.
      number: payment.receipt_no
        ? String(payment.receipt_no).padStart(4, '0')
        : '—',
    });
  };

  const removePayment = (payment) => askConfirm(
    `Remove the ${peso(payment.amount)} payment recorded on ${formatDateOnly(payment.paid_on)}? The balance goes back up by that much.`,
    async () => {
      try {
        const res = await fetch(`/api/event-committee/contributions/payments?paymentId=${payment.id}&actorId=${me.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) { showToast(data.message || 'Could not remove it', 'danger'); return; }
        await loadContribs(true);
        showToast(data.message || 'Payment removed', 'success');
      } catch (error) { showToast('Error: ' + error.message, 'danger'); }
    },
    { title: 'Remove Payment?', subtitle: 'Committee Contribution', confirmLabel: 'Remove', icon: 'fa-rotate-left' },
  );

  const removePayer = (payer, force = false) => askConfirm(
    force
      ? `Remove ${formatPersonName(payer.payer_name)} from this contribution along with the ${payer.payments.length} payment${payer.payments.length === 1 ? '' : 's'} on their record?`
      : `Remove ${formatPersonName(payer.payer_name)} from this contribution?`,
    async () => {
      try {
        const res = await fetch(
          `/api/event-committee/contributions/payments?payerId=${payer.id}&actorId=${me.id}${force ? '&force=1' : ''}`,
          { method: 'DELETE' },
        );
        const data = await res.json();
        if (!data.success && data.code === 'HAS_PAYMENTS') {
          showToast(data.message, 'warning');
          setTimeout(() => removePayer(payer, true), 400);
          return;
        }
        if (!data.success) { showToast(data.message || 'Could not remove them', 'danger'); return; }
        await loadContribs(true);
        showToast(data.message || 'Removed', 'success');
      } catch (error) { showToast('Error: ' + error.message, 'danger'); }
    },
    {
      title: force ? 'Remove Them And Their Payments?' : 'Remove From Contribution?',
      subtitle: 'Committee Contribution',
      confirmLabel: force ? 'Remove it all' : 'Remove',
      icon: 'fa-user-minus',
    },
  );

  /* ---------------- E-Signature ---------------- */
  // One signature per account, set by the person it belongs to and nobody else.
  //
  // Two things make a signature block, and they are asked for in that order: a
  // PRINTED NAME, which is what a reader uses to know who signed, and a MARK
  // over it. The name comes first because a mark on its own is not a signature
  // block - it is a squiggle - and because somebody who has typed their name
  // has already decided how they want to be known on a document.
  //
  // The mark is drawn at three times the size it is shown, trimmed to the ink
  // and exported as WebP on a transparent ground: sharp on a printed receipt,
  // usually 10-30KB, and with nothing behind it to cover the line it sits on.

  // How much bigger the canvas is than the box on screen. 3 is the point where
  // a stroke printed at 300dpi stops showing its own pixels; past that the file
  // grows and nothing looks better.
  const SIG_SCALE = 3;
  // The long edge of the exported image. A signature is printed about 45mm
  // wide, which is ~530px at 300dpi - 1200 is comfortably past that and keeps
  // the file in the tens of kilobytes rather than the hundreds.
  const SIG_MAX_EDGE = 1200;
  const SIG_PEN = 2.4;

  const sigCanvasRef = useRef(null);
  // Strokes live in a ref, not in state: a pointermove fires dozens of times a
  // second and re-rendering the dashboard on each one would make the pen lag
  // behind the finger. React only needs to know whether there is ANY ink.
  const sigStrokes = useRef([]);
  const sigDrawing = useRef(false);
  const [sigHasInk, setSigHasInk] = useState(false);

  const [sigLoading, setSigLoading] = useState(false);
  const [sigSaving, setSigSaving] = useState(false);
  const [sigError, setSigError] = useState('');
  const [sigName, setSigName] = useState('');
  // What is actually stored, as opposed to what is being typed or drawn.
  const [sigSaved, setSigSaved] = useState({ signatureUrl: '', signaturePath: '', signatureName: '', hasName: false, updatedAt: null });
  const [sigMode, setSigMode] = useState('draw'); // 'draw' | 'upload'
  const [sigKnockout, setSigKnockout] = useState(true);
  const [sigPreview, setSigPreview] = useState(null); // an uploaded file, before saving

  const loadSignature = useCallback(async () => {
    if (!me) return;
    setSigLoading(true);
    setSigError('');
    try {
      const res = await fetch(`/api/event-committee/signature?actorId=${encodeURIComponent(me.id)}`);
      const data = await res.json();
      if (!data.success) { setSigError(data.message || 'Could not load your signature'); return; }
      setSigSaved(data.data);
      setSigName(data.data.signatureName || '');
    } catch (error) {
      setSigError(error.message);
    } finally {
      setSigLoading(false);
    }
  }, [me]);

  useEffect(() => {
    if (activeSection !== 'signature') return;
    loadSignature();
  }, [activeSection, loadSignature]);

  /* ---- The pad ---- */
  // Redrawn from the stroke list rather than left on the canvas, because that
  // is what makes Undo possible: taking the last stroke off and drawing what
  // is left. Painting a white rectangle over the end of a line would be a lie
  // on a transparent image.
  const sigRepaint = useCallback(() => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(SIG_SCALE, SIG_SCALE);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = SIG_PEN;

    sigStrokes.current.forEach((stroke) => {
      if (stroke.length === 0) return;
      ctx.beginPath();
      if (stroke.length === 1) {
        // A tap is a dot. Without this, dotting an i draws nothing.
        ctx.arc(stroke[0].x, stroke[0].y, SIG_PEN / 2, 0, Math.PI * 2);
        ctx.fillStyle = '#111';
        ctx.fill();
        return;
      }
      ctx.moveTo(stroke[0].x, stroke[0].y);
      // Through the midpoints, with each recorded point as the control. Joining
      // the points with straight lines shows every one of them as a corner at
      // the speed a hand actually moves.
      for (let i = 1; i < stroke.length - 1; i += 1) {
        const mid = { x: (stroke[i].x + stroke[i + 1].x) / 2, y: (stroke[i].y + stroke[i + 1].y) / 2 };
        ctx.quadraticCurveTo(stroke[i].x, stroke[i].y, mid.x, mid.y);
      }
      ctx.lineTo(stroke[stroke.length - 1].x, stroke[stroke.length - 1].y);
      ctx.stroke();
    });
  }, []);

  // The backing store follows the box on screen, at SIG_SCALE. Done here and
  // not in the markup because the box is a percentage of a column whose width
  // is not known until it is laid out - and a canvas with no width attribute
  // defaults to 300x150 regardless of what CSS says it is.
  const sigFitCanvas = useCallback(() => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    canvas.width = Math.round(rect.width * SIG_SCALE);
    canvas.height = Math.round(rect.height * SIG_SCALE);
    sigRepaint();
  }, [sigRepaint]);

  useEffect(() => {
    if (activeSection !== 'signature' || sigMode !== 'draw') return undefined;
    // After paint: the section is display:none until it is the active one, and
    // a hidden element measures zero.
    const id = requestAnimationFrame(sigFitCanvas);
    window.addEventListener('resize', sigFitCanvas);
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', sigFitCanvas); };
  }, [activeSection, sigMode, sigFitCanvas]);

  const sigPoint = (e) => {
    const rect = sigCanvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const sigDown = (e) => {
    // Pointer events rather than mouse or touch: one set of handlers covers a
    // mouse, a finger and a stylus, and setPointerCapture keeps the stroke
    // going when the hand leaves the box mid-letter.
    e.currentTarget.setPointerCapture(e.pointerId);
    sigDrawing.current = true;
    sigStrokes.current.push([sigPoint(e)]);
    setSigHasInk(true);
  };

  const sigMove = (e) => {
    if (!sigDrawing.current) return;
    const stroke = sigStrokes.current[sigStrokes.current.length - 1];
    const p = sigPoint(e);
    const last = stroke[stroke.length - 1];
    // Points closer than a pixel are the digitiser's noise, not the hand's
    // movement, and keeping them only makes the file bigger.
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1) return;
    stroke.push(p);
    sigRepaint();
  };

  const sigUp = () => { sigDrawing.current = false; };

  const sigClear = () => {
    sigStrokes.current = [];
    setSigHasInk(false);
    sigRepaint();
  };

  const sigUndo = () => {
    sigStrokes.current.pop();
    setSigHasInk(sigStrokes.current.length > 0);
    sigRepaint();
  };

  // The box the ink actually occupies, in CSS pixels. Computed from the points
  // rather than by reading the canvas back: exact, cheap, and it does not need
  // the canvas to still hold what was drawn.
  const sigInkBounds = () => {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    sigStrokes.current.forEach((stroke) => stroke.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }));
    if (minX === Infinity) return null;
    // The pen has width, so the ink reaches half a stroke past the points.
    const pad = SIG_PEN;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  };

  // Trimmed to the ink and exported. Trimming is what makes the mark usable
  // anywhere: an untrimmed pad is mostly empty, and dropping it onto a receipt
  // gives a signature the size of a postage stamp floating in a box.
  const sigToWebp = () => new Promise((resolve, reject) => {
    const canvas = sigCanvasRef.current;
    const bounds = sigInkBounds();
    if (!canvas || !bounds) { reject(new Error('Draw your signature first')); return; }

    const sx = Math.max(0, bounds.minX) * SIG_SCALE;
    const sy = Math.max(0, bounds.minY) * SIG_SCALE;
    const sw = Math.min(canvas.width - sx, (bounds.maxX - bounds.minX) * SIG_SCALE);
    const sh = Math.min(canvas.height - sy, (bounds.maxY - bounds.minY) * SIG_SCALE);
    if (sw <= 0 || sh <= 0) { reject(new Error('Draw your signature first')); return; }

    const shrink = Math.min(1, SIG_MAX_EDGE / Math.max(sw, sh));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(sw * shrink));
    out.height = Math.max(1, Math.round(sh * shrink));
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    // No fill: the ground stays transparent so the mark sits ON the line it is
    // printed over instead of covering it with a white block.
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);

    out.toBlob(
      (blob) => (blob
        ? resolve(new File([blob], 'signature.webp', { type: 'image/webp' }))
        : reject(new Error('Could not save that signature'))),
      'image/webp',
      0.92,
    );
  });

  // A photographed signature. Scaled, and - unless the toggle is turned off -
  // the paper behind it knocked out, because a white rectangle pasted over a
  // receipt's signature line hides the line.
  const sigFileToWebp = (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const shrink = Math.min(1, SIG_MAX_EDGE / Math.max(img.width, img.height));
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(img.width * shrink));
      out.height = Math.max(1, Math.round(img.height * shrink));
      const ctx = out.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, out.width, out.height);

      if (sigKnockout) {
        // Paper is not pure white under a phone camera, so the threshold is
        // generous - and the fade between 150 and 230 keeps the edge of every
        // stroke soft instead of turning the mark into a jagged stencil.
        const data = ctx.getImageData(0, 0, out.width, out.height);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
          const light = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
          if (light > 230) px[i + 3] = 0;
          else if (light > 150) px[i + 3] = Math.round(px[i + 3] * ((230 - light) / 80));
          // What is left is ink: forced to near-black so a blue biro under
          // yellow lamplight still prints as a signature.
          if (px[i + 3] > 0) { px[i] = 17; px[i + 1] = 17; px[i + 2] = 17; }
        }
        ctx.putImageData(data, 0, 0);
      }

      out.toBlob(
        (blob) => (blob
          ? resolve(new File([blob], 'signature.webp', { type: 'image/webp' }))
          : reject(new Error('Could not read that image'))),
        'image/webp',
        0.92,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image')); };
    img.src = url;
  });

  /* ---- Saving ---- */
  const saveSigName = async () => {
    const name = sigName.trim();
    if (!name) { showToast('Enter the full name to print under your signature', 'warning'); return; }
    setSigSaving(true);
    try {
      const res = await fetch('/api/event-committee/signature', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: me.id, signatureName: name }),
      });
      const data = await res.json();
      if (!data.success) { showToast(data.message || 'Could not save', 'danger'); return; }
      setSigSaved(data.data);
      showToast(data.message || 'Printed name saved', 'success');
    } catch (error) {
      showToast('Error: ' + error.message, 'danger');
    } finally {
      setSigSaving(false);
    }
  };

  const saveSignature = async (file) => {
    setSigSaving(true);
    try {
      const webp = file || await sigToWebp();
      const fd = new FormData();
      fd.append('file', webp);
      fd.append('actorId', me.id);
      // So the one it replaces is dropped rather than left in the bucket.
      if (sigSaved.signaturePath) fd.append('replaces', sigSaved.signaturePath);

      const upload = await fetch('/api/event-committee/signature/upload', { method: 'POST', body: fd });
      const uploaded = await upload.json();
      if (!uploaded.success) { showToast(uploaded.message || 'Upload failed', 'danger'); return; }

      const res = await fetch('/api/event-committee/signature', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorId: me.id,
          signatureName: sigName.trim(),
          signatureUrl: uploaded.url,
          signaturePath: uploaded.path,
        }),
      });
      const data = await res.json();
      if (!data.success) { showToast(data.message || 'Could not save', 'danger'); return; }

      setSigSaved(data.data);
      setSigPreview(null);
      sigClear();
      showToast(`Signature saved (${Math.round((uploaded.bytes || 0) / 1024)}KB)`, 'success');
    } catch (error) {
      showToast(error.message, 'danger');
    } finally {
      setSigSaving(false);
    }
  };

  const pickSignatureFile = async (file) => {
    if (!file) return;
    setSigSaving(true);
    try {
      const webp = await sigFileToWebp(file);
      setSigPreview({ file: webp, url: URL.createObjectURL(webp), bytes: webp.size });
    } catch (error) {
      showToast(error.message, 'danger');
    } finally {
      setSigSaving(false);
    }
  };

  const removeSignature = () => askConfirm(
    'Remove your signature? Receipts you record after this print with a blank line to sign by hand. Your printed name is kept.',
    async () => {
      try {
        const res = await fetch(`/api/event-committee/signature?actorId=${me.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) { showToast(data.message || 'Could not remove it', 'danger'); return; }
        setSigSaved((s) => ({ ...s, signatureUrl: '', signaturePath: '' }));
        showToast(data.message || 'Signature removed', 'success');
      } catch (error) { showToast('Error: ' + error.message, 'danger'); }
    },
    { title: 'Remove Signature?', subtitle: 'E-Signature', confirmLabel: 'Remove', icon: 'fa-eraser' },
  );

  /* ---------------- Gates ---------------- */
  if (me === undefined) {
    return (
      <div className="dashboard-loading-screen">
        <div className="dashboard-loading-logo">
          <img src="/assets/LOGO.png" alt="SanctuaryHub" />
        </div>
        <div className="dashboard-loading-spinner"></div>
        <p className="dashboard-loading-text">Preparing your dashboard...</p>
      </div>
    );
  }

  if (me === null) {
    return (
      <div className="dashboard-loading-screen">
        <div className="dashboard-loading-logo">
          <img src="/assets/LOGO.png" alt="SanctuaryHub" />
        </div>
        <p className="dashboard-loading-text">Taking you to the committee sign in…</p>
      </div>
    );
  }

  const menu = [
    { section: 'home', label: 'Home', icon: 'fas fa-home' },
    { section: 'events', label: 'Events', icon: 'fas fa-calendar-alt', badge: stats.toVerify || 0 },
    {
      section: 'apparel',
      label: 'Committee Apparel',
      icon: 'fas fa-shirt',
      // An Admin's badge counts orders waiting to be dealt with; a member's
      // counts what is in their basket, unordered.
      badge: isManager ? pendingOrderCount : cartCount,
    },
    ...(isManager ? [
      { section: 'payment-methods', label: 'Mode of Payment', icon: 'fas fa-money-check-dollar' },
      { section: 'team', label: 'Committee Team', icon: 'fas fa-users-gear', badge: team.waiting.length || 0 },
    ] : []),
    // Everybody, not just Admins: a signature belongs to the person, and a
    // member working a door hands over receipts too. Last in the list because
    // it is set up once and then left alone.
    { section: 'signature', label: 'E-Signature', icon: 'fas fa-signature' },
  ];

  const scopeNote = isManager
    ? 'You manage every event.'
    : (me.committeeEvents?.length
      ? `You are assigned to ${me.committeeEvents.length} event${me.committeeEvents.length === 1 ? '' : 's'}.`
      : 'You are assigned to all events.');

  const owedForForm = eventRegsModal ? totalAmountOf(eventRegsModal) : 0;

  return (
    <div className="dashboard-wrapper">
      {toastMessage && <div className={`toast-notification toast-${toastMessage.type}`}>{toastMessage.message}</div>}

      {/* Logout confirmation */}
      {showLogoutModal && (
        <div className="logout-modal" style={{ display: 'flex' }}>
          <div className="logout-modal-content">
            <div className="logout-modal-header">
              <div className="logout-modal-icon"><i className="fas fa-sign-out-alt"></i></div>
              <h3>Confirm Logout</h3><p>Event Committee</p>
            </div>
            <div className="logout-modal-body">
              <p>Are you sure you want to logout from your account?</p>
              <div className="logout-modal-actions">
                <button className="logout-modal-btn logout-modal-cancel" onClick={() => setShowLogoutModal(false)}><i className="fas fa-times"></i> Cancel</button>
                <button className="logout-modal-btn logout-modal-confirm" onClick={confirmLogout}><i className="fas fa-sign-out-alt"></i> Logout</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Generic confirm modal */}
      {confirmModal.open && (
        <div className="logout-modal" style={{ display: 'flex' }}>
          <div className="logout-modal-content">
            <div className="logout-modal-header">
              <div className="logout-modal-icon"><i className={`fas ${confirmModal.icon}`}></i></div>
              <h3>{confirmModal.title}</h3><p>{confirmModal.subtitle}</p>
            </div>
            <div className="logout-modal-body">
              <p>{confirmModal.message}</p>
              <div className="logout-modal-actions">
                <button className="logout-modal-btn logout-modal-cancel" onClick={closeConfirm}><i className="fas fa-times"></i> Cancel</button>
                <button
                  className="logout-modal-btn logout-modal-confirm"
                  onClick={async () => { const fn = confirmModal.onConfirm; closeConfirm(); if (fn) await fn(); }}
                >
                  <i className="fas fa-check"></i> {confirmModal.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Top Navbar */}
      <header className="mobile-topbar">
        <div className="mobile-topbar-left">
          <img src="/assets/LOGO.png" alt="SanctuaryHub Logo" className="mobile-topbar-logo" />
        </div>
        <button className="mobile-hamburger" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle menu">
          <span className={`hamburger-line ${sidebarOpen ? 'open' : ''}`}></span>
          <span className={`hamburger-line ${sidebarOpen ? 'open' : ''}`}></span>
          <span className={`hamburger-line ${sidebarOpen ? 'open' : ''}`}></span>
        </button>
      </header>
      <div className={`overlay ${sidebarOpen ? 'active' : ''}`} onClick={() => setSidebarOpen(false)}></div>

      <div className="dashboard-container">
        {/* ============ SIDEBAR ============ */}
        <aside className={`sidebar ${sidebarOpen ? 'active' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-top">
            <div className="sidebar-brand">
              <div className="logo">
                <img src="/assets/LOGO.png" alt="Joyful Sound Church International Logo" />
              </div>
              <div className="brand-text">
                <span className="brand-name">Joyful Sound Church</span>
                <span className="brand-sub">Event Committee</span>
              </div>
            </div>
            <button
              className="sidebar-collapse-arrow"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={sidebarCollapsed ? 'Expand' : 'Collapse'}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <i className={`fas fa-chevron-${sidebarCollapsed ? 'right' : 'left'}`}></i>
            </button>
          </div>

          <nav className="sidebar-menu">
            <div className="menu-section-label">Menu</div>
            {menu.map((item) => (
              <a
                key={item.section}
                className={`menu-item ${activeSection === item.section ? 'active' : ''}`}
                onClick={() => showSection(item.section)}
                title={sidebarCollapsed ? item.label : ''}
              >
                <span className="menu-icon"><i className={item.icon}></i></span>
                <span className="menu-label">{item.label}</span>
                {item.badge > 0 && <span className="notification-badge">{item.badge}</span>}
              </a>
            ))}

          </nav>

          <div className="sidebar-bottom">
            {/* The other half of the quick switch - same button, same place as
                the one that brought them here. */}
            {hasMainSession && (
              <button
                className="sidebar-notif-bell"
                onClick={() => router.push('/dashboard')}
                title="Back to the member dashboard"
                aria-label="Switch to the member dashboard"
              >
                <i className="fas fa-house"></i>
                <span>Member Dashboard</span>
              </button>
            )}

            <button className="sidebar-notif-bell" onClick={toggleDarkMode} title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
              <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`}></i>
              <span>{darkMode ? 'Light Mode' : 'Dark Mode'}</span>
            </button>

            <div className="sidebar-user-card" title={scopeNote}>
              <div className="sidebar-avatar">
                {me.profile_picture ? (
                  <img src={me.profile_picture} alt="Profile" referrerPolicy="no-referrer" />
                ) : (
                  <span className="avatar-initials">{initialsOf(me.firstname, me.lastname)}</span>
                )}
                <div className="sidebar-status-dot verified"></div>
              </div>
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">{me.firstname} {me.lastname}</div>
                <div className="sidebar-role-pill">{isManager ? me.role : 'Event Committee'}</div>
              </div>
            </div>

            <button className="logout-btn" onClick={() => setShowLogoutModal(true)}>
              <i className="fas fa-sign-out-alt"></i>
              <span className="logout-label">Logout</span>
            </button>
          </div>
        </aside>

        {/* ============ MAIN CONTENT ============ */}
        <main className="main-content">

          {/* ========== HOME ========== */}
          <section className={`content-section ${activeSection === 'home' ? 'active' : ''}`}>
            <h2 className="section-title">Home</h2>

            <div className="welcome-card">
              <div className="welcome-card-glow"></div>
              <div className="welcome-card-abstract">
                <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="120" cy="80" r="60" fill="rgba(255,195,0,0.06)" />
                  <circle cx="160" cy="120" r="45" fill="rgba(255,195,0,0.04)" />
                  <circle cx="80" cy="140" r="30" fill="rgba(255,255,255,0.03)" />
                  <path d="M10,180 Q60,100 120,160 T200,100" stroke="rgba(255,195,0,0.12)" strokeWidth="1.5" fill="none" />
                  <path d="M0,140 Q80,60 160,130 T240,80" stroke="rgba(255,255,255,0.06)" strokeWidth="1" fill="none" />
                  <path d="M30,200 Q100,120 180,180" stroke="rgba(255,195,0,0.08)" strokeWidth="1" fill="none" />
                </svg>
              </div>
              <div className="welcome-card-content">
                <div className="welcome-date">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
                <h2 className="welcome-greeting">Welcome, {me.firstname}. {scopeNote}</h2>
              </div>
            </div>

            <div className="stats-container">
              <div className="stat-card" onClick={() => showSection('events')}>
                <div className="stat-icon"><i className="fas fa-calendar-alt"></i></div>
                <div className="stat-value">{events.length || '—'}</div>
                <div className="stat-label">{isManager ? 'Events' : 'Assigned Events'}</div>
              </div>
              <div className="stat-card" onClick={() => eventRegsModal && setManageTab('registrations')}>
                <div className="stat-icon"><i className="fas fa-users"></i></div>
                <div className="stat-value">{eventRegsModal ? stats.holding : '—'}</div>
                <div className="stat-label">Holding A Slot</div>
              </div>
              <div className="stat-card" onClick={() => { if (eventRegsModal) { setManageTab('registrations'); setRegMoneyFilter('pending'); showSection('events'); } }}>
                <div className="stat-icon"><i className="fas fa-receipt"></i></div>
                <div className="stat-value">{eventRegsModal ? stats.toVerify : '—'}</div>
                <div className="stat-label">To Verify</div>
              </div>
              <div className="stat-card" onClick={() => { if (eventRegsModal) { setManageTab('attendance'); showSection('events'); } }}>
                <div className="stat-icon"><i className="fas fa-user-check"></i></div>
                <div className="stat-value">{eventRegsModal ? stats.attended : '—'}</div>
                <div className="stat-label">Checked In</div>
              </div>
            </div>

            <h2 className="section-title" style={{ marginTop: 30 }}>Your next events</h2>
            {eventsLoading ? (
              <p className="events-empty-msg">Loading events…</p>
            ) : events.length === 0 ? (
              <p className="events-empty-msg">
                Nothing here yet. An Admin either has not created an event, or has not added one to your committee assignments.
              </p>
            ) : (
              <div className="evt-table-wrapper">
                <table className="evt-table">
                  <thead>
                    <tr><th>Event</th><th>Date</th><th>Venue</th><th>Fee</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                  </thead>
                  <tbody>
                    {events.slice(0, 5).map((evt) => {
                      const st = eventStatusOf(evt);
                      return (
                        <tr key={evt.id}>
                          <td className="evt-td-primary" data-label="Event">
                            <div className="evt-cell-title">
                              {evt.image_url
                                ? <img src={evt.image_url} alt="" className="evt-cell-banner" />
                                : <div className="evt-cell-banner placeholder"><i className="fas fa-calendar-day"></i></div>}
                              <div>
                                <div className="evt-cell-name">{evt.title}</div>
                                {evt.description && <div className="evt-cell-desc">{evt.description}</div>}
                              </div>
                            </div>
                          </td>
                          <td className="evt-nowrap" data-label="Date">{formatEventSpan(evt.event_date, evt.end_date)}</td>
                          <td data-label="Venue">{evt.location || '—'}{evt.loc_city && <div className="evt-cell-sub">{evt.loc_city}</div>}</td>
                          <td className="evt-nowrap" data-label="Fee">{evt.has_fee ? peso(evt.registration_fee) : 'Free'}</td>
                          <td data-label="Status"><span className={`evt-tstatus evt-tstatus-${st.cls}`}>{st.label}</span></td>
                          <td className="evt-td-actions" data-label="Actions">
                            <button className="evt-mini-btn ok" onClick={() => openEventManage(evt)}>
                              <i className="fas fa-clipboard-list"></i> Work This Event
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ========== EVENTS ========== */}
          <section className={`content-section ${activeSection === 'events' ? 'active' : ''}`}>
            {eventRegsModal ? (
              <div className="um-hero evt-hero">
                <div className="um-hero-bg"></div>
                <div className="um-hero-content">
                  <div className="evt-hero-grid">
                    <div className="evt-hero-main">
                      <h2 className="um-hero-title">{eventRegsModal.title}</h2>
                      <p className="um-hero-sub">{eventRegsModal.description || 'Review registrations and manage attendance for this event.'}</p>
                      <div className="evt-hero-actions">
                        <button className="evt-hero-action ghost" onClick={closeEventManage}>
                          <i className="fas fa-arrow-left"></i> Back to Events
                        </button>
                        {manageTab === 'registrations' && (
                          <button
                            className="evt-hero-action"
                            disabled={isEventOver(eventRegsModal)}
                            title={isEventOver(eventRegsModal) ? 'This event has already ended' : ''}
                            onClick={openAddReg}
                          >
                            <i className="fas fa-user-plus"></i> Add Attendee
                          </button>
                        )}
                        {manageTab === 'attendance' && (
                          <button className="evt-hero-action" onClick={() => { setQrScanResult(null); setShowQrScanner(true); }}>
                            <i className="fas fa-qrcode"></i> Scan QR
                          </button>
                        )}
                      </div>
                    </div>

                    {/* What the event has taken in, and what is still out there.
                        Each figure is a way into the rows behind it. */}
                    {eventRegsModal.has_fee && (
                      <div className="evt-hero-stats">
                        <button
                          type="button"
                          className={`evt-stat lead ${manageTab === 'registrations' && regMoneyFilter === 'all' ? 'on' : ''}`}
                          onClick={() => { setManageTab('registrations'); setRegMoneyFilter('all'); }}
                          title="Show every registration"
                        >
                          <span>Total Collected</span>
                          <b>{peso(eventMoney.total)}</b>
                          <em>from {eventRegs.filter((r) => r.status !== 'cancelled').length} registrations</em>
                        </button>
                        <button
                          type="button"
                          className={`evt-stat ${regMoneyFilter === 'cash' ? 'on' : ''}`}
                          onClick={() => { setManageTab('registrations'); setRegMoneyFilter(regMoneyFilter === 'cash' ? 'all' : 'cash'); }}
                          title="Show the registrations paid in cash"
                        >
                          <span>Cash Collected</span>
                          <b>{peso(eventMoney.cash)}</b>
                          <em>received in person</em>
                        </button>
                        <button
                          type="button"
                          className={`evt-stat ${regMoneyFilter === 'online' ? 'on' : ''}`}
                          onClick={() => { setManageTab('registrations'); setRegMoneyFilter(regMoneyFilter === 'online' ? 'all' : 'online'); }}
                          title="Show the registrations paid online"
                        >
                          <span>Online Collected</span>
                          <b>{peso(eventMoney.online)}</b>
                          <em>GCash / bank transfer</em>
                        </button>
                        <button
                          type="button"
                          className={`evt-stat due ${manageTab === 'installments' ? 'on' : ''}`}
                          onClick={() => { setManageTab('installments'); loadInstallments(eventRegsModal.id); }}
                          title="Open the installment plans"
                        >
                          <span>Installment Balances</span>
                          <b>{peso(eventMoney.planDue)}</b>
                          <em>still to collect</em>
                        </button>
                        {eventMoney.pending > 0 && (
                          <button
                            type="button"
                            className={`evt-stat wait ${regMoneyFilter === 'pending' ? 'on' : ''}`}
                            onClick={() => { setManageTab('registrations'); setRegMoneyFilter(regMoneyFilter === 'pending' ? 'all' : 'pending'); }}
                            title="Show the payments nobody has verified yet"
                          >
                            <span>Awaiting Verification</span>
                            <b>{peso(eventMoney.pending)}</b>
                            <em>not yet checked</em>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="um-hero evt-hero">
                <div className="um-hero-bg"></div>
                <div className="um-hero-content">
                  <h2 className="um-hero-title">Events</h2>
                  <p className="um-hero-sub">
                    Open an event to work its door: verify payments, check people in, collect on a plan and add attendees. {scopeNote}
                  </p>
                  <button className="um-hero-btn" onClick={loadEvents}>
                    <i className="fas fa-rotate"></i> Refresh
                  </button>
                </div>
              </div>
            )}

            {/* ---- The event picker ---- */}
            {!eventRegsModal && (
              <>
                <div className="evt-viewbar evt-viewbar-stack">
                  <div className="evt-view-toggle">
                    <button className={eventsView === 'list' ? 'on' : ''} onClick={() => setEventsView('list')}><i className="fas fa-list"></i> List</button>
                    <button className={eventsView === 'grid' ? 'on' : ''} onClick={() => setEventsView('grid')}><i className="fas fa-table-cells-large"></i> Grid</button>
                  </div>
                  <div className="evt-filters">
                    <div className="evt-search">
                      <i className="fas fa-magnifying-glass"></i>
                      <input
                        type="search"
                        value={eventSearch}
                        onChange={(e) => setEventSearch(e.target.value)}
                        placeholder="Search events, venue or city"
                        aria-label="Search events"
                      />
                      {eventSearch && (
                        <button type="button" onClick={() => setEventSearch('')} title="Clear search"><i className="fas fa-xmark"></i></button>
                      )}
                    </div>
                    <select className="evt-filter-select" value={eventStatusFilter} onChange={(e) => setEventStatusFilter(e.target.value)} aria-label="Filter events by status">
                      <option value="all">All statuses</option>
                      <option value="upcoming">Upcoming</option>
                      <option value="ongoing">Ongoing</option>
                      <option value="completed">Completed</option>
                      <option value="draft">Draft</option>
                    </select>
                    {(eventSearch.trim() || eventStatusFilter !== 'all') && (
                      <span className="evt-filter-count">
                        {visibleEvents.length} of {events.length}
                        <button type="button" onClick={() => { setEventSearch(''); setEventStatusFilter('all'); }} title="Clear filters"><i className="fas fa-xmark"></i></button>
                      </span>
                    )}
                  </div>
                </div>

                {eventsLoading ? (
                  <p className="events-empty-msg">Loading events…</p>
                ) : visibleEvents.length === 0 ? (
                  <p className="events-empty-msg">
                    {events.length === 0
                      ? 'No events are assigned to you yet. An Admin either has not created an event, or has not added one to your committee assignments.'
                      : (eventSearch.trim() ? `No event matches “${eventSearch.trim()}”.` : 'No events match these filters.')}
                  </p>
                ) : eventsView === 'grid' ? (
                  <div className="evt-admin-grid">
                    {visibleEvents.map((evt) => {
                      const st = eventStatusOf(evt);
                      return (
                        <div key={evt.id} className="evt-admin-card">
                          <div className="evt-admin-card-img">
                            {evt.image_url
                              ? <img src={evt.image_url} alt={evt.title} />
                              : <div className="evt-admin-card-ph"><i className="fas fa-calendar-day"></i></div>}
                            <span className={`evt-admin-tag ${evt.is_published === false ? 'hidden' : 'public'}`}>{evt.is_published === false ? 'HIDDEN' : 'PUBLIC'}</span>
                            {(evt.loc_city || evt.location) && <span className="evt-admin-loc"><i className="fas fa-location-dot"></i> {evt.loc_city || evt.location}</span>}
                            <div className="evt-admin-card-body">
                              <h4>{evt.title}</h4>
                              <div className="evt-admin-card-meta">
                                {formatEventDateTime(evt.event_date)} · {evt.has_fee ? peso(evt.registration_fee) : 'Free'} · {st.label}
                              </div>
                              <button className="evt-admin-manage" onClick={() => openEventManage(evt)}>Work This Event</button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="evt-table-wrapper">
                    <table className="evt-table">
                      <thead>
                        <tr><th>Event</th><th>Date</th><th>Venue</th><th>Fee</th><th>Registered</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                      </thead>
                      <tbody>
                        {visibleEvents.map((evt) => {
                          const st = eventStatusOf(evt);
                          return (
                            <tr key={evt.id}>
                              <td className="evt-td-primary" data-label="Event">
                                <div className="evt-cell-title">
                                  {evt.image_url
                                    ? <img src={evt.image_url} alt="" className="evt-cell-banner" />
                                    : <div className="evt-cell-banner placeholder"><i className="fas fa-calendar-day"></i></div>}
                                  <div>
                                    <div className="evt-cell-name">{evt.title}</div>
                                    {evt.description && <div className="evt-cell-desc">{evt.description}</div>}
                                  </div>
                                </div>
                              </td>
                              <td className="evt-nowrap" data-label="Date">
                                {formatEventSpan(evt.event_date, evt.end_date)}
                                {Array.isArray(evt.event_days) && evt.event_days.length > 1 && (
                                  <div className="evt-cell-sub">{evt.event_days.length} sessions</div>
                                )}
                              </td>
                              <td data-label="Venue">
                                {evt.location || '—'}
                                {evt.loc_city && <div className="evt-cell-sub">{evt.loc_city}</div>}
                              </td>
                              <td className="evt-nowrap" data-label="Fee">{evt.has_fee ? peso(evt.registration_fee) : 'Free'}</td>
                              <td className="evt-nowrap" data-label="Registered">
                                {evt.registered_count ?? 0}{evt.max_participants ? ` / ${evt.max_participants}` : ''}
                              </td>
                              <td data-label="Status"><span className={`evt-tstatus evt-tstatus-${st.cls}`}>{st.label}</span></td>
                              <td className="evt-td-actions" data-label="Actions">
                                <button className="evt-manage-btn" onClick={() => openEventManage(evt)}>
                                  Work This Event <i className="fas fa-arrow-right"></i>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {visibleEvents.length > 0 && (
                  <div className="evt-table-foot"><span>Results 1–{visibleEvents.length} of {events.length}</span></div>
                )}
              </>
            )}

            {/* ---- Working one event ---- */}
            {eventRegsModal && (
              <>
                <div className="evt-tabs">
                  <button className={`evt-tab ${manageTab === 'registrations' ? 'active' : ''}`} onClick={() => setManageTab('registrations')}>
                    <i className="fas fa-clipboard-list"></i> Registrations {eventRegs.length > 0 && <span className="evt-tab-count">{eventRegs.length}</span>}
                  </button>
                  <button className={`evt-tab ${manageTab === 'attendance' ? 'active' : ''}`} onClick={() => setManageTab('attendance')}>
                    <i className="fas fa-user-check"></i> Attendance {stats.attended > 0 && <span className="evt-tab-count">{stats.attended}</span>}
                  </button>
                  {(eventRegsModal.has_fee || hasFlexiblePlans) && (
                    <button className={`evt-tab ${manageTab === 'installments' ? 'active' : ''}`} onClick={() => { setManageTab('installments'); loadInstallments(eventRegsModal.id); }}>
                      <i className="fas fa-calendar-day"></i> Flexible Installment {installments.length > 0 && <span className="evt-tab-count">{installments.length}</span>}
                    </button>
                  )}
                </div>

                {/* ---------- Registrations ---------- */}
                {manageTab === 'registrations' && (
                  <>
                    <div className="evt-viewbar">
                      <div className="evt-filters">
                        <div className="evt-search">
                          <i className="fas fa-magnifying-glass"></i>
                          <input
                            type="search"
                            value={regSearch}
                            onChange={(e) => { setRegSearch(e.target.value); setRegPage(1); }}
                            placeholder="Search attendees, church, contact or reference"
                            aria-label="Search registrations"
                          />
                          {regSearch && (
                            <button type="button" onClick={() => setRegSearch('')} title="Clear search"><i className="fas fa-xmark"></i></button>
                          )}
                        </div>
                        <select className="evt-filter-select" value={regSort} onChange={(e) => setRegSort(e.target.value)} aria-label="Sort registrations">
                          <option value="newest">Newest first</option>
                          <option value="oldest">Oldest first</option>
                        </select>
                        <select className="evt-filter-select" value={regChurchFilter} onChange={(e) => { setRegChurchFilter(e.target.value); setRegPage(1); }} aria-label="Filter by church">
                          <option value="all">All churches ({eventRegs.length})</option>
                          {regChurchOptions.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
                        </select>
                        <select className="evt-filter-select" value={regTypeFilter} onChange={(e) => { setRegTypeFilter(e.target.value); setRegPage(1); }} aria-label="Filter by registration type">
                          <option value="all">All types</option>
                          <option value="individual">Individual</option>
                          <option value="bulk">Bulk</option>
                        </select>
                        {(regTypeFilter !== 'all' || regChurchFilter !== 'all' || regMoneyFilter !== 'all' || regSearch.trim()) && (
                          <span className="evt-filter-count">
                            {regMoneyFilter !== 'all' && (
                              <b className="evt-filter-what">{{ cash: 'Cash', online: 'Online', pending: 'Awaiting check' }[regMoneyFilter]}</b>
                            )}
                            {visibleRegs.length} of {eventRegs.length}
                            <button type="button" onClick={() => { setRegTypeFilter('all'); setRegChurchFilter('all'); setRegMoneyFilter('all'); setRegSearch(''); }} title="Clear filters"><i className="fas fa-xmark"></i></button>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* the wrapper scrolls sideways, which would clip an open row
                        menu - so it stops clipping while one is open */}
                    <div className={`evt-table-wrapper evt-table-steady ${openRowMenu ? 'menu-open' : ''}`}>
                      <table className="evt-table evt-table-regs">
                        <thead>
                          <tr><th>Attendee</th><th>Type</th><th>Added By</th><th>Church</th><th>Extras</th><th>Payment</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                        </thead>
                        <tbody>
                          {eventRegsLoading ? (
                            <tr><td colSpan={8}>Loading…</td></tr>
                          ) : pagedRegs.length === 0 ? (
                            <tr><td colSpan={8}>{eventRegs.length === 0
                              ? 'No registrations yet.'
                              : (regSearch.trim() ? `No one matches “${regSearch.trim()}”.` : 'No registrations match these filters.')}</td></tr>
                          ) : pagedRegs.map((r) => (
                            <tr key={r.id}>
                              <td className="evt-cell-name evt-td-primary" data-label="Attendee">
                                {formatPersonName(r.attendee_name)}
                                <div className="evt-cell-sub">
                                  {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                  {r.group_size > 1 && <span className="evt-group-tag"><i className="fas fa-user-group"></i> Group of {r.group_size}</span>}
                                </div>
                              </td>
                              <td data-label="Type">
                                {(() => {
                                  const look = regTypeOf(r) === 'bulk'
                                    ? { label: 'Bulk', cls: 'bulk', icon: 'fa-user-group' }
                                    : { label: 'Individual', cls: 'solo', icon: 'fa-user' };
                                  return <span className={`evt-type-tag ${look.cls}`}><i className={`fas ${look.icon}`}></i> {look.label}</span>;
                                })()}
                              </td>
                              {/* Staff entries read as the role that made them;
                                  everyone else reads as the person. */}
                              <td data-label="Added By">
                                {(() => {
                                  const STAFF = ['Admin', 'Super Admin', 'Event Committee'];
                                  const role = STAFF.includes(r.added_by_role)
                                    ? r.added_by_role
                                    : (/^super\s+admin$/i.test(r.added_by || '') ? 'Super Admin'
                                      : (/^admin$/i.test(r.added_by || '') ? 'Admin' : null));
                                  if (!role) return null;
                                  const staff = formatPersonName(r.added_by);
                                  return (
                                    <>
                                      <span className={`evt-added-admin ${role === 'Super Admin' ? 'super' : ''}`}>
                                        <i className="fas fa-shield-halved"></i> {role}
                                      </span>
                                      {staff && staff.toLowerCase() !== role.toLowerCase() && (
                                        <div className="evt-cell-sub">{staff}</div>
                                      )}
                                      {r.payment_plan === 'flexible' && (
                                        <span className="evt-plan-chip"><i className="fas fa-calendar-day"></i> Flexible Installment</span>
                                      )}
                                    </>
                                  );
                                })() || (
                                  <>
                                    {formatPersonName(r.added_by || r.representative || r.attendee_name) || '—'}
                                    {regTypeOf(r) === 'bulk' && <div className="evt-cell-sub">Representative</div>}
                                    {r.payment_plan === 'flexible' && (
                                      <span className="evt-plan-chip"><i className="fas fa-calendar-day"></i> Flexible Installment</span>
                                    )}
                                  </>
                                )}
                              </td>
                              <td data-label="Church">
                                {formatChurchName(r.church_name) || '—'}
                                {r.church_pastor && (
                                  <div className="evt-cell-sub">
                                    {`Ptr. ${formatPersonName(String(r.church_pastor).replace(/^ptr\.?\s*/i, ''))}`}
                                  </div>
                                )}
                              </td>
                              {/* One mark per extra the event offers: ticked if
                                  they took it, dashed if they did not. */}
                              <td data-label="Extras" className="evt-cell-extras">
                                {(() => {
                                  const offered = eventRegsModal.event_addons || [];
                                  const taken = Array.isArray(r.addons) ? r.addons : [];
                                  const has = (x) => taken.some((t) => t.id === x.id
                                    || String(t.question || '').trim().toLowerCase() === String(x.question || '').trim().toLowerCase());
                                  if (offered.length === 0) return <span className="evt-cell-sub">—</span>;
                                  return (
                                    <div className="evt-extra-marks">
                                      {offered.map((x) => (
                                        <span
                                          key={x.id}
                                          className={`evt-extra-mark ${has(x) ? 'yes' : 'no'}`}
                                          title={`${x.question} (+${peso(x.fee)}) — ${has(x) ? 'availed' : 'not availed'}`}
                                        >
                                          <i className={`fas ${has(x) ? 'fa-circle-check' : 'fa-circle-minus'}`}></i>
                                        </span>
                                      ))}
                                    </div>
                                  );
                                })()}
                              </td>
                              <td data-label="Payment" className="evt-cell-payment">
                                {r.amount > 0 ? (
                                  <>
                                    <strong>{peso(r.amount)}</strong>
                                    <div className="evt-cell-sub">
                                      {r.payment_method || '—'}
                                      {r.base_amount != null && Number(r.base_amount) !== Number(r.amount) && (
                                        <> · {peso(r.base_amount)} + <b className="evt-extra-amt">{peso(Number(r.amount) - Number(r.base_amount))}</b></>
                                      )}
                                    </div>
                                    {r.payment_reference && <div className="evt-cell-sub">Ref: {r.payment_reference}</div>}
                                    {r.payment_plan === 'flexible' && (() => {
                                      const paidNow = Number(r.amount_paid) || 0;
                                      const settled = paidNow >= (Number(r.amount) || 0);
                                      return (
                                        <span className={`evt-plan-tag ${settled ? 'settled' : ''}`}>
                                          <i className={`fas ${settled ? 'fa-circle-check' : 'fa-calendar-day'}`}></i> Total Paid: {peso(paidNow)}
                                        </span>
                                      );
                                    })()}
                                  </>
                                ) : 'Free'}
                              </td>
                              <td className="evt-nowrap" data-label="Status">
                                {(() => {
                                  // An installment plan says how far along it is,
                                  // not just that "a payment was submitted".
                                  if (r.payment_plan === 'flexible' && r.status !== 'cancelled') {
                                    const owed = Number(r.amount) || 0;
                                    const paid = Number(r.amount_paid) || 0;
                                    return paid >= owed && owed > 0
                                      ? <span className="evt-status evt-status-payment_verified">paid</span>
                                      : (
                                        <>
                                          <span className="evt-status evt-status-installment">installment</span>
                                          <div className="evt-cell-sub">{peso(paid)} of {peso(owed)}</div>
                                        </>
                                      );
                                  }
                                  return <span className={`evt-status evt-status-${r.status}`}>{statusLabel(r.status)}</span>;
                                })()}
                                {r.attended && (
                                  <div className="evt-cell-sub"><i className="fas fa-circle-check"></i> Checked in</div>
                                )}
                              </td>
                              {/* One button per row instead of four - the actions
                                  live behind it, so the table can breathe. */}
                              <td className="evt-td-actions" data-label="Actions">
                                {(() => {
                                  const onPlan = r.payment_plan === 'flexible' && r.status !== 'cancelled';
                                  const owed = Number(r.amount) || 0;
                                  const paid = Number(r.amount_paid) || 0;
                                  const settled = onPlan && owed > 0 && paid >= owed;
                                  const name = formatPersonName(r.attendee_name);
                                  const confirmed = r.status === 'registered' || r.status === 'payment_verified';
                                  return (
                                    <div className={`evt-rowmenu ${openRowMenu === r.id ? 'open' : ''}`} onClick={(e) => e.stopPropagation()}>
                                      <button
                                        className="evt-manage-trigger"
                                        disabled={busyRow === r.id}
                                        onClick={() => setOpenRowMenu(openRowMenu === r.id ? null : r.id)}
                                        aria-expanded={openRowMenu === r.id}
                                      >
                                        <i className={`fas ${busyRow === r.id ? 'fa-spinner fa-spin' : 'fa-sliders'}`}></i> Manage <i className="fas fa-chevron-down caret"></i>
                                      </button>
                                      {openRowMenu === r.id && (
                                        <div className="evt-rowmenu-list" role="menu">
                                          {r.payment_proof_url && (
                                            <button role="menuitem" onClick={() => { setOpenRowMenu(null); setProofModal(r); }}>
                                              <i className="fas fa-receipt"></i> Proof
                                            </button>
                                          )}

                                          {/* On a plan there is nothing to verify
                                              until the balance is cleared - money
                                              to collect. */}
                                          {onPlan ? (
                                            settled ? (
                                              <span className="evt-rowmenu-note ok"><i className="fas fa-circle-check"></i> Fully paid &mdash; {peso(paid)} of {peso(owed)}</span>
                                            ) : (
                                              <button role="menuitem" className="ok" onClick={() => {
                                                setOpenRowMenu(null);
                                                openPayModal({
                                                  id: r.id, attendee_name: r.attendee_name, amount: owed, paid,
                                                  balance: Math.max(0, owed - paid),
                                                });
                                              }}>
                                                <i className="fas fa-peso-sign"></i> Collect <em>{peso(Math.max(0, owed - paid))} left</em>
                                              </button>
                                            )
                                          ) : (r.status === 'payment_submitted' || r.status === 'pending_payment') && (
                                            <button role="menuitem" className="ok" onClick={() => { setOpenRowMenu(null); verifyRegistration(r.id, 'payment_verified'); }}>
                                              <i className="fas fa-check"></i> Verify
                                            </button>
                                          )}

                                          {/* A verified payment can be put back -
                                              the reference sometimes turns out not
                                              to match. */}
                                          {r.status === 'payment_verified' && r.payment_plan !== 'flexible' && (
                                            <button role="menuitem" className="warn" onClick={() => {
                                              setOpenRowMenu(null);
                                              askConfirm(
                                                `Mark ${name}'s payment as unverified? Their registration goes back to "for verification" so it can be checked again.`,
                                                () => verifyRegistration(r.id, 'payment_submitted'),
                                                { title: 'Unverify Payment?', subtitle: eventRegsModal.title, confirmLabel: 'Unverify', icon: 'fa-rotate-left' },
                                              );
                                            }}>
                                              <i className="fas fa-rotate-left"></i> Unverify
                                            </button>
                                          )}

                                          {/* Checking somebody in from the row
                                              they were just found on, rather than
                                              hunting for them on the other tab. */}
                                          {confirmed && (r.attended ? (
                                            <button role="menuitem" className="warn" onClick={() => {
                                              setOpenRowMenu(null);
                                              askConfirm(
                                                `${name} will be marked as not attended / no-show. You can check them in again later.`,
                                                () => markAttendance(r.id, false),
                                                { title: 'Mark as Not Attended?', subtitle: eventRegsModal.title, confirmLabel: 'Mark Not Attended', icon: 'fa-user-xmark' },
                                              );
                                            }}>
                                              <i className="fas fa-user-xmark"></i> Undo Check-in
                                            </button>
                                          ) : (
                                            <button role="menuitem" onClick={() => { setOpenRowMenu(null); markAttendance(r.id, true); }}>
                                              <i className="fas fa-user-check"></i> Check In
                                            </button>
                                          ))}

                                          {!confirmed && !onPlan && (
                                            <span className="evt-rowmenu-note"><i className="fas fa-circle-info"></i> Check-in opens once the registration is confirmed</span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {visibleRegs.length > 0 && (
                      <TablePager
                        page={regPageSafe} pageSize={regPageSize} total={visibleRegs.length}
                        onPage={setRegPage} onSize={setRegPageSize} label="registrations"
                      />
                    )}
                  </>
                )}

                {/* ---------- Attendance ----------
                     The same component the Admin dashboard renders. It was two
                     screens before this - the admin had the RFID door, the
                     per-day columns and the counters, this had a single Mark
                     Attended button - and keeping them level by maintaining
                     both was never going to work. See
                     src/components/eventDesk/EventAttendanceTab.jsx. */}
                {manageTab === 'attendance' && (
                  <EventAttendanceTab
                    event={eventRegsModal}
                    regs={eventRegs}
                    loading={eventRegsLoading}
                    onRegsChange={setEventRegs}
                    actorId={me?.id || null}
                    showToast={showToast}
                    askConfirm={askConfirm}
                    Pager={TablePager}
                  />
                )}

                {/* ---------- Flexible installments ---------- */}
                {manageTab === 'installments' && (() => {
                  // The figures are read off the rows on screen, so filtering to
                  // one church answers "how much does THAT church still owe".
                  const shownPlans = visibleInstallments;
                  const instCollected = shownPlans.reduce((sum, r) => sum + (Number(r.paid) || 0), 0);
                  const instOutstanding = shownPlans.reduce((sum, r) => sum + (Number(r.balance) || 0), 0);
                  const instSettled = shownPlans.filter((r) => (Number(r.balance) || 0) <= 0).length;
                  const instFiltered = instChurchFilter !== 'all' || instStatusFilter !== 'all' || instSearch.trim() !== '';
                  return (
                    <>
                      <div className="evt-inst-stats">
                        <div className="evt-inst-stat">
                          <span>On A Plan</span>
                          <b>{shownPlans.length}</b>
                          <em>{instSettled} fully paid{shownPlans.length - instSettled > 0 && <> · {shownPlans.length - instSettled} still paying</>}</em>
                        </div>
                        <div className="evt-inst-stat paid">
                          <span>Collected</span>
                          <b>{peso(instCollected)}</b>
                          <em>received so far</em>
                        </div>
                        <div className="evt-inst-stat due">
                          <span>Outstanding</span>
                          <b>{peso(instOutstanding)}</b>
                          <em>still to collect</em>
                        </div>
                        <div className="evt-inst-stat total">
                          <span>Plan Value</span>
                          <b>{peso(instCollected + instOutstanding)}</b>
                          <em>{instFiltered ? 'across the filtered plans' : 'across every plan'}</em>
                        </div>
                      </div>

                      <div className="evt-viewbar">
                        <div className="evt-filters">
                          <div className="evt-search">
                            <i className="fas fa-magnifying-glass"></i>
                            <input
                              type="search"
                              value={instSearch}
                              onChange={(e) => { setInstSearch(e.target.value); setInstPage(1); }}
                              placeholder="Search attendees, church, contact or reference"
                              aria-label="Search installment plans"
                            />
                            {instSearch && (
                              <button type="button" onClick={() => setInstSearch('')} title="Clear search"><i className="fas fa-xmark"></i></button>
                            )}
                          </div>
                          <select className="evt-filter-select" value={instChurchFilter} onChange={(e) => { setInstChurchFilter(e.target.value); setInstPage(1); }} aria-label="Filter plans by church">
                            <option value="all">All churches ({installments.length})</option>
                            {instChurchOptions.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
                          </select>
                          <select className="evt-filter-select" value={instStatusFilter} onChange={(e) => { setInstStatusFilter(e.target.value); setInstPage(1); }} aria-label="Filter plans by status">
                            <option value="all">All statuses</option>
                            <option value="progress">In progress</option>
                            <option value="settled">Fully paid</option>
                            <option value="nothing">Nothing paid yet</option>
                          </select>
                          {instFiltered && (
                            <span className="evt-filter-count">
                              {visibleInstallments.length} of {installments.length}
                              <button type="button" onClick={() => { setInstChurchFilter('all'); setInstStatusFilter('all'); setInstSearch(''); }} title="Clear filters"><i className="fas fa-xmark"></i></button>
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="evt-table-wrapper">
                        <table className="evt-table">
                          <thead>
                            <tr>
                              <th>Attendee</th><th>Total</th><th>Paid</th><th>Balance</th>
                              <th>Payment Dates</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {installmentsLoading ? (
                              <tr><td colSpan={7}>Loading…</td></tr>
                            ) : installmentsError ? (
                              <tr><td colSpan={7} style={{ color: '#b91c1c' }}>
                                <i className="fas fa-triangle-exclamation"></i> {installmentsError}
                                {/payment_plan|amount_paid|event_registration_payments|column|relation/i.test(installmentsError) && (
                                  <div className="evt-cell-sub">Ask an Admin to run <b>supabase/migrations/event_flexible_payment.sql</b>.</div>
                                )}
                              </td></tr>
                            ) : pagedInstallments.length === 0 ? (
                              <tr><td colSpan={7}>{installments.length === 0
                                ? 'Nobody is on a flexible plan for this event yet.'
                                : (instSearch.trim() ? `No plan matches “${instSearch.trim()}”.` : 'No plans match these filters.')}</td></tr>
                            ) : pagedInstallments.map((r) => {
                              const settled = (Number(r.balance) || 0) <= 0;
                              return (
                                <tr key={r.id}>
                                  <td className="evt-cell-name evt-td-primary" data-label="Attendee">
                                    {formatPersonName(r.attendee_name)}
                                    <div className="evt-cell-sub">{formatChurchName(r.church_name) || '—'}</div>
                                  </td>
                                  <td data-label="Total">
                                    <strong>{peso(r.amount)}</strong>
                                    {Array.isArray(r.addons) && r.addons.length > 0 && (
                                      <div className="evt-cell-sub">{peso(r.base_amount)} + extras</div>
                                    )}
                                  </td>
                                  <td data-label="Paid" className="evt-inst-paid">{peso(r.paid)}</td>
                                  <td data-label="Balance">
                                    <strong className={settled ? 'evt-inst-clear' : 'evt-inst-due'}>{peso(r.balance)}</strong>
                                  </td>
                                  {/* every date money came in, so a plan reads as a history */}
                                  <td data-label="Payment Dates">
                                    {(r.payments || []).length === 0 ? <span className="evt-cell-sub">No payments yet</span> : (
                                      <div className="evt-inst-dates">
                                        {r.payments.map((pmt) => (
                                          <span className="evt-inst-date" key={pmt.id}>
                                            <b>{new Date(pmt.paid_on).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</b>
                                            <em>{peso(pmt.amount)}</em>
                                            {pmt.method && <i>{pmt.method}</i>}
                                            {/* Removing a payment is an Admin
                                                correction - the server refuses it
                                                for committee accounts. */}
                                            {isManager && (
                                              <button type="button" onClick={() => deleteInstallment(pmt)} title="Remove this payment"><i className="fas fa-xmark"></i></button>
                                            )}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                  <td className="evt-nowrap" data-label="Status">
                                    <span className={`evt-status evt-status-${settled ? 'payment_verified' : 'installment'}`}>
                                      {settled ? 'fully paid' : 'in progress'}
                                    </span>
                                  </td>
                                  <td className="evt-td-actions" data-label="Actions">
                                    <button className="evt-mini-btn ok" disabled={settled} onClick={() => openPayModal(r)}>
                                      <i className="fas fa-peso-sign"></i> Record Payment
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {visibleInstallments.length > 0 && (
                        <TablePager
                          page={instPageSafe} pageSize={instPageSize} total={visibleInstallments.length}
                          onPage={setInstPage} onSize={setInstPageSize} label="plans"
                        />
                      )}
                    </>
                  );
                })()}
              </>
            )}


            {/* ---- Proof of payment: the receipt beside the numbers it should match ---- */}
            {proofModal && (
              <div className="evt-modal-overlay" onClick={() => setProofModal(null)}>
                <div className="evt-modal evt-proof-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="evt-modal-head">
                    <div><h3>Proof of Payment</h3><p>{formatPersonName(proofModal.attendee_name)}</p></div>
                    <button className="evt-modal-close" onClick={() => setProofModal(null)}><i className="fas fa-times"></i></button>
                  </div>
                  <div className="evt-modal-body evt-proof-body">
                    <div className="evt-proof-image">
                      {/* A receipt is not always a picture. A PDF is shown in
                          place so it can be read without leaving the page, and
                          anything else is offered as a download - either way
                          the checker sees what was sent rather than a broken
                          image icon they have no explanation for. */}
                      {!proofModal.payment_proof_url ? (
                        <div className="evt-proof-empty"><i className="fas fa-image"></i> No proof uploaded</div>
                      ) : isImageProof(proofModal.payment_proof_url) ? (
                        <>
                          <img src={proofModal.payment_proof_url} alt="Payment proof" />
                          <a href={proofModal.payment_proof_url} target="_blank" rel="noreferrer" className="evt-proof-zoom">
                            <i className="fas fa-up-right-and-down-left-from-center"></i> Open full size
                          </a>
                        </>
                      ) : isPdfProof(proofModal.payment_proof_url) ? (
                        <>
                          <object className="evt-proof-doc" data={proofModal.payment_proof_url} type="application/pdf">
                            <div className="evt-proof-file">
                              <i className="fas fa-file-pdf"></i>
                              <strong>{proofFileName(proofModal.payment_proof_url)}</strong>
                              <small>This browser cannot show the PDF here.</small>
                            </div>
                          </object>
                          <a href={proofModal.payment_proof_url} target="_blank" rel="noreferrer" className="evt-proof-zoom">
                            <i className="fas fa-up-right-and-down-left-from-center"></i> Open full size
                          </a>
                        </>
                      ) : (
                        <>
                          <div className="evt-proof-file">
                            <i className="fas fa-file-lines"></i>
                            <strong>{proofFileName(proofModal.payment_proof_url)}</strong>
                            <small>This receipt is a file, not an image.</small>
                          </div>
                          <a href={proofModal.payment_proof_url} target="_blank" rel="noreferrer" className="evt-proof-zoom">
                            <i className="fas fa-arrow-up-right-from-square"></i> Open the file
                          </a>
                        </>
                      )}
                    </div>

                    <div className="evt-proof-details">
                      <div className="evt-proof-section">
                        <h4>Attendee</h4>
                        <dl className="evt-proof-list">
                          <div><dt>Full Name</dt><dd>{formatPersonName(proofModal.attendee_name) || '—'}</dd></div>
                          <div><dt>Church Name</dt><dd>{formatChurchName(proofModal.church_name) || '—'}</dd></div>
                          {proofModal.church_pastor && (
                            <div><dt>Church Pastor</dt><dd>{`Ptr. ${formatPersonName(String(proofModal.church_pastor).replace(/^ptr\.?\s*/i, ''))}`}</dd></div>
                          )}
                          {proofModal.attendee_mobile && (
                            <div><dt>Contact</dt><dd>{proofModal.attendee_mobile}</dd></div>
                          )}
                          {proofModal.representative && (
                            <div><dt>Registered By</dt><dd>{formatPersonName(proofModal.representative)}</dd></div>
                          )}
                        </dl>
                      </div>

                      <div className="evt-proof-section">
                        <h4>Receipt</h4>
                        <div className="evt-proof-receipt">
                          <div className="evt-proof-line">
                            <span>Registration Fee</span>
                            <b>{peso(proofModal.base_amount ?? proofModal.amount)}</b>
                          </div>
                          {(proofModal.addons || []).map((a, i) => (
                            <div className="evt-proof-line" key={i}>
                              <span>{a.question}</span>
                              <b>{peso(a.fee)}</b>
                            </div>
                          ))}
                          <div className="evt-proof-line total">
                            <span>Total</span>
                            <b>{peso(proofModal.amount)}</b>
                          </div>
                        </div>
                      </div>

                      <div className="evt-proof-section">
                        <h4>Payment</h4>
                        <dl className="evt-proof-list">
                          <div>
                            <dt>Mode of Payment</dt>
                            <dd>{proofModal.payment_method
                              ? (/cash on|walk|^cash$/i.test(proofModal.payment_method)
                                ? proofModal.payment_method
                                : `Online (${proofModal.payment_method})`)
                              : '—'}</dd>
                          </div>
                          {/* The one thing that actually has to match the
                              screenshot, so it is impossible to miss. */}
                          <div>
                            <dt>Reference Number</dt>
                            <dd className="evt-proof-ref">{proofModal.payment_reference || '—'}</dd>
                          </div>
                          <div>
                            <dt>Status</dt>
                            <dd><span className={`evt-status evt-status-${proofModal.status}`}>{statusLabel(proofModal.status)}</span></dd>
                          </div>
                        </dl>
                      </div>
                    </div>
                  </div>

                  <div className="evt-modal-foot evt-proof-foot">
                    <button className="evt-foot-btn ghost" onClick={() => setProofModal(null)}>
                      <i className="fas fa-xmark"></i> Close
                    </button>
                    {proofModal.status === 'payment_verified' ? (
                      <button className="evt-foot-btn unverify" onClick={() => verifyRegistration(proofModal.id, 'payment_submitted')}>
                        <i className="fas fa-rotate-left"></i> Unverify Payment
                      </button>
                    ) : (
                      <button className="evt-foot-btn verify" onClick={() => verifyRegistration(proofModal.id, 'payment_verified')}>
                        <i className="fas fa-circle-check"></i> Verify Payment
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ---- Record one installment ---- */}
            {payModal && (
              <div className="evt-modal-overlay" onClick={() => !paySaving && setPayModal(null)}>
                <div className="evt-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="evt-modal-head">
                    <div><h3>Record Payment</h3><p>{formatPersonName(payModal.attendee_name)}</p></div>
                    <button className="evt-modal-close" onClick={() => setPayModal(null)}><i className="fas fa-times"></i></button>
                  </div>
                  <div className="evt-modal-body">
                    {/* The three numbers this decision turns on, with the balance
                        as the headline. */}
                    <div className="evt-plan-summary big">
                      <div><span>Total</span><b>{peso(payModal.amount)}</b></div>
                      <div><span>Paid So Far</span><b>{peso(payModal.paid)}</b></div>
                      <div className="bal"><span>Balance To Pay</span><b>{peso(payModal.balance)}</b></div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div className="form-group">
                        <label>Amount Received *</label>
                        <input
                          className="form-control"
                          inputMode="numeric"
                          value={payForm.amount}
                          onChange={(e) => setPayForm({ ...payForm, amount: onlyDigits(e.target.value) })}
                          placeholder={String(payModal.balance)}
                        />
                      </div>
                      <div className="form-group">
                        <label>Date Paid *</label>
                        <input type="date" className="form-control" value={payForm.paidOn} onChange={(e) => setPayForm({ ...payForm, paidOn: e.target.value })} />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div className="form-group"><label>Paid Through</label>
                        <select className="form-control" value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                          <option value="">Select…</option>
                          {paymentMethodsFor(eventRegsModal).map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      <div className="form-group"><label>Reference (optional)</label>
                        <input className="form-control" value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} />
                      </div>
                    </div>

                    <div className="form-group"><label>Note (optional)</label>
                      <input className="form-control" value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} placeholder="e.g. paid at the registration table" />
                    </div>

                    <p className="evt-muted" style={{ fontSize: '0.8rem' }}>
                      <i className="fas fa-circle-info"></i> Remaining after this payment:{' '}
                      <b>{peso(Math.max(0, (Number(payModal.balance) || 0) - (Number(payForm.amount) || 0)))}</b>
                      {(Number(payForm.amount) || 0) >= (Number(payModal.balance) || 0) && (Number(payForm.amount) || 0) > 0
                        && ' — this settles the registration and confirms their slot.'}
                    </p>
                  </div>
                  <div className="evt-modal-foot">
                    <button className="btn-secondary" onClick={() => setPayModal(null)} disabled={paySaving}>Cancel</button>
                    <button className="btn-primary" onClick={submitInstallment} disabled={paySaving}>
                      <i className={`fas ${paySaving ? 'fa-spinner fa-spin' : 'fa-check'}`}></i> {paySaving ? 'Saving…' : 'Record Payment'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ---- Add an attendee ---- */}
            {showAddReg && eventRegsModal && (
              <div className="evt-modal-overlay" onClick={() => !addSaving && setShowAddReg(false)}>
                <div className="evt-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="evt-modal-head">
                    <div><h3>Add Attendee</h3><p>{eventRegsModal.title}</p></div>
                    <button className="evt-modal-close" onClick={() => setShowAddReg(false)}><i className="fas fa-times"></i></button>
                  </div>
                  <div className="evt-modal-body">
                    <div className="evt-steps">
                      {['Attendee Details', 'Payment'].map((label, i) => (
                        <span className="evt-step-wrap" key={label}>
                          {i > 0 && <span className="evt-step-line"></span>}
                          <button
                            type="button"
                            className={`evt-step ${addStep === i ? 'on' : ''} ${addStep > i ? 'done' : ''}`}
                            onClick={() => { if (i < addStep) setAddStep(i); }}
                          >
                            <b>{addStep > i ? <i className="fas fa-check"></i> : i + 1}</b> {label}
                          </button>
                        </span>
                      ))}
                    </div>

                    {addStep === 0 && (
                      <>
                        <p className="evt-muted" style={{ marginBottom: 12, fontSize: '0.82rem' }}>
                          <i className="fas fa-circle-info"></i> Use this to record somebody who turned up at the door without registering online.
                        </p>

                        {/* Whose name goes on having made this row. */}
                        <div className="evt-actas">
                          <span className={`evt-added-admin ${me.role === 'Super Admin' ? 'super' : ''}`}>
                            <i className="fas fa-shield-halved"></i> {isManager ? me.role : 'Event Committee'}
                          </span>
                          <small>{me.firstname} {me.lastname} — this registration is saved under your name.</small>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <div className="form-group">
                            <label>First Name *</label>
                            <input
                              className={`form-control ${addErrors.firstName ? 'evt-field-error' : ''}`}
                              value={addForm.attendeeFirstName}
                              onChange={(e) => setAddForm({ ...addForm, attendeeFirstName: e.target.value })}
                            />
                            {addErrors.firstName && <div className="evt-field-error-msg">{addErrors.firstName}</div>}
                          </div>
                          <div className="form-group">
                            <label>Last Name *</label>
                            <input
                              className={`form-control ${addErrors.lastName ? 'evt-field-error' : ''}`}
                              value={addForm.attendeeLastName}
                              onChange={(e) => setAddForm({ ...addForm, attendeeLastName: e.target.value })}
                            />
                            {addErrors.lastName && <div className="evt-field-error-msg">{addErrors.lastName}</div>}
                          </div>
                        </div>

                        {/* Nobody may hold two slots for the same event. */}
                        {dupName && (
                          <div className="evt-dup-warn">
                            <i className="fas fa-triangle-exclamation"></i>
                            <span>
                              <b>{formatPersonName(dupName.name || dupName)}</b> already holds a slot for this event
                              {dupName.status ? <> — <span className={`evt-status evt-status-${dupName.status}`}>{statusLabel(dupName.status)}</span></> : null}.
                              Find them on the Registrations tab instead of adding them twice.
                            </span>
                          </div>
                        )}

                        {/* One church, spelled one way - offered from what people
                            have already registered under. */}
                        <div className="form-group evt-church-field">
                          <label>Church Name * <em style={{ fontStyle: 'normal', fontWeight: 500, color: 'var(--text-muted, #999)' }}>(complete name)</em></label>
                          <input
                            className={`form-control ${addErrors.churchName ? 'evt-field-error' : ''}`}
                            value={addForm.churchName}
                            onChange={(e) => { setAddForm({ ...addForm, churchName: e.target.value }); setChurchOpen(true); }}
                            onFocus={() => setChurchOpen(true)}
                            onBlur={() => setTimeout(() => setChurchOpen(false), 150)}
                            placeholder="e.g. Joyful Sound Church International"
                          />
                          {churchOpen && churchOptions.length > 0 && (
                            <ul className="evt-church-list">
                              {churchOptions.map((c) => (
                                <li key={c.name}>
                                  <button type="button" onClick={() => { setAddForm((f) => ({ ...f, churchName: c.name })); setChurchOpen(false); }}>
                                    {c.name} <em>{c.count}</em>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                          {addErrors.churchName && <div className="evt-field-error-msg">{addErrors.churchName}</div>}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <div className="form-group">
                            <label>Church Pastor *</label>
                            <div className={`evt-prefix-input ${addErrors.churchPastor ? 'evt-field-error' : ''}`}>
                              <span>Ptr.</span>
                              <input
                                value={addForm.churchPastor}
                                onChange={(e) => setAddForm({ ...addForm, churchPastor: e.target.value })}
                                placeholder="Full name"
                              />
                            </div>
                            {addErrors.churchPastor && <div className="evt-field-error-msg">{addErrors.churchPastor}</div>}
                          </div>
                          <div className="form-group">
                            <label>Contact Number *</label>
                            <input
                              className={`form-control ${addErrors.mobile ? 'evt-field-error' : ''}`}
                              inputMode="numeric"
                              value={addForm.attendeeMobile}
                              onChange={(e) => setAddForm({ ...addForm, attendeeMobile: onlyDigits(e.target.value) })}
                              placeholder="09XXXXXXXXX"
                            />
                            {addErrors.mobile && <div className="evt-field-error-msg">{addErrors.mobile}</div>}
                          </div>
                        </div>

                        <div className="form-group">
                          <label>Email (optional)</label>
                          <input
                            className="form-control"
                            type="email"
                            value={addForm.attendeeEmail}
                            onChange={(e) => setAddForm({ ...addForm, attendeeEmail: e.target.value })}
                            placeholder="Only if they have one to give"
                          />
                        </div>

                        <button className="btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={addRegNext}>
                          Continue to Payment <i className="fas fa-arrow-right"></i>
                        </button>
                      </>
                    )}

                    {addStep === 1 && (
                      <>
                        {/* The same paid extras the attendee would have been offered */}
                        {(eventRegsModal.event_addons || []).length > 0 && (
                          <div className="evt-addon-pick">
                            <div className="evt-addon-pick-head"><i className="fas fa-circle-plus"></i> Optional Extras</div>
                            {eventRegsModal.event_addons.map((a) => (
                              <label key={a.id} className={`evt-addon-option ${addAddons.includes(a.id) ? 'on' : ''} ${a.is_required ? 'locked' : ''}`}>
                                <input type="checkbox" checked={addAddons.includes(a.id)} disabled={a.is_required} onChange={() => toggleAddon(a)} />
                                <span className="evt-addon-option-text">
                                  <strong>{a.question}</strong>
                                  {a.is_required && <small>Required &mdash; included for everyone.</small>}
                                </span>
                                <span className="evt-addon-option-fee">+{peso(a.fee)}</span>
                              </label>
                            ))}
                          </div>
                        )}

                        {owedForForm <= 0 ? (
                          <p className="evt-free-note"><i className="fas fa-gift"></i> Nothing to collect &mdash; they will be registered instantly.</p>
                        ) : (
                          <div className="evt-pay-box">
                            <div className="evt-receipt">
                              <div className="evt-receipt-line"><span>Registration Fee</span><b>{peso(baseAmountOf(eventRegsModal))}</b></div>
                              {(eventRegsModal.event_addons || []).filter((a) => addAddons.includes(a.id)).map((a) => (
                                <div className="evt-receipt-line" key={a.id}><span>Extras ({a.question})</span><b>{peso(a.fee)}</b></div>
                              ))}
                              <div className="evt-receipt-total"><span>Total</span><b>{peso(owedForForm)}</b></div>
                            </div>

                            {/* How this is being settled decides everything below it. */}
                            <div className="evt-plan-pick">
                              <div className="evt-plan-head">Payment Options</div>
                              <button
                                type="button"
                                className={`evt-plan-option ${addForm.paymentPlan === 'full' ? 'on' : ''}`}
                                onClick={() => setAddForm({ ...addForm, paymentPlan: 'full' })}
                              >
                                <i className="fas fa-money-bill-wave"></i>
                                <span>
                                  <strong>Pay in Full</strong>
                                  <small>The whole {peso(owedForForm)} is settled now.</small>
                                </span>
                              </button>
                              <button
                                type="button"
                                className={`evt-plan-option ${addForm.paymentPlan === 'flexible' ? 'on' : ''}`}
                                onClick={() => setAddForm({ ...addForm, paymentPlan: 'flexible' })}
                              >
                                <i className="fas fa-calendar-day"></i>
                                <span>
                                  <strong>Flexible Payment Plan</strong>
                                  <small>Paid down over several visits. Tracked under Flexible Installment.</small>
                                </span>
                              </button>
                            </div>

                            {addForm.paymentPlan === 'full' && (
                              <>
                                <div className="form-group"><label>Payment Method</label>
                                  <select className="form-control" value={addForm.paymentMethod} onChange={(e) => setAddForm({ ...addForm, paymentMethod: e.target.value })}>
                                    <option value="">Select…</option>
                                    {paymentMethodsFor(eventRegsModal).map((m) => <option key={m} value={m}>{m}</option>)}
                                  </select>
                                </div>
                                <div className="form-group"><label>Reference / Txn Number</label>
                                  <input
                                    className="form-control"
                                    value={addForm.paymentReference}
                                    onChange={(e) => setAddForm({ ...addForm, paymentReference: e.target.value })}
                                    placeholder={/^cash$/i.test(addForm.paymentMethod) ? 'Not needed for cash' : ''}
                                  />
                                </div>
                                <label className="evt-toggle-row" style={{ marginTop: 4 }}>
                                  <input type="checkbox" checked={addForm.markVerified} onChange={(e) => setAddForm({ ...addForm, markVerified: e.target.checked })} />
                                  <span>Mark payment as verified immediately (already collected in person)</span>
                                </label>
                              </>
                            )}

                            {addForm.paymentPlan === 'flexible' && (
                              <div className="evt-plan-detail">
                                <div className="evt-plan-summary">
                                  <div><span>Total to pay</span><b>{peso(owedForForm)}</b></div>
                                  <div><span>Paying now</span><b>{peso(addForm.initialPayment)}</b></div>
                                  <div className="bal"><span>Remaining balance</span><b>{peso(Math.max(0, owedForForm - (Number(addForm.initialPayment) || 0)))}</b></div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                  <div className="form-group">
                                    <label>First Payment (optional)</label>
                                    <input
                                      className="form-control"
                                      inputMode="numeric"
                                      value={addForm.initialPayment}
                                      onChange={(e) => setAddForm({ ...addForm, initialPayment: onlyDigits(e.target.value) })}
                                      placeholder="0"
                                    />
                                  </div>
                                  <div className="form-group"><label>Paid Through</label>
                                    <select className="form-control" value={addForm.paymentMethod} onChange={(e) => setAddForm({ ...addForm, paymentMethod: e.target.value })}>
                                      <option value="">Select…</option>
                                      {paymentMethodsFor(eventRegsModal).map((m) => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                  </div>
                                </div>
                                <p className="evt-muted" style={{ fontSize: '0.8rem', margin: 0 }}>
                                  <i className="fas fa-circle-info"></i> The rest is recorded under the <b>Flexible Installment</b> tab as it comes in.
                                  The registration is confirmed automatically once the balance reaches zero.
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="evt-modal-foot" style={{ padding: '14px 0 0', border: 'none', background: 'transparent' }}>
                          <button className="btn-secondary" onClick={() => setAddStep(0)} disabled={addSaving}>
                            <i className="fas fa-arrow-left"></i> Back
                          </button>
                          <button className="btn-primary" onClick={submitAddReg} disabled={addSaving}>
                            <i className={`fas ${addSaving ? 'fa-spinner fa-spin' : 'fa-user-plus'}`}></i> {addSaving ? 'Adding…' : 'Add Attendee'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* ========== COMMITTEE APPAREL ========== */}
          <section className={`content-section ${activeSection === 'apparel' ? 'active' : ''}`}>
            <div className="um-hero evt-hero">
              <div className="um-hero-bg"></div>
              <div className="um-hero-content">
                <div className="evt-hero-grid">
                  <div className="evt-hero-main">
                    <h2 className="um-hero-title">Committee Apparel</h2>
                    <p className="um-hero-sub">
                      Jackets, polo shirts, shirts and IDs for the committee. Pick a size, put it in your basket
                      and place the order &mdash; an Admin receives it and tells you when it is ready to collect.
                    </p>
                    <div className="evt-hero-actions">
                      <button
                        className="evt-hero-action ghost"
                        onClick={() => {
                          if (apparelTab === 'mine') loadMyOrders();
                          else if (apparelTab === 'orders') loadAllOrders();
                          else loadItems(apparelTab === 'catalog');
                        }}
                      >
                        <i className="fas fa-rotate"></i> Refresh
                      </button>
                      {isManager && (
                        <button className="evt-hero-action" onClick={() => { setApparelTab('catalog'); openItemForm(null); }}>
                          <i className="fas fa-plus"></i> Add Item
                        </button>
                      )}
                    </div>
                  </div>

                  {/* What the desk is holding, for the people who have to fill it. */}
                  {isManager && (
                    <div className="evt-hero-stats">
                      <button
                        type="button"
                        className={`evt-stat lead ${apparelTab === 'orders' && orderStatus === 'all' ? 'on' : ''}`}
                        onClick={() => { setApparelTab('orders'); setOrderStatus('all'); }}
                        title="Show every order"
                      >
                        <span>Orders</span>
                        <b>{orderMoney.orders}</b>
                        <em>{peso(orderMoney.value)} in all</em>
                      </button>
                      <button
                        type="button"
                        className={`evt-stat wait ${orderStatus === 'pending' ? 'on' : ''}`}
                        onClick={() => { setApparelTab('orders'); setOrderStatus(orderStatus === 'pending' ? 'all' : 'pending'); }}
                        title="Show the orders nobody has dealt with yet"
                      >
                        <span>Waiting</span>
                        <b>{orderMoney.pending}</b>
                        <em>not yet accepted</em>
                      </button>
                      <button
                        type="button"
                        className={`evt-stat ${orderStatus === 'ready' ? 'on' : ''}`}
                        onClick={() => { setApparelTab('orders'); setOrderStatus(orderStatus === 'ready' ? 'all' : 'ready'); }}
                        title="Show what is waiting to be collected"
                      >
                        <span>Ready</span>
                        <b>{orderMoney.ready}</b>
                        <em>waiting for pickup</em>
                      </button>
                      <button
                        type="button"
                        className="evt-stat due"
                        onClick={() => { setApparelTab('orders'); setOrderStatus('all'); }}
                        title="Money collected against orders"
                      >
                        <span>Collected</span>
                        <b>{peso(orderMoney.collected)}</b>
                        <em>{peso(Math.max(0, orderMoney.value - orderMoney.collected))} still to collect</em>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="evt-tabs">
              <button className={`evt-tab ${apparelTab === 'store' ? 'active' : ''}`} onClick={() => setApparelTab('store')}>
                <i className="fas fa-shirt"></i> Store {cartCount > 0 && <span className="evt-tab-count">{cartCount}</span>}
              </button>
              <button className={`evt-tab ${apparelTab === 'mine' ? 'active' : ''}`} onClick={() => setApparelTab('mine')}>
                <i className="fas fa-receipt"></i> My Orders {myOrders.length > 0 && <span className="evt-tab-count">{myOrders.length}</span>}
              </button>
              {isManager && (
                <>
                  <button className={`evt-tab ${apparelTab === 'orders' ? 'active' : ''}`} onClick={() => setApparelTab('orders')}>
                    <i className="fas fa-clipboard-check"></i> All Orders {allOrders.length > 0 && <span className="evt-tab-count">{allOrders.length}</span>}
                  </button>
                  <button className={`evt-tab ${apparelTab === 'catalog' ? 'active' : ''}`} onClick={() => setApparelTab('catalog')}>
                    <i className="fas fa-boxes-stacked"></i> Catalogue {items.length > 0 && <span className="evt-tab-count">{items.length}</span>}
                  </button>
                </>
              )}
            </div>

            {apparelError && (
              <p className="events-empty-msg">
                <i className="fas fa-triangle-exclamation"></i> {apparelError}
              </p>
            )}

            {/* ---------- STORE ---------- */}
            {apparelTab === 'store' && (
              <>
                <div className="ap-chips">
                  <button className={`ap-chip ${apparelCat === 'all' ? 'on' : ''}`} onClick={() => setApparelCat('all')}>
                    <i className="fas fa-layer-group"></i> All <b>{items.length}</b>
                  </button>
                  {categories.filter((c) => itemCounts.get(c)).map((c) => (
                    <button key={c} className={`ap-chip ${apparelCat === c ? 'on' : ''}`} onClick={() => setApparelCat(c)}>
                      <i className={`fas ${APPAREL_CATEGORY_ICONS[c] || 'fa-tag'}`}></i> {c} <b>{itemCounts.get(c)}</b>
                    </button>
                  ))}
                </div>

                <div className="evt-viewbar">
                  <div className="evt-filters">
                    <div className="evt-search">
                      <i className="fas fa-magnifying-glass"></i>
                      <input
                        type="search"
                        value={apparelSearch}
                        onChange={(e) => setApparelSearch(e.target.value)}
                        placeholder="Search apparel"
                        aria-label="Search apparel"
                      />
                      {apparelSearch && (
                        <button type="button" onClick={() => setApparelSearch('')} title="Clear search"><i className="fas fa-xmark"></i></button>
                      )}
                    </div>
                    {(apparelCat !== 'all' || apparelSearch.trim()) && (
                      <span className="evt-filter-count">
                        {visibleItems.length} of {items.length}
                        <button type="button" onClick={() => { setApparelCat('all'); setApparelSearch(''); }} title="Clear filters"><i className="fas fa-xmark"></i></button>
                      </span>
                    )}
                  </div>
                </div>

                <div className="ap-layout">
                  <div>
                    {itemsLoading ? (
                      <p className="events-empty-msg">Loading the catalogue…</p>
                    ) : visibleItems.length === 0 ? (
                      <p className="events-empty-msg">
                        {items.length === 0
                          ? (isManager
                            ? 'The catalogue is empty. Add the first garment from the Catalogue tab.'
                            : 'Nothing is on sale yet. An Admin has not added any apparel.')
                          : 'Nothing matches those filters.'}
                      </p>
                    ) : (
                      <div className="ap-grid">
                        {visibleItems.map((it) => {
                          const sizes = apparelSizes(it);
                          const oneSize = apparelIsOneSize(it);
                          const left = apparelTotalStock(it);
                          const out = left <= 0;
                          const picked = sizePick[it.id] || '';
                          // Front, back, whichever is showing. Clamped, so a
                          // picture being deleted cannot leave a card blank.
                          const pics = apparelImages(it);
                          const shot = Math.min(imgPick[it.id] || 0, Math.max(0, pics.length - 1));
                          const active = pics[shot];
                          return (
                            <div className={`ap-card ${out ? 'out' : ''}`} key={it.id}>
                              <div className="ap-card-img">
                                {active ? (
                                  <>
                                    {/* The same picture, blurred, behind the
                                        real one. The garment is shown whole -
                                        never cropped to a square - and the
                                        blur fills what is left over so a tall
                                        photo does not sit in a grey box. */}
                                    <span className="ap-card-img-bg" style={{ backgroundImage: `url(${active.url})` }} aria-hidden="true" />
                                    <img src={active.url} alt={active.label ? `${it.name} — ${active.label}` : it.name} />
                                  </>
                                ) : (
                                  <div className="ap-card-ph"><i className={`fas ${APPAREL_CATEGORY_ICONS[it.category] || 'fa-shirt'}`}></i></div>
                                )}
                                <span className="ap-card-cat">{it.category}</span>
                                {out
                                  ? <span className="ap-card-flag out">Out of stock</span>
                                  : left <= 5 ? <span className="ap-card-flag low">{left} left</span> : null}
                                {active?.label && <span className="ap-card-imglabel">{active.label}</span>}
                                {active && (
                                  <button
                                    type="button"
                                    className="ap-card-zoom"
                                    title="See the whole picture"
                                    aria-label={`See ${it.name} full size`}
                                    onClick={() => openLightbox(pics, shot, it.name)}
                                  >
                                    <i className="fas fa-expand"></i>
                                  </button>
                                )}
                              </div>

                              {/* One view is not worth a strip to switch
                                  between - but the ROOM the strip takes is
                                  still held, empty, so a one-photo card and a
                                  five-photo card beside it break their name,
                                  price and sizes on the same lines. */}
                              {pics.length > 1 ? (
                                <div className="ap-thumbs">
                                  {pics.map((p, i) => (
                                    <button
                                      key={`${it.id}-${i}`}
                                      type="button"
                                      className={`ap-thumb ${i === shot ? 'on' : ''}`}
                                      title={p.label || `Picture ${i + 1}`}
                                      aria-label={p.label || `Picture ${i + 1}`}
                                      onClick={() => setImgPick((m) => ({ ...m, [it.id]: i }))}
                                    >
                                      <img src={p.url} alt="" />
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <div className="ap-thumbs empty" aria-hidden="true" />
                              )}

                              <div className="ap-card-body">
                                <h4>{it.name}</h4>
                                {it.description && <p className="ap-card-desc">{it.description}</p>}
                                <div className="ap-card-price">
                                  {peso(it.price)}
                                  {oneSize && <small>one size</small>}
                                </div>

                                {/* A size that has run out stays on the card,
                                    struck through - "no Medium left" is more
                                    use than a Medium that was never there. */}
                                {!oneSize && (
                                  <div className="ap-size-pick">
                                    <span className="ap-size-lead">
                                      Size
                                      {picked
                                        ? <b>{picked}</b>
                                        : <em>pick one</em>}
                                    </span>
                                    <div className="ap-sizes">
                                      {sizes.map((s) => (
                                        <button
                                          key={s.size}
                                          type="button"
                                          className={`ap-size ${picked === s.size ? 'on' : ''}`}
                                          disabled={s.stock <= 0}
                                          title={s.stock <= 0 ? `${s.size} is out of stock` : `${s.stock} left in ${s.size}`}
                                          onClick={() => setSizePick((p) => ({ ...p, [it.id]: s.size }))}
                                        >
                                          {s.size}
                                          <em>{s.stock > 0 ? `${s.stock} left` : 'none'}</em>
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                <button
                                  type="button"
                                  className="ap-add"
                                  disabled={out}
                                  onClick={() => { if (addToCart(it)) setCartOpen(true); }}
                                >
                                  <i className="fas fa-cart-plus"></i>
                                  {out ? 'Out of stock' : (!oneSize && !picked ? 'Pick a size' : 'Add to Basket')}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ---- The basket ----
                       A column beside the grid on a desktop; a sheet that
                       slides up over it on a phone, where there is no column
                       to put it in. Same markup either way. */}
                  <aside className={`ap-cart ${cartOpen ? 'open' : ''}`} id="ap-basket">
                    <div className="ap-cart-head">
                      <h3>
                        <i className="fas fa-basket-shopping"></i> Your Basket
                        {cartCount > 0 && <span className="ap-cart-count">{cartCount} item{cartCount === 1 ? '' : 's'}</span>}
                      </h3>
                      <button
                        type="button"
                        className="ap-cart-hide"
                        onClick={() => setCartOpen(false)}
                        aria-label="Hide the basket"
                        title="Hide the basket"
                      >
                        <i className="fas fa-chevron-down"></i>
                      </button>
                    </div>

                    {cart.length === 0 ? (
                      <div className="ap-cart-empty">
                        <i className="fas fa-basket-shopping"></i>
                        Nothing in here yet. Pick a size on a garment and add it.
                      </div>
                    ) : (
                      <>
                        <div className="ap-cart-list">
                          {cart.map((l) => (
                            <div className="ap-cart-line" key={l.key}>
                              {l.imageUrl
                                ? <img className="ap-cart-thumb" src={l.imageUrl} alt="" />
                                : <div className="ap-cart-thumb ph"><i className="fas fa-shirt"></i></div>}

                              <div className="ap-cart-line-main">
                                <div className="ap-cart-line-name">{l.name}</div>
                                <div className="ap-cart-line-sub">
                                  <span className="ap-cart-size">{l.size || 'One size'}</span>
                                  {peso(l.unitPrice)} each
                                </div>
                              </div>

                              <button
                                type="button"
                                className="ap-cart-drop"
                                onClick={() => dropCartLine(l.key)}
                                aria-label={`Take ${l.name} out of the basket`}
                                title="Take this out"
                              >
                                <i className="fas fa-xmark"></i>
                              </button>

                              {/* Count and money on one line under the name, so
                                  the stepper is a proper target rather than
                                  three 24px buttons squeezed beside a price. */}
                              <div className="ap-cart-line-foot">
                                <div className="ap-qty">
                                  <button type="button" disabled={l.quantity <= 1} onClick={() => setCartQty(l.key, l.quantity - 1)} aria-label="One fewer"><i className="fas fa-minus"></i></button>
                                  <span aria-live="polite">{l.quantity}</span>
                                  <button type="button" disabled={l.quantity >= l.available} onClick={() => setCartQty(l.key, l.quantity + 1)} aria-label="One more" title={l.quantity >= l.available ? `Only ${l.available} left` : 'One more'}><i className="fas fa-plus"></i></button>
                                </div>
                                <b className="ap-cart-line-money">{peso(l.unitPrice * l.quantity)}</b>
                              </div>

                              {l.quantity >= l.available && (
                                <span className="ap-cart-line-note">That is all {l.available} of them</span>
                              )}
                            </div>
                          ))}
                        </div>

                        <div className="ap-cart-foot">
                          <div className="ap-cart-total">
                            <span>Total to pay</span>
                            <b>{peso(cartTotal)}</b>
                          </div>
                          <button type="button" className="btn-primary ap-cart-go" onClick={openCheckout}>
                            <i className="fas fa-paper-plane"></i> Place Order
                          </button>
                          <button type="button" className="ap-cart-clear" onClick={() => setCart([])}>
                            <i className="fas fa-rotate-left"></i> Empty the basket
                          </button>
                        </div>
                      </>
                    )}
                  </aside>
                </div>

                {/* The bar a thumb reaches on a phone. It only exists once
                    there is something in the basket, and it is the handle that
                    pulls the sheet up. */}
                {cartCount > 0 && (
                  <button
                    type="button"
                    className={`ap-cart-bar ${cartOpen ? 'hidden' : ''}`}
                    onClick={() => setCartOpen(true)}
                    aria-controls="ap-basket"
                    aria-expanded={cartOpen}
                  >
                    <span className="ap-cart-bar-icon">
                      <i className="fas fa-basket-shopping"></i>
                      <b>{cartCount}</b>
                    </span>
                    <span className="ap-cart-bar-text">
                      View basket
                      <em>{cartCount} piece{cartCount === 1 ? '' : 's'}</em>
                    </span>
                    <span className="ap-cart-bar-total">{peso(cartTotal)}</span>
                  </button>
                )}

                {/* Behind the sheet, so a tap anywhere else puts it away. */}
                {cartOpen && <div className="ap-cart-veil" onClick={() => setCartOpen(false)} />}
              </>
            )}

            {/* ---------- MY ORDERS ---------- */}
            {apparelTab === 'mine' && (
              ordersLoading ? (
                <p className="events-empty-msg">Loading your orders…</p>
              ) : myOrders.length === 0 ? (
                <p className="events-empty-msg">
                  You have not ordered anything yet. Anything you order shows up here with its status.
                </p>
              ) : (
                <div className="evt-table-wrapper">
                  <table className="evt-table">
                    <thead>
                      <tr><th>Order</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th>Placed</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                    </thead>
                    <tbody>
                      {myOrders.map((o) => (
                        <tr key={o.id}>
                          <td className="evt-cell-name evt-td-primary" data-label="Order">{o.order_no}</td>
                          <td data-label="Items">
                            <div className="ap-lines">
                              {(o.lines || []).map((l) => (
                                <span className="ap-line" key={l.id}>
                                  <b>{l.quantity}×</b> {l.item_name} <em>{l.size ? `(${l.size})` : '(One size)'}</em>
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="evt-nowrap" data-label="Total"><strong>{peso(o.total)}</strong></td>
                          <td data-label="Payment">
                            {o.is_paid
                              ? <span className="ap-status ap-status-released">paid</span>
                              : <span className="evt-cell-sub">not yet confirmed</span>}
                            {o.payment_method && <div className="evt-cell-sub">{o.payment_method}</div>}
                            {o.payment_reference && <div className="evt-cell-sub">Ref {o.payment_reference}</div>}
                            {o.payment_proof_url && (
                              <button className="evt-mini-btn" style={{ marginTop: 4 }} onClick={() => setOrderProof(o)}>
                                <i className="fas fa-receipt"></i> My Receipt
                              </button>
                            )}
                          </td>
                          <td className="evt-nowrap" data-label="Status">
                            <span className={`ap-status ap-status-${o.status}`}>{APPAREL_STATUS_LABELS[o.status] || o.status}</span>
                          </td>
                          <td className="evt-cell-sub evt-nowrap" data-label="Placed">{formatDateTime(o.created_at)}</td>
                          <td className="evt-td-actions" data-label="Actions">
                            <button className="evt-mini-btn" onClick={() => openOrder(o)}>
                              <i className="fas fa-eye"></i> View
                            </button>
                            {/* Calling off your own order is allowed only while
                                nobody has acted on it - after that it is a
                                conversation with the desk, not a button. */}
                            {o.status === 'pending' && (
                              <button
                                className="evt-mini-btn danger"
                                disabled={orderBusy === o.id}
                                onClick={() => askConfirm(
                                  `Cancel order ${o.order_no}? Everything in it goes back into stock.`,
                                  () => patchOrder({ id: o.id, status: 'cancelled' }, 'Order cancelled'),
                                  { title: 'Cancel Order?', subtitle: 'Committee Apparel', confirmLabel: 'Cancel Order', icon: 'fa-ban' },
                                )}
                              >
                                <i className="fas fa-ban"></i> Cancel
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {/* ---------- ALL ORDERS (Admins) ---------- */}
            {apparelTab === 'orders' && isManager && (
              <>
                <div className="evt-viewbar">
                  <div className="evt-filters">
                    <div className="evt-search">
                      <i className="fas fa-magnifying-glass"></i>
                      <input
                        type="search"
                        value={orderSearch}
                        onChange={(e) => { setOrderSearch(e.target.value); setOrderPage(1); }}
                        placeholder="Search reference, who ordered, or a garment"
                        aria-label="Search orders"
                      />
                      {orderSearch && (
                        <button type="button" onClick={() => setOrderSearch('')} title="Clear search"><i className="fas fa-xmark"></i></button>
                      )}
                    </div>
                    <select className="evt-filter-select" value={orderStatus} onChange={(e) => { setOrderStatus(e.target.value); setOrderPage(1); }} aria-label="Filter orders by status">
                      <option value="all">All statuses</option>
                      {APPAREL_STATUSES.map((s) => (
                        <option key={s} value={s}>{APPAREL_STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                    {(orderStatus !== 'all' || orderSearch.trim()) && (
                      <span className="evt-filter-count">
                        {visibleOrders.length} of {allOrders.length}
                        <button type="button" onClick={() => { setOrderStatus('all'); setOrderSearch(''); }} title="Clear filters"><i className="fas fa-xmark"></i></button>
                      </span>
                    )}
                  </div>
                </div>

                <div className="evt-table-wrapper">
                  <table className="evt-table">
                    <thead>
                      <tr>
                        <th>Order</th><th>Ordered By</th><th>Items</th><th>Total</th>
                        <th>Payment</th><th>Status</th><th>Placed</th><th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ordersLoading ? (
                        <tr><td colSpan={8}>Loading…</td></tr>
                      ) : pagedOrders.length === 0 ? (
                        <tr><td colSpan={8}>{allOrders.length === 0
                          ? 'Nobody has ordered any apparel yet.'
                          : (orderSearch.trim() ? `No order matches “${orderSearch.trim()}”.` : 'No order matches these filters.')}</td></tr>
                      ) : pagedOrders.map((o) => (
                        <tr key={o.id}>
                          <td className="evt-cell-name evt-td-primary" data-label="Order">
                            {o.order_no}
                            <div className="evt-cell-sub">{(o.lines || []).reduce((sum, l) => sum + l.quantity, 0)} piece(s)</div>
                          </td>
                          <td data-label="Ordered By">
                            {formatPersonName(o.ordered_by_name) || '—'}
                            <div className="evt-cell-sub">{o.ordered_by_role || 'Event Committee'}</div>
                            {o.contact && <div className="evt-cell-sub">{o.contact}</div>}
                          </td>
                          <td data-label="Items">
                            <div className="ap-lines">
                              {(o.lines || []).map((l) => (
                                <span className="ap-line" key={l.id}>
                                  <b>{l.quantity}×</b> {l.item_name} <em>{l.size ? `(${l.size})` : '(One size)'}</em>
                                </span>
                              ))}
                            </div>
                            {o.note && <div className="evt-cell-sub"><i className="fas fa-comment"></i> {o.note}</div>}
                          </td>
                          <td className="evt-nowrap" data-label="Total"><strong>{peso(o.total)}</strong></td>
                          <td data-label="Payment">
                            <button
                              className={`evt-mini-btn ${o.is_paid ? 'ok' : ''}`}
                              disabled={orderBusy === o.id}
                              title={o.is_paid ? 'Mark as not paid' : 'Mark as paid'}
                              onClick={() => patchOrder({ id: o.id, isPaid: !o.is_paid }, o.is_paid ? 'Marked as unpaid' : 'Marked as paid')}
                            >
                              <i className={`fas ${o.is_paid ? 'fa-circle-check' : 'fa-peso-sign'}`}></i> {o.is_paid ? 'Paid' : 'Collect'}
                            </button>
                            {o.payment_method && <div className="evt-cell-sub">{o.payment_method}</div>}
                            {o.payment_reference && <div className="evt-cell-sub">Ref {o.payment_reference}</div>}
                            {/* Cash has no receipt to show - the money was
                                handed over, not sent. Everything else does. */}
                            {o.payment_proof_url ? (
                              <button className="evt-mini-btn" style={{ marginTop: 4 }} onClick={() => setOrderProof(o)}>
                                <i className="fas fa-receipt"></i> Proof
                              </button>
                            ) : (o.payment_channel_id && (
                              <div className="evt-cell-sub"><i className="fas fa-circle-info"></i> no receipt</div>
                            ))}
                          </td>
                          <td className="evt-nowrap" data-label="Status">
                            <select
                              className="evt-filter-select"
                              value={o.status}
                              disabled={orderBusy === o.id}
                              onChange={(e) => patchOrder({ id: o.id, status: e.target.value }, `Order ${o.order_no} is now ${APPAREL_STATUS_LABELS[e.target.value]}`)}
                              aria-label={`Status of order ${o.order_no}`}
                            >
                              {APPAREL_STATUSES.map((s) => (
                                <option key={s} value={s}>{APPAREL_STATUS_LABELS[s]}</option>
                              ))}
                            </select>
                          </td>
                          <td className="evt-cell-sub evt-nowrap" data-label="Placed">{formatDateTime(o.created_at)}</td>
                          <td className="evt-td-actions" data-label="Actions">
                            <button className="evt-mini-btn" onClick={() => openOrder(o)}>
                              <i className="fas fa-sliders"></i> Manage
                            </button>
                            <button className="evt-mini-btn danger" onClick={() => deleteOrder(o)}>
                              <i className="fas fa-trash"></i> Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {visibleOrders.length > 0 && (
                  <TablePager
                    page={orderPageSafe} pageSize={orderPageSize} total={visibleOrders.length}
                    onPage={setOrderPage} onSize={setOrderPageSize} label="orders"
                  />
                )}
              </>
            )}

            {/* ---------- CATALOGUE (Admins) ---------- */}
            {apparelTab === 'catalog' && isManager && (
              <>
                <div className="evt-viewbar">
                  <div className="evt-filters">
                    <div className="evt-search">
                      <i className="fas fa-magnifying-glass"></i>
                      <input
                        type="search"
                        value={apparelSearch}
                        onChange={(e) => setApparelSearch(e.target.value)}
                        placeholder="Search the catalogue"
                        aria-label="Search the catalogue"
                      />
                      {apparelSearch && (
                        <button type="button" onClick={() => setApparelSearch('')} title="Clear search"><i className="fas fa-xmark"></i></button>
                      )}
                    </div>
                    <select className="evt-filter-select" value={apparelCat} onChange={(e) => setApparelCat(e.target.value)} aria-label="Filter by category">
                      <option value="all">All categories</option>
                      {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <button className="btn-primary" onClick={() => openItemForm(null)}>
                    <i className="fas fa-plus"></i> Add Item
                  </button>
                </div>

                <div className="evt-table-wrapper">
                  <table className="evt-table">
                    <thead>
                      <tr><th>Item</th><th>Category</th><th>Price</th><th>Stock</th><th>In Store</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                    </thead>
                    <tbody>
                      {itemsLoading ? (
                        <tr><td colSpan={6}>Loading…</td></tr>
                      ) : visibleItems.length === 0 ? (
                        <tr><td colSpan={6}>{items.length === 0
                          ? 'The catalogue is empty. Add the first garment with Add Item.'
                          : 'Nothing matches those filters.'}</td></tr>
                      ) : visibleItems.map((it) => {
                        const sizes = apparelSizes(it);
                        const left = apparelTotalStock(it);
                        return (
                          <tr key={it.id}>
                            <td className="evt-td-primary" data-label="Item">
                              <div className="evt-cell-title">
                                {it.image_url
                                  ? <img src={it.image_url} alt="" className="evt-cell-banner" />
                                  : <div className="evt-cell-banner placeholder"><i className={`fas ${APPAREL_CATEGORY_ICONS[it.category] || 'fa-shirt'}`}></i></div>}
                                <div>
                                  <div className="evt-cell-name">{it.name}</div>
                                  {it.description && <div className="evt-cell-desc">{it.description}</div>}
                                </div>
                              </div>
                            </td>
                            <td className="evt-nowrap" data-label="Category">
                              <span className="evt-type-tag solo"><i className={`fas ${APPAREL_CATEGORY_ICONS[it.category] || 'fa-tag'}`}></i> {it.category}</span>
                            </td>
                            <td className="evt-nowrap" data-label="Price"><strong>{peso(it.price)}</strong></td>
                            <td data-label="Stock">
                              {sizes.length === 0 ? (
                                <span className={left > 0 ? 'evt-inst-paid' : 'evt-inst-due'}>{left} · one size</span>
                              ) : (
                                <div className="ap-sizes">
                                  {sizes.map((s) => (
                                    <span key={s.size} className="ap-size" title={`${s.stock} in ${s.size}`}>
                                      {s.size}<em style={s.stock <= 0 ? { color: 'var(--danger)' } : undefined}>{s.stock}</em>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="evt-nowrap" data-label="In Store">
                              {it.is_active === false
                                ? <span className="ap-status ap-status-cancelled">hidden</span>
                                : <span className="ap-status ap-status-released">on sale</span>}
                            </td>
                            <td className="evt-td-actions" data-label="Actions">
                              <button className="evt-mini-btn" onClick={() => openItemForm(it)}>
                                <i className="fas fa-pen"></i> Edit
                              </button>
                              <button className="evt-mini-btn ok" onClick={() => toggleItemVisible(it)}>
                                <i className={`fas ${it.is_active === false ? 'fa-eye' : 'fa-eye-slash'}`}></i> {it.is_active === false ? 'Show' : 'Hide'}
                              </button>
                              <button className="evt-mini-btn danger" onClick={() => deleteItem(it)}>
                                <i className="fas fa-trash"></i> Delete
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* ---- A picture, whole ----
                 Sits above every other overlay on this screen, because it is
                 opened FROM them - from the store grid and from the catalogue
                 form - and an overlay you cannot see is no use. */}
            {lightbox && (() => {
              const shot = lightbox.pics[lightbox.index];
              return (
                <div className="ap-lightbox" onClick={() => setLightbox(null)} role="dialog" aria-modal="true" aria-label={`${lightbox.title} pictures`}>
                  <div className="ap-lightbox-top" onClick={(e) => e.stopPropagation()}>
                    <div className="ap-lightbox-title">
                      <b>{lightbox.title}</b>
                      <span>
                        {shot?.label ? `${shot.label} · ` : ''}
                        {lightbox.index + 1} of {lightbox.pics.length}
                      </span>
                    </div>
                    <button type="button" className="ap-lightbox-close" onClick={() => setLightbox(null)} aria-label="Close">
                      <i className="fas fa-xmark"></i>
                    </button>
                  </div>

                  {/* The picture is never cropped and never blown up past its
                      own resolution - it is shown at whatever size fits. */}
                  <img
                    className="ap-lightbox-shot"
                    src={shot?.url}
                    alt={shot?.label ? `${lightbox.title} — ${shot.label}` : lightbox.title}
                    onClick={(e) => e.stopPropagation()}
                  />

                  {lightbox.pics.length > 1 && (
                    <>
                      <button
                        type="button"
                        className="ap-lightbox-step prev"
                        onClick={(e) => { e.stopPropagation(); stepLightbox(-1); }}
                        aria-label="Previous picture"
                      ><i className="fas fa-chevron-left"></i></button>
                      <button
                        type="button"
                        className="ap-lightbox-step next"
                        onClick={(e) => { e.stopPropagation(); stepLightbox(1); }}
                        aria-label="Next picture"
                      ><i className="fas fa-chevron-right"></i></button>

                      <div className="ap-lightbox-strip" onClick={(e) => e.stopPropagation()}>
                        {lightbox.pics.map((pic, i) => (
                          <button
                            key={`lb-${i}`}
                            type="button"
                            className={`ap-lightbox-thumb ${i === lightbox.index ? 'on' : ''}`}
                            title={pic.label || `Picture ${i + 1}`}
                            aria-label={pic.label || `Picture ${i + 1}`}
                            onClick={() => setLightbox((v) => ({ ...v, index: i }))}
                          >
                            <img src={pic.url} alt="" />
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

            {/* ---- Placing the order ---- */}
            {checkout && (
              <div className="evt-modal-overlay" onClick={() => !placing && setCheckout(null)}>
                <div className="evt-modal" onClick={(e) => e.stopPropagation()}>
                  <form onSubmit={placeOrder}>
                    <div className="evt-modal-head">
                      <div><h3>Place Your Order</h3><p>{cartCount} piece{cartCount === 1 ? '' : 's'} · {peso(cartTotal)}</p></div>
                      <button type="button" className="evt-modal-close" onClick={() => setCheckout(null)}><i className="fas fa-times"></i></button>
                    </div>
                    <div className="evt-modal-body">
                      <div className="evt-receipt">
                        {cart.map((l) => (
                          <div className="evt-receipt-line" key={l.key}>
                            <span>{l.quantity} × {l.name} {l.size ? `(${l.size})` : '(One size)'}</span>
                            <b>{peso(l.unitPrice * l.quantity)}</b>
                          </div>
                        ))}
                        <div className="evt-receipt-total"><span>Total</span><b>{peso(cartTotal)}</b></div>
                      </div>

                      {/* ---- How this is being paid ---- */}
                      {cartTotal > 0 && (() => {
                        const picked = payPick && payPick !== 'cash'
                          ? basketPayments.channels.find((c) => String(c.id) === String(payPick))
                          : null;
                        const onCash = payPick === 'cash';
                        return (
                          <div className="evt-pay-channels" style={{ marginTop: 14 }}>
                            <div className="evt-pay-channels-head"><i className="fas fa-wallet"></i> How are you paying?</div>
                            {/* Nothing in common means these cannot go on one
                                payment, which the payer has to be told before
                                they go hunting for a missing option. */}
                            {!basketPayments.cash && basketPayments.channels.length === 0 && (
                              <p className="evt-field-error-msg" style={{ margin: '0 0 10px' }}>
                                <i className="fas fa-triangle-exclamation"></i> The things in your basket accept
                                different payments, so they cannot be ordered together. Order them separately.
                              </p>
                            )}

                            <div className={`evt-pay-picker ${payPickerOpen ? 'open' : ''}`}>
                              <button
                                type="button"
                                className="evt-pay-picker-trigger"
                                aria-expanded={payPickerOpen}
                                onClick={() => setPayPickerOpen((v) => !v)}
                              >
                                {onCash ? (
                                  <>
                                    <span className="pm-logo pm-logo-sm" style={{ background: '#16a34a' }}><span><i className="fas fa-money-bill-wave"></i></span></span>
                                    <span className="evt-pay-picker-name">
                                      {basketPayments.cashLabel}
                                      <span className="pm-badge">Cash</span>
                                    </span>
                                  </>
                                ) : picked ? (
                                  <>
                                    <span className="pm-logo pm-logo-sm" style={{ background: picked.logo_url ? 'transparent' : (picked.logo_color || '#1e3a8a') }}>
                                      {picked.logo_url ? <img src={picked.logo_url} alt={picked.name} /> : <span>{getPaymentInitials(picked.name)}</span>}
                                    </span>
                                    <span className="evt-pay-picker-name">
                                      {picked.name}
                                      <span className={`pm-badge ${picked.category}`}>{picked.category === 'bank' ? 'Bank Transfer' : 'Online Payment'}</span>
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span className="evt-pay-picker-ph"><i className="fas fa-hand-pointer"></i></span>
                                    <span className="evt-pay-picker-name evt-pay-picker-empty">Choose how you are paying</span>
                                  </>
                                )}
                                <i className="fas fa-chevron-down evt-pay-picker-caret"></i>
                              </button>

                              {payPickerOpen && (
                                <ul className="evt-pay-picker-menu">
                                  {/* Cash first: it is the one most people use
                                      at church, and it needs no reference. */}
                                  {basketPayments.cash && (
                                    <li>
                                      <button
                                        type="button"
                                        className={`evt-pay-picker-option ${onCash ? 'on' : ''}`}
                                        onClick={() => { setPayPick('cash'); setPayPickerOpen(false); }}
                                      >
                                        <span className="pm-logo pm-logo-sm" style={{ background: '#16a34a' }}><span><i className="fas fa-money-bill-wave"></i></span></span>
                                        <span className="evt-pay-picker-name">
                                          {basketPayments.cashLabel}
                                          <span className="pm-badge">Cash</span>
                                        </span>
                                        {onCash && <i className="fas fa-check evt-pay-picker-tick"></i>}
                                      </button>
                                    </li>
                                  )}
                                  {basketPayments.channels.map((m) => (
                                    <li key={m.id}>
                                      <button
                                        type="button"
                                        className={`evt-pay-picker-option ${String(payPick) === String(m.id) ? 'on' : ''}`}
                                        onClick={() => { setPayPick(m.id); setPayPickerOpen(false); }}
                                      >
                                        <span className="pm-logo pm-logo-sm" style={{ background: m.logo_url ? 'transparent' : (m.logo_color || '#1e3a8a') }}>
                                          {m.logo_url ? <img src={m.logo_url} alt={m.name} /> : <span>{getPaymentInitials(m.name)}</span>}
                                        </span>
                                        <span className="evt-pay-picker-name">
                                          {m.name}
                                          <span className={`pm-badge ${m.category}`}>{m.category === 'bank' ? 'Bank Transfer' : 'Online Payment'}</span>
                                        </span>
                                        {String(payPick) === String(m.id) && <i className="fas fa-check evt-pay-picker-tick"></i>}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>

                            {/* Cash needs no account number - only where to
                                bring it. A channel needs its numbers, its QR,
                                and somewhere to type the reference. */}
                            {onCash ? (
                              <div className="evt-pay-channel evt-pay-picked">
                                <div className="evt-pay-channel-info">
                                  <p className="evt-pay-channel-note">
                                    <i className="fas fa-circle-info"></i>{' '}
                                    Hand the payment to an Admin at church. Your order is marked paid once they have it.
                                  </p>
                                </div>
                              </div>
                            ) : picked ? (
                              <div className="evt-pay-channel evt-pay-picked">
                                <div className="evt-pay-channel-info">
                                  {picked.account_number && (
                                    <div className="evt-pay-channel-row">
                                      <span>Account No.</span>
                                      <strong>{picked.account_number}</strong>
                                      <button type="button" className="pm-icon-btn" title="Copy account number" onClick={() => copyPayDetail('Account number', picked.account_number)}>
                                        <i className="fas fa-copy"></i>
                                      </button>
                                    </div>
                                  )}
                                  {picked.account_name && (
                                    <div className="evt-pay-channel-row">
                                      <span>Account Name</span>
                                      <strong>{picked.account_name}</strong>
                                      <button type="button" className="pm-icon-btn" title="Copy account name" onClick={() => copyPayDetail('Account name', picked.account_name)}>
                                        <i className="fas fa-copy"></i>
                                      </button>
                                    </div>
                                  )}
                                  {picked.qr_url && (
                                    <button type="button" className="evt-pay-qr" onClick={() => setQrLightbox({ url: picked.qr_url, name: picked.name })}>
                                      <img src={picked.qr_url} alt={`${picked.name} QR code`} />
                                      <span><strong>Scan this QR to pay</strong><small>Tap to enlarge</small></span>
                                    </button>
                                  )}
                                  {picked.notes && <p className="evt-pay-channel-note"><i className="fas fa-circle-info"></i> {picked.notes}</p>}
                                  <div className="evt-pay-confirm">
                                    <div className="evt-pay-confirm-head"><i className="fas fa-receipt"></i> Confirm your payment</div>
                                    <div className="form-group">
                                      <label>Reference / Txn Number</label>
                                      <input
                                        className="form-control"
                                        value={checkout.reference}
                                        onChange={(e) => setCheckout({ ...checkout, reference: e.target.value })}
                                        placeholder="e.g. 0123456789"
                                      />
                                    </div>
                                    {/* Paying into an account means proving it
                                        arrived - the same receipt an event
                                        registration asks for. */}
                                    <div className="form-group">
                                      <label>Payment Receipt *</label>
                                      <ProofDrop id="committee-apparel-proof" file={proofFile} onPick={setProofFile} />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <p className="evt-pay-picker-hint">
                                <i className="fas fa-circle-info"></i> Pick one above to see where to send the money.
                              </p>
                            )}
                          </div>
                        );
                      })()}

                      <div className="form-group" style={{ marginTop: 14 }}>
                        <label>Contact Number</label>
                        <input
                          className="form-control"
                          inputMode="numeric"
                          value={checkout.contact}
                          onChange={(e) => setCheckout({ ...checkout, contact: onlyDigits(e.target.value) })}
                          placeholder="09XXXXXXXXX — so the desk can tell you it is ready"
                        />
                      </div>
                      <div className="form-group">
                        <label>Note (optional)</label>
                        <input
                          className="form-control"
                          value={checkout.note}
                          onChange={(e) => setCheckout({ ...checkout, note: e.target.value })}
                          placeholder="e.g. needed before the October conference"
                        />
                      </div>

                      <p className="evt-muted" style={{ fontSize: '0.8rem' }}>
                        <i className="fas fa-circle-info"></i> An Admin receives this order, marks it paid once your
                        payment is confirmed, and sets it to <b>ready for pickup</b> when it can be collected.
                      </p>
                    </div>
                    <div className="evt-modal-foot">
                      <button type="button" className="btn-secondary" onClick={() => setCheckout(null)} disabled={placing}>Cancel</button>
                      <button type="submit" className="btn-primary" disabled={placing}>
                        <i className={`fas ${placing ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`}></i> {placing ? 'Placing…' : 'Place Order'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* ---- One order, in full ---- */}
            {orderOpen && (
              <div className="evt-modal-overlay" onClick={() => setOrderOpen(null)}>
                <div className="evt-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="evt-modal-head">
                    <div>
                      <h3>Order {orderOpen.order_no}</h3>
                      <p>{formatPersonName(orderOpen.ordered_by_name) || 'Committee member'} · {formatDateTime(orderOpen.created_at)}</p>
                    </div>
                    <button className="evt-modal-close" onClick={() => setOrderOpen(null)}><i className="fas fa-times"></i></button>
                  </div>
                  <div className="evt-modal-body">
                    <div className="evt-plan-summary big">
                      <div><span>Pieces</span><b>{(orderOpen.lines || []).reduce((sum, l) => sum + l.quantity, 0)}</b></div>
                      <div><span>Payment</span><b>{orderOpen.is_paid ? 'Paid' : 'Unpaid'}</b></div>
                      <div className="bal"><span>Total</span><b>{peso(orderOpen.total)}</b></div>
                    </div>

                    <dl className="evt-proof-list" style={{ marginTop: 4 }}>
                      <div><dt>Status</dt><dd><span className={`ap-status ap-status-${orderOpen.status}`}>{APPAREL_STATUS_LABELS[orderOpen.status] || orderOpen.status}</span></dd></div>
                      <div><dt>Ordered By</dt><dd>{formatPersonName(orderOpen.ordered_by_name) || '—'} <span className="evt-cell-sub">{orderOpen.ordered_by_role}</span></dd></div>
                      <div><dt>Contact</dt><dd>{orderOpen.contact || '—'}</dd></div>
                      <div><dt>Paying With</dt><dd>{orderOpen.payment_method || <span className="evt-cell-sub">nothing to pay</span>}</dd></div>
                      {orderOpen.payment_reference && (
                        <div><dt>Reference</dt><dd className="evt-proof-ref">{orderOpen.payment_reference}</dd></div>
                      )}
                      {orderOpen.payment_proof_url && (
                        <div>
                          <dt>Receipt</dt>
                          <dd>
                            <button className="evt-mini-btn" onClick={() => setOrderProof(orderOpen)}>
                              <i className="fas fa-receipt"></i> View proof of payment
                            </button>
                          </dd>
                        </div>
                      )}
                      {orderOpen.note && <div><dt>Note</dt><dd>{orderOpen.note}</dd></div>}
                    </dl>

                    <div className="evt-table-wrapper" style={{ marginTop: 14 }}>
                      <table className="evt-table">
                        <thead>
                          <tr><th>Item</th><th>Size</th><th>Qty</th><th>Price</th><th>Line</th></tr>
                        </thead>
                        <tbody>
                          {(orderOpen.lines || []).map((l) => {
                            const catalogItem = items.find((i) => i.id === l.item_id);
                            const sizes = catalogItem ? apparelSizes(catalogItem) : [];
                            const editable = isManager && orderOpen.status !== 'released';
                            return (
                              <tr key={l.id}>
                                <td className="evt-cell-name evt-td-primary" data-label="Item">
                                  {l.item_name}
                                  <div className="evt-cell-sub">{l.category || '—'}</div>
                                </td>
                                <td data-label="Size">
                                  {/* Sizes come from the catalogue, so a line can
                                      only be moved to a size that exists. */}
                                  {editable && sizes.length > 0 ? (
                                    <select
                                      className="evt-filter-select"
                                      value={l.size || ''}
                                      disabled={orderBusy === l.id}
                                      onChange={(e) => patchOrder({ lineId: l.id, size: e.target.value }, 'Size changed')}
                                    >
                                      {sizes.map((s) => (
                                        <option key={s.size} value={s.size}>{s.size} ({s.stock} left)</option>
                                      ))}
                                    </select>
                                  ) : (l.size || 'One size')}
                                </td>
                                <td data-label="Qty">
                                  {editable ? (
                                    <div className="ap-qty">
                                      <button
                                        type="button"
                                        disabled={l.quantity <= 1 || orderBusy === l.id}
                                        onClick={() => patchOrder({ lineId: l.id, quantity: l.quantity - 1 }, 'Quantity changed')}
                                        aria-label="One fewer"
                                      ><i className="fas fa-minus"></i></button>
                                      <span>{l.quantity}</span>
                                      <button
                                        type="button"
                                        disabled={orderBusy === l.id}
                                        onClick={() => patchOrder({ lineId: l.id, quantity: l.quantity + 1 }, 'Quantity changed')}
                                        aria-label="One more"
                                      ><i className="fas fa-plus"></i></button>
                                    </div>
                                  ) : l.quantity}
                                </td>
                                <td className="evt-nowrap" data-label="Price">{peso(l.unit_price)}</td>
                                <td className="evt-nowrap" data-label="Line"><strong>{peso(l.line_total)}</strong></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {isManager && (
                      <>
                        <div className="evt-plan-pick" style={{ marginTop: 16 }}>
                          <div className="evt-plan-head">Move this order along</div>
                          {APPAREL_STATUSES.map((s) => (
                            <button
                              key={s}
                              type="button"
                              className={`evt-plan-option ${orderOpen.status === s ? 'on' : ''}`}
                              disabled={orderBusy === orderOpen.id}
                              onClick={() => patchOrder({ id: orderOpen.id, status: s }, `Order is now ${APPAREL_STATUS_LABELS[s]}`)}
                            >
                              <i className={`fas ${APPAREL_STATUS_ICONS[s]}`}></i>
                              <span>
                                <strong style={{ textTransform: 'capitalize' }}>{APPAREL_STATUS_LABELS[s]}</strong>
                                <small>{APPAREL_STATUS_HINTS[s]}</small>
                              </span>
                            </button>
                          ))}
                        </div>

                        <label className="evt-toggle-row" style={{ marginTop: 12 }}>
                          <input
                            type="checkbox"
                            checked={!!orderOpen.is_paid}
                            onChange={(e) => patchOrder({ id: orderOpen.id, isPaid: e.target.checked }, e.target.checked ? 'Marked as paid' : 'Marked as unpaid')}
                          />
                          <span>Payment collected in person ({peso(orderOpen.total)})</span>
                        </label>
                      </>
                    )}
                  </div>
                  <div className="evt-modal-foot">
                    <button className="btn-secondary" onClick={() => setOrderOpen(null)}>Close</button>
                    {isManager && (
                      <button className="btn-primary" style={{ background: 'var(--danger)' }} onClick={() => deleteOrder(orderOpen)}>
                        <i className="fas fa-trash"></i> Delete Order
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ---- Proof of payment for one order ---- */}
            {orderProof && (
              <div className="evt-modal-overlay" onClick={() => setOrderProof(null)}>
                <div className="evt-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="evt-modal-head">
                    <div>
                      <h3>Proof of Payment</h3>
                      <p>{orderProof.order_no} · {formatPersonName(orderProof.ordered_by_name) || 'Committee member'}</p>
                    </div>
                    <button className="evt-modal-close" onClick={() => setOrderProof(null)}><i className="fas fa-times"></i></button>
                  </div>
                  <div className="evt-modal-body">
                    {/* The figures first, so the screenshot below can be
                        checked against something rather than just admired. */}
                    <dl className="evt-proof-list">
                      <div><dt>Paid Through</dt><dd>{orderProof.payment_method || '—'}</dd></div>
                      <div><dt>Reference</dt><dd className="evt-proof-ref">{orderProof.payment_reference || '—'}</dd></div>
                      <div><dt>Amount</dt><dd><strong>{peso(orderProof.total)}</strong></dd></div>
                      <div><dt>Placed</dt><dd>{formatDateTime(orderProof.created_at)}</dd></div>
                    </dl>

                    {orderProof.payment_proof_url ? (
                      <div className="evt-proof-image" style={{ marginTop: 14 }}>
                        {isImageProof(orderProof.payment_proof_url) ? (
                          <img src={orderProof.payment_proof_url} alt="Payment receipt" />
                        ) : (
                          <div className="evt-proof-file">
                            <i className={`fas ${isPdfProof(orderProof.payment_proof_url) ? 'fa-file-pdf' : 'fa-file-lines'}`}></i>
                            <strong>{proofFileName(orderProof.payment_proof_url)}</strong>
                            <small>This receipt is a file, not an image.</small>
                          </div>
                        )}
                        <a href={orderProof.payment_proof_url} target="_blank" rel="noreferrer" className="evt-proof-zoom">
                          <i className="fas fa-up-right-and-down-left-from-center"></i>
                          {isImageProof(orderProof.payment_proof_url) ? ' Open full size' : ' Open the file'}
                        </a>
                      </div>
                    ) : (
                      <div className="evt-proof-empty" style={{ marginTop: 14 }}>
                        <i className="fas fa-image"></i> No receipt was uploaded &mdash; this was paid in cash.
                      </div>
                    )}
                  </div>
                  <div className="evt-modal-foot">
                    <button className="btn-secondary" onClick={() => setOrderProof(null)}>Close</button>
                    {isManager && !orderProof.is_paid && (
                      <button
                        className="btn-primary"
                        onClick={async () => {
                          const ok = await patchOrder({ id: orderProof.id, isPaid: true }, 'Marked as paid');
                          if (ok) setOrderProof(null);
                        }}
                      >
                        <i className="fas fa-circle-check"></i> Mark as Paid
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ---- Adding / editing one garment ---- */}
            {itemForm && isManager && (
              <div className="evt-modal-overlay" onClick={() => !itemSaving && closeItemForm()}>
                <div className="evt-modal" onClick={(e) => e.stopPropagation()}>
                  <form onSubmit={saveItem}>
                    <div className="evt-modal-head">
                      <div>
                        <h3>{itemForm.id ? 'Edit Item' : 'Add Item'}</h3>
                        <p>Committee Apparel</p>
                      </div>
                      <button type="button" className="evt-modal-close" onClick={closeItemForm}><i className="fas fa-times"></i></button>
                    </div>
                    <div className="evt-modal-body">
                      {/* Pictures are what people actually shop by, so they
                          come first - and a garment needs more than one, since
                          the back of a jacket is half of what is being bought.
                          The label under each is what the store shows. */}
                      <div className="form-group">
                        <label>Pictures <em style={{ fontStyle: 'normal', fontWeight: 500, color: 'var(--text-muted, #999)' }}>({itemForm.images.length} of {MAX_APPAREL_IMAGES})</em></label>

                        {itemForm.images.length > 0 && (
                          <div className="ap-pics">
                            {itemForm.images.map((img, i) => (
                              <div className="ap-pic" key={img.key}>
                                <div className="ap-pic-shot">
                                  <img src={img.preview} alt={img.label || `Picture ${i + 1}`} />
                                  {i === 0 && <span className="ap-pic-main">Main</span>}
                                  <button
                                    type="button"
                                    className="ap-pic-zoom"
                                    title="See the whole picture"
                                    aria-label={`See picture ${i + 1} full size`}
                                    onClick={() => openLightbox(
                                      itemForm.images.map((x, n) => ({ url: x.preview, label: x.label || `Picture ${n + 1}` })),
                                      i,
                                      itemForm.name || 'This garment',
                                    )}
                                  ><i className="fas fa-expand"></i></button>
                                  <button
                                    type="button"
                                    className="ap-pic-drop"
                                    title="Remove this picture"
                                    onClick={() => dropItemImage(img.key)}
                                  ><i className="fas fa-xmark"></i></button>
                                </div>
                                <input
                                  className="form-control ap-pic-label"
                                  value={img.label}
                                  onChange={(e) => labelItemImage(img.key, e.target.value)}
                                  placeholder="Label"
                                  list="ap-label-suggestions"
                                />
                              </div>
                            ))}
                          </div>
                        )}

                        {/* The usual labels, offered rather than imposed - a
                            sleeve close-up is nobody's "Front". */}
                        <datalist id="ap-label-suggestions">
                          {APPAREL_IMAGE_LABELS.map((l) => <option key={l} value={l} />)}
                        </datalist>

                        {itemForm.images.length < MAX_APPAREL_IMAGES && (
                          <div className="ap-img-pick" style={{ marginTop: itemForm.images.length > 0 ? 12 : 0 }}>
                            <div className="ap-img-pick-preview"><i className="fas fa-images"></i></div>
                            <div style={{ flex: 1 }}>
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                className="form-control"
                                onChange={(e) => { addItemImages(e.target.files); e.target.value = ''; }}
                              />
                              <p className="evt-muted" style={{ fontSize: '0.78rem', margin: '6px 0 0' }}>
                                Square photos work best. Pick several at once &mdash; up to {MAX_APPAREL_IMAGES}.
                                The first one is what the store grid shows.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div className="form-group">
                          <label>Name *</label>
                          <input
                            className="form-control"
                            value={itemForm.name}
                            onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                            placeholder="e.g. Committee Jacket 2026"
                          />
                        </div>
                        <div className="form-group">
                          <label>Category</label>
                          <select
                            className="form-control"
                            value={itemForm.category}
                            onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}
                          >
                            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                            {/* A category is whatever the committee decides to
                                call a thing, so it can be named here. It comes
                                into being with the first item filed under it. */}
                            <option value="__new">+ New category…</option>
                          </select>
                          {itemForm.category === '__new' && (
                            <input
                              className="form-control"
                              style={{ marginTop: 8 }}
                              value={itemForm.newCategory}
                              onChange={(e) => setItemForm({ ...itemForm, newCategory: e.target.value })}
                              placeholder="e.g. Cap, Lanyard, Tumbler"
                              maxLength={40}
                              autoFocus
                            />
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div className="form-group">
                          <label>Price (PHP)</label>
                          <input
                            className="form-control"
                            inputMode="numeric"
                            value={itemForm.price}
                            onChange={(e) => setItemForm({ ...itemForm, price: e.target.value.replace(/[^\d.]/g, '') })}
                            placeholder="0"
                          />
                        </div>
                        <div className="form-group">
                          <label>Description</label>
                          <input
                            className="form-control"
                            value={itemForm.description}
                            onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                            placeholder="Fabric, colour, anything worth knowing"
                          />
                        </div>
                      </div>

                      {/* Sizes and their stock. No sizes at all means the item is
                          ordered as "One size" - an ID, a pin. */}
                      <div className="form-group">
                        <label>Sizes &amp; Stock</label>
                        {itemForm.sizes.length === 0 ? (
                          <>
                            <p className="evt-muted" style={{ fontSize: '0.8rem', margin: '0 0 8px' }}>
                              <i className="fas fa-circle-info"></i> No sizes &mdash; this is ordered as <b>One size</b>.
                            </p>
                            <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10, alignItems: 'center' }}>
                              <input
                                className="form-control"
                                inputMode="numeric"
                                value={itemForm.oneSizeStock}
                                onChange={(e) => setItemForm({ ...itemForm, oneSizeStock: e.target.value.replace(/\D/g, '') })}
                                placeholder="Stock"
                              />
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => setItemForm({ ...itemForm, sizes: [{ size: 'S', stock: 0 }, { size: 'M', stock: 0 }, { size: 'L', stock: 0 }] })}
                              >
                                <i className="fas fa-ruler"></i> Give it sizes instead
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="ap-size-head"><span>Size</span><span>Stock</span><span /></div>
                            <div className="ap-size-rows">
                              {itemForm.sizes.map((s, i) => (
                                <div className="ap-size-row" key={i}>
                                  <input
                                    className="form-control"
                                    value={s.size}
                                    onChange={(e) => setItemForm({
                                      ...itemForm,
                                      sizes: itemForm.sizes.map((row, x) => (x === i ? { ...row, size: e.target.value } : row)),
                                    })}
                                    placeholder="e.g. M"
                                  />
                                  <input
                                    className="form-control"
                                    inputMode="numeric"
                                    value={s.stock}
                                    onChange={(e) => setItemForm({
                                      ...itemForm,
                                      sizes: itemForm.sizes.map((row, x) => (x === i ? { ...row, stock: Number(e.target.value.replace(/\D/g, '')) || 0 } : row)),
                                    })}
                                    placeholder="0"
                                  />
                                  <button
                                    type="button"
                                    title="Remove this size"
                                    onClick={() => setItemForm({ ...itemForm, sizes: itemForm.sizes.filter((_, x) => x !== i) })}
                                  ><i className="fas fa-xmark"></i></button>
                                </div>
                              ))}
                            </div>
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ marginTop: 10 }}
                              onClick={() => setItemForm({ ...itemForm, sizes: [...itemForm.sizes, { size: '', stock: 0 }] })}
                            >
                              <i className="fas fa-plus"></i> Add a size
                            </button>
                          </>
                        )}
                      </div>

                      {/* What this garment may be paid with. The channels are
                          the church's own, from Mode of Payment - ticking one
                          here is what makes it appear at checkout. */}
                      <div className="form-group">
                        <label>Mode of Payment</label>
                        <div className="evt-addon-pick">
                          <div className="evt-addon-pick-head"><i className="fas fa-wallet"></i> Shown at checkout for this item</div>

                          <label className={`evt-addon-option ${itemForm.allowCash ? 'on' : ''}`}>
                            <input
                              type="checkbox"
                              checked={itemForm.allowCash}
                              onChange={(e) => setItemForm({ ...itemForm, allowCash: e.target.checked })}
                            />
                            <span className="evt-addon-option-text">
                              <strong>Cash</strong>
                              <small>Paid in person. No reference or receipt to upload.</small>
                            </span>
                            <span className="evt-addon-option-fee">
                              <span className="pm-logo pm-logo-sm" style={{ background: '#16a34a' }}><span><i className="fas fa-money-bill-wave"></i></span></span>
                            </span>
                          </label>

                          {itemForm.allowCash && (
                            <div className="form-group" style={{ margin: '10px 0 4px' }}>
                              <label>What to call it</label>
                              <input
                                className="form-control"
                                value={itemForm.cashLabel}
                                onChange={(e) => setItemForm({ ...itemForm, cashLabel: e.target.value })}
                                placeholder={DEFAULT_CASH_LABEL}
                                maxLength={60}
                              />
                            </div>
                          )}

                          {payChannels.length === 0 ? (
                            <p className="evt-muted" style={{ fontSize: '0.8rem', margin: '8px 0 0' }}>
                              <i className="fas fa-circle-info"></i> No channels are visible to payers yet. Add one under{' '}
                              <b>Mode of Payment</b> in the sidebar.
                            </p>
                          ) : payChannels.map((m) => {
                            const on = itemForm.paymentMethodIds.includes(String(m.id));
                            return (
                              <label key={m.id} className={`evt-addon-option ${on ? 'on' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={() => setItemForm({
                                    ...itemForm,
                                    paymentMethodIds: on
                                      ? itemForm.paymentMethodIds.filter((id) => id !== String(m.id))
                                      : [...itemForm.paymentMethodIds, String(m.id)],
                                  })}
                                />
                                <span className="evt-addon-option-text">
                                  <strong>{m.name}</strong>
                                  <small>
                                    {m.category === 'bank' ? 'Bank transfer' : 'Online payment'}
                                    {m.account_number ? ` · ${m.account_number}` : ''}
                                    {m.qr_url ? ' · has a QR' : ''}
                                    {' · receipt required'}
                                  </small>
                                </span>
                                <span className="evt-addon-option-fee">
                                  <span className="pm-logo pm-logo-sm" style={{ background: m.logo_url ? 'transparent' : (m.logo_color || '#1e3a8a') }}>
                                    {m.logo_url ? <img src={m.logo_url} alt="" /> : <span>{getPaymentInitials(m.name)}</span>}
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                        <p className="evt-muted" style={{ fontSize: '0.78rem', margin: '8px 0 0' }}>
                          <i className="fas fa-circle-info"></i> Need another account? Add it under{' '}
                          <button type="button" className="evt-mini-btn" onClick={() => { closeItemForm(); showSection('payment-methods'); }}>
                            <i className="fas fa-money-check-dollar"></i> Mode of Payment
                          </button>
                        </p>
                      </div>

                      <label className="evt-toggle-row">
                        <input
                          type="checkbox"
                          checked={itemForm.isActive}
                          onChange={(e) => setItemForm({ ...itemForm, isActive: e.target.checked })}
                        />
                        <span>Show this in the committee store</span>
                      </label>
                    </div>
                    <div className="evt-modal-foot">
                      <button type="button" className="btn-secondary" onClick={closeItemForm} disabled={itemSaving}>Cancel</button>
                      <button type="submit" className="btn-primary" disabled={itemSaving}>
                        <i className={`fas ${itemSaving ? 'fa-spinner fa-spin' : 'fa-save'}`}></i> {itemSaving ? 'Saving…' : (itemForm.id ? 'Save Item' : 'Add Item')}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </section>

          {/* ========== E-SIGNATURE ========== */}
          <section className={`content-section ${activeSection === 'signature' ? 'active' : ''}`}>
            <div className="um-hero">
              <div className="um-hero-bg"></div>
              <div className="um-hero-content">
                <h2 className="um-hero-title">E-Signature</h2>
                <p className="um-hero-sub">
                  Your printed name and the mark that goes above it. Once both are set, every receipt you
                  record is signed with them &mdash; nobody else&rsquo;s account can set or use your signature.
                </p>
              </div>
            </div>

            {sigError ? (
              <p className="events-empty-msg">
                <i className="fas fa-triangle-exclamation"></i> {sigError}
              </p>
            ) : sigLoading ? (
              <p className="events-empty-msg">Loading…</p>
            ) : (
              <div className="sig-layout">
                <div className="sig-steps">

                  {/* ---- Step one: the printed name ---- */}
                  <section className={`sig-step ${sigSaved.hasName ? 'done' : 'on'}`}>
                    <header className="sig-step-head">
                      <b>{sigSaved.hasName ? <i className="fas fa-check"></i> : 1}</b>
                      <div>
                        <h3>Full Name</h3>
                        <p>The name printed under the line. Type it the way it should appear on a document.</p>
                      </div>
                    </header>
                    <div className="sig-step-body">
                      <div className="form-group" style={{ marginBottom: 10 }}>
                        <label>Printed name *</label>
                        <input
                          className="form-control"
                          value={sigName}
                          onChange={(e) => setSigName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveSigName(); }}
                          placeholder="e.g. Ptr. Juan D. Dela Cruz"
                          maxLength={120}
                        />
                      </div>
                      <button
                        className="btn-primary"
                        onClick={saveSigName}
                        disabled={sigSaving || !sigName.trim() || sigName.trim() === sigSaved.signatureName}
                      >
                        <i className={`fas ${sigSaving ? 'fa-spinner fa-spin' : 'fa-check'}`}></i>{' '}
                        {sigSaved.hasName ? 'Update Name' : 'Save Name'}
                      </button>
                    </div>
                  </section>

                  {/* ---- Step two: the mark ----
                       Locked until there is a name, which is the order the
                       thing is actually assembled in: a mark with nothing
                       printed under it tells a reader nothing. */}
                  <section className={`sig-step ${!sigSaved.hasName ? 'locked' : sigSaved.signatureUrl ? 'done' : 'on'}`}>
                    <header className="sig-step-head">
                      <b>{sigSaved.signatureUrl ? <i className="fas fa-check"></i> : 2}</b>
                      <div>
                        <h3>Signature</h3>
                        <p>
                          {sigSaved.hasName
                            ? 'Sign with a finger, a stylus or the mouse — or upload a photo of your signature.'
                            : 'Save your printed name first.'}
                        </p>
                      </div>
                    </header>

                    {sigSaved.hasName && (
                      <div className="sig-step-body">
                        <div className="evt-view-toggle sig-modes">
                          <button className={sigMode === 'draw' ? 'on' : ''} onClick={() => { setSigMode('draw'); setSigPreview(null); }}>
                            <i className="fas fa-pen-nib"></i> Draw
                          </button>
                          <button className={sigMode === 'upload' ? 'on' : ''} onClick={() => { setSigMode('upload'); sigClear(); }}>
                            <i className="fas fa-image"></i> Upload
                          </button>
                        </div>

                        {sigMode === 'draw' ? (
                          <>
                            <div className="sig-pad">
                              <canvas
                                ref={sigCanvasRef}
                                className="sig-canvas"
                                onPointerDown={sigDown}
                                onPointerMove={sigMove}
                                onPointerUp={sigUp}
                                onPointerCancel={sigUp}
                              />
                              {/* The rule you sign on, and the hint above it.
                                  Both sit under the canvas so a stroke is never
                                  drawn over its own instructions. */}
                              <span className="sig-pad-rule"></span>
                              {!sigHasInk && <span className="sig-pad-hint">Sign here</span>}
                            </div>
                            <div className="sig-pad-actions">
                              <span className="sig-pad-note">
                                <i className="fas fa-circle-info"></i> Saved as WebP on a transparent
                                background, trimmed to your signature.
                              </span>
                              <span className="sig-pad-btns">
                                <button className="evt-mini-btn" onClick={sigUndo} disabled={!sigHasInk}>
                                  <i className="fas fa-rotate-left"></i> Undo
                                </button>
                                <button className="evt-mini-btn" onClick={sigClear} disabled={!sigHasInk}>
                                  <i className="fas fa-eraser"></i> Clear
                                </button>
                                <button className="btn-primary" onClick={() => saveSignature()} disabled={!sigHasInk || sigSaving}>
                                  <i className={`fas ${sigSaving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`}></i>{' '}
                                  {sigSaving ? 'Saving…' : 'Save Signature'}
                                </button>
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <label className="sig-drop">
                              <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => { pickSignatureFile(e.target.files?.[0]); e.target.value = ''; }}
                              />
                              {sigPreview ? (
                                <img src={sigPreview.url} alt="Your signature" />
                              ) : (
                                <>
                                  <i className="fas fa-cloud-arrow-up"></i>
                                  <b>Choose a photo of your signature</b>
                                  <em>Sign on white paper, photograph it square on, and pick it here.</em>
                                </>
                              )}
                            </label>
                            <label className="sig-knockout">
                              <input
                                type="checkbox"
                                checked={sigKnockout}
                                onChange={(e) => { setSigKnockout(e.target.checked); setSigPreview(null); }}
                              />
                              <span>
                                <b>Remove the paper behind it</b>
                                <em>Leaves only the ink, so the mark sits on the line instead of covering it. Turn off for a signature that already has a transparent background.</em>
                              </span>
                            </label>
                            <div className="sig-pad-actions">
                              <span className="sig-pad-note">
                                {sigPreview
                                  ? <><i className="fas fa-circle-check"></i> Converted to WebP &mdash; {Math.max(1, Math.round(sigPreview.bytes / 1024))}KB</>
                                  : <><i className="fas fa-circle-info"></i> Converted to WebP when you pick it.</>}
                              </span>
                              <span className="sig-pad-btns">
                                <button className="evt-mini-btn" onClick={() => setSigPreview(null)} disabled={!sigPreview}>
                                  <i className="fas fa-xmark"></i> Discard
                                </button>
                                <button className="btn-primary" onClick={() => saveSignature(sigPreview.file)} disabled={!sigPreview || sigSaving}>
                                  <i className={`fas ${sigSaving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`}></i>{' '}
                                  {sigSaving ? 'Saving…' : 'Save Signature'}
                                </button>
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </section>
                </div>

                {/* ---- The overview ----
                     The two halves put together, at the size a document prints
                     them. This is the whole point of the screen: a name and a
                     mark are each half of a signature block, and neither can be
                     judged on its own. */}
                <aside className="sig-overview">
                  <h3 className="sig-overview-title">
                    <i className="fas fa-file-signature"></i> Overview
                  </h3>
                  <p className="sig-overview-sub">How your signature block appears on a receipt.</p>

                  <div className="sig-block-frame">
                    <div className="sig-block">
                      {sigSaved.signatureUrl ? (
                        <img className="sig-block-mark" src={sigSaved.signatureUrl} alt="Your signature" />
                      ) : (
                        <span className="sig-block-empty">not signed yet</span>
                      )}
                      <span className="sig-block-rule"></span>
                      <b className="sig-block-name">{sigSaved.signatureName || sigName.trim() || 'Your printed name'}</b>
                      <em className="sig-block-label">SIGNATURE OVER PRINTED NAME</em>
                    </div>
                  </div>

                  <dl className="sig-facts">
                    <div>
                      <dt>Status</dt>
                      <dd className={sigSaved.signatureUrl ? 'ok' : 'wait'}>
                        <i className={`fas ${sigSaved.signatureUrl ? 'fa-circle-check' : 'fa-circle-half-stroke'}`}></i>{' '}
                        {sigSaved.signatureUrl ? 'Ready to sign' : sigSaved.hasName ? 'Name set, no mark yet' : 'Not set up'}
                      </dd>
                    </div>
                    <div>
                      <dt>Format</dt>
                      <dd>WebP, transparent, trimmed</dd>
                    </div>
                    {sigSaved.updatedAt && (
                      <div>
                        <dt>Last changed</dt>
                        <dd>{formatDateTime(sigSaved.updatedAt)}</dd>
                      </div>
                    )}
                  </dl>

                  {sigSaved.signatureUrl && (
                    <button className="evt-mini-btn danger sig-remove" onClick={removeSignature}>
                      <i className="fas fa-eraser"></i> Remove signature
                    </button>
                  )}

                  <p className="sig-privacy">
                    <i className="fas fa-lock"></i> Only you can set this. It is applied to receipts for
                    payments <b>you</b> recorded &mdash; never to anybody else&rsquo;s.
                  </p>
                </aside>
              </div>
            )}
          </section>

          {/* ========== MODE OF PAYMENT (Admins only) ========== */}
          {isManager && (
            <section className={`content-section ${activeSection === 'payment-methods' ? 'active' : ''}`}>
              <div className="pm-head">
                <h2 className="section-title">Mode of Payment</h2>
                <button className="pm-add-btn" onClick={() => openPmForm(null)}>
                  <i className="fas fa-plus"></i> Add Payment Method
                </button>
              </div>
              <p className="pm-subtitle">
                The same channels the main dashboard keeps &mdash; edited here or there, it is one list.
                These are the accounts members pay into for event fees and committee apparel. Each entry
                shows a circle logo with the bank name, account number and account name.
              </p>

              <div className="evt-tabs pm-tabs">
                {[
                  { key: 'all', label: 'All', icon: 'fas fa-list' },
                  { key: 'bank', label: 'Bank Transfers', icon: 'fas fa-building-columns' },
                  { key: 'online', label: 'Online Payments', icon: 'fas fa-mobile-screen-button' },
                ].map((t) => (
                  <button
                    key={t.key}
                    className={`evt-tab ${pmFilter === t.key ? 'active' : ''}`}
                    onClick={() => setPmFilter(t.key)}
                  >
                    <i className={t.icon}></i> {t.label}
                    <span className="pm-tab-count">
                      {t.key === 'all' ? pmList.length : pmList.filter((m) => m.category === t.key).length}
                    </span>
                  </button>
                ))}
              </div>

              {pmLoading ? (
                <p className="events-empty-msg"><i className="fas fa-spinner fa-spin"></i> Loading payment methods…</p>
              ) : (() => {
                const shown = pmFilter === 'all' ? pmList : pmList.filter((m) => m.category === pmFilter);
                if (shown.length === 0) {
                  return (
                    <div className="pm-empty">
                      <i className="fas fa-money-check-dollar"></i>
                      <p>No payment methods yet.</p>
                      <button className="pm-add-btn" onClick={() => openPmForm(null)}>
                        <i className="fas fa-plus"></i> Add your first one
                      </button>
                    </div>
                  );
                }
                return (
                  <div className="pm-grid">
                    {shown.map((m) => (
                      <div key={m.id} className={`pm-card ${m.is_active === false ? 'inactive' : ''}`}>
                        <span className={`pm-status ${m.is_active === false ? 'off' : 'on'}`}>
                          <i className={m.is_active === false ? 'fas fa-eye-slash' : 'fas fa-eye'}></i>
                          {m.is_active === false ? 'Hidden' : 'Visible'}
                        </span>

                        <div className="pm-card-top">
                          <div className="pm-logo" style={{ background: m.logo_url ? 'transparent' : (m.logo_color || '#1e3a8a') }}>
                            {m.logo_url
                              ? <img src={m.logo_url} alt={m.name} />
                              : <span>{getPaymentInitials(m.name)}</span>}
                          </div>
                          <div className="pm-card-title">
                            <h3>{m.name}</h3>
                            <span className={`pm-badge ${m.category}`}>
                              <i className={m.category === 'bank' ? 'fas fa-building-columns' : 'fas fa-mobile-screen-button'}></i>
                              {m.category === 'bank' ? 'Bank Transfer' : 'Online Payment'}
                            </span>
                          </div>
                        </div>

                        <dl className="pm-card-details">
                          <div className="pm-detail">
                            <dt>Account Number</dt>
                            <dd>
                              <span className="pm-detail-text">{m.account_number || '—'}</span>
                              {m.account_number && (
                                <button className="pm-icon-btn" title="Copy account number" onClick={() => copyPayDetail('Account number', m.account_number)}>
                                  <i className="fas fa-copy"></i>
                                </button>
                              )}
                            </dd>
                          </div>
                          <div className="pm-detail">
                            <dt>Account Name</dt>
                            <dd>
                              <span className="pm-detail-text">{m.account_name || '—'}</span>
                              {m.account_name && (
                                <button className="pm-icon-btn" title="Copy account name" onClick={() => copyPayDetail('Account name', m.account_name)}>
                                  <i className="fas fa-copy"></i>
                                </button>
                              )}
                            </dd>
                          </div>
                        </dl>

                        {m.qr_url && (
                          <button type="button" className="pm-qr-card" onClick={() => setQrLightbox({ url: m.qr_url, name: m.name })}>
                            <img src={m.qr_url} alt={`${m.name} QR code`} />
                            <span><strong>Scan to pay</strong><small>Tap to enlarge</small></span>
                          </button>
                        )}

                        {m.notes && <p className="pm-notes"><i className="fas fa-circle-info"></i> <span>{m.notes}</span></p>}

                        {/* Where this channel is in use. A used channel can be
                            hidden but never deleted, so the count doubles as
                            the reason the Delete button is a padlock. */}
                        {(() => {
                          const used = m.used_by_events || [];
                          const open = pmUsageOpen === m.id;
                          // How many garments in the store accept this
                          // channel - the other place a channel is in use.
                          const inStore = items.filter((it) => apparelIdList(it.payment_method_ids).includes(String(m.id))).length;
                          if (used.length === 0) {
                            return inStore > 0
                              ? <p className="pm-usage none"><i className="fas fa-shirt"></i> Accepted by {inStore} apparel item{inStore === 1 ? '' : 's'}</p>
                              : <p className="pm-usage none"><i className="fas fa-circle-check"></i> Not used by any event yet</p>;
                          }
                          return (
                            <div className={`pm-usage-box ${open ? 'open' : ''}`}>
                              <button type="button" className="pm-usage-toggle" onClick={() => setPmUsageOpen(open ? null : m.id)}>
                                <i className="fas fa-link"></i>
                                <span>Used by {used.length} event{used.length === 1 ? '' : 's'}{inStore > 0 ? ` · and ${inStore} apparel item${inStore === 1 ? '' : 's'}` : ''}</span>
                                <i className={`fas ${open ? 'fa-chevron-up' : 'fa-chevron-down'} pm-usage-chev`}></i>
                              </button>
                              {open && (
                                <ul className="pm-usage-list">
                                  {used.map((ev) => (
                                    <li key={ev.id}>
                                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px' }}>
                                        <i className="fas fa-calendar-day"></i>
                                        <span className="pm-usage-title">{ev.title || 'Untitled event'}</span>
                                        <span className="pm-usage-date">{ev.event_date ? formatEventDateTime(ev.event_date) : 'No date'}</span>
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          );
                        })()}

                        <div className="pm-card-actions">
                          <button className="pm-act" onClick={() => openPmForm(m)}><i className="fas fa-pen"></i> Edit</button>
                          <button className="pm-act" onClick={() => togglePaymentMethodActive(m)}>
                            <i className={m.is_active === false ? 'fas fa-eye' : 'fas fa-eye-slash'}></i>
                            {m.is_active === false ? ' Show' : ' Hide'}
                          </button>
                          <button
                            className={`pm-act danger ${(m.used_by_events || []).length > 0 ? 'locked' : ''}`}
                            onClick={() => deletePaymentMethod(m)}
                            title={(m.used_by_events || []).length > 0 ? 'In use by an event — hide it instead' : 'Delete this payment method'}
                          >
                            <i className={`fas ${(m.used_by_events || []).length > 0 ? 'fa-lock' : 'fa-trash'}`}></i>
                            {(m.used_by_events || []).length > 0 ? ' In use' : ' Delete'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* ---- Add / edit one channel ---- */}
              {pmForm && (
                <div className="pm-modal-overlay" onClick={closePmForm}>
                  <div className="pm-form pm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
                    <div className="pm-form-head">
                      <h3>
                        <i className={pmEditingId ? 'fas fa-pen' : 'fas fa-plus-circle'}></i>{' '}
                        {pmEditingId ? 'Edit Payment Method' : 'New Payment Method'}
                      </h3>
                      <button className="pm-icon-btn" onClick={closePmForm} title="Close">
                        <i className="fas fa-times"></i>
                      </button>
                    </div>

                    <div className="pm-form-body">
                      {/* Left rail: the circle exactly as payers will see it. */}
                      <aside className="pm-form-aside">
                        <div
                          className="pm-logo pm-logo-lg"
                          style={{ background: pmForm.logoUrl ? 'transparent' : (pmForm.logoColor || '#1e3a8a') }}
                        >
                          {pmForm.logoUrl
                            ? <img src={pmForm.logoUrl} alt={pmForm.name || 'Logo'} />
                            : <span>{getPaymentInitials(pmForm.name)}</span>}
                        </div>
                        <span className="pm-form-preview-label">Circle logo preview</span>

                        <div className="pm-upload-stack">
                          <label className={`pm-upload-btn ${pmLogoBusy ? 'busy' : ''}`}>
                            <input
                              type="file"
                              accept="image/*"
                              disabled={pmLogoBusy}
                              onChange={(e) => { pickPmLogo(e.target.files?.[0]); e.target.value = ''; }}
                            />
                            {pmLogoBusy
                              ? <><i className="fas fa-spinner fa-spin"></i> Working...</>
                              : <><i className="fas fa-cloud-arrow-up"></i> {pmForm.logoUrl ? 'Replace' : 'Upload Logo'}</>}
                          </label>
                          {pmForm.logoUrl && !pmLogoBusy && (
                            <div className="pm-upload-row">
                              <button type="button" className="pm-upload-clear" onClick={() => setPmForm((f) => ({ ...f, logoUrl: '' }))}>
                                <i className="fas fa-trash"></i> Remove
                              </button>
                            </div>
                          )}
                          <small className="pm-upload-hint">
                            Centred and squared into the circle, saved as <strong>.webp</strong>.
                            No logo? The initials are used instead.
                          </small>
                        </div>
                      </aside>

                      {/* Right: the fields, grouped so the eye reads top to bottom. */}
                      <div className="pm-form-main">
                        <fieldset className="pm-fieldset">
                          <legend>Channel</legend>
                          <div className="pm-row pm-row-2">
                            <label className="pm-field">
                              <span>Type</span>
                              <select value={pmForm.category} onChange={(e) => setPmForm((f) => ({ ...f, category: e.target.value }))}>
                                <option value="bank">Bank Transfer</option>
                                <option value="online">Online Payment</option>
                              </select>
                            </label>
                            <label className="pm-field">
                              <span>{pmForm.category === 'bank' ? 'Bank Name *' : 'Channel Name *'}</span>
                              <input
                                type="text"
                                value={pmForm.name}
                                placeholder={pmForm.category === 'bank' ? 'e.g. BDO, BPI, Maribank' : 'e.g. GCash, Maya, PayPal'}
                                onChange={(e) => setPmForm((f) => ({ ...f, name: e.target.value }))}
                              />
                            </label>
                          </div>
                        </fieldset>

                        <fieldset className="pm-fieldset">
                          <legend>Account Details</legend>
                          <div className="pm-row pm-row-2">
                            <label className="pm-field">
                              <span>Account Number</span>
                              <input
                                type="text"
                                value={pmForm.accountNumber}
                                placeholder="e.g. 0012 3456 7890"
                                onChange={(e) => setPmForm((f) => ({ ...f, accountNumber: e.target.value }))}
                              />
                            </label>
                            <label className="pm-field">
                              <span>Account Name</span>
                              <input
                                type="text"
                                value={pmForm.accountName}
                                placeholder="e.g. Joyful Sound Church International"
                                onChange={(e) => setPmForm((f) => ({ ...f, accountName: e.target.value }))}
                              />
                            </label>
                          </div>

                          <div className="pm-row pm-row-qr">
                            <div className="pm-field">
                              <span>QR Code (optional)</span>
                              <div className="pm-qr-picker">
                                <div className="pm-qr-thumb">
                                  {pmForm.qrUrl
                                    ? <img src={pmForm.qrUrl} alt="Payment QR code" onClick={() => setQrLightbox({ url: pmForm.qrUrl, name: pmForm.name })} />
                                    : <span className="pm-qr-empty"><i className="fas fa-qrcode"></i></span>}
                                </div>
                                <div className="pm-qr-controls">
                                  <label className={`pm-upload-btn ${pmQrBusy ? 'busy' : ''}`}>
                                    <input
                                      type="file"
                                      accept="image/*"
                                      disabled={pmQrBusy}
                                      onChange={(e) => { pickPmQr(e.target.files?.[0]); e.target.value = ''; }}
                                    />
                                    {pmQrBusy
                                      ? <><i className="fas fa-spinner fa-spin"></i> Working...</>
                                      : <><i className="fas fa-qrcode"></i> {pmForm.qrUrl ? 'Replace QR' : 'Upload QR'}</>}
                                  </label>
                                  {pmForm.qrUrl && !pmQrBusy && (
                                    <button type="button" className="pm-upload-clear" onClick={() => setPmForm((f) => ({ ...f, qrUrl: '' }))}>
                                      <i className="fas fa-trash"></i> Remove
                                    </button>
                                  )}
                                  <small className="pm-upload-hint">
                                    Screenshot of your GCash / Maya / InstaPay QR. Kept whole on a white
                                    plate and saved as <strong>.webp</strong> so it still scans.
                                  </small>
                                </div>
                              </div>
                            </div>
                          </div>

                          <label className="pm-field">
                            <span>Notes / Instructions (optional)</span>
                            <textarea
                              rows={2}
                              value={pmForm.notes}
                              placeholder="e.g. Please send the deposit slip to the church office."
                              onChange={(e) => setPmForm((f) => ({ ...f, notes: e.target.value }))}
                            />
                          </label>
                        </fieldset>

                        <fieldset className="pm-fieldset">
                          <legend>Appearance &amp; Visibility</legend>
                          <div className="pm-row pm-row-2">
                            <label className="pm-field">
                              <span>Circle Color <small>(used when there is no logo)</small></span>
                              <div className="pm-color-row">
                                <input
                                  type="color"
                                  value={pmForm.logoColor || '#1e3a8a'}
                                  onChange={(e) => setPmForm((f) => ({ ...f, logoColor: e.target.value }))}
                                />
                                <input
                                  type="text"
                                  value={pmForm.logoColor || ''}
                                  placeholder="#1e3a8a"
                                  onChange={(e) => setPmForm((f) => ({ ...f, logoColor: e.target.value }))}
                                />
                              </div>
                            </label>
                            <label className="pm-field">
                              <span>Display Order <small>(lower shows first)</small></span>
                              <input
                                type="number"
                                value={pmForm.sortOrder}
                                onChange={(e) => setPmForm((f) => ({ ...f, sortOrder: e.target.value }))}
                              />
                            </label>
                          </div>

                          <button
                            type="button"
                            className={`pm-switch ${pmForm.isActive ? 'on' : ''}`}
                            onClick={() => setPmForm((f) => ({ ...f, isActive: !f.isActive }))}
                            aria-pressed={pmForm.isActive}
                          >
                            <span className="pm-switch-track"><span className="pm-switch-knob"></span></span>
                            <span className="pm-switch-text">
                              <strong>{pmForm.isActive ? 'Visible to payers' : 'Hidden from payers'}</strong>
                              <small>
                                {pmForm.isActive
                                  ? 'Can be offered by an event and by the committee store.'
                                  : 'Kept here for reference but never offered to payers.'}
                              </small>
                            </span>
                          </button>
                        </fieldset>
                      </div>
                    </div>

                    <div className="pm-form-actions">
                      <button className="btn-secondary" onClick={closePmForm}>Cancel</button>
                      <button className="btn-primary" onClick={savePaymentMethod} disabled={pmSaving}>
                        {pmSaving
                          ? <><i className="fas fa-spinner fa-spin"></i> Saving...</>
                          : <><i className="fas fa-save"></i> {pmEditingId ? 'Save Changes' : 'Add Payment Method'}</>}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ========== COMMITTEE TEAM (Admins only) ========== */}
          {isManager && (
            <section className={`content-section ${activeSection === 'team' ? 'active' : ''}`}>
              <div className="um-hero">
                <div className="um-hero-bg"></div>
                <div className="um-hero-content">
                  <h2 className="um-hero-title">Committee Team</h2>
                  <p className="um-hero-sub">
                    Who may open this dashboard, and which events they work. Members sign in with their ordinary
                    SanctuaryHub account — there is no second password.
                  </p>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button className="um-hero-btn" onClick={() => { setTeamQuery(''); setTeamRole('all'); setTeamPage(1); setInviteOpen(true); }}>
                      <i className="fas fa-user-plus"></i> Add Member
                    </button>
                    <button
                      className="evt-hero-action ghost"
                      onClick={() => loadTeam(teamQuery.trim(), teamPage, teamPageSize, teamRole)}
                    >
                      <i className="fas fa-rotate"></i> Refresh
                    </button>
                  </div>
                </div>
              </div>

              {teamError ? (
                <p className="events-empty-msg">
                  <i className="fas fa-triangle-exclamation"></i> {teamError}
                </p>
              ) : (
                <>
                  {teamLoading && <p className="events-empty-msg">Loading…</p>}

                  {/* ---- The two halves of the committee ----
                      Who is on it, and what they have put in. Both are "the
                      committee" and neither is a sub-page of the other, so they
                      are tabs of one screen rather than two sidebar entries -
                      the sidebar answers what you are DOING, and this is one
                      job seen two ways. */}
                  <div className="evt-tabs">
                    <button
                      type="button"
                      className={`evt-tab ${teamTab === 'members' ? 'active' : ''}`}
                      onClick={() => setTeamTab('members')}
                    >
                      <i className="fas fa-users"></i> Committee members
                      {team.members.length > 0 && <span className="evt-tab-count">{team.members.length}</span>}
                    </button>
                    <button
                      type="button"
                      className={`evt-tab ${teamTab === 'contributions' ? 'active' : ''}`}
                      onClick={() => { setTeamTab('contributions'); setOpenContrib(null); }}
                    >
                      <i className="fas fa-hand-holding-dollar"></i> Committee Contribution
                      {contribs.length > 0 && <span className="evt-tab-count">{contribs.length}</span>}
                    </button>
                  </div>

                  {teamTab === 'members' && (
                  <>
                  {/* Somebody signed up through the committee page and is
                      waiting. Worth saying on the page; the list of them is in
                      the Add Member modal with everybody else. */}
                  {team.waiting.length > 0 && (
                    <p className="events-empty-msg" style={{ marginBottom: 16 }}>
                      <i className="fas fa-hourglass-half"></i>{' '}
                      <b>{team.waiting.length}</b> {team.waiting.length === 1 ? 'person has' : 'people have'} asked to join the committee.{' '}
                      <button
                        type="button"
                        className="evt-mini-btn ok"
                        onClick={() => { setTeamQuery(''); setTeamRole('all'); setTeamPage(1); setInviteOpen(true); }}
                      >
                        <i className="fas fa-user-plus"></i> Review them
                      </button>
                    </p>
                  )}

                  <div className="pm-head" style={{ margin: '4px 0 12px' }}>
                    <h2 className="section-title" style={{ margin: 0 }}>
                      Committee members {team.members.length > 0 && <span className="evt-tab-count">{team.members.length}</span>}
                    </h2>
                    <button className="pm-add-btn" onClick={() => { setTeamQuery(''); setTeamRole('all'); setTeamPage(1); setInviteOpen(true); }}>
                      <i className="fas fa-user-plus"></i> Add Member
                    </button>
                  </div>
                  {team.members.length === 0 ? (
                    <p className="events-empty-msg">
                      Nobody is on the committee yet. Use <b>Add Member</b> above to put the first person on it.
                    </p>
                  ) : (
                    <div className="evt-table-wrapper">
                      <table className="evt-table">
                        <thead>
                          <tr><th>Member</th><th>Account Role</th><th>Events &amp; Committee Roles</th><th>Tasks</th><th>Added</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                        </thead>
                        <tbody>
                          {team.members.map((p) => {
                            const scoped = (p.committee_events || []).length;
                            const held = rolesFor(p.id);
                            const own = tasksFor(p.id);
                            const openTaskCount = own.filter((tk) => tk.status === 'open' || tk.status === 'doing').length;
                            return (
                              <tr key={p.id} className={p.is_active === false ? 'um-row-deactivated' : ''}>
                                <td className="evt-cell-name evt-td-primary" data-label="Member">
                                  <div className="evt-cell-title">
                                    <div className="um-avatar" style={{ width: 36, height: 36, fontSize: '0.8rem' }}>
                                      {p.profile_picture
                                        ? <img src={p.profile_picture} alt="" />
                                        : <span>{initialsOf(p.firstname, p.lastname)}</span>}
                                    </div>
                                    <div>
                                      <div className="evt-cell-name">{formatPersonName(`${p.firstname} ${p.lastname}`)}</div>
                                      <div className="evt-cell-sub">{p.email}</div>
                                      {p.member_id && <div className="evt-cell-sub">{p.member_id}</div>}
                                    </div>
                                  </div>
                                </td>
                                {/* Their standing in the church - Guest, PAW,
                                    Song Leader - which is a different question
                                    from what they do on an event. */}
                                <td data-label="Account Role">
                                  <div className="ap-chips" style={{ margin: 0, gap: 5 }}>
                                    {accountRoleTags(p).map((tag) => <span className="um-role-pill" key={tag}>{tag}</span>)}
                                    {accountRoleTags(p).length === 0 && <span className="evt-cell-sub">—</span>}
                                  </div>
                                </td>
                                {/* What they were put on, and what they do there. */}
                                <td data-label="Events &amp; Committee Roles">
                                  {scoped === 0
                                    ? <span className="evt-status evt-status-registered">all events</span>
                                    : <span className="evt-status evt-status-installment">{scoped} event{scoped === 1 ? '' : 's'}</span>}
                                  {held.length > 0 ? (
                                    <div className="ap-lines" style={{ marginTop: 6 }}>
                                      {held.map((a) => {
                                        const evt = events.find((e) => String(e.id) === String(a.eventId));
                                        return (
                                          <span className="ap-line" key={a.eventId}>
                                            <b>{evt ? evt.title : 'Event'}</b>{' '}
                                            <em>{a.roles.join(', ') || 'no role set'}</em>
                                          </span>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <div className="evt-cell-sub" style={{ marginTop: 4 }}>No committee role set</div>
                                  )}
                                </td>
                                <td className="evt-nowrap" data-label="Tasks">
                                  {own.length === 0
                                    ? <span className="evt-cell-sub">none</span>
                                    : (
                                      <>
                                        <span className={`ap-status ${openTaskCount > 0 ? 'ap-status-pending' : 'ap-status-released'}`}>
                                          {openTaskCount > 0 ? `${openTaskCount} to do` : 'all done'}
                                        </span>
                                        <div className="evt-cell-sub">{own.length} in total</div>
                                      </>
                                    )}
                                </td>
                                <td className="evt-cell-sub" data-label="Added">{formatDateTime(p.committee_assigned_at)}</td>
                                <td className="evt-td-actions" data-label="Actions">
                                  <button className="evt-mini-btn" onClick={() => openScope(p)}>
                                    <i className="fas fa-list-check"></i> Assignments
                                  </button>
                                  <button className="evt-mini-btn ok" onClick={() => openTasks(p)}>
                                    <i className="fas fa-clipboard-list"></i> Tasks{openTaskCount > 0 ? ` (${openTaskCount})` : ''}
                                  </button>
                                  <button
                                    className="evt-mini-btn danger"
                                    onClick={() => askConfirm(
                                      `Remove ${formatPersonName(`${p.firstname} ${p.lastname}`)} from the Event Committee? Their main account is unchanged - they simply cannot open this dashboard any more.`,
                                      () => updateMember(p.id, { isCommittee: false }, 'Removed from the committee'),
                                      { title: 'Remove From Committee?', subtitle: 'Committee Team', confirmLabel: 'Remove', icon: 'fa-user-minus' },
                                    )}
                                  >
                                    <i className="fas fa-user-minus"></i> Remove
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  </>
                  )}

                  {/* ---- Committee contributions ----
                      The other half of this screen. A drive collects money
                      from the committee for a named purpose; a share is one
                      person's part of it; an instalment is money actually
                      handed over. Three levels, and the screen shows one at a
                      time so it is always clear which one is being changed. */}
                  {teamTab === 'contributions' && (
                    contribsError ? (
                      <p className="events-empty-msg">
                        <i className="fas fa-triangle-exclamation"></i> {contribsError}
                      </p>
                    ) : currentContrib ? (
                      <>
                        <div className="ctr-detail-head">
                          <button type="button" className="evt-mini-btn" onClick={() => { setOpenContrib(null); setOpenPayer(null); }}>
                            <i className="fas fa-arrow-left"></i> All contributions
                          </button>
                          <div className="ctr-detail-title">
                            <h3>{currentContrib.title}</h3>
                            {currentContrib.description && <p>{currentContrib.description}</p>}
                          </div>
                          <button className="pm-add-btn" onClick={() => openPayerForm(currentContrib)}>
                            <i className="fas fa-hand-holding-dollar"></i> Add Payment
                          </button>
                        </div>

                        {/* The three figures the drive turns on. Outstanding is
                            the headline because it is the only one that says
                            what is left to do. */}
                        <div className="evt-plan-summary big">
                          <div>
                            <span>To Collect</span>
                            <b>{peso(currentContrib.totals.expected)}</b>
                          </div>
                          <div>
                            <span>Collected</span>
                            <b>{peso(currentContrib.totals.collected)}</b>
                          </div>
                          <div className="bal">
                            <span>Outstanding</span>
                            <b>{peso(currentContrib.totals.balance)}</b>
                          </div>
                        </div>

                        {currentContrib.payers.length === 0 ? (
                          <p className="events-empty-msg">
                            Nobody is on this contribution yet. Use <b>Add Payment</b> above to put the first
                            person on it and record what they are down for.
                          </p>
                        ) : (
                          <div className="evt-table-wrapper">
                            <table className="evt-table ctr-table">
                              <thead>
                                <tr>
                                  <th>Member</th>
                                  <th>Plan</th>
                                  <th>Payment To Pay</th>
                                  <th>Paid</th>
                                  <th>Balance</th>
                                  <th>Last Payment</th>
                                  <th style={{ textAlign: 'right' }}>Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {currentContrib.payers.map((payer) => {
                                  const last = payer.payments[payer.payments.length - 1];
                                  const open = openPayer === payer.id;
                                  const pct = payer.amount_due > 0
                                    ? Math.min(100, Math.round((payer.paid / payer.amount_due) * 100))
                                    : 0;
                                  return (
                                    <Fragment key={payer.id}>
                                    <tr className={open ? 'ctr-row-open' : ''}>
                                      <td className="evt-cell-name evt-td-primary" data-label="Member">
                                        {formatPersonName(payer.payer_name)}
                                        {payer.payer_email && <div className="evt-cell-sub">{payer.payer_email}</div>}
                                      </td>
                                      <td data-label="Plan">
                                        <span className={`ctr-plan ${payer.plan}`}>
                                          <i className={`fas ${payer.plan === 'full' ? 'fa-money-bill-wave' : 'fa-calendar-day'}`}></i>
                                          {payer.plan === 'full' ? 'Paid In Full' : 'Installment'}
                                        </span>
                                      </td>
                                      <td className="evt-nowrap" data-label="Payment To Pay"><b>{peso(payer.amount_due)}</b></td>
                                      <td className="evt-nowrap" data-label="Paid">
                                        {peso(payer.paid)}
                                        {/* How far along, at a glance. A list of
                                            forty people is read by scanning this
                                            column, not by reading the figures. */}
                                        <div className="ctr-bar" title={`${pct}% paid`}>
                                          <span style={{ width: `${pct}%` }} className={payer.settled ? 'done' : ''}></span>
                                        </div>
                                      </td>
                                      <td className="evt-nowrap" data-label="Balance">
                                        {payer.settled
                                          ? <span className="ctr-settled"><i className="fas fa-circle-check"></i> Settled</span>
                                          : <b className="ctr-owed">{peso(payer.balance)}</b>}
                                      </td>
                                      <td data-label="Last Payment">
                                        {last ? (
                                          <>
                                            <div>{formatDateOnly(last.paid_on)}</div>
                                            <div className="evt-cell-sub">{peso(last.amount)} · {last.method_name || 'Cash'}</div>
                                          </>
                                        ) : <span className="evt-cell-sub">Nothing yet</span>}
                                      </td>
                                      <td className="evt-td-actions" data-label="Actions">
                                        {/* The history is only worth unfolding
                                            when there is one. */}
                                        {payer.payments.length > 0 && (
                                          <button
                                            type="button"
                                            className="evt-mini-btn"
                                            onClick={() => setOpenPayer(open ? null : payer.id)}
                                          >
                                            <i className={`fas fa-chevron-${open ? 'up' : 'down'}`}></i>{' '}
                                            {payer.payments.length} payment{payer.payments.length === 1 ? '' : 's'}
                                          </button>
                                        )}
                                        {!payer.settled && (
                                          <button
                                            type="button"
                                            className="evt-mini-btn ok"
                                            onClick={() => openPayerForm(currentContrib, payer)}
                                          >
                                            <i className="fas fa-plus"></i> Payment
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          className="evt-mini-btn danger"
                                          title={`Remove ${formatPersonName(payer.payer_name)} from this contribution`}
                                          aria-label={`Remove ${formatPersonName(payer.payer_name)} from this contribution`}
                                          onClick={() => removePayer(payer)}
                                        >
                                          <i className="fas fa-user-minus"></i>
                                        </button>
                                      </td>
                                    </tr>
                                      {/* ---- The instalments themselves ----
                                          A row of its own, which is the only
                                          place a full-width cell can go: a <td>
                                          with colSpan inside the row above would
                                          make that row fourteen columns wide.
                                          Below 1024px the table is a stack of
                                          cards and this becomes a card too, so
                                          .ctr-history-tr joins it to the one
                                          above rather than floating free of the
                                          name it belongs to. */}
                                      {open && (
                                        <tr className="ctr-history-tr">
                                        <td className="ctr-history-cell" colSpan={7}>
                                          <div className="ctr-history">
                                            <div className="ctr-history-head">
                                              <span>Date</span>
                                              <span>Amount</span>
                                              <span>Mode of Payment</span>
                                              <span></span>
                                            </div>
                                            {payer.payments.map((pmt) => (
                                              <div className="ctr-history-row" key={pmt.id}>
                                                <span className="ctr-history-date">{formatDateOnly(pmt.paid_on)}</span>
                                                <span className="ctr-history-amt">{peso(pmt.amount)}</span>
                                                <span className="ctr-history-mode">
                                                  <i className={`fas ${isCashMethod(pmt.method_name) ? 'fa-money-bill-wave' : 'fa-building-columns'}`}></i>
                                                  {pmt.method_name || 'Cash'}
                                                  {pmt.reference && <em>Ref {pmt.reference}</em>}
                                                </span>
                                                <span className="ctr-history-act">
                                                  {pmt.recorded_by_name && <em>by {formatPersonName(pmt.recorded_by_name)}</em>}
                                                  <button
                                                    type="button"
                                                    className="evt-mini-btn ctr-receipt-btn"
                                                    title={`Receipt No. ${pmt.receipt_no ? String(pmt.receipt_no).padStart(4, '0') : '—'}`}
                                                    onClick={() => openReceipt(currentContrib, payer, pmt)}
                                                  >
                                                    <i className="fas fa-receipt"></i> Receipt
                                                  </button>
                                                  <button
                                                    type="button"
                                                    className="evt-mini-btn danger"
                                                    title="Remove this payment"
                                                    aria-label="Remove this payment"
                                                    onClick={() => removePayment(pmt)}
                                                  >
                                                    <i className="fas fa-rotate-left"></i>
                                                  </button>
                                                </span>
                                              </div>
                                            ))}
                                            {/* The sum, and what it leaves. Said
                                                under the rows it is the sum of,
                                                because that is the check anybody
                                                reading a payment history is
                                                actually doing. */}
                                            <div className="ctr-history-foot">
                                              <span>
                                                Paid <b>{peso(payer.paid)}</b> of <b>{peso(payer.amount_due)}</b>
                                              </span>
                                              <span className={payer.settled ? 'ok' : 'owed'}>
                                                {payer.settled
                                                  ? 'Nothing left to pay'
                                                  : <>Remaining balance <b>{peso(payer.balance)}</b></>}
                                              </span>
                                            </div>
                                          </div>
                                        </td>
                                        </tr>
                                      )}
                                    </Fragment>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="pm-head" style={{ margin: '4px 0 12px' }}>
                          <h2 className="section-title" style={{ margin: 0 }}>
                            Contributions {contribs.length > 0 && <span className="evt-tab-count">{contribs.length}</span>}
                          </h2>
                          <button className="pm-add-btn" onClick={() => setContribForm({ ...CONTRIB_BLANK })}>
                            <i className="fas fa-plus"></i> Add Contribution
                          </button>
                        </div>

                        {contribs.length > 3 && (
                          <div className="evt-viewbar">
                            <div className="evt-search">
                              <i className="fas fa-magnifying-glass"></i>
                              <input
                                type="search"
                                value={contribSearch}
                                onChange={(e) => setContribSearch(e.target.value)}
                                placeholder="Search contributions"
                                aria-label="Search contributions"
                              />
                              {contribSearch && (
                                <button type="button" onClick={() => setContribSearch('')} title="Clear search"><i className="fas fa-xmark"></i></button>
                              )}
                            </div>
                          </div>
                        )}

                        {contribsLoading ? (
                          <p className="events-empty-msg">Loading…</p>
                        ) : visibleContribs.length === 0 ? (
                          <p className="events-empty-msg">
                            {contribSearch.trim()
                              ? <>No contribution matches &ldquo;{contribSearch.trim()}&rdquo;.</>
                              : <>Nothing is being collected yet. Use <b>Add Contribution</b> to start one &mdash; give it a
                                title and say what it is for, then put people on it.</>}
                          </p>
                        ) : (
                          <div className="ctr-grid">
                            {visibleContribs.map((c) => {
                              const pct = c.totals.expected > 0
                                ? Math.min(100, Math.round((c.totals.collected / c.totals.expected) * 100))
                                : 0;
                              return (
                                <article key={c.id} className="ctr-card">
                                  <button
                                    type="button"
                                    className="ctr-card-open"
                                    onClick={() => { setOpenContrib(c.id); setOpenPayer(null); }}
                                  >
                                    <h4>{c.title}</h4>
                                    {c.description
                                      ? <p>{c.description}</p>
                                      : <p className="ctr-card-nodesc">No description</p>}

                                    <div className="ctr-card-figures">
                                      <div><span>Collected</span><b>{peso(c.totals.collected)}</b></div>
                                      <div><span>To Collect</span><b>{peso(c.totals.expected)}</b></div>
                                      <div className={c.totals.balance > 0 ? 'owed' : 'ok'}>
                                        <span>Outstanding</span><b>{peso(c.totals.balance)}</b>
                                      </div>
                                    </div>

                                    <div className="ctr-bar big" title={`${pct}% collected`}>
                                      <span style={{ width: `${pct}%` }} className={c.totals.balance <= 0 && c.totals.expected > 0 ? 'done' : ''}></span>
                                    </div>

                                    <div className="ctr-card-meta">
                                      <span>
                                        <i className="fas fa-users"></i>{' '}
                                        {c.totals.payers} {c.totals.payers === 1 ? 'person' : 'people'}
                                      </span>
                                      {c.totals.payers > 0 && (
                                        <span>
                                          <i className="fas fa-circle-check"></i>{' '}
                                          {c.totals.settled} settled
                                        </span>
                                      )}
                                    </div>
                                  </button>

                                  <div className="ctr-card-actions">
                                    <button
                                      type="button"
                                      className="evt-mini-btn"
                                      onClick={() => setContribForm({ id: c.id, title: c.title, description: c.description || '' })}
                                    >
                                      <i className="fas fa-pen"></i> Edit
                                    </button>
                                    <button type="button" className="evt-mini-btn danger" onClick={() => removeContrib(c)}>
                                      <i className="fas fa-trash"></i> Delete
                                    </button>
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )
                  )}

                  {/* ---- What is being collected, and what for ---- */}
                  {contribForm && (
                    <div className="evt-modal-overlay" onClick={() => !contribSaving && setContribForm(null)}>
                      <div className="evt-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="evt-modal-head">
                          <div>
                            <h3>{contribForm.id ? 'Edit Contribution' : 'New Contribution'}</h3>
                            <p>Committee Contribution</p>
                          </div>
                          <button className="evt-modal-close" onClick={() => setContribForm(null)}><i className="fas fa-times"></i></button>
                        </div>
                        <div className="evt-modal-body">
                          <div className="form-group">
                            <label>Title *</label>
                            <input
                              className="form-control"
                              value={contribForm.title}
                              onChange={(e) => setContribForm({ ...contribForm, title: e.target.value })}
                              placeholder="e.g. Christmas Outreach Fund"
                              autoFocus
                            />
                          </div>
                          <div className="form-group">
                            <label>Description</label>
                            <textarea
                              className="form-control"
                              rows={3}
                              value={contribForm.description}
                              onChange={(e) => setContribForm({ ...contribForm, description: e.target.value })}
                              placeholder="What the money is for, and anything the committee should know before they pay."
                            />
                          </div>
                          <p className="evt-muted" style={{ fontSize: '0.8rem' }}>
                            <i className="fas fa-circle-info"></i> Nobody is charged by creating this. You put people on
                            it one at a time with <b>Add Payment</b>, which is where the amount and the plan are set.
                          </p>
                        </div>
                        <div className="evt-modal-foot">
                          <button className="btn-secondary" onClick={() => setContribForm(null)} disabled={contribSaving}>Cancel</button>
                          <button className="btn-primary" onClick={saveContrib} disabled={contribSaving}>
                            <i className={`fas ${contribSaving ? 'fa-spinner fa-spin' : 'fa-check'}`}></i>{' '}
                            {contribSaving ? 'Saving…' : (contribForm.id ? 'Save Changes' : 'Create Contribution')}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ---- Add Payment ----
                      Two jobs, one dialog. Opening somebody's share asks who,
                      how much and on what plan; adding to a share that exists
                      asks only for the money, because the rest was settled the
                      first time. */}
                  {payerForm && (
                    <div className="evt-modal-overlay" onClick={() => !payerSaving && setPayerForm(null)}>
                      <div className="evt-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="evt-modal-head">
                          <div>
                            <h3>{payerForm.payerId ? 'Add Installment' : 'Add Payment'}</h3>
                            <p>{payerForm.payerId ? formatPersonName(payerForm.payerLabel) : (currentContrib?.title || 'Committee Contribution')}</p>
                          </div>
                          <button className="evt-modal-close" onClick={() => setPayerForm(null)}><i className="fas fa-times"></i></button>
                        </div>

                        <div className="evt-modal-body">
                          {/* ---- Who ---- */}
                          {!payerForm.payerId && (
                            <div className="form-group evt-church-field">
                              <label>User *</label>
                              <input
                                className="form-control"
                                value={payerForm.userId
                                  ? formatPersonName(payerForm.payerLabel)
                                  : payerForm.userQuery}
                                onChange={(e) => {
                                  // Typing after somebody was picked starts the
                                  // search again rather than editing the name
                                  // of a person who is already chosen.
                                  setPayerForm({ ...payerForm, userId: '', payerLabel: '', userQuery: e.target.value });
                                  setPayerPickOpen(true);
                                }}
                                onFocus={() => setPayerPickOpen(true)}
                                onBlur={() => setTimeout(() => setPayerPickOpen(false), 160)}
                                placeholder="Search committee members by name or email"
                              />
                              {payerForm.userId && (
                                <button
                                  type="button"
                                  className="ctr-clear-user"
                                  title="Choose somebody else"
                                  onClick={() => { setPayerForm({ ...payerForm, userId: '', payerLabel: '', userQuery: '' }); setPayerPickOpen(true); }}
                                >
                                  <i className="fas fa-xmark"></i>
                                </button>
                              )}
                              {payerPickOpen && !payerForm.userId && (
                                <ul className="evt-church-list">
                                  {payerPool.length === 0 ? (
                                    <li className="ctr-pick-empty">
                                      {(team.members || []).length === 0
                                        ? 'Nobody is on the committee yet — add members first.'
                                        : 'Everybody on the committee is already on this contribution.'}
                                    </li>
                                  ) : payerPool.map((m) => (
                                    <li key={m.id}>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setPayerForm((f) => ({
                                            ...f,
                                            userId: m.id,
                                            payerLabel: `${m.firstname} ${m.lastname}`.trim(),
                                            userQuery: '',
                                          }));
                                          setPayerPickOpen(false);
                                        }}
                                      >
                                        <span>
                                          {formatPersonName(`${m.firstname} ${m.lastname}`)}
                                          <small>{m.email}</small>
                                        </span>
                                        {m.member_id && <em>{m.member_id}</em>}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}

                          {/* ---- How much, and how ---- */}
                          {payerForm.payerId ? (
                            <div className="evt-plan-summary big">
                              <div><span>Payment To Pay</span><b>{peso(payerPreview.due)}</b></div>
                              <div><span>Paid So Far</span><b>{peso(payerPreview.paid)}</b></div>
                              <div className="bal"><span>Balance</span><b>{peso(Math.max(0, payerPreview.due - payerPreview.paid))}</b></div>
                            </div>
                          ) : (
                            <>
                              <div className="form-group">
                                <label>Payment to Pay *</label>
                                <div className="evt-prefix-input">
                                  <span>₱</span>
                                  <input
                                    inputMode="numeric"
                                    value={payerForm.amountDue}
                                    onChange={(e) => setPayerForm({ ...payerForm, amountDue: onlyDigits(e.target.value) })}
                                    placeholder="0"
                                  />
                                </div>
                              </div>

                              {/* Settling it now, or over time. Two cards
                                  rather than a dropdown: it changes what the
                                  rest of the dialog asks for, and a change that
                                  big should be visible without opening it. */}
                              <div className="form-group">
                                <label>How are they paying? *</label>
                                <div className="evt-type-choice">
                                  <button
                                    type="button"
                                    className={`ctr-plan-option ${payerForm.plan === 'full' ? 'on' : ''}`}
                                    onClick={() => setPayerForm({ ...payerForm, plan: 'full' })}
                                  >
                                    <i className="fas fa-money-bill-wave"></i>
                                    <b>Paid In Full</b>
                                    <em>The whole amount, now</em>
                                  </button>
                                  <button
                                    type="button"
                                    className={`ctr-plan-option ${payerForm.plan === 'installment' ? 'on' : ''}`}
                                    onClick={() => setPayerForm({ ...payerForm, plan: 'installment' })}
                                  >
                                    <i className="fas fa-calendar-day"></i>
                                    <b>Installment</b>
                                    <em>Part now, the rest later</em>
                                  </button>
                                </div>
                              </div>
                            </>
                          )}

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <div className="form-group">
                              <label>
                                {payerForm.payerId ? 'Payment *' : (payerForm.plan === 'full' ? 'Payment' : 'Payment now')}
                              </label>
                              <div className="evt-prefix-input">
                                <span>₱</span>
                                <input
                                  inputMode="numeric"
                                  value={payerForm.plan === 'full' && !payerForm.payerId ? payerForm.amountDue : payerForm.amount}
                                  onChange={(e) => setPayerForm({ ...payerForm, amount: onlyDigits(e.target.value) })}
                                  // Paid in full IS the whole amount. Letting
                                  // the two differ is how a share ends up
                                  // marked settled for less than it is worth.
                                  disabled={payerForm.plan === 'full' && !payerForm.payerId}
                                  placeholder="0"
                                />
                              </div>
                            </div>
                            <div className="form-group">
                              <label>Date {payerForm.plan === 'installment' || payerForm.payerId ? 'of this payment' : 'paid'}</label>
                              <input
                                type="date"
                                className="form-control"
                                value={payerForm.paidOn}
                                onChange={(e) => setPayerForm({ ...payerForm, paidOn: e.target.value })}
                              />
                            </div>
                          </div>

                          {/* ---- Through what ----
                              The channels an Admin set up in Mode of Payment,
                              plus Cash. Nothing is hard-coded: adding Maribank
                              on that screen puts it in this list. */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <div className="form-group">
                              <label>Mode of Payment *</label>
                              <select
                                className="form-control"
                                value={payerForm.methodId || `name:${payerForm.methodName}`}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v.startsWith('name:')) {
                                    setPayerForm({ ...payerForm, methodId: '', methodName: v.slice(5) });
                                  } else {
                                    const picked = contribMethods.find((m) => m.id === v);
                                    setPayerForm({ ...payerForm, methodId: v, methodName: picked?.name || '' });
                                  }
                                }}
                              >
                                {contribMethods.map((m) => (
                                  <option key={m.id || `name:${m.name}`} value={m.id || `name:${m.name}`}>{m.name}</option>
                                ))}
                              </select>
                              {pmList.length === 0 && (
                                <div className="evt-cell-sub" style={{ marginTop: 6 }}>
                                  Only Cash so far — add GCash, Maya or a bank under <b>Mode of Payment</b>.
                                </div>
                              )}
                            </div>
                            <div className="form-group">
                              <label>Reference (optional)</label>
                              <input
                                className="form-control"
                                value={payerForm.reference}
                                onChange={(e) => setPayerForm({ ...payerForm, reference: e.target.value })}
                                placeholder={isCashMethod(payerForm.methodName) ? 'Receipt no.' : 'Transaction ref'}
                              />
                            </div>
                          </div>

                          <div className="form-group">
                            <label>Note (optional)</label>
                            <input
                              className="form-control"
                              value={payerForm.note}
                              onChange={(e) => setPayerForm({ ...payerForm, note: e.target.value })}
                              placeholder="e.g. handed over at the Sunday meeting"
                            />
                          </div>

                          {/* The arithmetic, as it will be once this is saved.
                              Live, because it is the number somebody is
                              checking against the cash in their hand. */}
                          <p className="evt-muted" style={{ fontSize: '0.82rem' }}>
                            <i className="fas fa-circle-info"></i>{' '}
                            {payerForm.plan === 'full' && !payerForm.payerId ? (
                              <>Records <b>{peso(payerPreview.due)}</b> as paid in full — nothing left to collect.</>
                            ) : (
                              <>
                                Remaining balance after this payment:{' '}
                                <b>{peso(payerPreview.after)}</b>
                                {payerPreview.after <= 0 && payerPreview.now > 0 && ' — this settles their share.'}
                              </>
                            )}
                          </p>
                        </div>

                        <div className="evt-modal-foot">
                          <button className="btn-secondary" onClick={() => setPayerForm(null)} disabled={payerSaving}>Cancel</button>
                          <button className="btn-primary" onClick={submitPayer} disabled={payerSaving}>
                            <i className={`fas ${payerSaving ? 'fa-spinner fa-spin' : 'fa-check'}`}></i>{' '}
                            {payerSaving ? 'Saving…' : (payerForm.payerId ? 'Record Installment' : 'Add Payment')}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}


                  {/* ---- The receipt ----
                       Rendered into document.body rather than where it sits in
                       the tree, and for one reason: printing. The browser
                       prints the PAGE, and this dialog lives six levels inside
                       a dashboard with a sidebar, a hero and a table around it.
                       Hiding all of that with `visibility: hidden` leaves the
                       space it occupied, so the slip comes out on page four of
                       a stack of blanks. As a direct child of <body> it is one
                       rule - hide body's other children - and the receipt is
                       the whole document. */}
                  {receipt && typeof document !== 'undefined' && createPortal(
                    <div className="rcpt-print-root">
                      <div className="evt-modal-overlay" onClick={() => setReceipt(null)}>
                        <div className="evt-modal rcpt-modal" onClick={(e) => e.stopPropagation()}>
                          <div className="evt-modal-head">
                            <div>
                              <h3><i className="fas fa-receipt"></i> Receipt</h3>
                              <p>{receipt.contribution.title}</p>
                            </div>
                            <button className="evt-modal-close" onClick={() => setReceipt(null)}><i className="fas fa-times"></i></button>
                          </div>

                          <div className="evt-modal-body rcpt-body">
                            {/* Everything on this slip is filled in from the
                                payment that was recorded. The one blank left is
                                the signature, which is the only part a piece of
                                software has no business writing. */}
                            <div className="rcpt-sheet">
                              <header className="rcpt-brand">
                                <img src="/assets/LOGO.png" alt="" />
                                <div>
                                  <b>Joyful Sound Church</b>
                                  <span>International</span>
                                </div>
                              </header>

                              <h4 className="rcpt-title">RECEIPT</h4>

                              <div className="rcpt-topline">
                                <span className="rcpt-no">
                                  NO.<b>{receipt.number}</b>
                                </span>
                                <span className="rcpt-dateline">
                                  <em>DATE:</em>
                                  <u>{formatDateOnly(receipt.payment.paid_on)}</u>
                                </span>
                              </div>

                              <p className="rcpt-line rcpt-indent">
                                <em>RECEIVED from</em>
                                <u>{formatPersonName(receipt.payer.payer_name)}</u>
                              </p>

                              {/* Twice, as a receipt always says it: the words
                                  are what counts if a figure is ever argued
                                  over. */}
                              <p className="rcpt-line">
                                <em>the sum of pesos</em>
                                <u>{amountInWords(receipt.payment.amount)}</u>
                                <em className="rcpt-paren">(P</em>
                                <u className="rcpt-figure">
                                  {Number(receipt.payment.amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </u>
                              </p>

                              <p className="rcpt-line">
                                <em>as payment for</em>
                                <u>
                                  {receipt.contribution.title}
                                  {receipt.payment.method_name ? ` — paid through ${receipt.payment.method_name}` : ''}
                                  {receipt.payment.reference ? ` (Ref ${receipt.payment.reference})` : ''}
                                </u>
                              </p>

                              <div className="rcpt-foot">
                                {/* PAID on its own line with PARTIAL and the
                                    balance under it, which is how the printed
                                    pad reads: the balance belongs to PARTIAL,
                                    and putting all three on one row makes it
                                    look like it belongs to both. */}
                                <div className="rcpt-marks">
                                  {/* Which box is ticked is not a choice
                                      anybody makes at the desk - it is what the
                                      arithmetic says. Settled by this payment
                                      is PAID; anything left is PARTIAL, and the
                                      balance beside it is the balance AS OF
                                      this payment, not today's. An old slip
                                      must still read the way it read when it
                                      was handed over. */}
                                  <span className={`rcpt-check ${receipt.settled ? 'on' : ''}`}>
                                    <i className="rcpt-box">{receipt.settled && <b>&#10003;</b>}</i>
                                    PAID
                                  </span>
                                  <span className="rcpt-marks-row">
                                    <span className={`rcpt-check ${receipt.settled ? '' : 'on'}`}>
                                      <i className="rcpt-box">{!receipt.settled && <b>&#10003;</b>}</i>
                                      PARTIAL
                                    </span>
                                    <span className="rcpt-balance">
                                      <em>BALANCE</em>
                                      <u>{peso(receipt.balanceAfter)}</u>
                                    </span>
                                  </span>
                                </div>
                                {/* The signature of whoever TOOK the money,
                                    not of whoever is printing the slip. It
                                    arrives with the payment - see the signer
                                    lookup in the contributions route - so a
                                    receipt reprinted next year still carries
                                    the mark of the person who received it.

                                    No signature set means the line stays
                                    blank, to be signed by hand. That is the
                                    same receipt, not a broken one. */}
                                <div className={`rcpt-sign ${receipt.payment.signature_url ? 'signed' : ''}`}>
                                  {receipt.payment.signature_url && (
                                    <img
                                      className="rcpt-mark"
                                      src={receipt.payment.signature_url}
                                      alt=""
                                    />
                                  )}
                                  <u></u>
                                  {receipt.payment.signature_url && receipt.payment.signature_name && (
                                    <b className="rcpt-printed">{receipt.payment.signature_name}</b>
                                  )}
                                  <em>SIGNATURE</em>
                                </div>
                              </div>
                            </div>

                            {/* Not part of the slip - said on screen, for
                                whoever is about to hand it over. */}
                            <p className="rcpt-note">
                              <i className="fas fa-circle-info"></i>{' '}
                              Receipt <b>No. {receipt.number}</b> was issued when this payment was recorded
                              {receipt.payment.recorded_by_name ? <> by <b>{formatPersonName(receipt.payment.recorded_by_name)}</b></> : null}.
                              The number never changes and is never given to another payment.
                            </p>
                          </div>

                          <div className="evt-modal-foot">
                            <button className="btn-secondary" onClick={() => setReceipt(null)}>Close</button>
                            <button className="btn-primary" onClick={() => window.print()}>
                              <i className="fas fa-print"></i> Print Receipt
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>,
                    document.body,
                  )}

                </>
              )}

              {/* ---- Add a member: every account that is not on the committee ----
                  A modal rather than a second table on the page, so the page
                  answers one question - who IS on the committee - and adding
                  somebody is a deliberate act rather than a stray click. */}
              {inviteOpen && (
                <div className="evt-modal-overlay" onClick={() => setInviteOpen(false)}>
                  <div className="evt-modal ap-picker" onClick={(e) => e.stopPropagation()}>
                    <div className="evt-modal-head">
                      <div>
                        <h3>Add a Committee Member</h3>
                        <p>{team.searching ? `${team.matchesTotal} match${team.matchesTotal === 1 ? '' : 'es'}` : `${team.matchesTotal} account${team.matchesTotal === 1 ? '' : 's'} not on the committee`}</p>
                      </div>
                      <button className="evt-modal-close" onClick={() => setInviteOpen(false)}><i className="fas fa-times"></i></button>
                    </div>

                    <div className="evt-modal-body">
                      <p className="evt-muted" style={{ fontSize: '0.82rem', margin: '0 0 12px' }}>
                        <i className="fas fa-circle-info"></i> Adding somebody lets them open this dashboard with the
                        account they already have &mdash; there is no invitation to accept and no second password.
                      </p>

                      {/* Stays put while the list scrolls under it: on a long
                          list the search is what you reach for after scrolling,
                          not before. */}
                      <div className="ap-picker-bar">
                        <div className="evt-search">
                          <i className="fas fa-magnifying-glass"></i>
                          <input
                            type="search"
                            value={teamQuery}
                            onChange={(e) => setTeamQuery(e.target.value)}
                            placeholder="Search accounts by name or email"
                            aria-label="Search accounts"
                            autoFocus
                          />
                          {teamQuery && (
                            <button type="button" onClick={() => setTeamQuery('')} title="Clear search"><i className="fas fa-xmark"></i></button>
                          )}
                        </div>
                        <select
                          className="evt-filter-select"
                          value={teamRole}
                          onChange={(e) => setTeamRole(e.target.value)}
                          aria-label="Filter accounts by role"
                        >
                          <option value="all">All roles</option>
                          {(team.roles || []).map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                        {teamPoolLoading && (
                          <span className="evt-filter-count"><i className="fas fa-spinner fa-spin"></i></span>
                        )}
                        {(teamRole !== 'all' || teamQuery.trim().length >= 2) && (
                          <span className="evt-filter-count">
                            {team.matchesTotal}
                            <button type="button" onClick={() => { setTeamQuery(''); setTeamRole('all'); }} title="Clear filters"><i className="fas fa-xmark"></i></button>
                          </span>
                        )}
                      </div>

                      {/* Whoever asked to join through the committee signup
                          page comes first - they are already waiting. */}
                      {!team.searching && team.waiting.length > 0 && (
                        <>
                          <h4 style={{ margin: '0 0 8px', fontSize: '0.86rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary, #6c757d)' }}>
                            Waiting to be added
                          </h4>
                          <div className="evt-table-wrapper" style={{ marginBottom: 18 }}>
                            <table className="evt-table">
                              <thead>
                                <tr><th>Account</th><th>Asked</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                              </thead>
                              <tbody>
                                {team.waiting.map((p) => (
                                  <tr key={p.id}>
                                    <td className="evt-cell-name evt-td-primary" data-label="Account">
                                      {formatPersonName(`${p.firstname} ${p.lastname}`)}
                                      <div className="evt-cell-sub">{p.email}</div>
                                    </td>
                                    <td className="evt-cell-sub evt-nowrap" data-label="Asked">{formatDateTime(p.committee_requested_at)}</td>
                                    <td className="evt-td-actions" data-label="Actions">
                                      <button className="evt-mini-btn ok" onClick={() => updateMember(p.id, { isCommittee: true }, 'Added to the committee')}>
                                        <i className="fas fa-user-check"></i> Add
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}

                      <h4 style={{ margin: '0 0 8px', fontSize: '0.86rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary, #6c757d)' }}>
                        {team.searching ? 'Search results' : (teamRole === 'all' ? 'All accounts' : `${teamRole} accounts`)}
                      </h4>

                      {team.matches.length === 0 ? (
                        <p className="events-empty-msg">
                          {(teamLoading || teamPoolLoading) ? 'Loading…' : (team.searching
                            ? `No account matches “${teamQuery.trim()}”${teamRole !== 'all' ? ` with the ${teamRole} role` : ''}.`
                            : (teamRole !== 'all'
                              ? `No account with the ${teamRole} role is left to add.`
                              : 'Everybody with an account is already on the committee.'))}
                        </p>
                      ) : (
                        <>
                          <div className="evt-table-wrapper">
                            <table className="evt-table">
                              <thead>
                                <tr><th>Account</th><th>Role</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                              </thead>
                              <tbody>
                                {team.matches.map((p) => {
                                  // A deactivated account cannot sign in at
                                  // all, so putting it on the committee would
                                  // change nothing - the server ignores the
                                  // flag while the account is off.
                                  const off = p.is_active === false;
                                  return (
                                    <tr key={p.id} className={off ? 'um-row-deactivated' : ''}>
                                      <td className="evt-cell-name evt-td-primary" data-label="Account">
                                        <div className="evt-cell-title">
                                          <div className="um-avatar" style={{ width: 36, height: 36, fontSize: '0.8rem' }}>
                                            {p.profile_picture
                                              ? <img src={p.profile_picture} alt="" />
                                              : <span>{initialsOf(p.firstname, p.lastname)}</span>}
                                          </div>
                                          <div>
                                            <div className="evt-cell-name">{formatPersonName(`${p.firstname} ${p.lastname}`)}</div>
                                            <div className="evt-cell-sub">{p.email}</div>
                                            {p.member_id && <div className="evt-cell-sub">{p.member_id}</div>}
                                          </div>
                                        </div>
                                      </td>
                                      <td data-label="Role"><span className="um-role-pill">{p.role || 'Guest'}</span></td>
                                      <td data-label="Status">
                                        {off
                                          ? <span className="evt-status evt-status-cancelled">deactivated</span>
                                          : (p.committee_requested_at
                                            ? <span className="evt-status evt-status-payment_submitted">asked to join</span>
                                            : <span className="evt-cell-sub">—</span>)}
                                      </td>
                                      <td className="evt-td-actions" data-label="Actions">
                                        <button
                                          className="evt-mini-btn ok"
                                          disabled={off}
                                          title={off ? 'This account is deactivated - reactivate it in User Management first' : ''}
                                          onClick={() => updateMember(p.id, { isCommittee: true }, 'Added to the committee')}
                                        >
                                          <i className="fas fa-user-plus"></i> Add to Committee
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          {team.matchesTotal > teamPageSize && (
                            <TablePager
                              page={teamPage} pageSize={teamPageSize} total={team.matchesTotal}
                              onPage={setTeamPage} onSize={setTeamPageSize} label="accounts"
                            />
                          )}
                        </>
                      )}
                    </div>

                    <div className="evt-modal-foot">
                      <button className="btn-secondary" onClick={() => setInviteOpen(false)}>Done</button>
                    </div>
                  </div>
                </div>
              )}

              {/* ---- Which events one member works, and what they do there ---- */}
              {scopeFor && (
                <div className="evt-modal-overlay" onClick={() => !scopeSaving && setScopeFor(null)}>
                  <div className="evt-modal ap-picker" onClick={(e) => e.stopPropagation()}>
                    <div className="evt-modal-head">
                      <div>
                        <h3>Event Assignments &amp; Roles</h3>
                        <p>{formatPersonName(`${scopeFor.firstname} ${scopeFor.lastname}`)}</p>
                      </div>
                      <button className="evt-modal-close" onClick={() => setScopeFor(null)}><i className="fas fa-times"></i></button>
                    </div>
                    <div className="evt-modal-body">
                      <p className="evt-muted" style={{ fontSize: '0.82rem', marginBottom: 14 }}>
                        <i className="fas fa-circle-info"></i> Tick the events this person works, then say what they do on
                        each &mdash; one person can hold several roles on the same event. Ticking <b>nothing</b> lets them
                        work every event, with no particular role.
                      </p>

                      {events.length === 0 ? (
                        <p className="events-empty-msg">No events to assign yet.</p>
                      ) : events.map((evt) => {
                        const id = String(evt.id);
                        const on = scopePick.includes(id);
                        const held = rolePick[id] || [];
                        return (
                          <div className="ap-assign" key={evt.id}>
                            <label className={`evt-addon-option ${on ? 'on' : ''}`} style={{ marginBottom: on ? 10 : 0 }}>
                              <input type="checkbox" checked={on} onChange={() => toggleScopeEvent(id)} />
                              <span className="evt-addon-option-text">
                                <strong>{evt.title}</strong>
                                <small>{formatEventSpan(evt.event_date, evt.end_date)}</small>
                              </span>
                              <span className="evt-addon-option-fee">{eventStatusOf(evt).label}</span>
                            </label>

                            {/* The roles only matter for an event they are
                                actually on, so they appear with the tick. */}
                            {on && (
                              <div className="ap-assign-roles">
                                <div className="ap-chips" style={{ marginBottom: 8 }}>
                                  {committeeRoles.map((role) => (
                                    <button
                                      type="button"
                                      key={role}
                                      className={`ap-chip ${held.some((r) => r.toLowerCase() === role.toLowerCase()) ? 'on' : ''}`}
                                      onClick={() => toggleRole(id, role)}
                                    >
                                      {held.some((r) => r.toLowerCase() === role.toLowerCase())
                                        ? <i className="fas fa-check"></i>
                                        : <i className="fas fa-plus"></i>} {role}
                                    </button>
                                  ))}
                                </div>

                                {/* A role the committee has just invented. It
                                    is offered on every other event from here. */}
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  <input
                                    className="form-control"
                                    style={{ flex: '1 1 180px' }}
                                    value={newRole[id] || ''}
                                    onChange={(e) => setNewRole((prev) => ({ ...prev, [id]: e.target.value }))}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNewRole(id); } }}
                                    placeholder="Another role — e.g. Stage Manager"
                                    maxLength={40}
                                  />
                                  <button type="button" className="btn-secondary" onClick={() => addNewRole(id)}>
                                    <i className="fas fa-plus"></i> Add Role
                                  </button>
                                </div>

                                <p className="evt-muted" style={{ fontSize: '0.78rem', margin: '8px 0 0' }}>
                                  {held.length === 0
                                    ? 'No role yet — they can work this event but nothing says what they do.'
                                    : `On this event: ${held.join(', ')}.`}
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      <p className="evt-muted" style={{ fontSize: '0.8rem', marginTop: 14 }}>
                        {scopePick.length === 0
                          ? 'Currently: every event, no particular role.'
                          : `Currently: ${scopePick.length} event${scopePick.length === 1 ? '' : 's'}.`}
                      </p>
                    </div>
                    <div className="evt-modal-foot">
                      <button className="btn-secondary" onClick={() => setScopeFor(null)} disabled={scopeSaving}>Cancel</button>
                      <button className="btn-primary" onClick={saveScope} disabled={scopeSaving}>
                        <i className={`fas ${scopeSaving ? 'fa-spinner fa-spin' : 'fa-check'}`}></i> {scopeSaving ? 'Saving…' : 'Save Assignments'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ---- Tasks for one member ---- */}
              {taskFor && taskForm && (
                <div className="evt-modal-overlay" onClick={() => !taskSaving && setTaskFor(null)}>
                  <div className="evt-modal ap-picker" onClick={(e) => e.stopPropagation()}>
                    <div className="evt-modal-head">
                      <div>
                        <h3>Tasks</h3>
                        <p>{formatPersonName(`${taskFor.firstname} ${taskFor.lastname}`)}</p>
                      </div>
                      <button className="evt-modal-close" onClick={() => setTaskFor(null)}><i className="fas fa-times"></i></button>
                    </div>
                    <div className="evt-modal-body">
                      {/* Assigning one comes first: this modal is opened to
                          give somebody something to do. */}
                      <form onSubmit={submitTask} className="ap-task-form">
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 12 }}>
                          <div className="form-group">
                            <label>Task *</label>
                            <input
                              className="form-control"
                              value={taskForm.title}
                              onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                              placeholder="e.g. Man the registration table from 8am"
                              maxLength={160}
                            />
                          </div>
                          <div className="form-group">
                            <label>Due (optional)</label>
                            <input
                              type="date"
                              className="form-control"
                              value={taskForm.dueAt}
                              onChange={(e) => setTaskForm({ ...taskForm, dueAt: e.target.value })}
                            />
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 12 }}>
                          <div className="form-group">
                            <label>Details (optional)</label>
                            <input
                              className="form-control"
                              value={taskForm.details}
                              onChange={(e) => setTaskForm({ ...taskForm, details: e.target.value })}
                              placeholder="Anything they need to know to do it"
                              maxLength={1000}
                            />
                          </div>
                          <div className="form-group">
                            <label>Event (optional)</label>
                            <select
                              className="form-control"
                              value={taskForm.eventId}
                              onChange={(e) => setTaskForm({ ...taskForm, eventId: e.target.value })}
                            >
                              <option value="">Not about one event</option>
                              {events.map((evt) => <option key={evt.id} value={evt.id}>{evt.title}</option>)}
                            </select>
                          </div>
                        </div>
                        <button type="submit" className="btn-primary" disabled={taskSaving}>
                          <i className={`fas ${taskSaving ? 'fa-spinner fa-spin' : 'fa-plus'}`}></i> {taskSaving ? 'Assigning…' : 'Assign Task'}
                        </button>
                      </form>

                      <h4 style={{ margin: '20px 0 8px', fontSize: '0.86rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary, #6c757d)' }}>
                        Assigned so far
                      </h4>

                      {tasksFor(taskFor.id).length === 0 ? (
                        <p className="events-empty-msg">Nothing assigned yet.</p>
                      ) : (
                        <div className="evt-table-wrapper">
                          <table className="evt-table">
                            <thead>
                              <tr><th>Task</th><th>Event</th><th>Due</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                            </thead>
                            <tbody>
                              {tasksFor(taskFor.id).map((tk) => {
                                const evt = events.find((e) => String(e.id) === String(tk.event_id));
                                const overdue = tk.due_at && tk.status !== 'done' && tk.status !== 'cancelled'
                                  && new Date(tk.due_at) < new Date();
                                return (
                                  <tr key={tk.id}>
                                    <td className="evt-cell-name evt-td-primary" data-label="Task">
                                      {tk.title}
                                      {tk.details && <div className="evt-cell-sub">{tk.details}</div>}
                                      {tk.created_by_name && <div className="evt-cell-sub">by {formatPersonName(tk.created_by_name)}</div>}
                                    </td>
                                    <td data-label="Event">
                                      {evt ? evt.title : <span className="evt-cell-sub">—</span>}
                                    </td>
                                    <td className="evt-nowrap" data-label="Due">
                                      {tk.due_at
                                        ? (
                                          <span className={overdue ? 'evt-inst-due' : ''}>
                                            {new Date(tk.due_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                            {overdue && <div className="evt-cell-sub">overdue</div>}
                                          </span>
                                        )
                                        : <span className="evt-cell-sub">—</span>}
                                    </td>
                                    <td className="evt-nowrap" data-label="Status">
                                      <select
                                        className="evt-filter-select"
                                        value={tk.status}
                                        disabled={taskBusy === tk.id}
                                        onChange={(e) => patchTask(tk.id, { status: e.target.value }, `Task is now ${TASK_STATUS_LABELS[e.target.value]}`)}
                                      >
                                        {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
                                      </select>
                                      <div style={{ marginTop: 4 }}>
                                        <span className={`ap-status ${TASK_STATUS_PILL[tk.status]}`}>{TASK_STATUS_LABELS[tk.status]}</span>
                                      </div>
                                    </td>
                                    <td className="evt-td-actions" data-label="Actions">
                                      <button className="evt-mini-btn danger" onClick={() => deleteTask(tk)}>
                                        <i className="fas fa-trash"></i> Delete
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                    <div className="evt-modal-foot">
                      <button className="btn-secondary" onClick={() => setTaskFor(null)}>Done</button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}
          {/* Fullscreen QR so it can actually be scanned off the screen */}
          {qrLightbox && (
            <div className="pm-qr-lightbox" onClick={() => setQrLightbox(null)}>
              <div className="pm-qr-lightbox-inner" onClick={(e) => e.stopPropagation()}>
                <div className="pm-qr-lightbox-head">
                  <strong><i className="fas fa-qrcode"></i> {qrLightbox.name || 'Payment'} QR</strong>
                  <button className="pm-icon-btn" onClick={() => setQrLightbox(null)} title="Close"><i className="fas fa-times"></i></button>
                </div>
                <img src={qrLightbox.url} alt="Payment QR code" />
                <p>Open your payment app, scan this code, then keep the receipt.</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
