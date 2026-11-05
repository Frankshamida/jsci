import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSession } from '../session';
import { upcomingMine } from '../lineups';
import { invalidateMonths } from '../months';
import { api } from '../api';
import type { StackProps } from '../routes';
import { useDialog } from '../dialog';
import { Avatar, Banner, Button, Card, Chip, ChoiceRow, DateBox, EmptyState, Field, Icon, MonthSwitcher, Screen } from '../components';
import { font, fonts, makeStyles, partColor, radius, space, tint, useTheme } from '../theme';
import { firstName, longDate, monthDay, parseYmd, relativeDay, shiftMonth } from '../utils';
import type { Lineup, RoleType, SwapCandidate } from '../types';

// Three forms in one:
//   excuse  "I can't serve on this date": any date from today on, even months ahead
//   sub     "I'm on this lineup but can't make it": a teammate covers your part
//   swap    "Let's trade dates": you take a teammate's date, they take yours
export default function RequestFormScreen({ route, navigation }: StackProps<'RequestForm'>) {
  const { mode } = route.params;
  useLayoutEffect(() => {
    navigation.setOptions({ title: mode === 'excuse' ? 'File an Excuse' : mode === 'sub' ? 'Ask for a Substitute' : 'Swap Schedule' });
  }, [navigation, mode]);
  if (mode === 'excuse') return <ExcuseForm date={route.params.date} done={() => navigation.goBack()} />;
  return <LineupForm mode={mode} scheduleId={route.params.scheduleId} done={() => navigation.goBack()} />;
}

// ---- Excuse ----

function ExcuseForm({ date: startDate, done }: { date?: string; done: () => void }) {
  const { home, profile, refresh } = useSession();
  const { colors: c } = useTheme();
  const s = useStyles();
  const dialog = useDialog();
  const today = home?.today || '';
  const [date, setDate] = useState<string | null>(startDate && startDate >= today ? startDate : null);
  const [month, setMonth] = useState((startDate || today).slice(0, 7));
  const [roleType, setRoleType] = useState<RoleType | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!home || !profile) return null;

  // What the calendar marks: dates they are plotted on, and excuses filed.
  const plotted = Object.fromEntries(home.assignments.filter((l) => l.date >= today && !l.subbedOut).map((l) => [l.date, l]));
  const filed = Object.fromEntries(home.excuses.filter((e) => e.status !== 'Rejected').map((e) => [e.excuse_date, e]));
  const lineup: Lineup | undefined = date ? plotted[date] : undefined;
  const already = date ? filed[date] : undefined;
  const roles: RoleType[] = lineup?.myRoleTypes.length ? lineup.myRoleTypes : profile.coverableRoleTypes;
  const role = roleType && roles.includes(roleType) ? roleType : roles[0] || null;
  const lastMonth = shiftMonth(today.slice(0, 7), 12);

  const submit = async () => {
    if (!date) return setError('Pick a date on the calendar.');
    if (already) return setError('You have already filed an excuse for this date.');
    if (!reason.trim()) return setError('Write a short reason.');
    setError(null);
    setSaving(true);
    const res = await api.fileExcuse(date, (role || 'Song Leader') as RoleType, reason.trim());
    if (!res.ok) { setSaving(false); return setError(res.message); }
    invalidateMonths();
    await refresh(true);
    setSaving(false);
    await dialog.alert({ icon: 'circle-check', tone: 'success', title: 'Excuse filed', message: `For ${longDate(date)}. The Schedule Plotter will review it, and you will see the answer under Requests.` });
    done();
  };

  return (
    <Screen stacked>
      <Card raised style={s.intro}>
        <Icon name="calendar-minus" size={20} color={c.goldText} />
        <Text style={s.help}>Pick any date you cannot serve, this week or months ahead. The Schedule Plotter reviews it and leaves you off that lineup.</Text>
      </Card>

      <MonthSwitcher month={month} current={today.slice(0, 7)} onChange={(m) => { if (m >= today.slice(0, 7) && m <= lastMonth) setMonth(m); }} />
      <CalendarPicker month={month} today={today} selected={date} onPick={(d) => { setDate(d); setError(null); }}
        mark={(d) => (filed[d] ? (filed[d].status === 'Approved' ? 'approved' : 'pending') : plotted[d] ? 'plotted' : null)} />
      <View style={s.legend}>
        <Legend color={c.secondary} label="You are plotted" ring />
        <Legend color={c.warning} label="Excuse pending" />
        <Legend color={c.success} label="Excuse approved" />
      </View>

      {date && (
        <Card style={s.picked}>
          <DateBox date={date} today={today} size="sm" />
          <View style={s.flex}>
            <Text style={s.pickedWhen}>{relativeDay(date, today)}</Text>
            <Text style={s.pickedDate}>{longDate(date)}</Text>
            <Text style={s.muted}>{lineup ? `You are ${lineup.myParts.join(', ')}${lineup.songLeader && !lineup.isSongLeader ? ` · led by ${lineup.songLeader.name}` : ''}` : 'You are not plotted on this date yet.'}</Text>
          </View>
        </Card>
      )}
      {already && <Banner tone="warn" icon="circle-exclamation" text={`You have already filed an excuse for this date (${already.status === 'Approved' ? 'approved' : 'waiting for approval'}).`} />}

      {!already && date && roles.length > 1 && (
        <View>
          <Text style={s.label}>Part</Text>
          <ChoiceRow options={roles} value={role} onChange={setRoleType} />
        </View>
      )}
      {!already && (
        <Field label="Reason" value={reason} onChangeText={setReason} placeholder="e.g. Out of town for a family event" multiline maxLength={500} />
      )}
      {error && <Banner tone="danger" text={error} />}
      <Button title="Send Excuse" icon="paper-plane" onPress={submit} loading={saving} disabled={!date || !!already} />
    </Screen>
  );
}

