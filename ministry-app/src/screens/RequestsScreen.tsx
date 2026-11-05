import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSession } from '../session';
import { useAppNav } from '../routes';
import { api } from '../api';
import { invalidateMonths } from '../months';
import { useDialog } from '../dialog';
import { Avatar, Banner, Button, Card, Chip, EmptyState, Field, Icon, Screen, SectionTitle, Segmented, StatusBadge, statusColor, type IconName } from '../components';
import { font, fonts, makeStyles, partColor, radius, space, tint, useTheme } from '../theme';
import { firstName, longDate, mediumDate, monthDay, relativeDay } from '../utils';
import type { Excuse, SubRequest, Swap } from '../types';

type Tab = 'active' | 'history';

// One row of the request lists, whatever its kind.
interface Item {
  key: string;
  kind: 'excuse' | 'sub' | 'swap' | 'cover';
  date: string;
  status: string;
  excuse?: Excuse;
  sub?: SubRequest;
  swap?: Swap;
}

const KIND: Record<Item['kind'], { label: string; icon: IconName }> = {
  excuse: { label: 'Excuse', icon: 'calendar-minus' },
  sub: { label: 'Substitute', icon: 'people-arrows' },
  swap: { label: 'Swap', icon: 'right-left' },
  cover: { label: 'Covering', icon: 'user-check' },
};

const OPEN_SWAP = ['Waiting Partner', 'Pending Approval'];

