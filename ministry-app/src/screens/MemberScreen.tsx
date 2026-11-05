import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../api';
import type { StackProps } from '../routes';
import { useSession } from '../session';
import { Avatar, Banner, Button, Card, Chip, DateBox, EmptyState, Icon, LoadingView, Screen, SectionTitle, type IconName } from '../components';
import { font, fonts, makeStyles, partColor, radius, space, tint, useTheme } from '../theme';
import { firstName, monthLabel, monthDay } from '../utils';
import type { MemberHistory, MyDay } from '../types';

// Teammates looked at this session, so going back to one is instant.
const seen = new Map<string, MemberHistory>();

// A teammate: their ministry roles, and every date they were (or will be) on a
// lineup, six months back to three months ahead.
export default function MemberScreen({ route, navigation }: StackProps<'Member'>) {
  const { userId } = route.params;
  const name = route.params.name || 'Teammate';
  const { home } = useSession();
  const { colors: c } = useTheme();
  const s = useStyles();
  const [data, setData] = useState<MemberHistory | null>(seen.get(userId) || null);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => { navigation.setOptions({ title: firstName(name) }); }, [navigation, name]);

  const load = useCallback(async () => {
    setError(null);
    const res = await api.member(userId);
    if (res.ok) { seen.set(userId, res.data); setData(res.data); } else setError(res.message);
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  if (!data) {
    if (!error) return <LoadingView message={`Loading ${firstName(name)}'s schedule…`} />;
    return (
      <Screen stacked center>
        <EmptyState icon="circle-exclamation" title="Could not load" text={error} />
        <Button title="Try again" icon="rotate-right" onPress={load} />
      </Screen>
    );
  }

  const today = data.today;
  const upcoming = data.days.filter((d) => d.date >= today).reverse();
  const past = data.days.filter((d) => d.date < today);
  const months: { label: string; days: MyDay[] }[] = [];
  for (const d of past) {
    const label = monthLabel(d.date.slice(0, 7));
    const last = months[months.length - 1];
    if (last && last.label === label) last.days.push(d); else months.push({ label, days: [d] });
  }
  const isMe = home?.profile.id === data.id;

  return (
    <Screen stacked onRefresh={load}>
      <Card raised style={s.head}>
        <Avatar name={data.name} picture={data.picture} size={72} ring={c.secondary} />
        <Text style={s.name}>{data.name}{isMe ? ' (You)' : ''}</Text>
        <View style={s.groups}>
          {data.groups.map((g) => (
            <View key={g.label} style={s.group}>
              <Text style={s.groupLabel}>{g.label}</Text>
              {g.positions.length > 0 && <Text style={s.groupPositions}>{g.positions.join(' · ')}</Text>}
            </View>
          ))}
        </View>
        <View style={s.stats}>
          <Stat value={data.served} label="Served" note="last 6 months" />
          <View style={s.statLine} />
          <Stat value={upcoming.filter((d) => d.state === 'serving').length} label="Upcoming" note="next 3 months" />
          <View style={s.statLine} />
          <Stat value={data.rests} label="Rest days" note="last 6 months" />
        </View>
      </Card>
      {error && <Banner tone="warn" text={`Showing saved data. ${error}`} />}

      <SectionTitle title="Coming up" icon="calendar-check" />
      {upcoming.length ? upcoming.map((d) => <HistoryRow key={d.date} day={d} today={today} onPress={() => d.scheduleId && navigation.navigate('Lineup', { scheduleId: d.scheduleId, date: d.date })} />)
        : <Card><EmptyState icon="mug-hot" title="Nothing coming up" text="Not on a lineup in the next three months." /></Card>}

      {months.map((m) => (
        <View key={m.label}>
          <SectionTitle title={m.label} icon="clock-rotate-left" />
          {m.days.map((d) => <HistoryRow key={d.date} day={d} today={today} onPress={() => d.scheduleId && navigation.navigate('Lineup', { scheduleId: d.scheduleId, date: d.date })} />)}
        </View>
      ))}
      {!months.length && <Text style={s.muted}>No lineups in the last six months.</Text>}
    </Screen>
  );
}

function Stat({ value, label, note }: { value: number; label: string; note: string }) {
  const s = useStyles();
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statNote}>{note}</Text>
    </View>
  );
}

