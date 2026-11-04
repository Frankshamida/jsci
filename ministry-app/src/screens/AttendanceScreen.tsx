import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSession } from '../session';
import { Card, EmptyState, Screen, SectionTitle, StatusBadge, statusColor } from '../components';
import { colors, font, radius, space } from '../theme';
import { dayOfMonth, monthYear, weekday } from '../utils';
import type { AttendanceRecord } from '../types';

const ATTENDED = ['Present', 'Late'];

export default function AttendanceScreen() {
  const { home, refresh, refreshing } = useSession();

  if (!home) return <Screen><EmptyState icon="hourglass-outline" title="Loading…" /></Screen>;
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
    <Screen refreshing={refreshing} onRefresh={() => refresh(true)}>
      <Text style={s.title}>Attendance</Text>

      {records.length === 0 ? (
        <Card><EmptyState icon="checkmark-done-circle-outline" title="No attendance yet" text="Your attendance shows here once you are checked in at church." /></Card>
      ) : (
        <>
          <Card style={s.summary}>
            <View style={s.ring}>
              <Text style={s.rate}>{rate}%</Text>
              <Text style={s.rateLabel}>attended</Text>
            </View>
            <View style={s.flex}>
              <Stat label="Present" value={count('Present')} />
              <Stat label="Late" value={count('Late')} />
              <Stat label="Excused" value={count('Excused')} />
              <Stat label="Absent" value={count('Absent')} />
            </View>
          </Card>
          <Text style={s.note}>Based on your latest {records.length} records.{unmarked ? ` ${unmarked} of your recent lineup dates ${unmarked === 1 ? 'is' : 'are'} not marked yet.` : ''}</Text>

          {months.map((m) => (
            <View key={m.label}>
              <SectionTitle title={m.label} />
              <Card style={s.list}>
                {m.items.map((r, i) => (
                  <View key={r.id} style={[s.row, i > 0 && s.divider]}>
                    <View style={[s.dot, { backgroundColor: statusColor(r.status) }]} />
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={s.stat}>
      <View style={[s.dot, { backgroundColor: statusColor(label) }]} />
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  title: { color: colors.text, fontSize: font.xxl, fontWeight: '900', marginTop: space.sm, marginBottom: space.md },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  ring: { width: 104, height: 104, borderRadius: 52, borderWidth: 6, borderColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  rate: { color: colors.text, fontSize: font.xxl, fontWeight: '900' },
  rateLabel: { color: colors.textSecondary, fontSize: font.xs },
  stat: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 3 },
  statLabel: { flex: 1, color: colors.textSecondary, fontSize: font.sm },
  statValue: { color: colors.text, fontSize: font.md, fontWeight: '800' },
  note: { color: colors.textMuted, fontSize: font.xs, marginBottom: space.sm },
  list: { paddingVertical: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  day: { color: colors.text, fontSize: font.md, fontWeight: '700', width: 64 },
  notes: { flex: 1, color: colors.textMuted, fontSize: font.xs },
});
