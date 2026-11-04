import React, { useState } from 'react';
import { Alert, Linking, StyleSheet, Switch, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSession } from '../session';
import { API_BASE_URL } from '../config';
import { Avatar, Banner, Button, Card, Chip, Screen, SectionTitle } from '../components';
import { colors, font, space } from '../theme';
import { longDate } from '../utils';

export default function ProfileScreen() {
  const { profile, home, signOut, lockEnabled, biometricLabel, setLockEnabled, lastUpdated } = useSession();
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

  const confirmSignOut = () => Alert.alert('Sign out?', 'You will need your email and password to sign in again.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
  ]);

  return (
    <Screen>
      <View style={s.head}>
        <Avatar name={profile.fullName} picture={profile.profilePicture} size={88} ring={colors.gold} />
        <Text style={s.name}>{profile.fullName}</Text>
        <Text style={s.muted}>{profile.email}</Text>
        {profile.memberId ? <Text style={s.memberId}>Member ID {profile.memberId}</Text> : null}
      </View>

      <View style={s.stats}>
        <View style={s.stat}><Text style={s.statValue}>{upcoming}</Text><Text style={s.statLabel}>Upcoming</Text></View>
        <View style={s.stat}><Text style={s.statValue}>{served}</Text><Text style={s.statLabel}>Served (8 wks)</Text></View>
        <View style={s.stat}><Text style={s.statValue}>{home?.attendance.length ?? 0}</Text><Text style={s.statLabel}>Check-ins</Text></View>
      </View>

      <SectionTitle title="Ministry" />
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
          <View style={s.chips}>{profile.roles.map((r) => <Chip key={r} label={r} color={colors.info} />)}</View>
        </View>
      </Card>

      {profile.birthdate ? (
        <Card style={s.row}>
          <Ionicons name="gift-outline" size={18} color={colors.goldLight} />
          <Text style={s.rowText}>Birthday</Text>
          <Text style={s.muted}>{longDate(profile.birthdate.slice(0, 10)).replace(/^\w+, /, '')}</Text>
        </Card>
      ) : null}

      <SectionTitle title="Security" />
      <Card style={s.row}>
        <Ionicons name="finger-print" size={22} color={colors.goldLight} />
        <View style={s.flex}>
          <Text style={s.rowText}>Lock with {biometricLabel}</Text>
          <Text style={s.muted}>Asks for your {biometricLabel.toLowerCase()} when you open the app.</Text>
        </View>
        <Switch
          value={lockEnabled}
          onValueChange={toggleLock}
          disabled={lockBusy}
          trackColor={{ false: colors.border, true: colors.goldDark }}
          thumbColor={lockEnabled ? colors.goldLight : colors.textSecondary}
          accessibilityLabel={`Lock with ${biometricLabel}`}
        />
      </Card>
      {lockError && <Banner tone="warn" text={lockError} />}

      <SectionTitle title="Account" />
      <Card style={s.row} onPress={() => Linking.openURL(`${API_BASE_URL}/dashboard`)}>
        <Ionicons name="globe-outline" size={20} color={colors.textSecondary} />
        <View style={s.flex}>
          <Text style={s.rowText}>Edit profile on the website</Text>
          <Text style={s.muted}>Photo, name and password are changed on the JSCI website.</Text>
        </View>
        <Ionicons name="open-outline" size={16} color={colors.textMuted} />
      </Card>

      <Button title="Sign Out" icon="log-out-outline" variant="danger" onPress={confirmSignOut} style={s.signOut} />
      <Text style={s.foot}>
        JSCI Ministry · Praise & Worship{lastUpdated ? `\nSynced ${new Date(lastUpdated).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
      </Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  head: { alignItems: 'center', gap: 4, marginTop: space.lg },
  name: { color: colors.text, fontSize: font.xxl, fontWeight: '900', marginTop: space.sm, textAlign: 'center' },
  memberId: { color: colors.goldLight, fontSize: font.xs, fontWeight: '700', marginTop: 2 },
  muted: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 19 },
  stats: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  stat: { flex: 1, alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingVertical: space.md },
  statValue: { color: colors.goldLight, fontSize: font.xl, fontWeight: '900' },
  statLabel: { color: colors.textSecondary, fontSize: font.xs, marginTop: 2 },
  ministry: { paddingVertical: space.sm },
  ministryLabel: { color: colors.text, fontSize: font.md, fontWeight: '800', marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowText: { flex: 1, color: colors.text, fontSize: font.md, fontWeight: '700' },
  signOut: { marginTop: space.xl },
  foot: { color: colors.textMuted, fontSize: font.xs, textAlign: 'center', marginTop: space.lg, lineHeight: 17 },
});