function HistoryRow({ day: d, today, onPress }: { day: MyDay; today: string; onPress: () => void }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const extra: { text: string; color: string; icon: IconName }[] = [];
  if (d.state === 'covered') extra.push({ text: `Covered by ${d.sub?.substituteName || 'a substitute'}`, color: c.info, icon: 'people-arrows' });
  if (d.state === 'excused') extra.push({ text: 'Excused', color: c.danger, icon: 'calendar-xmark' });
  if (d.excuse?.status === 'Pending') extra.push({ text: 'Excuse pending', color: c.warning, icon: 'hourglass-half' });
  if (d.covering) extra.push({ text: `Covered for ${d.covering}`, color: c.info, icon: 'user-check' });
  if (d.swap?.status === 'Approved') extra.push({ text: `Swapped with ${d.swap.otherName} (${monthDay(d.swap.otherDate)})`, color: c.band, icon: 'right-left' });
  if (d.attendance) extra.push({ text: d.attendance, color: d.attendance === 'Present' ? c.success : d.attendance === 'Absent' ? c.danger : c.warning, icon: 'clipboard-check' });
  return (
    <Card onPress={d.scheduleId ? onPress : undefined} style={[s.row, d.date < today && s.faded]}>
      <DateBox date={d.date} today={today} size="sm" />
      <View style={s.flex}>
        <View style={s.chips}>
          {d.parts.length ? d.parts.map((p) => <Chip key={p} label={p} color={partColor(c, p)} solid={d.state === 'serving'} />)
            : <Chip label={d.state === 'covered' ? 'Covered' : d.state === 'excused' ? 'Excused' : 'Not on it'} color={c.textSecondary} />}
        </View>
        {d.leader && <Text style={s.leader}>Led by <Text style={s.leaderName}>{d.leader}</Text></Text>}
        {extra.map((x) => (
          <View key={x.text} style={s.noteRow}><Icon name={x.icon} size={10} color={x.color} /><Text style={[s.noteText, { color: x.color }]}>{x.text}</Text></View>
        ))}
      </View>
      {d.scheduleId && <Icon name="chevron-right" size={13} color={c.textMuted} />}
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  muted: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, textAlign: 'center', marginTop: space.md },
  head: { alignItems: 'center', paddingVertical: space.xl },
  name: { color: c.text, fontSize: font.xl, fontFamily: fonts.bold, marginTop: space.md, textAlign: 'center' },
  groups: { alignItems: 'center', gap: 6, marginTop: space.sm },
  group: { alignItems: 'center' },
  groupLabel: { color: c.goldText, fontSize: font.sm, fontFamily: fonts.bold },
  groupPositions: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, textAlign: 'center' },
  stats: { flexDirection: 'row', alignItems: 'center', marginTop: space.lg, paddingTop: space.md, borderTopWidth: 1, borderTopColor: c.border, alignSelf: 'stretch' },
  stat: { flex: 1, alignItems: 'center' },
  statLine: { width: 1, height: 36, backgroundColor: c.border },
  statValue: { color: c.text, fontSize: font.xxl, fontFamily: fonts.bold },
  statLabel: { color: c.text, fontSize: font.sm, fontFamily: fonts.semibold },
  statNote: { color: c.textMuted, fontSize: 10, fontFamily: fonts.regular },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  faded: { opacity: 0.6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  leader: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, marginTop: 4 },
  leaderName: { color: c.goldText, fontFamily: fonts.heavy },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  noteText: { fontSize: font.xs, fontFamily: fonts.semibold },
  pill: { borderRadius: radius.pill, backgroundColor: tint(c.secondary, 0.1) },
}));
