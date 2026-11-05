// Attendance: check yourself in at church by GPS, see who of today's lineup
// (and the Media team) is already here, and your own attendance history.
// Check-in opens on a service or practice day, within 1.5 km of the church;
// the server measures the distance again before it saves anything.
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useSession } from '../session';
import { useDialog } from '../dialog';
import {
  CHURCH, CHURCH_MAPS_URL, CHURCH_STREET_VIEW, attendanceApi, distanceMeters, kmText, useAttendance,
  type AttendanceData, type AttendanceItem, type ChurchEvent, type RosterGroup,
} from '../attendance';
import { Avatar, Button, Card, Chip, EmptyState, Icon, LoadingView, Screen, SectionTitle, StatusBadge, statusColor, type IconName } from '../components';
import { font, fonts, makeStyles, partColor, radius, space, tint, useTheme } from '../theme';
import { dayOfMonth, longDate, monthYear, relativeDay, weekday } from '../utils';

const ATTENDED = ['Present', 'Late'];
const POLL_MS = 30 * 1000;
const timeText = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');

export default function AttendanceScreen() {
  const { profile, refresh } = useSession();
  const { colors: c } = useTheme();
  const s = useStyles();
  const dialog = useDialog();
  const { data, error, reload, isStale } = useAttendance(profile?.id);
  const gps = useChurchDistance();
  const [busy, setBusy] = useState(false);

  // On the tab: refresh when old, and keep "who's here" current on an event day.
  const hasEvent = useRef(false);
  hasEvent.current = !!data?.event;
  useFocusEffect(useCallback(() => {
    if (isStale(POLL_MS)) reload();
    const timer = setInterval(() => { if (hasEvent.current) reload(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [reload, isStale]));

  if (!data) {
    if (!error) return <LoadingView message="Loading attendance…" />;
    return (
      <Screen center onRefresh={reload}>
        <EmptyState icon="circle-exclamation" title="Could not load attendance" text={error} />
        <Button title="Try again" icon="rotate-right" onPress={reload} />
      </Screen>
    );
  }

  const radiusM = data.church?.radiusM || CHURCH.radiusM;
  const distance = gps.fix ? distanceMeters(gps.fix.latitude, gps.fix.longitude, CHURCH.latitude, CHURCH.longitude) : null;
  const weakSignal = !!gps.fix?.accuracy && gps.fix.accuracy > radiusM;
  const within = distance != null && distance <= radiusM && !weakSignal;
  const canCheckIn = within && !!data.event && !data.me && gps.state === 'ready';

  const checkIn = async () => {
    setBusy(true);
    // A fresh fix for the check-in itself; the watched one if the phone is slow.
    let pos = gps.fix;
    try {
      const fresh = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
      if (fresh) pos = { latitude: fresh.coords.latitude, longitude: fresh.coords.longitude, accuracy: fresh.coords.accuracy ?? null };
    } catch { /* keep the watched position */ }
    if (!pos) {
      setBusy(false);
      dialog.alert({ icon: 'location-crosshairs', tone: 'danger', title: 'Location not found', message: 'Your phone could not find where you are. Step outside for a moment and try again.' });
      return;
    }
    const res = await attendanceApi.checkIn(pos.latitude, pos.longitude, pos.accuracy);
    await reload();
    setBusy(false);
    if (res.ok) {
      refresh(true); // Home shows it too
      dialog.alert({ icon: 'circle-check', tone: 'success', title: "You're checked in!", message: res.message || 'God bless the service!', confirmText: 'Amen' });
    } else {
      dialog.alert({ icon: 'circle-exclamation', tone: 'danger', title: 'Could not check in', message: res.message });
    }
  };

  return (
    <Screen onRefresh={reload}>
      <Text style={s.title}>Attendance</Text>
      <Text style={s.subtitle}>{longDate(data.today)}</Text>

      <EventCard event={data.event} next={data.nextEvent} today={data.today} />
      <ChurchPreview />

      {/* Where you are, and the check-in */}
      <Card raised={canCheckIn}>
        {data.me ? (
          <CheckedIn me={data.me} />
        ) : (
          <>
            <DistanceStatus state={gps.state} distance={distance} within={within} weak={weakSignal} accuracy={gps.fix?.accuracy ?? null} onTurnOn={gps.turnOn} onRetry={gps.retry} radiusM={radiusM} />
            <Button
              title={!data.event ? 'Opens on service days' : gps.state === 'ready' && distance != null && !within && !weakSignal ? 'Too far to check in' : 'Check In'}
              icon={data.event ? 'location-dot' : 'calendar-xmark'}
              onPress={checkIn}
              loading={busy}
              disabled={!canCheckIn}
              style={s.checkIn}
            />
            {!data.event && <Text style={s.hint}>Check-in opens on the day of a Sunday Service or a practice.</Text>}
          </>
        )}
      </Card>

      {/* Who is here */}
      {data.event && (
        <>
          <View style={s.hereHead}>
            <SectionTitle title="Who's here" icon="user-check" />
            {data.counts.total > 0 && <Chip label={`${data.counts.here} of ${data.counts.total} here`} color={c.success} icon="circle-check" />}
          </View>
          {data.roster.length === 0
            ? <Card><Text style={s.muted}>Nobody is listed for {data.event.type === 'Practice' ? 'practice' : 'the service'} today yet.</Text></Card>
            : <Roster groups={data.roster} me={profile?.fullName || ''} />}
        </>
      )}

      <History items={data.history} />
    </Screen>
  );
}

// ---- Location ----

type GpsState = 'checking' | 'needs-permission' | 'blocked' | 'services-off' | 'locating' | 'ready' | 'error';
interface Fix { latitude: number; longitude: number; accuracy: number | null }

// Watches the phone's position while the tab is open (and only then).
function useChurchDistance() {
  const dialog = useDialog();
  const [state, setState] = useState<GpsState>('checking');
  const [fix, setFix] = useState<Fix | null>(null);
  const [attempt, setAttempt] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  useFocusEffect(useCallback(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    const take = (p: Location.LocationObject) => {
      if (cancelled) return;
      setFix({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy ?? null });
      setState('ready');
    };
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (cancelled) return;
        if (!perm.granted) { setState(perm.canAskAgain ? 'needs-permission' : 'blocked'); return; }
        if (!(await Location.hasServicesEnabledAsync())) { if (!cancelled) setState('services-off'); return; }
        setState((prev) => (prev === 'ready' ? prev : 'locating'));
        // A recent position first, so the distance shows at once.
        const last = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60 * 1000 }).catch(() => null);
        if (last) take(last);
        const watch = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 20, timeInterval: 5000 },
          take,
        );
        if (cancelled) watch.remove(); else sub = watch;
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    // Back from the phone's Settings (location allowed, GPS switched on): look again.
    const app = AppState.addEventListener('change', (next) => {
      if (next === 'active' && !cancelled && stateRef.current !== 'ready') setAttempt((n) => n + 1);
    });
    return () => { cancelled = true; sub?.remove(); app.remove(); };
  }, [attempt]));

  const retry = useCallback(() => { setState('checking'); setAttempt((n) => n + 1); }, []);

  // Ask for location, and switch the phone's GPS on if it is off.
  const turnOn = useCallback(async () => {
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) { Linking.openSettings().catch(() => {}); return; }
        perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) { setState(perm.canAskAgain ? 'needs-permission' : 'blocked'); return; }
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        if (Platform.OS === 'android') {
          await Location.enableNetworkProviderAsync(); // the phone's own "Turn on location?" box
        } else {
          const go = await dialog.confirm({
            icon: 'location-crosshairs', title: 'Turn on Location Services',
            message: 'Open Settings > Privacy & Security > Location Services, switch it on, then come back.',
            confirmText: 'Open Settings', cancelText: 'Later',
          });
          if (go) Linking.openSettings().catch(() => {});
          return;
        }
      }
      retry();
    } catch {
      setState('services-off'); // the GPS box was declined
    }
  }, [dialog, retry]);

  return { state, fix, turnOn, retry };
}