function Legend({ color, label, ring }: { color: string; label: string; ring?: boolean }) {
  const s = useStyles();
  return (
    <View style={s.legendItem}>
      <View style={[s.legendDot, ring ? { borderWidth: 2, borderColor: color } : { backgroundColor: color }]} />
      <Text style={s.legendText}>{label}</Text>
    </View>
  );
}

type Mark = 'plotted' | 'pending' | 'approved' | null;

// A month to pick one date from; past days cannot be picked.
function CalendarPicker({ month, today, selected, onPick, mark }: {
  month: string; today: string; selected: string | null; onPick: (date: string) => void; mark: (date: string) => Mark;
}) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const first = parseYmd(`${month}-01`);
  const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(first.getDay()).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  return (
    <Card style={s.calendar}>
      <View style={s.calRow}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <Text key={i} style={[s.calHead, i === 0 && { color: c.goldText }]}>{w}</Text>)}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, r) => (
        <View key={r} style={s.calRow}>
          {cells.slice(r * 7, r * 7 + 7).map((n, i) => {
            if (!n) return <View key={i} style={s.calCell} />;
            const date = `${month}-${String(n).padStart(2, '0')}`;
            const past = date < today;
            const on = date === selected;
            const m = mark(date);
            const sunday = i === 0;
            return (
              <Pressable key={i} disabled={past} onPress={() => onPick(date)} style={[s.calCell, past && s.calPast]}
                accessibilityRole="button" accessibilityState={{ selected: on, disabled: past }} accessibilityLabel={longDate(date)}>
                <View style={[
                  s.calDay,
                  sunday && !on && s.calSunday,
                  m === 'plotted' && s.calPlotted,
                  m === 'pending' && { backgroundColor: tint(c.warning, 0.22) },
                  m === 'approved' && { backgroundColor: tint(c.success, 0.22) },
                  date === today && s.calToday,
                  on && s.calOn,
                ]}>
                  <Text style={[s.calNum, sunday && s.calNumSunday, on && s.calNumOn]}>{n}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </Card>
  );
}

// ---- Substitute and swap: start from one of your upcoming lineups ----

function LineupForm({ mode, scheduleId, done }: { mode: 'sub' | 'swap'; scheduleId?: string; done: () => void }) {
  const { home, refresh } = useSession();
  const { colors: c } = useTheme();
  const s = useStyles();
  const dialog = useDialog();
  const mine = useMemo(() => (home ? upcomingMine(home) : []), [home]);
  const [picked, setPicked] = useState<string | null>(scheduleId || mine[0]?.scheduleId || null);
  const [roleType, setRoleType] = useState<RoleType | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Swap: who could trade with you on that lineup
  const [candidates, setCandidates] = useState<SwapCandidate[] | null>(null);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [partner, setPartner] = useState<SwapCandidate | null>(null);

  const lineup = mine.find((l) => l.scheduleId === picked) || null;

  useEffect(() => {
    if (mode !== 'swap' || !picked) return;
    let live = true;
    setCandidates(null);
    setCandidateError(null);
    setPartner(null);
    api.swapCandidates(picked).then((res) => {
      if (!live) return;
      if (res.ok) setCandidates(res.data.candidates); else setCandidateError(res.message);
    });
    return () => { live = false; };
  }, [mode, picked]);

  if (!home) return null;
  if (!mine.length) {
    return (
      <Screen stacked center>
        <EmptyState icon="calendar" title="No upcoming lineups" text={mode === 'sub' ? 'You can ask for a substitute once you are plotted on a date.' : 'You can swap once you are plotted on a date.'} />
      </Screen>
    );
  }

  const busyWith = (l: Lineup) => {
    const sub = home.substitutes.find((x) => x.date === l.date && x.requesterId === home.profile.id && ['Pending Admin', 'Open for Sub', 'Accepted'].includes(x.status));
    if (sub) return `Sub request: ${sub.status === 'Accepted' ? 'covered' : 'pending'}`;
    const swap = (home.swaps || []).find((w) => w.requesterId === home.profile.id && w.requesterDate === l.date && ['Waiting Partner', 'Pending Approval'].includes(w.status));
    if (swap) return `Swap with ${firstName(swap.partnerName)}: pending`;
    return null;
  };
  const blocked = lineup ? busyWith(lineup) : null;
  const roles = lineup?.myRoleTypes || [];
  const role = roleType && roles.includes(roleType) ? roleType : roles[0] || null;

  const submit = async () => {
    if (!lineup) return setError('Pick one of your lineups.');
    setError(null);
    if (mode === 'sub') {
      if (!role) return setError('Pick the part.');
      if (!reason.trim()) return setError('Write a short reason.');
      setSaving(true);
      const res = await api.requestSub(lineup.scheduleId, role, reason.trim());
      if (!res.ok) { setSaving(false); return setError(res.message); }
    } else {
      if (!partner) return setError('Pick who to swap with.');
      setSaving(true);
      const res = await api.requestSwap({ scheduleId: lineup.scheduleId, part: partner.part, partnerId: partner.partnerId, partnerDate: partner.date, reason: reason.trim() });
      if (!res.ok) { setSaving(false); return setError(res.message); }
    }
    invalidateMonths();
    await refresh(true);
    setSaving(false);
    await dialog.alert(mode === 'sub'
      ? { icon: 'circle-check', tone: 'success', title: 'Request sent', message: 'Once the Schedule Plotter approves it, teammates who can take your part see it and can cover you.' }
      : { icon: 'right-left', tone: 'success', title: 'Swap request sent', message: `${partner!.partnerName} will be asked. If they accept, the Schedule Plotter approves it and both lineups change.` });
    done();
  };

  return (
    <Screen stacked>
      <Card raised style={s.intro}>
        <Icon name={mode === 'sub' ? 'people-arrows' : 'right-left'} size={20} color={c.goldText} />
        <Text style={s.help}>
          {mode === 'sub'
            ? 'Ask a teammate to cover your part. Once the Schedule Plotter approves, it opens to teammates who can take it.'
            : 'Trade dates with a teammate who has the same part: you take their date, they take yours. They accept, then the Schedule Plotter approves.'}
        </Text>
      </Card>

      <Text style={s.label}>{mode === 'sub' ? 'Which date?' : 'The date you give away'}</Text>
      {mine.map((l) => {
        const on = l.scheduleId === picked;
        const busy = busyWith(l);
        return (
          <Card key={l.scheduleId} onPress={() => { setPicked(l.scheduleId); setError(null); }} style={[s.pickRow, on && s.pickRowOn]}>
            <DateBox date={l.date} today={home.today} size="sm" />
            <View style={s.flex}>
              <Text style={s.pickTitle}>{relativeDay(l.date, home.today)}</Text>
              <View style={s.chips}>{l.myParts.map((p) => <Chip key={p} label={p} color={partColor(c, p)} solid={on} />)}</View>
              {busy && <Text style={[s.busy, { color: c.warning }]}>{busy}</Text>}
            </View>
            <View style={[s.radio, on && s.radioOn]}>{on && <View style={s.radioDot} />}</View>
          </Card>
        );
      })}

      {blocked && <Banner tone="warn" text={`This date already has a request (${blocked}). Take it back under Requests first.`} />}

      {mode === 'sub' && lineup && roles.length > 1 && (
        <View>
          <Text style={s.label}>Part</Text>
          <ChoiceRow options={roles} value={role} onChange={setRoleType} />
        </View>
      )}

      {mode === 'swap' && lineup && !blocked && (
        <>
          <Text style={s.label}>Swap with</Text>
          {candidateError ? <Banner tone="danger" text={candidateError} />
            : !candidates ? <Card><Text style={s.muted}>Finding teammates who can trade…</Text></Card>
            : !candidates.length ? (
              <Card><EmptyState icon="user-slash" title="Nobody to swap with" text="No teammate with your part is free to trade in the next four months." /></Card>
            ) : candidates.map((x) => {
              const on = partner?.partnerId === x.partnerId && partner.date === x.date && partner.part === x.part;
              return (
                <Card key={`${x.partnerId}-${x.date}-${x.part}`} onPress={() => setPartner(x)} style={[s.pickRow, on && s.pickRowOn]}>
                  <Avatar name={x.partnerName} picture={x.partnerPicture} size={40} />
                  <View style={s.flex}>
                    <Text style={s.pickTitle}>{x.partnerName}</Text>
                    <Text style={s.muted}>{x.part} on <Text style={s.strong}>{monthDay(x.date)}</Text> ({relativeDay(x.date, home.today).toLowerCase()})</Text>
                  </View>
                  <View style={[s.radio, on && s.radioOn]}>{on && <View style={s.radioDot} />}</View>
                </Card>
              );
            })}
          {partner && (
            <View style={s.swapBox}>
              <View style={s.swapSide}><Text style={s.swapLabel}>You take</Text><Text style={s.swapDate}>{monthDay(partner.date)}</Text></View>
              <Icon name="right-left" size={15} color={c.band} />
              <View style={s.swapSide}><Text style={s.swapLabel}>{firstName(partner.partnerName)} takes</Text><Text style={s.swapDate}>{monthDay(lineup.date)}</Text></View>
            </View>
          )}
        </>
      )}

      {!blocked && (
        <Field
          label={mode === 'sub' ? 'Reason' : 'Message (optional)'}
          value={reason}
          onChangeText={setReason}
          placeholder={mode === 'sub' ? 'e.g. Sick, cannot sing this Sunday' : 'e.g. I have a family event that day. Thank you!'}
          multiline
          maxLength={500}
        />
      )}
      {error && <Banner tone="danger" text={error} />}
      <Button title={mode === 'sub' ? 'Ask for a Substitute' : 'Send Swap Request'} icon="paper-plane" onPress={submit} loading={saving}
        disabled={!!blocked || !lineup || (mode === 'swap' && !partner)} />
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  intro: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  help: { flex: 1, color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, lineHeight: 19 },
  label: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.semibold, marginBottom: 6, marginTop: space.sm },
  muted: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, lineHeight: 19 },
  strong: { color: c.text, fontFamily: fonts.bold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 4 },

  calendar: { paddingHorizontal: space.sm, paddingVertical: space.md },
  calRow: { flexDirection: 'row' },
  calHead: { flex: 1, textAlign: 'center', color: c.textMuted, fontSize: font.xs, fontFamily: fonts.bold, marginBottom: 4 },
  calCell: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center' },
  calPast: { opacity: 0.3 },
  calDay: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  calSunday: { backgroundColor: c.goldMuted },
  calPlotted: { borderColor: c.secondary },
  calToday: { borderColor: c.accent, borderStyle: 'dashed' },
  calOn: { backgroundColor: c.secondary, borderColor: c.secondary },
  calNum: { color: c.text, fontSize: font.sm, fontFamily: fonts.semibold },
  calNumSunday: { color: c.goldText, fontFamily: fonts.bold },
  calNumOn: { color: '#ffffff', fontFamily: fonts.bold },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginBottom: space.md, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: c.textSecondary, fontSize: font.xs, fontFamily: fonts.medium },

  picked: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderColor: tint(c.secondary, 0.5) },
  pickedWhen: { color: c.goldText, fontSize: font.xs, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 1 },
  pickedDate: { color: c.text, fontSize: font.md, fontFamily: fonts.bold },

  pickRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  pickRowOn: { borderColor: c.secondary, backgroundColor: c.cardRaised },
  pickTitle: { color: c.text, fontSize: font.md, fontFamily: fonts.bold },
  busy: { fontSize: font.xs, fontFamily: fonts.semibold, marginTop: 3 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.borderStrong, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: c.secondary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.secondary },
  swapBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginBottom: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: tint(c.band, 0.1) },
  swapSide: { alignItems: 'center' },
  swapLabel: { color: c.textSecondary, fontSize: font.xs, fontFamily: fonts.medium },
  swapDate: { color: c.text, fontSize: font.lg, fontFamily: fonts.heavy, letterSpacing: 0.5 },
}));
