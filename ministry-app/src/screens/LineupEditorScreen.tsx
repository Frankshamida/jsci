// ============================================================
// Plot or change one lineup (Schedule Plotter): the date and practice, the
// Song Leader, Backup Singers, the band and the dancers.
//   One person, one part: somebody already in a part is greyed out elsewhere.
//   An excuse on the date shows on the person ("Excused" / "Excuse pending").
// Songs are never touched here: they belong to the Song Leader.
// ============================================================
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSession } from '../session';
import type { StackProps } from '../routes';
import { useDialog } from '../dialog';
import { Avatar, Banner, Button, Card, Chip, ChoiceRow, EmptyState, Field, Icon, LoadingView, Screen, type IconName } from '../components';
import { font, fonts, makeStyles, partColor, radius, space, tint, useTheme } from '../theme';
import { dayOfMonth, longDate, parseYmd, relativeDay, upcomingSundays, weekday, ymd } from '../utils';
import {
  INSTRUMENTS, findPlannedLineup, loadPlannerMonthOf, monthLabel, monthOf, plannerApi, plannerChanged, setPlannerFlash, shiftMonth,
  shortNamer, usePlannerMonth, type InstrumentToken, type LineupInput, type PlannerExcuse, type PlannerLineup, type PlannerPerson,
} from '../planner';

const emptyBand = (): Record<InstrumentToken, string[]> => ({ Keyboard: [], Guitarist: [], Bass: [], Drummer: [] });
const lower = (n: string) => n.trim().toLowerCase();
const addDays = (date: string, days: number) => { const d = parseYmd(date); d.setDate(d.getDate() + days); return ymd(d); };
const daysBetween = (a: string, b: string) => Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86400000);