function DistanceStatus({ state, distance, within, weak, accuracy, onTurnOn, onRetry, radiusM }: {
  state: GpsState; distance: number | null; within: boolean; weak: boolean; accuracy: number | null;
  onTurnOn: () => void; onRetry: () => void; radiusM: number;
}) {
  const { colors: c } = useTheme();
  const s = useStyles();

  const ask = (icon: IconName, title: string, text: string, action: string, onPress: () => void) => (
    <View style={s.locRow}>
      <View style={[s.locIcon, { backgroundColor: tint(c.warning, 0.14) }]}><Icon name={icon} size={18} color={c.warning} /></View>
      <View style={s.flex}>
        <Text style={s.locTitle}>{title}</Text>
        <Text style={s.muted}>{text}</Text>
        <Button compact variant="ghost" title={action} icon="location-crosshairs" onPress={onPress} style={s.locAction} />
      </View>
    </View>
  );

  if (state === 'needs-permission') return ask('location-dot', 'Allow your location', 'The app checks that you are at church before it marks you present.', 'Turn on location', onTurnOn);
  if (state === 'blocked') return ask('location-dot', 'Location is blocked', 'Allow location for JSCI Ministry in your phone settings.', 'Open Settings', onTurnOn);
  if (state === 'services-off') return ask('satellite-dish', 'Your GPS is off', "Switch on your phone's location to check in.", 'Turn on GPS', onTurnOn);
  if (state === 'error') return ask('triangle-exclamation', 'Location not available', 'Your phone could not give a location just now.', 'Try again', onRetry);
  if (state !== 'ready' || distance == null) {
    return (
      <View style={s.locRow}>
        <View style={[s.locIcon, { backgroundColor: c.goldMuted }]}><ActivityIndicator size="small" color={c.secondary} /></View>
        <View style={s.flex}>
          <Text style={s.locTitle}>Finding your location…</Text>
          <Text style={s.muted}>This takes a few seconds outdoors.</Text>
        </View>
      </View>
    );
  }

  const tone = within ? c.success : c.textSecondary;
  return (
    <View>
      <View style={s.locRow}>
        <View style={[s.locIcon, { backgroundColor: tint(within ? c.success : c.info, 0.14) }]}>
          <Icon name={within ? 'church' : 'person-walking'} size={18} color={within ? c.success : c.info} />
        </View>
        <View style={s.flex}>
          <Text style={[s.locTitle, { color: within ? c.success : c.text }]}>
            {distance < 100 ? "You're at church" : `You are ${kmText(distance)} from church`}
          </Text>
          <Text style={[s.muted, { color: tone }]}>
            {weak
              ? `Weak GPS signal (±${kmText(accuracy || 0)}). Step outside for a better fix.`
              : within ? 'You are close enough to check in.' : `Check-in opens within ${kmText(radiusM)}.`}
          </Text>
        </View>
      </View>
      <ProximityMeter distance={distance} radiusM={radiusM} />
    </View>
  );
}

