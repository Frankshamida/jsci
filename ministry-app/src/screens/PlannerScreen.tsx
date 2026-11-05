// ============================================================
// Schedule Plotter: the month's lineups (plot, edit, remove), and the
// excuses, substitute requests and swaps waiting for a decision.
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { useSession } from '../session';
import type { StackProps } from '../routes';
import { useDialog } from '../dialog';
import { Avatar, Banner, Button, Card, Chip, EmptyState, Icon, LoadingView, Screen, type IconName } from '../components';
import { font, fonts, makeStyles, partColor, radius, space, tint, useTheme } from '../theme';
import { dayOfMonth, firstName, longDate, parseYmd, relativeDay, shortDate, weekday, ymd } from '../utils';
import {
  INSTRUMENTS, allPeople, monthLabel, plannerApi, plannerChanged, shiftMonth, shortNamer, takePlannerFlash, useApprovals,
  usePlannerMonth, waitingCount, type ApprovalKind, type DecidedItem, type PendingRequest, type PendingSwap, type PlannerLineup,
} from '../planner';

type Tab = 'lineups' | 'approvals';

const monthAbbr = (d: string) => parseYmd(d).toLocaleDateString('en-US', { month: 'short' }).toUpperCase();

export default function PlannerScreen({ route, navigation }: StackProps<'Planner'>) {
  const { home, refresh } = useSession();
  const today = home?.today || ymd(new Date());
  const [tab, setTab] = useState<Tab>(route.params?.tab || 'lineups');
  const [month, setMonth] = useState(route.params?.month || today.slice(0, 7));
  const [flash, setFlash] = useState<string | null>(null);
  const plan = usePlannerMonth(month);
  const approvals = useApprovals();

  // Opened again with other params (from a notice, or after saving).
  useEffect(() => {
    if (route.params?.tab) setTab(route.params.tab);
    if (route.params?.month) setMonth(route.params.month);
  }, [route.params?.tab, route.params?.month]);

  // Back from the editor: show what changed, and fetch what it changed.
  const { load: loadMonth } = plan;
  const { load: loadApprovals } = approvals;
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    const message = takePlannerFlash();
    if (message) setFlash(message);
    if (firstFocus.current) { firstFocus.current = false; return; }
    loadMonth();
    loadApprovals();
  }, [loadMonth, loadApprovals]));

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  const waiting = approvals.data ? waitingCount(approvals.data) : home?.pendingApprovals || 0;

  // Nothing at all yet: one calm screen.
  if (!plan.anyData && !approvals.data) {
    if (plan.error && !plan.loading) {
      return (
        <Screen stacked center>
          <EmptyState icon="circle-exclamation" title="Could not open the plotter" text={plan.error} />
          <Button title="Try again" icon="rotate-right" onPress={plan.reload} />
        </Screen>
      );
    }
    return <LoadingView message="Opening the plotter…" />;
  }

  const reloadAll = () => Promise.all([plan.reload(), approvals.reload()]);

  return (
    <Screen stacked onRefresh={reloadAll}>
      <Segmented
        value={tab}
        onChange={setTab}
        items={[
          { key: 'lineups', label: 'Lineups', icon: 'calendar-days' },
          { key: 'approvals', label: 'Approvals', icon: 'list-check', count: waiting },
        ]}
      />
      {flash && <Banner tone="success" text={flash} />}

      {tab === 'lineups'
        ? <LineupsTab month={month} setMonth={setMonth} today={today} plan={plan} onEdit={(scheduleId) => navigation.navigate('LineupEditor', { scheduleId })}
            onPlot={(date) => navigation.navigate('LineupEditor', date ? { date } : {})} onChanged={(m) => { setFlash(m); refresh(true); }} />
        : <ApprovalsTab today={today} approvals={approvals} onChanged={(m) => { setFlash(m); refresh(true); }} />}
    </Screen>
  );
}

// ---- A pill switch between the two halves ----

