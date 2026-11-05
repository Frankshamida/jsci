import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useSession } from '../session';
import { useAppNav } from '../routes';
import { api } from '../api';
import { useDialog } from '../dialog';
import { Banner, Button, Card, Chip, Field, Icon, LoadingView, Screen, SectionTitle, StatusBadge } from '../components';
import { font, fonts, makeStyles, partColor, space, tint, useTheme } from '../theme';
import { firstName, longDate, relativeDay } from '../utils';
import type { Excuse, SubRequest } from '../types';

export default function RequestsScreen() {
  const { home, profile, refresh } = useSession();
  const { colors: c } = useTheme();
  const s = useStyles();
  const dialog = useDialog();
  const nav = useAppNav();
  const [busy, setBusy] = useState<string | null>(null);

  if (!home || !profile) return <LoadingView message="Loading your requests…" />;

  // Runs one change, then reloads the dashboard so every tab agrees.
  const run = async (id: string, call: () => Promise<{ ok: boolean; message?: string }>, done?: string) => {
    setBusy(id);
    const res = await call();
    if (res.ok) await refresh(true);
    setBusy(null);
    if (!res.ok) dialog.alert({ icon: 'circle-exclamation', tone: 'danger', title: 'Something went wrong', message: res.message });
    else if (done) dialog.alert({ icon: 'circle-check', tone: 'success', title: 'Done', message: done });
  };

  const accept = async (sub: SubRequest) => {
    const ok = await dialog.confirm({
      icon: 'user-check', title: 'Cover this part?',
      message: `You will be ${sub.roleType} on ${longDate(sub.date)} in place of ${sub.requesterName}.`,
      confirmText: "Yes, I'll cover", cancelText: 'Not now',
    });
    if (ok) run(sub.id, () => api.acceptSub(sub.id), `Thank you! You are now on the lineup for ${longDate(sub.date)}.`);
  };
  const cancelSub = async (sub: SubRequest) => {
    const ok = await dialog.confirm({
      icon: 'xmark', tone: 'danger', title: 'Cancel this request?',
      message: `Your substitute request for ${longDate(sub.date)} will be withdrawn.`, confirmText: 'Cancel request', cancelText: 'Keep it',
    });
    if (ok) run(sub.id, () => api.cancelSub(sub.id));
  };
  const cancelExcuse = async (ex: Excuse) => {
    const ok = await dialog.confirm({
      icon: 'calendar-minus', tone: 'danger', title: 'Take back this excuse?',
      message: `You will be available again on ${longDate(ex.excuse_date)}.`, confirmText: 'Take back', cancelText: 'Keep it',
    });
    if (ok) run(ex.id, () => api.cancelExcuse(ex.id));
  };

  const myRequests = home.substitutes.filter((x) => x.requesterId === profile.id);
  const covering = home.substitutes.filter((x) => x.substituteId === profile.id && x.status === 'Accepted');
  const upcoming = (d: string) => d >= home.today;

  return (
    <Screen onRefresh={() => refresh(true)}>
      <Text style={s.title}>Excuse & Substitute</Text>
      <View style={s.actions}>
        <Button title="File an Excuse" icon="calendar-minus" variant="secondary" style={s.flex} onPress={() => nav.navigate('RequestForm', { mode: 'excuse' })} />
        <Button title="Ask for a Sub" icon="people-arrows" variant="secondary" style={s.flex} onPress={() => nav.navigate('RequestForm', { mode: 'sub' })} />
      </View>

      {/* Teammates asking for cover in a part you can do */}
      <SectionTitle title="Teammates need a sub" icon="hand" />
      {home.openSubs.length === 0 ? (
        <Text style={s.muted}>Nobody needs a substitute right now.</Text>
      ) : home.openSubs.map((sub) => (
        <Card key={sub.id} style={s.openCard}>
          <View style={s.head}>
            <Text style={s.when}>{relativeDay(sub.date, home.today)} · {longDate(sub.date)}</Text>
            <Chip label={sub.roleType} color={partColor(c, sub.roleType)} />
          </View>
          <Text style={s.name}>{sub.requesterName}</Text>
          {sub.reason ? <Text style={s.reason}>“{sub.reason}”</Text> : null}
          <Button title="I'll cover" icon="user-check" onPress={() => accept(sub)} loading={busy === sub.id} style={s.cta} />
        </Card>
      ))}

      {/* What you asked for */}
      <SectionTitle title="My substitute requests" icon="people-arrows" />
      {myRequests.length === 0 ? <Text style={s.muted}>You have not asked for a substitute.</Text> : myRequests.map((sub) => (
        <MyRequest key={sub.id} sub={sub} today={home.today} busy={busy === sub.id} onCancel={() => cancelSub(sub)}
          onThank={(message) => run(sub.id, () => api.thankSub(sub.id, message), `Your thanks was sent to ${firstName(sub.substituteName || '')}.`)} />
      ))}

      {covering.length > 0 && (
        <>
          <SectionTitle title="You are covering" icon="user-check" />
          {covering.map((sub) => (
            <Card key={sub.id}>
              <View style={s.head}>
                <Text style={s.when}>{longDate(sub.date)}</Text>
                <Chip label={sub.roleType} color={partColor(c, sub.roleType)} />
              </View>
              <Text style={s.muted}>For {sub.requesterName}</Text>
            </Card>
          ))}
        </>
      )}

      {/* Excuses */}
      <SectionTitle title="My excuses" icon="calendar-minus" />
      {home.excuses.length === 0 ? <Text style={s.muted}>No excuses filed.</Text> : home.excuses.map((ex) => (
        <Card key={ex.id} style={!upcoming(ex.excuse_date) && s.faded}>
          <View style={s.head}>
            <Text style={s.when}>{longDate(ex.excuse_date)}</Text>
            <StatusBadge status={ex.status} />
          </View>
          <Text style={s.muted}>{ex.role_type}{ex.reason ? ` · ${ex.reason}` : ''}</Text>
          {ex.status === 'Pending' && upcoming(ex.excuse_date) && (
            <Button compact variant="ghost" icon="xmark" title="Take back" onPress={() => cancelExcuse(ex)} loading={busy === ex.id} style={s.cta} />
          )}
        </Card>
      ))}
    </Screen>
  );
}