// A track from 5 km away to the church; the check-in zone is green.
function ProximityMeter({ distance, radiusM }: { distance: number; radiusM: number }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const MAX = 5000;
  const at = 1 - Math.min(distance, MAX) / MAX;
  const zone = 1 - radiusM / MAX;
  const inside = distance <= radiusM;
  return (
    <View style={s.meterWrap} accessibilityLabel={`${kmText(distance)} from church`}>
      <View style={s.meter}>
        <View style={[s.meterZone, { left: `${zone * 100}%` }]} />
        <View style={[s.meterDot, { left: `${at * 100}%`, backgroundColor: inside ? c.success : c.secondary }]} />
      </View>
      <View style={s.meterLabels}>
        <Text style={s.meterLabel}>5 km+</Text>
        <Text style={[s.meterLabel, { position: 'absolute', left: `${zone * 100}%`, marginLeft: -16 }]}>{kmText(radiusM)}</Text>
        <Icon name="church" size={11} color={c.textMuted} />
      </View>
    </View>
  );
}

function CheckedIn({ me }: { me: NonNullable<AttendanceData['me']> }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const here = ATTENDED.includes(me.status);
  const tone = here ? c.success : statusColor(c, me.status);
  return (
    <View style={s.locRow}>
      <View style={[s.doneIcon, { backgroundColor: tint(tone, 0.15), borderColor: tint(tone, 0.4) }]}>
        <Icon name={here ? 'check' : 'circle-info'} size={22} color={tone} />
      </View>
      <View style={s.flex}>
        <Text style={[s.locTitle, { color: tone }]}>{here ? `Checked in${me.checkedInAt ? ` at ${timeText(me.checkedInAt)}` : ''}` : `Marked ${me.status} today`}</Text>
        <Text style={s.muted}>
          {[me.sessionType, me.distanceM != null ? `${me.distanceM < 1000 ? `${me.distanceM} m` : kmText(me.distanceM)} from church` : null].filter(Boolean).join(' · ') || 'See you inside!'}
        </Text>
      </View>
    </View>
  );
}

