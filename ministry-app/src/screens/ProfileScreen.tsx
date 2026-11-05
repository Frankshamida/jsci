import React, { useState } from 'react';
import { Linking, Switch, Text, View } from 'react-native';
import { useSession } from '../session';
import { useAppNav } from '../routes';
import { IS_WEB } from '../platform';
import { API_BASE_URL, APP_VERSION } from '../config';
import { useDialog } from '../dialog';
import { Avatar, Banner, Button, Card, Chip, ChoiceRow, Icon, Screen, SectionTitle, type IconName } from '../components';
import { font, fonts, makeStyles, radius, space, useTheme, type ThemePref } from '../theme';
import { longDate } from '../utils';

const THEMES: ThemePref[] = ['system', 'light', 'dark'];

export default function ProfileScreen() {
  const { profile, home, signOut, lockEnabled, biometricLabel, setLockEnabled, lastUpdated } = useSession();
  const { colors: c, pref, setPref } = useTheme();
  const s = useStyles();
  const dialog = useDialog();
  const nav = useAppNav();
  const [lockBusy, setLockBusy] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  if (!profile) return <Screen><Text style={s.muted}>Loading…</Text></Screen>;

  const served = home ? home.assignments.filter((l) => l.date < home.today && !l.subbedOut).length : 0;
  const upcoming = home ? home.assignments.filter((l) => l.date >= home.today && !l.subbedOut).length : 0;

  const toggleLock = async (on: boolean) => {
    setLockBusy(true);
    setLockError(await setLockEnabled(on));
    setLockBusy(false);
  };

  const confirmSignOut = async () => {
    const ok = await dialog.confirm({
      icon: 'right-from-bracket',
      tone: 'danger',
      title: 'Sign out?',
      message: 'You will need your email and password to sign in again.',
      confirmText: 'Sign out',
      cancelText: 'Stay',
    });
    if (ok) signOut(`See you soon, ${profile.firstname}!`, 'farewell');
  };

  return (
    <Screen>
      <View style={s.head}>
        <Avatar name={profile.fullName} picture={profile.profilePicture} size={92} ring={c.secondary} />
        <Text style={s.name}>{profile.fullName}</Text>
        <Text style={s.muted}>{profile.email}</Text>
        {profile.memberId ? (
          <View style={s.memberId}><Icon name="id-badge" size={11} color={c.goldText} /><Text style={s.memberIdText}>{profile.memberId}</Text></View>
        ) : null}
      </View>

      <View style={s.stats}>
        <Stat icon="calendar-check" value={upcoming} label="Upcoming" />
        <Stat icon="hands-praying" value={served} label="Served (8 wks)" />
        <Stat icon="clipboard-check" value={home?.attendance.length ?? 0} label="Check-ins" />
      </View>

      <SectionTitle title="Ministry" icon="church" />
      <Card>
        {profile.ministries.length === 0 && <Text style={s.muted}>No ministry roles set. Ask an admin.</Text>}
        {profile.ministries.map((m, i) => (
          <View key={`${m.label}-${i}`} style={[s.ministry, i > 0 && s.divider]}>
            <Text style={s.ministryLabel}>{m.label}</Text>
            <View style={s.chips}>{m.positions.map((p) => <Chip key={p} label={p} />)}</View>
          </View>
        ))}
        <View style={[s.ministry, s.divider]}>
          <Text style={s.ministryLabel}>Roles</Text>
          <View style={s.chips}>{profile.roles.map((r) => <Chip key={r} label={r} color={c.info} />)}</View>
        </View>
      </Card>

      {profile.canPlot && (
        <Card style={s.row} onPress={() => nav.navigate('Planner', home?.pendingApprovals ? { tab: 'approvals' } : undefined)}>
          <RowIcon icon="calendar-check" />
          <View style={s.flex}>
            <Text style={s.rowText}>Schedule Plotter</Text>
            <Text style={s.muted}>Plot lineups · approve excuses, subs and swaps</Text>
          </View>
          {home?.pendingApprovals ? <View style={s.badge}><Text style={s.badgeText}>{home.pendingApprovals}</Text></View> : null}
          <Icon name="chevron-right" size={13} color={c.textMuted} />
        </Card>
      )}
      <Card style={s.row} onPress={() => nav.navigate('Member', { userId: profile.id, name: profile.fullName })}>
        <RowIcon icon="clock-rotate-left" />
        <View style={s.flex}>
          <Text style={s.rowText}>My lineup history</Text>
          <Text style={s.muted}>Every date you served, six months back</Text>
        </View>
        <Icon name="chevron-right" size={13} color={c.textMuted} />
      </Card>

      {profile.birthdate ? (
        <Card style={s.row}>
          <RowIcon icon="gift" />
          <Text style={s.rowText}>Birthday</Text>
          <Text style={s.muted}>{longDate(profile.birthdate.slice(0, 10)).replace(/^\w+, /, '')}</Text>
        </Card>
      ) : null}

      <SectionTitle title="Appearance" icon="circle-half-stroke" />
      <ChoiceRow options={THEMES} value={pref} onChange={setPref} labels={{ system: 'Same as phone', light: 'Light', dark: 'Dark' }} />

      {/* Browsers have no fingerprint lock */}
      {!IS_WEB && <SectionTitle title="Security" icon="lock" />}
      {!IS_WEB && <Card style={s.row}>
        <RowIcon icon="fingerprint" />
        <View style={s.flex}>
          <Text style={s.rowText}>Lock with {biometricLabel}</Text>
          <Text style={s.muted}>Asks for your {biometricLabel.toLowerCase()} when you open the app.</Text>
        </View>
        <Switch
          value={lockEnabled}
          onValueChange={toggleLock}
          disabled={lockBusy}
          trackColor={{ false: c.border, true: c.primary }}
          thumbColor={lockEnabled ? c.accent : c.card}
          accessibilityLabel={`Lock with ${biometricLabel}`}
        />
      </Card>}
      {lockError && <Banner tone="warn" text={lockError} />}

      <SectionTitle title="Account" icon="user" />
      <Card style={s.row} onPress={() => Linking.openURL(`${API_BASE_URL}/dashboard`)}>
        <RowIcon icon="globe" />
        <View style={s.flex}>
          <Text style={s.rowText}>Edit profile on the website</Text>
          <Text style={s.muted}>Photo, name and password are changed on the JSCI website.</Text>
        </View>
        <Icon name="arrow-up-right-from-square" size={13} color={c.textMuted} />
      </Card>

      <Button title="Sign Out" icon="right-from-bracket" variant="danger" onPress={confirmSignOut} style={s.signOut} />
      <Text style={s.foot}>
        JSCI Ministry {APP_VERSION} · Joyful Sound Church International{lastUpdated ? `\nSynced ${new Date(lastUpdated).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
      </Text>
    </Screen>
  );
}

function Stat({ icon, value, label }: { icon: IconName; value: number; label: string }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  return (
    <View style={s.stat}>
      <Icon name={icon} size={14} color={c.goldText} />
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function RowIcon({ icon }: { icon: IconName }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  return <View style={s.rowIcon}><Icon name={icon} size={15} color={c.goldText} /></View>;
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#ffffff', fontSize: font.xs, fontFamily: fonts.bold },
  head: { alignItems: 'center', gap: 4, marginTop: space.lg },
  name: { color: c.text, fontSize: font.xxl, fontFamily: fonts.bold, marginTop: space.sm, textAlign: 'center' },
  memberId: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: c.goldMuted },
  memberIdText: { color: c.goldText, fontSize: font.xs, fontFamily: fonts.semibold },
  muted: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, lineHeight: 19 },
  stats: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  stat: {
    flex: 1, alignItems: 'center', gap: 2, backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1,
    borderColor: c.scheme === 'light' ? '#eceef1' : c.border, paddingVertical: space.md,
    boxShadow: c.scheme === 'light' ? '0px 2px 10px rgba(0, 0, 0, 0.05)' : undefined,
  },
  statValue: { color: c.text, fontSize: font.xl, fontFamily: fonts.bold },
  statLabel: { color: c.textSecondary, fontSize: font.xs, fontFamily: fonts.regular },
  ministry: { paddingVertical: space.sm },
  ministryLabel: { color: c.text, fontSize: font.md, fontFamily: fonts.semibold, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  divider: { borderTopWidth: 1, borderTopColor: c.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.goldMuted },
  rowText: { flex: 1, color: c.text, fontSize: font.md, fontFamily: fonts.semibold },
  signOut: { marginTop: space.xl },
  foot: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular, textAlign: 'center', marginTop: space.lg, lineHeight: 17 },
}));