export default function RequestsScreen() {
  const { home, profile, refresh } = useSession();
  const { colors: c } = useTheme();
  const s = useStyles();
  const dialog = useDialog();
  const nav = useAppNav();
  const [tab, setTab] = useState<Tab>('active');
  const [busy, setBusy] = useState<string | null>(null);

  const items = useMemo<Item[]>(() => {
    if (!home || !profile) return [];
    return [
      ...home.excuses.map((e) => ({ key: `e-${e.id}`, kind: 'excuse' as const, date: e.excuse_date, status: e.status, excuse: e })),
      ...home.substitutes.filter((x) => x.requesterId === profile.id).map((x) => ({ key: `s-${x.id}`, kind: 'sub' as const, date: x.date, status: x.status, sub: x })),
      ...home.substitutes.filter((x) => x.substituteId === profile.id && x.status === 'Accepted').map((x) => ({ key: `c-${x.id}`, kind: 'cover' as const, date: x.date, status: 'Accepted', sub: x })),
      ...(home.swaps || []).filter((w) => w.requesterId === profile.id || w.status !== 'Waiting Partner')
        .map((w) => ({ key: `w-${w.id}`, kind: 'swap' as const, date: w.requesterId === profile.id ? w.requesterDate : w.partnerDate, status: w.status, swap: w })),
    ];
  }, [home, profile]);

  // The navigator shows the loading screen until the dashboard is in.
  if (!home || !profile) return null;
  const today = home.today;

  // Active: still waiting, or coming up. History: decided and done, or past.
  const isActive = (i: Item) => i.date >= today && !['Rejected', 'Declined', 'Cancelled'].includes(i.status);
  const active = items.filter(isActive).sort((a, b) => a.date.localeCompare(b.date));
  const history = items.filter((i) => !isActive(i)).sort((a, b) => b.date.localeCompare(a.date));
  const swapsForMe = home.swapsForMe || [];

  // Runs one change, then reloads the dashboard so every tab agrees.
  const run = async (id: string, call: () => Promise<{ ok: boolean; message?: string }>, done?: string) => {
    setBusy(id);
    const res = await call();
    if (res.ok) { invalidateMonths(); await refresh(true); }
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
  const answerSwap = async (w: Swap, yes: boolean) => {
    const ok = await dialog.confirm(yes ? {
      icon: 'right-left', title: 'Accept this swap?',
      message: `You take ${firstName(w.requesterName)}'s ${w.part} on ${longDate(w.requesterDate)}, and ${firstName(w.requesterName)} takes yours on ${longDate(w.partnerDate)}. The Schedule Plotter approves it next.`,
      confirmText: 'Accept swap', cancelText: 'Not now',
    } : {
      icon: 'xmark', tone: 'danger', title: 'Decline this swap?',
      message: `${firstName(w.requesterName)} will be told you cannot swap.`, confirmText: 'Decline', cancelText: 'Back',
    });
    if (ok) run(w.id, () => api.answerSwap(w.id, yes ? 'accept' : 'decline'), yes ? 'Swap accepted. The Schedule Plotter will approve it.' : undefined);
  };
  const cancel = async (i: Item) => {
    const what = i.kind === 'excuse' ? 'excuse' : i.kind === 'sub' ? 'substitute request' : 'swap request';
    const ok = await dialog.confirm({
      icon: 'xmark', tone: 'danger', title: `Take back this ${what}?`,
      message: `For ${longDate(i.date)}. You can file it again later.`, confirmText: 'Take back', cancelText: 'Keep it',
    });
    if (!ok) return;
    if (i.excuse) run(i.key, () => api.cancelExcuse(i.excuse!.id));
    if (i.sub) run(i.key, () => api.cancelSub(i.sub!.id));
    if (i.swap) run(i.key, () => api.cancelSwap(i.swap!.id));
  };

  const list = tab === 'active' ? active : history;
  const pictureOf = (name: string) => (home.members || []).find((m) => m.name.toLowerCase() === name.toLowerCase())?.picture || null;

  return (
    <Screen onRefresh={() => refresh(true)}>
      <Text style={s.title}>Requests</Text>
      <Text style={s.subtitle}>Excuses, substitutes and swaps</Text>

      <View style={s.tiles}>
        <Tile icon="calendar-minus" title="File an Excuse" text="Any date ahead" onPress={() => nav.navigate('RequestForm', { mode: 'excuse' })} />
        <Tile icon="people-arrows" title="Ask for a Sub" text="Someone covers you" onPress={() => nav.navigate('RequestForm', { mode: 'sub' })} />
        <Tile icon="right-left" title="Swap Schedule" text="Trade dates" onPress={() => nav.navigate('RequestForm', { mode: 'swap' })} />
      </View>

      {/* Waiting for their answer */}
      {(swapsForMe.length > 0 || home.openSubs.length > 0) && (
        <SectionTitle title={`Waiting for you (${swapsForMe.length + home.openSubs.length})`} icon="bell" />
      )}
      {swapsForMe.map((w) => (
        <Card key={w.id} style={[s.askCard, { borderColor: tint(c.band, 0.45) }]}>
          <View style={s.askHead}>
            <Avatar name={w.requesterName} picture={pictureOf(w.requesterName)} size={38} />
            <View style={s.flex}>
              <Text style={s.askName}>{w.requesterName}</Text>
              <Text style={s.muted}>asks to swap with you</Text>
            </View>
            <Chip label={w.part} color={partColor(c, w.part)} />
          </View>
          <View style={s.swapBox}>
            <SwapSide label="You take" date={w.requesterDate} />
            <Icon name="right-left" size={14} color={c.band} />
            <SwapSide label={`${firstName(w.requesterName)} takes`} date={w.partnerDate} />
          </View>
          {w.reason ? <Text style={s.reason}>“{w.reason}”</Text> : null}
          <View style={s.actions}>
            <Button compact variant="secondary" title="Decline" icon="xmark" onPress={() => answerSwap(w, false)} disabled={busy === w.id} style={s.flex} />
            <Button compact title="Accept" icon="check" onPress={() => answerSwap(w, true)} loading={busy === w.id} style={s.flex} />
          </View>
        </Card>
      ))}
      {home.openSubs.map((sub) => (
        <Card key={sub.id} style={[s.askCard, { borderColor: tint(c.info, 0.45) }]}>
          <View style={s.askHead}>
            <Avatar name={sub.requesterName} picture={pictureOf(sub.requesterName)} size={38} />
            <View style={s.flex}>
              <Text style={s.askName}>{sub.requesterName}</Text>
              <Text style={s.muted}>needs a substitute · {relativeDay(sub.date, today)}</Text>
            </View>
            <Chip label={sub.roleType} color={partColor(c, sub.roleType)} />
          </View>
          <Text style={s.when}>{longDate(sub.date)}</Text>
          {sub.reason ? <Text style={s.reason}>“{sub.reason}”</Text> : null}
          <Button compact title="I'll cover" icon="user-check" onPress={() => accept(sub)} loading={busy === sub.id} style={s.cta} />
        </Card>
      ))}

      <SectionTitle title="My requests" icon="list-check" />
      <Segmented<Tab> options={['active', 'history']} value={tab} onChange={setTab}
        labels={{ active: 'Active', history: 'History' }} counts={{ active: active.length }} icons={{ active: 'hourglass-half', history: 'clock-rotate-left' }} />

      {list.length === 0 ? (
        <Card>
          <EmptyState icon={tab === 'active' ? 'circle-check' : 'clock-rotate-left'}
            title={tab === 'active' ? 'Nothing pending' : 'No history yet'}
            text={tab === 'active' ? 'Your excuses, sub requests and swaps show here until they are done.' : 'Past and decided requests show here.'} />
        </Card>
      ) : list.map((i) => (
        <RequestCard key={i.key} item={i} today={today} myId={profile.id} busy={busy === i.key}
          onCancel={() => cancel(i)}
          onThank={(message) => run(i.key, () => api.thankSub(i.sub!.id, message), `Your thanks was sent to ${firstName(i.sub!.substituteName || '')}.`)} />
      ))}
    </Screen>
  );
}

function Tile({ icon, title, text, onPress }: { icon: IconName; title: string; text: string; onPress: () => void }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.tile, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel={title}>
      <View style={s.tileIcon}><Icon name={icon} size={17} color={c.goldText} /></View>
      <Text style={s.tileTitle}>{title}</Text>
      <Text style={s.tileText}>{text}</Text>
    </Pressable>
  );
}

