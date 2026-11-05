import React from 'react';
import { Text, View } from 'react-native';
import { useSession } from '../session';
import { Card, EmptyState, LoadingView, Screen, SectionTitle, StatusBadge, statusColor } from '../components';
import { font, fonts, makeStyles, radius, space, useTheme } from '../theme';
import { dayOfMonth, monthYear, weekday } from '../utils';
import type { AttendanceRecord } from '../types';

const ATTENDED = ['Present', 'Late'];

export default function AttendanceScreen() {
  const { home, refresh } = useSession();
  const { colors: c } = useTheme();
  const s = useStyles();

  if (!home) return <LoadingView message="Loading your attendance…" />;
  const records = home.attendance;

  // Counts and the rate over the records the server sent (the latest 60).
  const count = (status: string) => records.filter((r) => r.status === status).length;
  const attended = records.filter((r) => ATTENDED.includes(r.status)).length;
  const rate = records.length ? Math.round((attended / records.length) * 100) : 0;

  // Most recent first, grouped by month.
  const months: { label: string; items: AttendanceRecord[] }[] = [];
  for (const r of records) {
    const label = monthYear(r.event_date);
    const last = months[months.length - 1];
    if (last && last.label === label) last.items.push(r);
    else months.push({ label, items: [r] });
  }

  // Sundays served lately with no attendance mark yet.
  const marked = new Set(records.map((r) => r.event_date));
  const unmarked = home.assignments.filter((l) => l.date < home.today && !l.subbedOut && !marked.has(l.date)).length;

  return (
    <Screen onRefresh={() => refresh(true)}>
      <Text style={s.title}>Attendance</Text>

      {records.length === 0 ? (
        <Card><EmptyState icon="clipboard-check" title="No attendance yet" text="Your attendance shows here once you are checked in at church." /></Card>
      ) : (
        <>
          <Card style={s.summary}>
            <View style={s.ring}>
              <Text style={s.rate}>{rate}%</Text>
              <Text style={s.rateLabel}>attended</Text>
            </View>
            <View style={s.flex}>
              {['Present', 'Late', 'Excused', 'Absent'].map((label) => (
                <View key={label} style={s.stat}>
                  <View style={[s.dot, { backgroundColor: statusColor(c, label) }]} />
                  <Text style={s.statLabel}>{label}</Text>
                  <Text style={s.statValue}>{count(label)}</Text>
                </View>
              ))}
            </View>
          </Card>
          <Text style={s.note}>Based on your latest {records.length} records.{unmarked ? ` ${unmarked} of your recent lineup dates ${unmarked === 1 ? 'is' : 'are'} not marked yet.` : ''}</Text>

          {months.map((m) => (
            <View key={m.label}>
              <SectionTitle title={m.label} icon="calendar" />
              <Card style={s.list}>
                {m.items.map((r, i) => (
                  <View key={r.id} style={[s.row, i > 0 && s.divider]}>
                    <View style={[s.dot, { backgroundColor: statusColor(c, r.status) }]} />
                    <Text style={s.day}>{weekday(r.event_date)} {dayOfMonth(r.event_date)}</Text>
                    <Text style={s.notes} numberOfLines={1}>{r.notes || ''}</Text>
                    <StatusBadge status={r.status} />
                  </View>
                ))}
              </Card>
            </View>
          ))}
        </>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  title: { color: c.text, fontSize: font.xxl, fontFamily: fonts.bold, marginTop: space.sm, marginBottom: space.md },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  ring: { width: 104, height: 104, borderRadius: 52, borderWidth: 6, borderColor: c.secondary, alignItems: 'center', justifyContent: 'center', backgroundColor: c.goldMuted },
  rate: { color: c.text, fontSize: font.xxl, fontFamily: fonts.bold },
  rateLabel: { color: c.textSecondary, fontSize: font.xs, fontFamily: fonts.regular },
  stat: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 3 },
  statLabel: { flex: 1, color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular },
  statValue: { color: c.text, fontSize: font.md, fontFamily: fonts.bold },
  note: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular, marginBottom: space.sm },
  list: { paddingVertical: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: c.border },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  day: { color: c.text, fontSize: font.md, fontFamily: fonts.semibold, width: 64 },
  notes: { flex: 1, color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular },
}));