function Segmented<T extends string>({ value, onChange, items }: {
  value: T; onChange: (v: T) => void; items: { key: T; label: string; icon: IconName; count?: number }[];
}) {
  const { colors: c } = useTheme();
  const s = useStyles();
  return (
    <View style={s.seg} accessibilityRole="tablist">
      {items.map((it) => {
        const on = it.key === value;
        const body = (
          <>
            <Icon name={it.icon} size={13} color={on ? c.onGold : c.textSecondary} />
            <Text style={[s.segText, on && s.segTextOn]}>{it.label}</Text>
            {!!it.count && (
              <View style={[s.segCount, on && s.segCountOn]}><Text style={[s.segCountText, on && s.segCountTextOn]}>{it.count > 99 ? '99+' : it.count}</Text></View>
            )}
          </>
        );
        return (
          <Pressable key={it.key} onPress={() => onChange(it.key)} style={s.segItem} accessibilityRole="tab" accessibilityState={{ selected: on }}>
            {on
              ? <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.segInner}>{body}</LinearGradient>
              : <View style={s.segInner}>{body}</View>}
          </Pressable>
        );
      })}
    </View>
  );
}

// ---- Lineups ----

function LineupsTab({ month, setMonth, today, plan, onEdit, onPlot, onChanged }: {
  month: string; setMonth: (m: string) => void; today: string; plan: ReturnType<typeof usePlannerMonth>;
  onEdit: (scheduleId: string) => void; onPlot: (date?: string) => void; onChanged: (message: string) => void;
}) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const dialog = useDialog();
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const data = plan.data;
  const thisMonth = today.slice(0, 7);
  const namer = useMemo(() => shortNamer(allPeople(plan.anyData)), [plan.anyData]);

  const lineups = (data?.lineups || []).filter((l) => !removed.has(l.scheduleId));
  const byDate = new Map(lineups.map((l) => [l.date, l]));
  const dates = [...new Set([...(data?.sundays || []), ...lineups.map((l) => l.date)])].sort();

  const remove = async (l: PlannerLineup) => {
    const ok = await dialog.confirm({
      icon: 'trash-can', tone: 'danger', title: 'Remove this lineup?',
      message: `${longDate(l.date)} will have no lineup. ${l.songCount ? `Its ${l.songCount} songs go with it.` : ''}`.trim(),
      confirmText: 'Remove', cancelText: 'Keep it',
    });
    if (!ok) return;
    setBusy(l.scheduleId);
    setRemoved((prev) => new Set(prev).add(l.scheduleId)); // gone at once; back if it fails
    const res = await plannerApi.remove(l.scheduleId);
    setBusy(null);
    if (!res.ok) {
      setRemoved((prev) => { const next = new Set(prev); next.delete(l.scheduleId); return next; });
      dialog.alert({ icon: 'circle-exclamation', tone: 'danger', title: 'Could not remove it', message: res.message });
      return;
    }
    plannerChanged();
    plan.reload().then(() => setRemoved(new Set()));
    onChanged(`The lineup for ${longDate(l.date)} was removed.`);
  };

  const plotted = dates.filter((d) => byDate.has(d)).length;

  return (
    <>
      <View style={s.monthRow}>
        <Pressable onPress={() => setMonth(shiftMonth(month, -1))} hitSlop={10} style={s.monthArrow} accessibilityRole="button" accessibilityLabel="Previous month">
          <Icon name="chevron-left" size={15} color={c.goldText} />
        </Pressable>
        <View style={s.monthMid}>
          <Text style={s.monthText}>{monthLabel(month)}</Text>
          {month === thisMonth
            ? <View style={s.thisMonth}><Text style={s.thisMonthText}>This month</Text></View>
            : <Pressable onPress={() => setMonth(thisMonth)} hitSlop={8}><Text style={s.backToMonth}>Back to this month</Text></Pressable>}
        </View>
        <Pressable onPress={() => setMonth(shiftMonth(month, 1))} hitSlop={10} style={s.monthArrow} accessibilityRole="button" accessibilityLabel="Next month">
          <Icon name="chevron-right" size={15} color={c.goldText} />
        </Pressable>
      </View>

      {!data ? (
        plan.error && !plan.loading
          ? <><Banner tone="danger" text={plan.error} /><Button title="Try again" icon="rotate-right" variant="secondary" onPress={plan.reload} /></>
          : <Card style={s.loadingCard}><ActivityIndicator color={c.secondary} /><Text style={s.muted}>Loading {monthLabel(month)}…</Text></Card>
      ) : (
        <>
          <Text style={s.summary}>{plotted} of {dates.length} {dates.length === 1 ? 'date' : 'dates'} plotted{plan.loading ? ' · updating…' : ''}</Text>
          {plan.error && <Banner tone="warn" text={`Showing saved data. ${plan.error}`} />}
          {dates.map((d) => {
            const l = byDate.get(d);
            const past = d < today;
            return l
              ? <PlottedCard key={d} lineup={l} today={today} past={past} namer={namer} busy={busy === l.scheduleId} onEdit={() => onEdit(l.scheduleId)} onDelete={() => remove(l)} />
              : <EmptyDayCard key={d} date={d} today={today} past={past} onPlot={() => onPlot(d)} />;
          })}
          <Button title="Add a lineup on another date" icon="plus" variant="ghost" onPress={() => onPlot()} style={s.addOther} />
        </>
      )}
    </>
  );
}