function SwapSide({ label, date }: { label: string; date: string }) {
  const s = useStyles();
  return (
    <View style={s.swapSide}>
      <Text style={s.swapLabel}>{label}</Text>
      <Text style={s.swapDate}>{monthDay(date)}</Text>
    </View>
  );
}

// What a status means, in words.
function statusWords(i: Item, myId: string): string {
  if (i.kind === 'excuse') return i.status === 'Pending' ? 'Waiting for approval' : i.status;
  if (i.kind === 'cover') return `Covering for ${i.sub!.requesterName}`;
  if (i.kind === 'sub') {
    const x = i.sub!;
    if (x.status === 'Accepted') return x.substituteName ? `Covered by ${x.substituteName}` : 'Covered';
    if (x.status === 'Pending Admin') return 'Waiting for approval';
    if (x.status === 'Open for Sub') return 'Open to teammates';
    return x.status;
  }
  const w = i.swap!;
  const other = w.requesterId === myId ? w.partnerName : w.requesterName;
  if (w.status === 'Waiting Partner') return `Waiting for ${firstName(other)}`;
  if (w.status === 'Pending Approval') return 'Waiting for approval';
  if (w.status === 'Approved') return 'Swapped';
  if (w.status === 'Declined') return `${firstName(other)} declined`;
  return w.status;
}

const badgeStatus = (status: string) => (status === 'Waiting Partner' || status === 'Pending Approval' ? 'Pending' : status === 'Declined' || status === 'Cancelled' ? 'Rejected' : status);