function MyRequest({ sub, today, busy, onCancel, onThank }: {
  sub: SubRequest; today: string; busy: boolean; onCancel: () => void; onThank: (message: string) => void;
}) {
  const { colors: c } = useTheme();
  const s = useStyles();
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
      {sub.thankYouSent && (
        <View style={s.thanked}><Icon name="heart" size={11} color={c.success} /><Text style={[s.thankedText, { color: c.success }]}>Thanks sent</Text></View>
      )}
      {canCancel && <Button compact variant="ghost" icon="xmark" title="Cancel request" onPress={onCancel} loading={busy} style={s.cta} />}
      {canThank && !writing && <Button compact variant="ghost" icon="heart" title={`Thank ${firstName(sub.substituteName!)}`} onPress={() => setWriting(true)} style={s.cta} />}
      {canThank && writing && (
        <View style={s.cta}>
          <Field label="Your message" value={message} onChangeText={setMessage} placeholder="Thank you for covering for me!" multiline maxLength={300} />
          {!message.trim() && <Banner tone="info" text="Leave it empty to send a simple thank-you." />}
          <View style={s.actions}>
            <Button compact variant="secondary" title="Cancel" onPress={() => setWriting(false)} style={s.flex} />
            <Button compact title="Send" icon="paper-plane" loading={busy} style={s.flex}
              onPress={() => onThank(message.trim() || `Thank you for covering for me, ${firstName(sub.substituteName!)}! God bless!`)} />
          </View>
        </View>
      )}
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  title: { color: c.text, fontSize: font.xxl, fontFamily: fonts.bold, marginTop: space.sm, marginBottom: space.md },
  actions: { flexDirection: 'row', gap: space.sm },
  muted: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, lineHeight: 19 },
  openCard: { borderColor: tint(c.info, 0.4) },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, marginBottom: 4 },
  when: { flex: 1, color: c.goldText, fontSize: font.sm, fontFamily: fonts.semibold },
  name: { color: c.text, fontSize: font.lg, fontFamily: fonts.bold },
  reason: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, fontStyle: 'italic', marginTop: 4 },
  cta: { marginTop: space.md },
  thanked: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  thankedText: { fontSize: font.xs, fontFamily: fonts.semibold },
  faded: { opacity: 0.6 },
}));