function DateBox({ date, today }: { date: string; today: string }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const isToday = date === today;
  const inner = (
    <>
      <Text style={[s.dbMonth, isToday && s.onGold]}>{monthAbbr(date)}</Text>
      <Text style={[s.dbDay, isToday && s.onGold]}>{dayOfMonth(date)}</Text>
      <Text style={[s.dbDow, isToday && s.onGoldSoft]}>{weekday(date)}</Text>
    </>
  );
  return isToday
    ? <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.dateBox}>{inner}</LinearGradient>
    : <View style={[s.dateBox, s.dateBoxPlain]}>{inner}</View>;
}

function PlottedCard({ lineup: l, today, past, namer, busy, onEdit, onDelete }: {
  lineup: PlannerLineup; today: string; past: boolean; namer: (n: string) => string; busy: boolean; onEdit: () => void; onDelete: () => void;
}) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const band = INSTRUMENTS.filter((i) => l.musicians[i.token]?.length)
    .map((i) => `${i.short} – ${l.musicians[i.token].map(namer).join(', ')}`).join('  ·  ');
  const rows: [string, string][] = [
    ['Backup', l.backupSingers.map(namer).join(', ')],
    ['Band', band],
    ['Dancers', l.dancers.map(namer).join(', ')],
  ];
  return (
    <Card onPress={onEdit} style={past && s.past}>
      <View style={s.cardTop}>
        <DateBox date={l.date} today={today} />
        <View style={s.flex}>
          <Text style={s.when}>{relativeDay(l.date, today)}</Text>
          <View style={s.leaderRow}>
            <Icon name="microphone" size={13} color={c.leader} />
            <Text style={s.leader} numberOfLines={1}>{l.songLeader || 'No Song Leader'}</Text>
          </View>
          <View style={s.metaRow}>
            {l.hasSubstitute && <Chip label="Sub leading" icon="people-arrows" color={c.info} />}
            <Chip label={l.songCount ? `${l.songCount} songs` : 'No songs yet'} icon="music" color={l.songCount ? c.success : c.textSecondary} />
          </View>
        </View>
      </View>
      <View style={s.rows}>
        {rows.map(([label, value]) => (
          <View key={label} style={s.infoRow}>
            <Text style={s.infoLabel}>{label}</Text>
            <Text style={[s.infoValue, !value && s.infoEmpty]} numberOfLines={2}>{value || '—'}</Text>
          </View>
        ))}
        {l.practiceDate && (
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Practice</Text>
            <Text style={s.infoValue}>{weekday(l.practiceDate)}, {shortDate(l.practiceDate)}{l.practiceTime ? ` · ${l.practiceTime}` : ''}</Text>
          </View>
        )}
      </View>
      <View style={s.actions}>
        <Button compact variant="danger" icon="trash-can" title="Remove" onPress={onDelete} loading={busy} />
        <Button compact variant="secondary" icon="pen-to-square" title="Edit" onPress={onEdit} />
      </View>
    </Card>
  );
}