function RequestCard({ item: i, today, myId, busy, onCancel, onThank }: {
  item: Item; today: string; myId: string; busy: boolean; onCancel: () => void; onThank: (message: string) => void;
}) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const [writing, setWriting] = useState(false);
  const [message, setMessage] = useState('');
  const kind = KIND[i.kind];
  const color = statusColor(c, badgeStatus(i.status));
  const upcoming = i.date >= today;
  const reason = i.excuse?.reason || i.sub?.reason || i.swap?.reason || '';
  const note = i.excuse?.admin_note || i.sub?.adminNote || i.swap?.adminNote || null;
  const reviewer = i.excuse?.reviewed_by || i.swap?.reviewedBy || null;
  const canCancel = upcoming && (
    (i.kind === 'excuse' && i.status === 'Pending')
    || (i.kind === 'sub' && ['Pending Admin', 'Open for Sub'].includes(i.status))
    || (i.kind === 'swap' && i.swap!.requesterId === myId && OPEN_SWAP.includes(i.status)));
  const canThank = i.kind === 'sub' && i.status === 'Accepted' && !i.sub!.thankYouSent && !!i.sub!.substituteName;

  return (
    <Card style={[s.req, !upcoming && s.faded]}>
      <View style={[s.reqStripe, { backgroundColor: color }]} />
      <View style={s.reqHead}>
        <View style={[s.kindIcon, { backgroundColor: tint(color, 0.14) }]}><Icon name={kind.icon} size={13} color={color} /></View>
        <View style={s.flex}>
          <Text style={s.kindLabel}>{kind.label}{i.excuse ? ` · ${i.excuse.role_type}` : i.sub ? ` · ${i.sub.roleType}` : i.swap ? ` · ${i.swap.part}` : ''}</Text>
          <Text style={s.reqDate}>{i.swap ? `${monthDay(i.swap.requesterDate)} ⇄ ${monthDay(i.swap.partnerDate)}` : mediumDate(i.date)}</Text>
        </View>
        <StatusBadge status={badgeStatus(i.status)} label={i.status === 'Pending Admin' ? 'Pending' : i.status === 'Open for Sub' ? 'Open' : i.status === 'Waiting Partner' || i.status === 'Pending Approval' ? 'Pending' : undefined} />
      </View>
      <Text style={[s.statusLine, { color }]}>{statusWords(i, myId)}</Text>
      {i.swap && (
        <Text style={s.muted}>
          {i.swap.requesterId === myId
            ? `You give ${monthDay(i.swap.requesterDate)} to ${i.swap.partnerName} and take their ${monthDay(i.swap.partnerDate)}.`
            : `${i.swap.requesterName} gives you ${monthDay(i.swap.requesterDate)} and takes your ${monthDay(i.swap.partnerDate)}.`}
        </Text>
      )}
      {reason ? <Text style={s.reason}>“{reason}”</Text> : null}
      {(note || reviewer) && <Text style={s.reviewed}>{reviewer ? `Reviewed by ${reviewer}` : ''}{note ? `${reviewer ? ': ' : ''}${note}` : ''}</Text>}
      {i.sub?.thankYouSent && (
        <View style={s.thanked}><Icon name="heart" size={11} color={c.success} /><Text style={[s.thankedText, { color: c.success }]}>Thanks sent</Text></View>
      )}

      {canCancel && <Button compact variant="ghost" icon="xmark" title="Take back" onPress={onCancel} loading={busy} style={s.cta} />}
      {canThank && !writing && <Button compact variant="ghost" icon="heart" title={`Thank ${firstName(i.sub!.substituteName!)}`} onPress={() => setWriting(true)} style={s.cta} />}
      {canThank && writing && (
        <View style={s.cta}>
          <Field label="Your message" value={message} onChangeText={setMessage} placeholder="Thank you for covering for me!" multiline maxLength={300} />
          {!message.trim() && <Banner tone="info" text="Leave it empty to send a simple thank-you." />}
          <View style={s.actions}>
            <Button compact variant="secondary" title="Cancel" onPress={() => setWriting(false)} style={s.flex} />
            <Button compact title="Send" icon="paper-plane" loading={busy} style={s.flex}
              onPress={() => onThank(message.trim() || `Thank you for covering for me, ${firstName(i.sub!.substituteName!)}! God bless!`)} />
          </View>
        </View>
      )}
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  pressed: { opacity: 0.85 },
  title: { color: c.text, fontSize: font.xxl, fontFamily: fonts.bold, marginTop: space.sm },
  subtitle: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, marginBottom: space.md },
  tiles: { flexDirection: 'row', gap: space.sm },
  tile: {
    flex: 1, alignItems: 'center', paddingVertical: space.md, paddingHorizontal: 4, borderRadius: radius.lg, backgroundColor: c.card,
    borderWidth: 1, borderColor: c.scheme === 'light' ? '#eceef1' : c.border, boxShadow: c.scheme === 'light' ? '0px 2px 10px rgba(0, 0, 0, 0.05)' : undefined,
  },
  tileIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.goldMuted, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  tileTitle: { color: c.text, fontSize: font.sm, fontFamily: fonts.bold, textAlign: 'center' },
  tileText: { color: c.textMuted, fontSize: 10.5, fontFamily: fonts.regular, textAlign: 'center', marginTop: 1 },
  muted: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, lineHeight: 19 },
  askCard: { borderWidth: 1.5 },
  askHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  askName: { color: c.text, fontSize: font.md, fontFamily: fonts.bold },
  swapBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginTop: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: tint(c.band, 0.08) },
  swapSide: { alignItems: 'center' },
  swapLabel: { color: c.textSecondary, fontSize: font.xs, fontFamily: fonts.medium },
  swapDate: { color: c.text, fontSize: font.lg, fontFamily: fonts.heavy, letterSpacing: 0.5 },
  when: { color: c.goldText, fontSize: font.sm, fontFamily: fonts.semibold, marginTop: space.sm },
  reason: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, fontStyle: 'italic', marginTop: 6 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  cta: { marginTop: space.md },
  req: { paddingLeft: space.lg + 4, overflow: 'hidden' },
  reqStripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  reqHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  kindIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  kindLabel: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 0.8 },
  reqDate: { color: c.text, fontSize: font.md, fontFamily: fonts.bold },
  statusLine: { fontSize: font.sm, fontFamily: fonts.semibold, marginTop: space.sm },
  reviewed: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular, marginTop: 6 },
  thanked: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  thankedText: { fontSize: font.xs, fontFamily: fonts.semibold },
  faded: { opacity: 0.6 },
}));