// ---- Today ----

function EventCard({ event, next, today }: { event: ChurchEvent | null; next: ChurchEvent | null; today: string }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  if (!event) {
    return (
      <Card style={s.eventRow}>
        <View style={[s.eventIcon, { backgroundColor: c.goldMuted }]}><Icon name="calendar-xmark" size={18} color={c.goldText} /></View>
        <View style={s.flex}>
          <Text style={s.eventTitle}>No service or practice today</Text>
          {next && (
            <Text style={s.muted}>
              Next: <Text style={s.strong}>{next.type}</Text>, {relativeDay(next.date, today) === 'Tomorrow' ? 'tomorrow' : longDate(next.date)}{next.time ? `, ${next.time}` : ''}
            </Text>
          )}
        </View>
      </Card>
    );
  }
  const practice = event.type === 'Practice';
  return (
    <Card raised style={s.eventRow}>
      <View style={[s.eventIcon, { backgroundColor: tint(practice ? c.band : c.secondary, 0.16) }]}>
        <Icon name={practice ? 'music' : 'church'} size={18} color={practice ? c.band : c.goldText} />
      </View>
      <View style={s.flex}>
        <Text style={s.eventKicker}>TODAY</Text>
        <Text style={s.eventTitle}>{event.type}</Text>
        <Text style={s.muted}>{longDate(event.date)}{event.time ? ` · ${event.time}` : ''}</Text>
      </View>
    </Card>
  );
}

