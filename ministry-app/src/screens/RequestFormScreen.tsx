import React, { useLayoutEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useSession } from '../session';
import { upcomingMine } from '../lineups';
import { api } from '../api';
import type { StackProps } from '../routes';
import { Banner, Button, Card, ChoiceRow, EmptyState, Field, Icon, Screen } from '../components';
import { font, fonts, makeStyles, space, useTheme } from '../theme';
import { longDate, shortDate, upcomingSundays } from '../utils';
import type { RoleType } from '../types';

// Two forms in one:
//   excuse  "I can't serve on this date" - the plotter leaves you off it
//   sub     "I'm on this lineup but can't make it" - a teammate covers your part
export default function RequestFormScreen({ route, navigation }: StackProps<'RequestForm'>) {
  const { mode } = route.params;
  const { home, profile, refresh } = useSession();
  const { colors: c } = useTheme();
  const s = useStyles();
  const isExcuse = mode === 'excuse';

  // Excuse: the coming Sundays and any other date you are on. Sub: your upcoming lineups.
  const mine = home ? upcomingMine(home) : [];
  const dates = useMemo(() => {
    if (!isExcuse) return mine.map((l) => l.date);
    return Array.from(new Set([...upcomingSundays(8), ...mine.map((l) => l.date)])).sort();
  }, [isExcuse, home]); // eslint-disable-line react-hooks/exhaustive-deps

  const startDate = route.params.date
    || (route.params.scheduleId ? mine.find((l) => l.scheduleId === route.params.scheduleId)?.date : undefined)
    || dates[0] || null;
  const [date, setDate] = useState<string | null>(startDate);
  const lineupOn = (d: string | null) => mine.find((l) => l.date === d) || null;
  const lineup = lineupOn(date);

  // The parts you could be excused from / covered in on that date.
  const roleOptions: RoleType[] = isExcuse
    ? (lineup?.myRoleTypes.length ? lineup.myRoleTypes : profile?.coverableRoleTypes || [])
    : lineup?.myRoleTypes || [];
  const [roleType, setRoleType] = useState<RoleType | null>(roleOptions[0] || null);
  const role = roleType && roleOptions.includes(roleType) ? roleType : roleOptions[0] || null;

  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: isExcuse ? 'File an Excuse' : 'Ask for a Substitute' });
  }, [navigation, isExcuse]);

  if (!home || !profile) return <Screen stacked><EmptyState icon="hourglass-half" title="Loading…" /></Screen>;
  if (!dates.length) {
    return (
      <Screen stacked>
        <EmptyState icon="calendar" title="No upcoming lineups" text="You can ask for a substitute once you are plotted on a date." />
      </Screen>
    );
  }

  const already = isExcuse
    ? home.excuses.find((e) => e.excuse_date === date && e.status !== 'Rejected')
    : home.substitutes.find((x) => x.date === date && x.requesterId === profile.id && ['Pending Admin', 'Open for Sub', 'Accepted'].includes(x.status));

  const submit = async () => {
    if (!date) return setError('Pick a date.');
    if (!role) return setError('Pick the part.');
    if (!reason.trim()) return setError('Write a short reason.');
    setError(null);
    setSaving(true);
    const res = isExcuse
      ? await api.fileExcuse(date, role, reason.trim())
      : await api.requestSub(lineup!.scheduleId, role, reason.trim());
    if (!res.ok) { setSaving(false); return setError(res.message); }
    await refresh(true);
    setSaving(false);
    navigation.goBack();
  };

  return (
    <Screen stacked>
      <Card raised style={s.intro}>
        <Icon name={isExcuse ? 'calendar-minus' : 'people-arrows'} size={20} color={c.goldText} />
        <Text style={s.help}>
          {isExcuse
            ? 'Let the team know you cannot serve on a date. The admins review it, and the plotter leaves you off that lineup.'
            : 'Ask a teammate to cover your part. Once an admin approves, it opens to teammates who can take it.'}
        </Text>
      </Card>

      <Text style={s.label}>Date</Text>
      <ChoiceRow
        options={dates}
        value={date}
        onChange={(d) => { setDate(d); setError(null); }}
        labels={Object.fromEntries(dates.map((d) => [d, `${shortDate(d)}${lineupOn(d) ? ' •' : ''}`]))}
      />
      {date && <Text style={s.selected}>{longDate(date)}{lineup ? ` · you are ${lineup.myParts.join(', ')}` : ''}</Text>}
      {isExcuse && <Text style={s.hint}>• marks dates you are already plotted on.</Text>}

      {roleOptions.length > 1 && (
        <View>
          <Text style={s.label}>Part</Text>
          <ChoiceRow options={roleOptions} value={role} onChange={setRoleType} />
        </View>
      )}

      <Field
        label="Reason"
        value={reason}
        onChangeText={setReason}
        placeholder={isExcuse ? 'e.g. Out of town for a family event' : 'e.g. Sick, cannot sing this Sunday'}
        multiline
        maxLength={500}
      />

      {already && <Banner tone="warn" text={isExcuse ? `You already filed an excuse for this date (${already.status}).` : `You already asked for a substitute on this date (${already.status}).`} />}
      {error && <Banner tone="danger" text={error} />}
      <Button title={isExcuse ? 'Send Excuse' : 'Ask for a Substitute'} icon="paper-plane" onPress={submit} loading={saving} disabled={!!already} />
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  intro: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  help: { flex: 1, color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, lineHeight: 19 },
  label: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.semibold, marginBottom: 6, marginTop: space.sm },
  selected: { color: c.goldText, fontSize: font.sm, fontFamily: fonts.semibold, marginTop: -4, marginBottom: space.sm },
  hint: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular, marginBottom: space.md },
}));
