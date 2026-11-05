import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useSession } from '../session';
import { Button, Icon, Logo, Screen } from '../components';
import { font, fonts, makeStyles, space, useTheme } from '../theme';

// Shown instead of the app while it is locked; asks for the fingerprint at once.
export default function LockScreen() {
  const { unlock, signOut, biometricLabel, profile } = useSession();
  const { colors: c } = useTheme();
  const s = useStyles();
  const [failed, setFailed] = useState(false);

  const tryUnlock = async () => { setFailed(!(await unlock())); };
  // Once, when the lock appears.
  useEffect(() => { tryUnlock(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen center scroll={false}>
      <View style={s.body}>
        <Logo size={84} />
        <View style={s.badge}>
          <Icon name={biometricLabel === 'Face ID' ? 'face-smile' : 'fingerprint'} size={40} color={c.goldText} />
        </View>
        <Text style={s.title}>JSCI Ministry is locked</Text>
        <Text style={s.text}>{profile ? `Hi ${profile.firstname}! ` : ''}Use your {biometricLabel.toLowerCase()} to open the app.</Text>
        {failed && <Text style={s.failed}>Not recognised. Try again.</Text>}
        <Button title={`Unlock with ${biometricLabel}`} icon="lock-open" onPress={tryUnlock} style={s.button} />
        <Button title="Sign out instead" variant="ghost" icon="right-from-bracket" onPress={() => signOut()} style={s.button} />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg, gap: space.md },
  badge: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: c.goldMuted, marginTop: space.lg },
  title: { color: c.text, fontSize: font.xl, fontFamily: fonts.bold, marginTop: space.sm },
  text: { color: c.textSecondary, fontSize: font.md, fontFamily: fonts.regular, textAlign: 'center', lineHeight: 22 },
  failed: { color: c.danger, fontSize: font.sm, fontFamily: fonts.semibold },
  button: { alignSelf: 'stretch' },
}));
