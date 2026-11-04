import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../session';
import { useAppNav } from '../routes';
import { api } from '../api';
import { Banner, Button, Card, Chip, EmptyState, Field, Screen, SectionTitle, StatusBadge } from '../components';
import { colors, font, partColor, space } from '../theme';
import { firstName, longDate, relativeDay } from '../utils';
import type { Excuse, SubRequest } from '../types';

export default function RequestsScreen() {
  const { home, profile, refresh, refreshing } = useSession();
  const nav = useAppNav();
  const [busy, setBusy] = useState<string | null>(null);

  if (!home || !profile) return <Screen><EmptyState icon="hourglass-outline" title="Loading…" /></Screen>;

  // Runs one change, then reloads the dashboard so every tab agrees.
  const run = async (id: string, call: () => Promise<{ ok: boolean; message?: string }>, done?: string) => {
    setBusy(id);
    const res = await call();
    if (res.ok) await refresh(true);
    setBusy(null);
    if (!res.ok) Alert.alert('Something went wrong', res.message);
    else if (done) Alert.alert('Done', done);
  };

  const accept = (sub: SubRequest) => Alert.alert(
    'Cover this part?',
    `You will be ${sub.roleType} on ${longDate(sub.date)} in place of ${sub.requesterName}.`,
    [{ text: 'Not now', style: 'cancel' }, { text: "Yes, I'll cover", onPress: () => run(sub.id, () => api.acceptSub(sub.id), `Thank you! You are now on the lineup for ${longDate(sub.date)}.`) }],
  );
  const cancelSub = (sub: SubRequest) => Alert.alert('Cancel this request?', undefined, [
    { text: 'Keep it', style: 'cancel' }, { text: 'Cancel request', style: 'destructive', onPress: () => run(sub.id, () => api.cancelSub(sub.id)) },
  ]);
  const cancelExcuse = (ex: Excuse) => Alert.alert('Take back this excuse?', undefined, [
    { text: 'Keep it', style: 'cancel' }, { text: 'Take back', style: 'destructive', onPress: () => run(ex.id, () => api.cancelExcuse(ex.id)) },
  ]);

  const myRequests = home.substitutes.filter((x) => x.requesterId === profile.id);
  const covering = home.substitutes.filter((x) => x.substituteId === profile.id && x.status === 'Accepted');
  const upcoming = (d: string) => d >= home.today;

  return (
    <Screen refreshing={refreshing} onRefresh={() => refresh(true)}>
      <Text style={s.title}>Excuse & Substitute</Text>
      <View style={s.actions}>
        <Button title="File an Excuse" icon="document-text-outline" variant="secondary" style={s.flex} onPress={() => nav.navigate('RequestForm', { mode: 'excuse' })} />
        <Button title="Ask for a Sub" icon="people-outline" variant="secondary" style={s.flex} onPress={() => nav.navigate('RequestForm', { mode: 'sub' })} />
      </View>

      {/* Teammates asking for cover in a part you can do */}
      <SectionTitle title="Teammates need a sub" />
      {home.openSubs.length === 0 ? (
        <Text style={s.muted}>Nobody needs a substitute right now.</Text>
      ) : home.openSubs.map((sub) => (
        <Card key={sub.id} style={s.openCard}>
          <View style={s.head}>
            <Text style={s.when}>{relativeDay(sub.date, home.today)} · {longDate(sub.date)}</Text>
            <Chip label={sub.roleType} color={partColor(sub.roleType)} />
          </View>
          <Text style={s.name}>{sub.requesterName}</Text>
          {sub.reason ? <Text style={s.reason}>“{sub.reason}”</Text> : null}
          <Button title="I'll cover" icon="hand-left" onPress={() => accept(sub)} loading={busy === sub.id} style={s.cta} />
        </Card>
      ))}

      {/* What you asked for */}
      <SectionTitle title="My substitute requests" />
      {myRequests.length === 0 ? <Text style={s.muted}>You have not asked for a substitute.</Text> : myRequests.map((sub) => (
        <MyRequest key={sub.id} sub={sub} today={home.today} busy={busy === sub.id} onCancel={() => cancelSub(sub)}
          onThank={(message) => run(sub.id, () => api.thankSub(sub.id, message), `Your thanks was sent to ${firstName(sub.substituteName || '')}.`)} />
      ))}

      {covering.length > 0 && (
        <>
          <SectionTitle title="You are covering" />
          {covering.map((sub) => (
            <Card key={sub.id}>
              <View style={s.head}>
                <Text style={s.when}>{longDate(sub.date)}</Text>
                <Chip label={sub.roleType} color={partColor(sub.roleType)} />
              </View>
              <Text style={s.muted}>For {sub.requesterName}</Text>
            </Card>
          ))}
        </>
      )}

      {/* Excuses */}
      <SectionTitle title="My excuses" />
      {home.excuses.length === 0 ? <Text style={s.muted}>No excuses filed.</Text> : home.excuses.map((ex) => (
        <Card key={ex.id} style={!upcoming(ex.excuse_date) && s.faded}>
          <View style={s.head}>
            <Text style={s.when}>{longDate(ex.excuse_date)}</Text>
            <StatusBadge status={ex.status} />
          </View>
          <Text style={s.muted}>{ex.role_type}{ex.reason ? ` · ${ex.reason}` : ''}</Text>
          {ex.status === 'Pending' && upcoming(ex.excuse_date) && (
            <Button compact variant="ghost" title="Take back" onPress={() => cancelExcuse(ex)} loading={busy === ex.id} style={s.cta} />
          )}
        </Card>
      ))}
    </Screen>
  );
}