// Google Street View of the church. Memoized: the GPS updates around it never reload it.
const ChurchPreview = memo(function ChurchPreview() {
  const { colors: c } = useTheme();
  const s = useStyles();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { const t = setTimeout(() => setLoaded(true), 8000); return () => clearTimeout(t); }, []);

  const html = useMemo(() => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:${c.cardRaised}}iframe{display:block;border:0;width:100%;height:100%}</style>
</head><body>
<iframe src="${CHURCH_STREET_VIEW}" allowfullscreen loading="eager" referrerpolicy="strict-origin-when-cross-origin"
  onload="window.ReactNativeWebView && window.ReactNativeWebView.postMessage('loaded')"></iframe>
</body></html>`, [c.cardRaised]);

  const onMessage = useCallback((e: WebViewMessageEvent) => { if (e.nativeEvent.data === 'loaded') setLoaded(true); }, []);

  return (
    <Card style={s.previewCard}>
      <View style={s.preview}>
        <WebView
          source={{ html, baseUrl: 'https://sanctuaryhub.vercel.app' }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          nestedScrollEnabled
          scrollEnabled={false}
          setSupportMultipleWindows={false}
          onMessage={onMessage}
          // Links out of the embed ("View on Google Maps") open the Maps app, not this little box.
          onShouldStartLoadWithRequest={(req) => {
            const url = req.url || '';
            if (url.startsWith('about:') || url.startsWith('data:') || url.startsWith('https://sanctuaryhub.vercel.app') || url.startsWith('https://www.google.com/maps/embed')) return true;
            if (req.isTopFrame === false) return true;
            Linking.openURL(url).catch(() => {});
            return false;
          }}
          style={s.webview}
        />
        {!loaded && (
          <View style={s.previewLoading} pointerEvents="none">
            <ActivityIndicator color={c.secondary} />
            <Text style={s.previewLoadingText}>Loading street view…</Text>
          </View>
        )}
      </View>
      <View style={s.previewRow}>
        <Icon name="location-dot" size={15} color={c.goldText} />
        <View style={s.flex}>
          <Text style={s.previewName} numberOfLines={1}>{CHURCH.name}</Text>
          <Text style={s.previewHint}>Check in within {kmText(CHURCH.radiusM)} of the church</Text>
        </View>
        <Pressable onPress={() => Linking.openURL(CHURCH_MAPS_URL).catch(() => {})} hitSlop={8} style={s.mapsLink} accessibilityRole="link">
          <Icon name="map-location-dot" size={13} color={c.info} />
          <Text style={s.mapsText}>Open in Maps</Text>
        </Pressable>
      </View>
    </Card>
  );
});

// ---- Who's here ----

const GROUP_ICON: Record<string, IconName> = {
  leader: 'microphone', backup: 'users', musicians: 'guitar', dancers: 'person-running', media: 'video', others: 'user-check',
};

const Roster = memo(function Roster({ groups, me }: { groups: RosterGroup[]; me: string }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const mine = me.toLowerCase();
  return (
    <>
      {groups.map((g) => {
        const here = g.people.filter((p) => p.here).length;
        return (
          <Card key={g.key} style={s.groupCard}>
            <View style={s.groupHead}>
              <Icon name={GROUP_ICON[g.key] || 'users'} size={12} color={c.goldText} />
              <Text style={s.groupTitle}>{g.title}</Text>
              <Text style={s.groupCount}>{here}/{g.people.length}</Text>
            </View>
            {g.people.map((p, i) => {
              const isMe = p.name.toLowerCase() === mine;
              return (
                <View key={`${g.key}-${p.name}-${p.part}`} style={[s.person, i > 0 && s.divider, !p.here && s.notYet]}>
                  <Avatar name={p.name} picture={p.picture} size={34} ring={isMe ? c.secondary : p.here ? c.success : undefined} />
                  <View style={s.flex}>
                    <Text style={[s.personName, isMe && s.personMe]} numberOfLines={1}>{p.name}{isMe ? ' (You)' : ''}</Text>
                    {/* Musicians: which instrument */}
                    {g.key === 'musicians' ? <View style={s.partRow}><Chip label={p.part} color={partColor(c, p.part)} /></View> : null}
                  </View>
                  {p.here ? (
                    <View style={s.hereTag}>
                      <Icon name="circle-check" size={13} color={c.success} />
                      <Text style={[s.hereText, { color: c.success }]}>{p.checkedInAt ? timeText(p.checkedInAt) : 'Here'}</Text>
                    </View>
                  ) : (
                    <Text style={s.notYetText}>Not yet</Text>
                  )}
                </View>
              );
            })}
          </Card>
        );
      })}
    </>
  );
});

// ---- History ----

const History = memo(function History({ items }: { items: AttendanceItem[] }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const count = (status: string) => items.filter((r) => r.status === status).length;
  const attended = items.filter((r) => ATTENDED.includes(r.status)).length;
  const rate = items.length ? Math.round((attended / items.length) * 100) : 0;

  // Most recent first, grouped by month.
  const months = useMemo(() => {
    const out: { label: string; items: AttendanceItem[] }[] = [];
    for (const r of items) {
      const label = monthYear(r.date);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(r);
      else out.push({ label, items: [r] });
    }
    return out;
  }, [items]);

  return (
    <>
      <SectionTitle title="My attendance" icon="clock-rotate-left" />
      {items.length === 0 ? (
        <Card><EmptyState icon="clipboard-check" title="No attendance yet" text="Check in here on a service or practice day, and your record builds up below." /></Card>
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
          <Text style={s.note}>Based on your latest {items.length} records.</Text>

          {months.map((m) => (
            <View key={m.label}>
              <Text style={s.monthLabel}>{m.label}</Text>
              <Card style={s.list}>
                {m.items.map((r, i) => (
                  <View key={r.id} style={[s.row, i > 0 && s.divider]}>
                    <View style={s.dayBox}>
                      <Text style={s.dayDow}>{weekday(r.date)}</Text>
                      <Text style={s.dayNum}>{dayOfMonth(r.date)}</Text>
                    </View>
                    <View style={s.flex}>
                      <Text style={s.rowTitle} numberOfLines={1}>{r.sessionType || 'Service'}</Text>
                      <Text style={s.rowMeta} numberOfLines={1}>
                        {r.checkedInAt ? `GPS check-in ${timeText(r.checkedInAt)}` : r.notes || ''}
                      </Text>
                    </View>
                    <StatusBadge status={r.status} />
                  </View>
                ))}
              </Card>
            </View>
          ))}
        </>
      )}
    </>
  );
});

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  title: { color: c.text, fontSize: font.xxl, fontFamily: fonts.bold, marginTop: space.sm },
  subtitle: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.medium, marginBottom: space.md },
  muted: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, lineHeight: 19 },
  strong: { color: c.text, fontFamily: fonts.semibold },
  hint: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular, textAlign: 'center', marginTop: space.sm },

  eventRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  eventIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  eventKicker: { color: c.goldText, fontSize: font.xs, fontFamily: fonts.bold, letterSpacing: 1.2 },
  eventTitle: { color: c.text, fontSize: font.lg, fontFamily: fonts.bold },

  previewCard: { padding: 0, overflow: 'hidden' },
  preview: { height: 200, backgroundColor: c.cardRaised },
  webview: { flex: 1, backgroundColor: 'transparent' },
  previewLoading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: space.sm, backgroundColor: c.cardRaised },
  previewLoadingText: { color: c.textSecondary, fontSize: font.xs, fontFamily: fonts.medium },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  previewName: { color: c.text, fontSize: font.sm, fontFamily: fonts.semibold },
  previewHint: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular },
  mapsLink: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: tint(c.info, 0.1) },
  mapsText: { color: c.info, fontSize: font.xs, fontFamily: fonts.semibold },

  locRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  locIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  locTitle: { color: c.text, fontSize: font.md, fontFamily: fonts.bold, marginBottom: 2 },
  locAction: { alignSelf: 'flex-start', marginTop: space.sm },
  doneIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  checkIn: { marginTop: space.lg },

  meterWrap: { marginTop: space.md },
  meter: { height: 8, borderRadius: 4, backgroundColor: c.border, overflow: 'visible', justifyContent: 'center' },
  meterZone: { position: 'absolute', top: 0, bottom: 0, right: 0, borderTopRightRadius: 4, borderBottomRightRadius: 4, backgroundColor: tint(c.success, 0.45) },
  meterDot: { position: 'absolute', width: 16, height: 16, borderRadius: 8, marginLeft: -8, borderWidth: 3, borderColor: c.card },
  meterLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  meterLabel: { color: c.textMuted, fontSize: 10, fontFamily: fonts.medium },

  hereHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  groupCard: { paddingVertical: space.md },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  groupTitle: { flex: 1, color: c.goldText, fontSize: font.xs, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 1 },
  groupCount: { color: c.textSecondary, fontSize: font.xs, fontFamily: fonts.semibold },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 8 },
  notYet: { opacity: 0.6 },
  personName: { color: c.text, fontSize: font.md, fontFamily: fonts.medium },
  personMe: { color: c.goldText, fontFamily: fonts.bold },
  partRow: { flexDirection: 'row', marginTop: 3 },
  hereTag: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  hereText: { fontSize: font.xs, fontFamily: fonts.semibold },
  notYetText: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.medium },

  summary: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  ring: { width: 104, height: 104, borderRadius: 52, borderWidth: 6, borderColor: c.secondary, alignItems: 'center', justifyContent: 'center', backgroundColor: c.goldMuted },
  rate: { color: c.text, fontSize: font.xxl, fontFamily: fonts.bold },
  rateLabel: { color: c.textSecondary, fontSize: font.xs, fontFamily: fonts.regular },
  stat: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 3 },
  statLabel: { flex: 1, color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular },
  statValue: { color: c.text, fontSize: font.md, fontFamily: fonts.bold },
  note: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular, marginBottom: space.sm },
  monthLabel: { color: c.textSecondary, fontSize: font.xs, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 1, marginTop: space.md, marginBottom: space.sm },
  list: { paddingVertical: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: c.border },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  dayBox: { width: 46, height: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: c.goldMuted },
  dayDow: { color: c.goldText, fontSize: 10, fontFamily: fonts.bold, textTransform: 'uppercase' },
  dayNum: { color: c.text, fontSize: font.lg, fontFamily: fonts.bold },
  rowTitle: { color: c.text, fontSize: font.md, fontFamily: fonts.semibold },
  rowMeta: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular, marginTop: 1 },
}));