export default function LineupEditorScreen({ route, navigation }: StackProps<'LineupEditor'>) {
  const scheduleId = route.params?.scheduleId;
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; lineup: PlannerLineup | null; message?: string }>(() => {
    if (!scheduleId) return { status: 'ready', lineup: null };
    const found = findPlannedLineup(scheduleId);
    return found ? { status: 'ready', lineup: found } : { status: 'loading', lineup: null };
  });

  useLayoutEffect(() => { navigation.setOptions({ title: scheduleId ? 'Edit Lineup' : 'New Lineup' }); }, [navigation, scheduleId]);

  // Opened with just the lineup's id (from the lineup screen): find its month.
  const open = () => {
    if (!scheduleId) return;
    setState({ status: 'loading', lineup: null });
    loadPlannerMonthOf(scheduleId).then((res) => {
      if (!res.ok) { setState({ status: 'error', lineup: null, message: res.message }); return; }
      const found = res.data.lineups.find((l) => l.scheduleId === scheduleId);
      setState(found ? { status: 'ready', lineup: found } : { status: 'error', lineup: null, message: 'This lineup was removed.' });
    });
  };
  useEffect(() => { if (state.status === 'loading') open(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.status === 'loading') return <LoadingView message="Opening the lineup…" />;
  if (state.status === 'error') {
    return (
      <Screen stacked center>
        <EmptyState icon="circle-exclamation" title="Could not open the lineup" text={state.message} />
        <Button title="Try again" icon="rotate-right" onPress={open} />
      </Screen>
    );
  }
  return <Editor existing={state.lineup} startDate={route.params?.date} navigation={navigation} />;
}

interface Form {
  date: string;
  practiceDate: string | null;
  practiceTime: string;
  songLeader: string | null;
  backupSingers: string[];
  musicians: Record<InstrumentToken, string[]>;
  dancers: string[];
}

// Each part of the lineup, as the editor shows it.
type PartKey = 'leader' | 'backup' | InstrumentToken | 'dancer';
const PART_LABEL: Record<PartKey, string> = {
  leader: 'Song Leader', backup: 'Backup Singer', Keyboard: 'Keyboard', Guitarist: 'Guitar', Bass: 'Bass', Drummer: 'Drums', dancer: 'Dancer',
};

function Editor({ existing, startDate, navigation }: { existing: PlannerLineup | null; startDate?: string; navigation: StackProps<'LineupEditor'>['navigation'] }) {
  const { home, refresh } = useSession();
  const { colors: c } = useTheme();
  const s = useStyles();
  const dialog = useDialog();
  const today = home?.today || ymd(new Date());

  const [form, setForm] = useState<Form>(() => ({
    date: existing?.date || startDate || upcomingSundays(1)[0],
    practiceDate: existing?.practiceDate || null,
    practiceTime: existing?.practiceTime || '',
    songLeader: existing?.songLeader || null,
    backupSingers: existing?.backupSingers || [],
    musicians: { ...emptyBand(), ...(existing?.musicians || {}) },
    dancers: existing?.dancers || [],
  }));
  const [pickingDate, setPickingDate] = useState(!existing && !startDate);
  const [openPart, setOpenPart] = useState<PartKey | null>(existing ? null : 'leader');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);
  const leaving = useRef(false);

  // The month of the date: who can be plotted, who is excused, which dates are taken.
  const plan = usePlannerMonth(monthOf(form.date));
  const data = plan.data || plan.anyData; // the people lists are the same every month
  const people = data?.people;
  const namer = useMemo(() => shortNamer(people ? [...people.songLeaders, ...people.backupSingers, ...people.musicians, ...people.dancers] : []), [people]);

  // Leaving with unsaved changes asks first.
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (!dirty.current || leaving.current) return;
    e.preventDefault();
    dialog.confirm({
      icon: 'triangle-exclamation', tone: 'danger', title: 'Discard changes?',
      message: 'This lineup is not saved yet.', confirmText: 'Discard', cancelText: 'Keep editing',
    }).then((ok) => { if (ok) { leaving.current = true; navigation.dispatch(e.data.action); } });
  }), [navigation, dialog]);

  const edit = (patch: Partial<Form>) => { dirty.current = true; setError(null); setForm((f) => ({ ...f, ...patch })); };

  // A new date keeps the practice the same number of days before it.
  const pickDate = (date: string) => {
    let practiceDate = form.practiceDate;
    if (practiceDate) {
      const before = daysBetween(practiceDate, form.date);
      practiceDate = before >= 0 && before <= 6 ? addDays(date, -before) : null;
    }
    edit({ date, practiceDate });
    setPickingDate(false);
  };

  // Who is in which part right now.
  const partOf = useMemo(() => {
    const map = new Map<string, PartKey>();
    if (form.songLeader) map.set(lower(form.songLeader), 'leader');
    form.backupSingers.forEach((n) => map.set(lower(n), 'backup'));
    INSTRUMENTS.forEach(({ token }) => form.musicians[token].forEach((n) => map.set(lower(n), token)));
    form.dancers.forEach((n) => map.set(lower(n), 'dancer'));
    return map;
  }, [form]);

  const excusesToday = (data?.month === monthOf(form.date) ? data.excuses : []).filter((x) => x.date === form.date);
  const excuseOf = (p: PlannerPerson): PlannerExcuse | null =>
    excusesToday.find((x) => x.userId === p.id || lower(x.name) === lower(p.name)) || null;

  const clash = plan.data?.lineups.find((l) => l.date === form.date && l.scheduleId !== existing?.scheduleId) || null;
  const takenDates = new Set((plan.data?.lineups || []).filter((l) => l.scheduleId !== existing?.scheduleId).map((l) => l.date));

  // Choosing someone for a part.
  const namesIn = (part: PartKey): string[] => {
    if (part === 'leader') return form.songLeader ? [form.songLeader] : [];
    if (part === 'backup') return form.backupSingers;
    if (part === 'dancer') return form.dancers;
    return form.musicians[part];
  };
  const setNames = (part: PartKey, names: string[]) => {
    if (part === 'leader') edit({ songLeader: names[0] || null });
    else if (part === 'backup') edit({ backupSingers: names });
    else if (part === 'dancer') edit({ dancers: names });
    else edit({ musicians: { ...form.musicians, [part]: names } });
  };
  const toggle = (part: PartKey, name: string) => {
    const current = namesIn(part);
    const on = current.some((n) => lower(n) === lower(name));
    if (part === 'leader') setNames(part, on ? [] : [name]);
    else setNames(part, on ? current.filter((n) => lower(n) !== lower(name)) : [...current, name]);
  };

  // Each part's candidates; names already on the lineup that are no longer on
  // the lists stay, so they can be taken off.
  const candidates = (part: PartKey): PlannerPerson[] => {
    if (!people) return [];
    const list = part === 'leader' ? people.songLeaders
      : part === 'backup' ? people.backupSingers
        : part === 'dancer' ? people.dancers
          : people.musicians.filter((m) => m.instruments?.includes(part));
    const extra = namesIn(part).filter((n) => !list.some((p) => lower(p.name) === lower(n)))
      .map((n) => ({ id: `kept:${n}`, name: n, picture: null }));
    return [...list, ...extra];
  };

  const save = async () => {
    if (!form.songLeader) { setOpenPart('leader'); return setError('Pick the Song Leader.'); }
    if (clash) return setError(`There is already a lineup on ${longDate(form.date)}. Pick another date.`);
    setSaving(true);
    setError(null);
    const input: LineupInput = {
      date: form.date,
      practiceDate: form.practiceDate,
      practiceTime: form.practiceTime.trim(),
      songLeader: form.songLeader,
      backupSingers: form.backupSingers,
      musicians: form.musicians,
      dancers: form.dancers,
    };
    const res = existing ? await plannerApi.update(existing.scheduleId, input) : await plannerApi.create(input);
    setSaving(false);
    if (!res.ok) {
      setError(res.message);
      dialog.alert({ icon: 'circle-exclamation', tone: 'danger', title: 'Could not save the lineup', message: res.message });
      return;
    }
    plannerChanged();
    refresh(true);
    setPlannerFlash(`${existing ? 'Saved' : 'Plotted'}: ${longDate(form.date)}, led by ${form.songLeader}.`);
    leaving.current = true;
    navigation.goBack();
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await dialog.confirm({
      icon: 'trash-can', tone: 'danger', title: 'Remove this lineup?',
      message: `${longDate(existing.date)} will have no lineup.${existing.songCount ? ` Its ${existing.songCount} songs go with it.` : ''}`,
      confirmText: 'Remove', cancelText: 'Keep it',
    });
    if (!ok) return;
    setDeleting(true);
    const res = await plannerApi.remove(existing.scheduleId);
    setDeleting(false);
    if (!res.ok) {
      dialog.alert({ icon: 'circle-exclamation', tone: 'danger', title: 'Could not remove it', message: res.message });
      return;
    }
    plannerChanged();
    refresh(true);
    setPlannerFlash(`The lineup for ${longDate(existing.date)} was removed.`);
    leaving.current = true;
    navigation.goBack();
  };

  // The six days before the service, for practice.
  const practiceDays = [6, 5, 4, 3, 2, 1].map((n) => addDays(form.date, -n));
  const practiceOptions = ['none', ...practiceDays];
  const practiceValue = form.practiceDate && practiceDays.includes(form.practiceDate) ? form.practiceDate : form.practiceDate ? 'other' : 'none';

  const parts: { key: PartKey; icon: IconName; color: string; single?: boolean }[] = [
    { key: 'leader', icon: 'microphone', color: c.leader, single: true },
    { key: 'backup', icon: 'users', color: c.backup },
    ...INSTRUMENTS.map((i) => ({ key: i.token as PartKey, icon: i.icon, color: c.band })),
    { key: 'dancer', icon: 'person-running', color: c.dance },
  ];
  const searching = query.trim().length > 0;
  const total = partOf.size;

  return (
    <Screen stacked>
      {/* The date */}
      <Card raised>
        <View style={s.dateHead}>
          <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.dateBadge}>
            <Text style={s.dateBadgeMonth}>{parseYmd(form.date).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</Text>
            <Text style={s.dateBadgeDay}>{dayOfMonth(form.date)}</Text>
          </LinearGradient>
          <View style={s.flex}>
            <Text style={s.kicker}>{relativeDay(form.date, today)}</Text>
            <Text style={s.bigDate}>{longDate(form.date)}</Text>
            <Text style={s.muted}>{total ? `${total} on this lineup` : 'Nobody on it yet'}</Text>
          </View>
          <Pressable onPress={() => setPickingDate((v) => !v)} hitSlop={8} style={s.changeDate} accessibilityRole="button" accessibilityLabel="Change the date">
            <Icon name={pickingDate ? 'xmark' : 'calendar-days'} size={15} color={c.goldText} />
          </Pressable>
        </View>
        {pickingDate && <MonthCalendar value={form.date} today={today} onPick={pickDate} />}
        {clash && <View style={s.top}><Banner tone="danger" text={`${longDate(form.date)} already has a lineup (led by ${clash.songLeader || 'nobody yet'}). Pick another date, or edit that one.`} /></View>}
        {form.date < today && !clash && <View style={s.top}><Banner tone="warn" text="This date has passed. You can still correct who served." /></View>}
      </Card>

      {/* Practice */}
      <Text style={s.label}>Practice day</Text>
      <ChoiceRow
        options={practiceValue === 'other' ? [...practiceOptions, 'other'] : practiceOptions}
        value={practiceValue}
        onChange={(v) => { if (v !== 'other') edit({ practiceDate: v === 'none' ? null : v }); }}
        labels={{
          none: 'None',
          other: form.practiceDate ? `${weekday(form.practiceDate)} ${dayOfMonth(form.practiceDate)}` : '',
          ...Object.fromEntries(practiceDays.map((d) => [d, `${weekday(d)} ${dayOfMonth(d)}`])),
        }}
      />
      {form.practiceDate && (
        <Field label="Practice time" value={form.practiceTime} onChangeText={(t) => edit({ practiceTime: t })} placeholder="7:00 PM" maxLength={20} autoCapitalize="characters" />
      )}

      {/* The people */}
      <View style={s.peopleHead}>
        <Text style={s.sectionTitle}>Who serves</Text>
        {plan.loading && !data && <Text style={s.muted}>Loading the team…</Text>}
      </View>
      {plan.error && !data && <Banner tone="danger" text={plan.error} />}
      <Field
        label="Find someone"
        value={query}
        onChangeText={setQuery}
        placeholder="Type a name"
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="search"
        right={searching ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10} style={s.clear} accessibilityRole="button" accessibilityLabel="Clear search">
            <Icon name="circle-xmark" size={16} color={c.textMuted} />
          </Pressable>
        ) : (
          <View style={s.clear}><Icon name="magnifying-glass" size={14} color={c.textMuted} /></View>
        )}
      />

      {parts.map(({ key, icon, color, single }) => {
        const chosen = namesIn(key);
        const list = candidates(key).filter((p) => !searching || lower(p.name).includes(lower(query)));
        if (searching && !list.length) return null;
        const open = searching || openPart === key;
        return (
          <Card key={key} style={s.partCard}>
            <Pressable onPress={() => setOpenPart(open && !searching ? null : key)} style={s.partHead} accessibilityRole="button" accessibilityState={{ expanded: open }}>
              <View style={[s.partIcon, { backgroundColor: tint(color, 0.14) }]}><Icon name={icon} size={14} color={color} /></View>
              <View style={s.flex}>
                <Text style={s.partTitle}>{PART_LABEL[key]}{key === 'backup' ? 's' : key === 'dancer' ? 's' : ''}</Text>
                {!open && (
                  <Text style={[s.partSummary, !chosen.length && s.partEmpty]} numberOfLines={1}>
                    {chosen.length ? chosen.map(namer).join(', ') : key === 'leader' ? 'Pick the Song Leader' : 'Nobody yet'}
                  </Text>
                )}
              </View>
              {chosen.length > 0 && <View style={[s.count, { backgroundColor: color }]}><Text style={s.countText}>{chosen.length}</Text></View>}
              {!searching && <Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} color={c.textMuted} />}
            </Pressable>

            {open && (
              <View style={s.list}>
                {!people && <Text style={s.muted}>Loading…</Text>}
                {people && !list.length && <Text style={s.muted}>Nobody has this position yet. Set it in User Management on the website.</Text>}
                {list.map((p) => {
                  const on = chosen.some((n) => lower(n) === lower(p.name));
                  const elsewhere = partOf.get(lower(p.name));
                  const busyElsewhere = !!elsewhere && elsewhere !== key;
                  const excuse = excuseOf(p);
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => toggle(key, p.name)}
                      disabled={busyElsewhere}
                      style={({ pressed }) => [s.person, on && { backgroundColor: tint(color, 0.1), borderColor: tint(color, 0.45) }, busyElsewhere && s.personOff, pressed && s.pressed]}
                      accessibilityRole={single ? 'radio' : 'checkbox'}
                      accessibilityState={{ checked: on, disabled: busyElsewhere }}
                    >
                      <Avatar name={p.name} picture={p.picture} size={34} />
                      <View style={s.flex}>
                        <Text style={[s.personName, on && s.personNameOn]} numberOfLines={1}>{p.name}</Text>
                        {(busyElsewhere || excuse) && (
                          <View style={s.badges}>
                            {busyElsewhere && <Text style={s.elsewhere}>In {PART_LABEL[elsewhere!]}</Text>}
                            {excuse && <Chip label={excuse.status === 'Approved' ? 'Excused' : 'Excuse pending'} color={excuse.status === 'Approved' ? c.danger : c.warning} icon="calendar-minus" />}
                          </View>
                        )}
                      </View>
                      <View style={[single ? s.radio : s.check, on && { backgroundColor: color, borderColor: color }]}>
                        {on && <Icon name="check" size={11} color="#ffffff" />}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </Card>
        );
      })}

      {searching && people && !parts.some(({ key }) => candidates(key).some((p) => lower(p.name).includes(lower(query)))) && (
        <Card><EmptyState icon="magnifying-glass" title={`Nobody named “${query.trim()}”`} text="Only Praise & Worship members with that position can be plotted." /></Card>
      )}

      {error && <Banner tone="danger" text={error} />}
      <Button title={existing ? 'Save Lineup' : 'Plot Lineup'} icon="check" onPress={save} loading={saving} disabled={deleting || !!clash} style={s.save} />
      {existing && <Button title="Remove Lineup" icon="trash-can" variant="danger" onPress={remove} loading={deleting} disabled={saving} />}
    </Screen>
  );
}

// ---- A small month calendar: Sundays stand out, taken dates have a dot ----

function MonthCalendar({ value, today, onPick }: { value: string; today: string; onPick: (date: string) => void }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const [month, setMonth] = useState(monthOf(value));
  const plan = usePlannerMonth(month);
  const taken = new Set((plan.data?.lineups || []).map((l) => l.date));

  const [y, m] = month.split('-').map(Number);
  const lead = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ];
  while (cells.length % 7) cells.push(null);

  return (
    <View style={s.cal}>
      <View style={s.calHead}>
        <Pressable onPress={() => setMonth(shiftMonth(month, -1))} hitSlop={10} style={s.calArrow} accessibilityLabel="Previous month">
          <Icon name="chevron-left" size={13} color={c.goldText} />
        </Pressable>
        <Text style={s.calTitle}>{monthLabel(month)}</Text>
        <Pressable onPress={() => setMonth(shiftMonth(month, 1))} hitSlop={10} style={s.calArrow} accessibilityLabel="Next month">
          <Icon name="chevron-right" size={13} color={c.goldText} />
        </Pressable>
      </View>
      <View style={s.calRow}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <Text key={i} style={[s.calDow, i === 0 && s.calSunday]}>{d}</Text>)}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, row) => (
        <View key={row} style={s.calRow}>
          {cells.slice(row * 7, row * 7 + 7).map((d, i) => {
            if (!d) return <View key={i} style={s.calCell} />;
            const selected = d === value;
            const sunday = i === 0;
            const past = d < today;
            return (
              <Pressable key={d} onPress={() => onPick(d)} style={s.calCell} accessibilityRole="button" accessibilityLabel={longDate(d)} accessibilityState={{ selected }}>
                <View style={[s.calDay, selected && s.calDayOn, !selected && d === today && s.calToday]}>
                  <Text style={[s.calNum, sunday && s.calNumSunday, past && s.calNumPast, selected && s.calNumOn]}>{Number(d.slice(8))}</Text>
                </View>
                <View style={[s.calDot, taken.has(d) && { backgroundColor: selected ? c.goldText : c.secondary }]} />
              </Pressable>
            );
          })}
        </View>
      ))}
      <Text style={s.calHint}>A dot marks a date that already has a lineup.</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  muted: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, lineHeight: 19 },
  pressed: { opacity: 0.85 },
  top: { marginTop: space.md, marginBottom: -space.md },

  dateHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dateBadge: { width: 58, height: 62, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  dateBadgeMonth: { color: 'rgba(255, 255, 255, 0.9)', fontSize: 10.5, fontFamily: fonts.bold, letterSpacing: 1 },
  dateBadgeDay: { color: '#ffffff', fontSize: 26, lineHeight: 29, fontFamily: fonts.bold },
  kicker: { color: c.goldText, fontSize: font.xs, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 1 },
  bigDate: { color: c.text, fontSize: font.lg, fontFamily: fonts.bold },
  changeDate: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.goldMuted },

  label: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.semibold, marginBottom: 6, marginTop: space.sm },
  peopleHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md, marginBottom: space.sm },
  sectionTitle: { color: c.text, fontSize: font.lg, fontFamily: fonts.bold },
  clear: { padding: 10 },

  partCard: { paddingVertical: space.md },
  partHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  partIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  partTitle: { color: c.text, fontSize: font.md, fontFamily: fonts.bold },
  partSummary: { color: c.goldText, fontSize: font.sm, fontFamily: fonts.semibold, marginTop: 1 },
  partEmpty: { color: c.textMuted, fontFamily: fonts.regular },
  count: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  countText: { color: '#ffffff', fontSize: font.xs, fontFamily: fonts.bold },
  list: { marginTop: space.md, gap: 6 },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 7, paddingHorizontal: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: 'transparent' },
  personOff: { opacity: 0.4 },
  personName: { color: c.text, fontSize: font.md, fontFamily: fonts.medium },
  personNameOn: { fontFamily: fonts.bold },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 3 },
  elsewhere: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.semibold },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: c.borderStrong, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: c.borderStrong, alignItems: 'center', justifyContent: 'center' },

  save: { marginTop: space.sm, marginBottom: space.md },

  cal: { marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: c.border },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
  calArrow: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: c.goldMuted },
  calTitle: { color: c.text, fontSize: font.md, fontFamily: fonts.bold },
  calRow: { flexDirection: 'row' },
  calDow: { flex: 1, textAlign: 'center', color: c.textMuted, fontSize: font.xs, fontFamily: fonts.semibold, paddingVertical: 4 },
  calSunday: { color: c.goldText },
  calCell: { flex: 1, alignItems: 'center', paddingVertical: 3 },
  calDay: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  calDayOn: { backgroundColor: c.secondary },
  calToday: { borderWidth: 1.5, borderColor: c.secondary },
  calNum: { color: c.text, fontSize: font.sm, fontFamily: fonts.medium },
  calNumSunday: { color: c.goldText, fontFamily: fonts.bold },
  calNumPast: { opacity: 0.45 },
  calNumOn: { color: '#ffffff', fontFamily: fonts.bold, opacity: 1 },
  calDot: { width: 5, height: 5, borderRadius: 3, marginTop: 2, backgroundColor: 'transparent' },
  calHint: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular, textAlign: 'center', marginTop: space.sm },
}));