function MyRequest({ sub, today, busy, onCancel, onThank }: {
  sub: SubRequest; today: string; busy: boolean; onCancel: () => void; onThank: (message: string) => void;
}) {
  const [writing, setWriting] = useState(false);
  const [message, setMessage] = useState('');
  const canCancel = ['Pending Admin', 'Open for Sub'].includes(sub.status) && sub.date >= today;
  const canThank = sub.status === 'Accepted' && !sub.thankYouSent && !!sub.substituteName;
  const statusLabel = sub.status === 'Accepted' && sub.substituteName ? `Covered by ${firstName(sub.substituteName)}`
    : sub.status === 'Pending Admin' ? 'Waiting for admin'
    : sub.status === 'Open for Sub' ? 'Open to teammates' : sub.status;

  return (
    <Card style={sub.date < today && s.faded}>
      <View style={s.head}>
        <Text style={s.when}>{longDate(sub.date)}</Text>
        <StatusBadge status={sub.status} label={statusLabel} />
      </View>
      <Text style={s.muted}>{sub.roleType}{sub.reason ? ` · ${sub.reason}` : ''}</Text>
      {sub.thankYouSent && <Text style={s.thanked}>Thanks sent ✓</Text>}
      {canCancel && <Button compact variant="ghost" title="Cancel request" onPress={onCancel} loading={busy} style={s.cta} />}
      {canThank && !writing && <Button compact variant="ghost" icon="heart-outline" title={`Thank ${firstName(sub.substituteName!)}`} onPress={() => setWriting(true)} style={s.cta} />}
      {canThank && writing && (
        <View style={s.cta}>
          <Field label="Your message" value={message} onChangeText={setMessage} placeholder="Thank you for covering for me!" multiline maxLength={300} />
          {!message.trim() && <Banner tone="info" text="Leave it empty to send a simple thank-you." />}
          <View style={s.actions}>
            <Button compact variant="secondary" title="Cancel" onPress={() => setWriting(false)} style={s.flex} />
            <Button compact title="Send" icon="send" loading={busy} style={s.flex}
              onPress={() => onThank(message.trim() || `Thank you for covering for me, ${firstName(sub.substituteName!)}! God bless!`)} />
          </View>
        </View>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  title: { color: colors.text, fontSize: font.xxl, fontWeight: '900', marginTop: space.sm, marginBottom: space.md },
  actions: { flexDirection: 'row', gap: space.sm },
  muted: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 19 },
  openCard: { borderColor: 'rgba(76,195,224,0.4)' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, marginBottom: 4 },
  when: { flex: 1, color: colors.goldLight, fontSize: font.sm, fontWeight: '800' },
  name: { color: colors.text, fontSize: font.lg, fontWeight: '800' },
  reason: { color: colors.textSecondary, fontSize: font.sm, fontStyle: 'italic', marginTop: 4 },
  cta: { marginTop: space.md },
  thanked: { color: colors.success, fontSize: font.xs, fontWeight: '700', marginTop: 6 },
  faded: { opacity: 0.6 },
});