function EmptyDayCard({ date, today, past, onPlot }: { date: string; today: string; past: boolean; onPlot: () => void }) {
  const s = useStyles();
  const sunday = parseYmd(date).getDay() === 0;
  return (
    <View style={[s.emptyDay, past && s.past]}>
      <DateBox date={date} today={today} />
      <View style={s.flex}>
        <Text style={s.when}>{relativeDay(date, today)}</Text>
        <Text style={s.notPlotted}>Not plotted yet</Text>
      </View>
      <Button compact icon="plus" title={sunday ? 'Plot this Sunday' : 'Plot'} onPress={onPlot} />
    </View>
  );
}

// ---- Approvals ----

const KIND_ICON: Record<ApprovalKind, IconName> = { excuse: 'calendar-minus', sub: 'people-arrows', swap: 'right-left' };
const KIND_LABEL: Record<ApprovalKind, string> = { excuse: 'Excuse', sub: 'Substitute', swap: 'Swap' };

function ApprovalsTab({ today, approvals, onChanged }: {
  today: string; approvals: ReturnType<typeof useApprovals>; onChanged: (message: string) => void;
}) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const dialog = useDialog();
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const data = approvals.data;

  if (!data) {
    if (approvals.error && !approvals.loading) {
      return <><Banner tone="danger" text={approvals.error} /><Button title="Try again" icon="rotate-right" variant="secondary" onPress={approvals.reload} /></>;
    }
    return <Card style={s.loadingCard}><ActivityIndicator color={c.secondary} /><Text style={s.muted}>Loading approvals…</Text></Card>;
  }

  const decide = async (kind: ApprovalKind, id: string, approve: boolean, ask: { title: string; message: string }) => {
    const ok = await dialog.confirm({
      icon: approve ? 'circle-check' : 'circle-xmark',
      tone: approve ? 'success' : 'danger',
      title: ask.title,
      message: ask.message,
      confirmText: approve ? 'Approve' : 'Reject',
      cancelText: 'Not yet',
    });
    if (!ok) return;
    setBusy(`${id}:${approve ? 'a' : 'r'}`);
    const res = await plannerApi.decide(kind, id, approve ? 'approve' : 'reject');
    setBusy(null);
    if (!res.ok) {
      dialog.alert({ icon: 'circle-exclamation', tone: 'danger', title: 'Could not save that', message: res.message });
      approvals.reload();
      return;
    }
    // Off the list at once; the server's list follows.
    approvals.setData((prev) => prev && ({
      ...prev,
      excuses: kind === 'excuse' ? prev.excuses.filter((x) => x.id !== id) : prev.excuses,
      subs: kind === 'sub' ? prev.subs.filter((x) => x.id !== id) : prev.subs,
      swaps: kind === 'swap' ? prev.swaps.filter((x) => x.id !== id) : prev.swaps,
    }));
    plannerChanged();
    approvals.reload();
    onChanged(res.message || (approve ? 'Approved.' : 'Rejected.'));
  };

  const total = waitingCount(data);
  const recent = showAll ? data.recent : data.recent.slice(0, 8);

  return (
    <>
      {total === 0 && (
        <Card><EmptyState icon="circle-check" title="All caught up" text="No excuses, substitute requests or swaps are waiting for you." /></Card>
      )}

      {data.excuses.length > 0 && <GroupHead icon="calendar-minus" title="Excuses" count={data.excuses.length} />}
      {data.excuses.map((x) => (
        <RequestCard key={x.id} kind="excuse" item={x} today={today} busy={busy}
          onApprove={() => decide('excuse', x.id, true, { title: 'Approve this excuse?', message: `${x.name} will be excused on ${longDate(x.date)}.` })}
          onReject={() => decide('excuse', x.id, false, { title: 'Reject this excuse?', message: `${firstName(x.name)} is told the excuse for ${longDate(x.date)} was not approved.` })} />
      ))}

      {data.subs.length > 0 && <GroupHead icon="people-arrows" title="Substitute requests" count={data.subs.length} />}
      {data.subs.map((x) => (
        <RequestCard key={x.id} kind="sub" item={x} today={today} busy={busy}
          onApprove={() => decide('sub', x.id, true, { title: 'Open this for a substitute?', message: `Every ${x.roleType} is told ${firstName(x.name)} needs cover on ${longDate(x.date)}, and one of them can take it.` })}
          onReject={() => decide('sub', x.id, false, { title: 'Reject this request?', message: `${firstName(x.name)} stays on the lineup for ${longDate(x.date)}.` })} />
      ))}

      {data.swaps.length > 0 && <GroupHead icon="right-left" title="Swaps" count={data.swaps.length} />}
      {data.swaps.map((w) => (
        <SwapCard key={w.id} swap={w} today={today} busy={busy}
          onApprove={() => decide('swap', w.id, true, {
            title: 'Approve this swap?',
            message: `${firstName(w.partnerName)} will be ${w.part} on ${shortDate(w.requesterDate)} and ${firstName(w.requesterName)} on ${shortDate(w.partnerDate)}. Both lineups change now.`,
          })}
          onReject={() => decide('swap', w.id, false, { title: 'Reject this swap?', message: 'Both stay on their own dates.' })} />
      ))}

      {data.recent.length > 0 && (
        <>
          <GroupHead icon="clock-rotate-left" title="Recently decided" />
          <Card style={s.recentCard}>
            {recent.map((r, i) => <RecentRow key={`${r.kind}-${r.id}`} item={r} first={i === 0} />)}
            {data.recent.length > 8 && (
              <Pressable onPress={() => setShowAll((v) => !v)} style={s.more} hitSlop={6}>
                <Text style={s.moreText}>{showAll ? 'Show less' : `Show all ${data.recent.length}`}</Text>
              </Pressable>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function GroupHead({ icon, title, count }: { icon: IconName; title: string; count?: number }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  return (
    <View style={s.groupHead}>
      <Icon name={icon} size={14} color={c.goldText} />
      <Text style={s.groupTitle}>{title}</Text>
      {count != null && <View style={s.groupCount}><Text style={s.groupCountText}>{count}</Text></View>}
    </View>
  );
}

function RequestCard({ kind, item: x, today, busy, onApprove, onReject }: {
  kind: 'excuse' | 'sub'; item: PendingRequest; today: string; busy: string | null; onApprove: () => void; onReject: () => void;
}) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const past = x.date < today;
  // What the plotter should know before deciding.
  const flag = !x.hasLineup
    ? { text: 'No lineup plotted on this date yet', color: c.textSecondary, icon: 'calendar' as IconName }
    : x.parts.length
      ? { text: `On this lineup: ${x.parts.join(', ')}`, color: c.info, icon: 'circle-info' as IconName }
      : { text: kind === 'sub' ? 'No longer on this lineup' : 'Not on this lineup', color: c.warning, icon: 'triangle-exclamation' as IconName };
  return (
    <Card style={past && s.past}>
      <View style={s.reqTop}>
        <Avatar name={x.name} picture={x.picture} size={42} />
        <View style={s.flex}>
          <Text style={s.reqName} numberOfLines={1}>{x.name}</Text>
          <Text style={s.reqDate}>{longDate(x.date)}</Text>
          <Text style={s.reqWhen}>{past ? 'Date has passed' : relativeDay(x.date, today)}</Text>
        </View>
        <Chip label={x.roleType} color={partColor(c, x.roleType)} />
      </View>
      {x.reason ? <Text style={s.reason}>“{x.reason}”</Text> : null}
      <View style={s.flag}>
        <Icon name={flag.icon} size={11} color={flag.color} />
        <Text style={[s.flagText, { color: flag.color }]}>{flag.text}</Text>
      </View>
      <View style={s.decide}>
        <Button compact variant="danger" icon="xmark" title="Reject" onPress={onReject} loading={busy === `${x.id}:r`} disabled={!!busy} style={s.flex} />
        <Button compact icon="check" title="Approve" onPress={onApprove} loading={busy === `${x.id}:a`} disabled={!!busy} style={s.flex} />
      </View>
    </Card>
  );
}

function SwapCard({ swap: w, today, busy, onApprove, onReject }: {
  swap: PendingSwap; today: string; busy: string | null; onApprove: () => void; onReject: () => void;
}) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const side = (name: string, picture: string | null, date: string) => (
    <View style={s.swapSide}>
      <Avatar name={name} picture={picture} size={40} />
      <Text style={s.swapName} numberOfLines={1}>{firstName(name)}</Text>
      <Text style={s.swapGives}>gives</Text>
      <Text style={s.swapDate}>{weekday(date)}, {shortDate(date)}</Text>
    </View>
  );
  return (
    <Card>
      <View style={s.swapHead}>
        <Chip label={w.part} color={partColor(c, w.part)} />
        <Text style={s.reqWhen}>Asked {relativeDay(w.createdAt.slice(0, 10), today).toLowerCase()}</Text>
      </View>
      <View style={s.swapRow}>
        {side(w.requesterName, w.requesterPicture, w.requesterDate)}
        <View style={s.swapIcon}><Icon name="right-left" size={15} color={c.goldText} /></View>
        {side(w.partnerName, w.partnerPicture, w.partnerDate)}
      </View>
      <Text style={s.swapAfter}>
        After: <Text style={s.swapStrong}>{firstName(w.partnerName)}</Text> serves {shortDate(w.requesterDate)}, <Text style={s.swapStrong}>{firstName(w.requesterName)}</Text> serves {shortDate(w.partnerDate)}.
      </Text>
      {w.reason ? <Text style={s.reason}>“{w.reason}”</Text> : null}
      {w.partnerNote ? <Text style={s.reason}>{firstName(w.partnerName)}: “{w.partnerNote}”</Text> : null}
      {w.problem && <View style={s.problem}><Banner tone="warn" text={`${w.problem} Reject it, or fix the lineups first.`} /></View>}
      <View style={s.decide}>
        <Button compact variant="danger" icon="xmark" title="Reject" onPress={onReject} loading={busy === `${w.id}:r`} disabled={!!busy} style={s.flex} />
        <Button compact icon="check" title="Approve" onPress={onApprove} loading={busy === `${w.id}:a`} disabled={!!busy || !!w.problem} style={s.flex} />
      </View>
    </Card>
  );
}

function RecentRow({ item: r, first }: { item: DecidedItem; first: boolean }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const approved = r.status !== 'Rejected';
  const what = r.kind === 'swap' && r.partner && r.otherDate
    ? `${firstName(r.name)} ⇄ ${firstName(r.partner)} · ${shortDate(r.date)} / ${shortDate(r.otherDate)}`
    : `${r.name} · ${shortDate(r.date)}`;
  return (
    <View style={[s.recent, !first && s.divider]}>
      <View style={[s.recentIcon, { backgroundColor: tint(approved ? c.success : c.danger, 0.12) }]}>
        <Icon name={KIND_ICON[r.kind]} size={12} color={approved ? c.success : c.danger} />
      </View>
      <View style={s.flex}>
        <Text style={s.recentWhat} numberOfLines={1}>{what}</Text>
        <Text style={s.recentMeta} numberOfLines={1}>{KIND_LABEL[r.kind]} · {r.part}{r.reviewedBy ? ` · by ${r.reviewedBy}` : ''}</Text>
      </View>
      <Chip label={approved ? 'Approved' : 'Rejected'} color={approved ? c.success : c.danger} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  muted: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular },
  onGold: { color: '#ffffff' },
  onGoldSoft: { color: 'rgba(255, 255, 255, 0.85)' },

  seg: { flexDirection: 'row', backgroundColor: c.card, borderRadius: radius.pill, padding: 4, borderWidth: 1, borderColor: c.border, marginTop: space.xs, marginBottom: space.md, gap: 4 },
  segItem: { flex: 1, borderRadius: radius.pill, overflow: 'hidden' },
  segInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 10, borderRadius: radius.pill },
  segText: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.semibold },
  segTextOn: { color: c.onGold, fontFamily: fonts.bold },
  segCount: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: c.danger },
  segCountOn: { backgroundColor: '#ffffff' },
  segCountText: { color: '#ffffff', fontSize: 11, fontFamily: fonts.bold },
  segCountTextOn: { color: c.primary },

  monthRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space.sm },
  monthArrow: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.goldMuted },
  monthMid: { flex: 1, alignItems: 'center', gap: 3 },
  monthText: { color: c.text, fontSize: font.xl, fontFamily: fonts.bold },
  thisMonth: { paddingHorizontal: 10, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: c.goldMuted },
  thisMonthText: { color: c.goldText, fontSize: font.xs, fontFamily: fonts.bold },
  backToMonth: { color: c.info, fontSize: font.xs, fontFamily: fonts.semibold },
  summary: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.medium, textAlign: 'center', marginBottom: space.md },
  loadingCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md, paddingVertical: space.xl },
  addOther: { marginTop: space.xs },

  past: { opacity: 0.55 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dateBox: { width: 58, height: 68, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  dateBoxPlain: { backgroundColor: c.goldMuted },
  dbMonth: { color: c.goldText, fontSize: 10.5, fontFamily: fonts.bold, letterSpacing: 1 },
  dbDay: { color: c.text, fontSize: 24, lineHeight: 27, fontFamily: fonts.bold },
  dbDow: { color: c.textSecondary, fontSize: 10.5, fontFamily: fonts.semibold, textTransform: 'uppercase' },
  when: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.semibold, textTransform: 'uppercase', letterSpacing: 0.8 },
  leaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  leader: { flex: 1, color: c.goldText, fontSize: font.lg, fontFamily: fonts.bold },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  rows: { marginTop: space.md, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: c.border, gap: 5 },
  infoRow: { flexDirection: 'row', gap: space.sm },
  infoLabel: { width: 66, color: c.textMuted, fontSize: font.sm, fontFamily: fonts.medium },
  infoValue: { flex: 1, color: c.text, fontSize: font.sm, fontFamily: fonts.regular, lineHeight: 19 },
  infoEmpty: { color: c.textMuted },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.md },
  emptyDay: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, marginBottom: space.md,
    borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: tint(c.secondary, 0.55), backgroundColor: tint(c.secondary, 0.04),
  },
  notPlotted: { color: c.textSecondary, fontSize: font.md, fontFamily: fonts.semibold, marginTop: 2 },

  groupHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.lg, marginBottom: space.sm },
  groupTitle: { color: c.text, fontSize: font.lg, fontFamily: fonts.bold },
  groupCount: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: c.goldMuted },
  groupCountText: { color: c.goldText, fontSize: font.xs, fontFamily: fonts.bold },
  reqTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  reqName: { color: c.text, fontSize: font.md, fontFamily: fonts.bold },
  reqDate: { color: c.goldText, fontSize: font.sm, fontFamily: fonts.semibold, marginTop: 1 },
  reqWhen: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular },
  reason: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, fontStyle: 'italic', marginTop: space.sm, lineHeight: 19 },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm },
  flagText: { fontSize: font.xs, fontFamily: fonts.semibold },
  decide: { flexDirection: 'row', gap: space.sm, marginTop: space.md },

  swapHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
  swapRow: { flexDirection: 'row', alignItems: 'center' },
  swapSide: { flex: 1, alignItems: 'center', gap: 2 },
  swapName: { color: c.text, fontSize: font.md, fontFamily: fonts.bold, marginTop: 4 },
  swapGives: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular },
  swapDate: { color: c.goldText, fontSize: font.sm, fontFamily: fonts.semibold },
  swapIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.goldMuted },
  swapAfter: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, textAlign: 'center', marginTop: space.md, lineHeight: 19 },
  swapStrong: { color: c.text, fontFamily: fonts.semibold },
  problem: { marginTop: space.sm, marginBottom: -space.md },

  recentCard: { paddingVertical: space.sm },
  recent: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: c.border },
  recentIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  recentWhat: { color: c.text, fontSize: font.sm, fontFamily: fonts.semibold },
  recentMeta: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular, marginTop: 1 },
  more: { alignItems: 'center', paddingTop: space.md, borderTopWidth: 1, borderTopColor: c.border },
  moreText: { color: c.goldText, fontSize: font.sm, fontFamily: fonts.semibold },
}));
