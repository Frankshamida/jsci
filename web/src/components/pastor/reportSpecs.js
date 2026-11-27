// The Pastor's reports, as files. Each report is one exportDoc `spec` (title,
// meta, columns, rows), so the PDF, the Word file and the spreadsheet always
// say the same thing. Browser only.

import { buildPdf, loadLogoJpeg } from '@/lib/pdfWriter';
import { buildXlsx, buildDocx, downloadBlob, safeFilename } from '@/lib/exportDoc';
import { peso } from '@/lib/giving';

const TZ = 'Asia/Manila';
const day = (ymd, opts) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
const at = (iso, opts) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, ...opts });
const longDate = (ymd) => day(ymd, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const shortDate = (ymd) => day(ymd, { month: 'short', day: 'numeric', year: 'numeric' });
const stamp = (by) => `Generated ${at(new Date().toISOString(), { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}${by ? ` by ${by}` : ''}`;

export const FORMATS = [
  { id: 'pdf', label: 'PDF', ext: 'pdf' },
  { id: 'docx', label: 'Word', ext: 'docx' },
  { id: 'xlsx', label: 'Excel', ext: 'xlsx' },
];

let logo; // undefined: not tried yet; null: tried, none
export async function saveReport(spec, format, nameParts) {
  let blob;
  if (format === 'pdf') {
    if (logo === undefined) logo = await loadLogoJpeg().catch(() => null);
    blob = buildPdf(spec, logo);
  } else if (format === 'docx') blob = buildDocx(spec);
  else blob = buildXlsx(spec);
  const ext = FORMATS.find((f) => f.id === format)?.ext || format;
  downloadBlob(blob, `${safeFilename(...nameParts)}.${ext}`);
}

// ---- Sunday lineup: who serves and what is sung ----
export function lineupSpec(sunday, by) {
  const s = sunday.lineup.sheet;
  const rows = [];
  const add = (part, who, fill) => rows.push({ part, who: who || '—', ...(fill ? { _fill: fill } : {}) });
  add('Song leader', s.songLeader);
  add('Backup singers', s.backupSingers.join(', '));
  s.musicians.forEach((m) => add(m.instrument, m.names.join(', ')));
  add('Dancers', s.dancers.join(', '));
  add('Practice', s.practice || 'Not set');
  s.slowSongs.forEach((t, i) => add(i === 0 ? 'Slow songs' : '', `${i + 1}. ${t}`, 'F4EDDC'));
  s.fastSongs.forEach((t, i) => add(i === 0 ? 'Fast songs' : '', `${i + 1}. ${t}`, 'FFF7D6'));
  if (!s.slowSongs.length && !s.fastSongs.length) add('Songs', 'No songs picked yet');
  return {
    title: 'Sunday Service Lineup',
    subtitle: `${longDate(sunday.date)} · ${sunday.time}`,
    meta: [['Ready', `${sunday.lineup.ready} of ${sunday.lineup.total}`]],
    columns: [{ key: 'part', label: 'Part', width: 28 }, { key: 'who', label: 'Who / Song', width: 72 }],
    rows,
    count: rows.length,
    orientation: 'portrait',
    footNote: stamp(by),
  };
}

// ---- Care list: who to reach this week ----
// From Joyful Cares (needs follow-up, watch, in care), then new accounts and
// birthdays.
const CARE_GROUPS = [
  { status: 'follow', label: 'Needs follow-up', fill: 'FDE4D8' },
  { status: 'care', label: 'In care', fill: 'E3EBFF' },
  { status: 'watch', label: 'Watch', fill: 'FFF3C4' },
];
export function careSpec(care, cares, today, by) {
  const rows = [];
  const flagged = cares?.flagged || [];
  CARE_GROUPS.forEach((g) => flagged.filter((p) => p.status === g.status).forEach((p) => rows.push({
    group: g.label, name: p.name, ministry: (p.ministries || []).join(', '),
    details: [
      ...(p.flags || []),
      g.status === 'care' && p.assignedName ? `with ${p.assignedName}` : null,
      g.status === 'care' && p.followUpOn ? `follow up by ${shortDate(p.followUpOn)}` : null,
    ].filter(Boolean).join('; '),
    _fill: g.fill,
  })));
  care.newPeople.forEach((p) => rows.push({
    group: 'New account', name: p.name, ministry: p.ministry || '',
    details: [p.role || 'Guest', `joined ${shortDate(dateOf(p.joined))}`, p.verified ? '' : 'not verified yet'].filter(Boolean).join(' · '),
    _fill: 'F4EDDC',
  }));
  care.birthdays.forEach((p) => rows.push({
    group: 'Birthday', name: p.name, ministry: p.ministry || '', details: day(p.on, { weekday: 'long', month: 'short', day: 'numeric' }), _fill: 'E6F4EC',
  }));
  const t = cares?.totals;
  return {
    title: 'Care List',
    subtitle: `Week of ${longDate(today)}`,
    meta: [
      ['Needs follow-up', t ? String(t.follow) : '—'],
      ['In care', t ? String(t.care) : '—'],
      ['Watch', t ? String(t.watch) : '—'],
      ['New accounts', `${care.newCount} in the last ${care.newDays} days`],
      ['Birthdays', `${care.birthdays.length} in the next 7 days`],
    ],
    columns: [
      { key: 'group', label: 'Why', width: 18 }, { key: 'name', label: 'Name', width: 22 },
      { key: 'ministry', label: 'Ministry', width: 18 }, { key: 'details', label: 'Details', width: 42 },
    ],
    legend: [
      ...CARE_GROUPS.map((g) => ({ color: g.fill, label: g.label, count: flagged.filter((p) => p.status === g.status).length })),
      { color: 'F4EDDC', label: 'New account', count: care.newPeople.length },
      { color: 'E6F4EC', label: 'Birthday', count: care.birthdays.length },
    ],
    rows,
    orientation: 'portrait',
    footNote: `${stamp(by)}. Personal information: keep this file within the pastoral team.`,
  };
}

// ---- Sunday check-ins, 12 weeks ----
export function checkinsSpec(attendance, by) {
  const weeks = attendance.weeks || [];
  const recorded = weeks.filter((w) => w.count > 0);
  const avg = recorded.length ? Math.round(recorded.reduce((s, w) => s + w.count, 0) / recorded.length) : 0;
  const rows = weeks.map((w, i) => {
    const prev = weeks[i - 1];
    const change = prev && prev.count > 0 && w.count > 0 ? w.count - prev.count : null;
    return {
      sunday: day(w.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
      count: w.count > 0 ? String(w.count) : 'None recorded',
      change: change == null ? '' : change > 0 ? `+${change}` : String(change),
    };
  });
  rows.push({ sunday: 'Average (Sundays with check-ins)', count: String(avg), change: '', _fill: 'F4EDDC' });
  return {
    title: 'Sunday Check-ins',
    subtitle: weeks.length ? `${shortDate(weeks[0].date)} to ${shortDate(weeks[weeks.length - 1].date)}` : '',
    meta: [['Counts', 'Ministry app (GPS), RFID card and attendance marked by hand']],
    columns: [
      { key: 'sunday', label: 'Sunday', width: 50 }, { key: 'count', label: 'Checked in', align: 'right', width: 25 },
      { key: 'change', label: 'Change', align: 'right', width: 25 },
    ],
    rows,
    count: weeks.length,
    orientation: 'portrait',
    footNote: stamp(by),
  };
}

// ---- Donations: confirmed gifts, donor names included ----
export function donationsSpec(result, by) {
  const total = result.gifts.reduce((s, g) => s + g.amount, 0);
  const rows = result.gifts.map((g) => ({
    date: at(g.at, { month: 'short', day: 'numeric', year: 'numeric' }),
    receipt: g.receipt,
    donor: g.anonymous ? `${g.donor} (gave anonymously)` : g.donor,
    for: g.drive ? `${g.fund} · ${g.drive}` : g.fund,
    method: g.method,
    reference: g.reference,
    amount: peso(g.amount),
  }));
  rows.push({ date: 'Total', receipt: '', donor: `${result.gifts.length} gift${result.gifts.length === 1 ? '' : 's'}`, for: '', method: '', reference: '', amount: peso(total), _fill: 'F4EDDC' });
  return {
    title: 'Donations Report',
    subtitle: `${result.scopeLabel} · ${result.periodLabel}`,
    meta: [['Gifts', 'Confirmed only'], ['Total', peso(total)], ['Number of gifts', String(result.gifts.length)]],
    columns: [
      { key: 'date', label: 'Date', width: 13 }, { key: 'receipt', label: 'Receipt', width: 14 },
      { key: 'donor', label: 'Donor', width: 20 }, { key: 'for', label: 'For', width: 20 },
      { key: 'method', label: 'Method', width: 11 }, { key: 'reference', label: 'Reference', width: 12 },
      { key: 'amount', label: 'Amount', align: 'right', width: 12 },
    ],
    rows,
    count: result.gifts.length,
    orientation: 'landscape',
    footNote: `${stamp(by)}. Names who gave: keep this file private.`,
  };
}

function dateOf(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
