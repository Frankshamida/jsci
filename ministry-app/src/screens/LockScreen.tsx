import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSession } from '../session';
import { Button } from '../components';
import { colors, font, radius, space } from '../theme';

// Shown instead of the app while it is locked; asks for the fingerprint at once.
export default function LockScreen() {
  const { unlock, signOut, biometricLabel, profile } = useSession();
  const [failed, setFailed] = useState(false);

  const tryUnlock = async () => { setFailed(!(await unlock())); };
  // Once, when the lock appears.
  useEffect(() => { tryUnlock(); }, []);

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.body}>
        <Image source={require('../../assets/icon.png')} style={s.logo} />
        <Ionicons name={biometricLabel === 'Face ID' ? 'scan' : 'finger-print'} size={56} color={colors.goldLight} />
        <Text style={s.title}>JSCI Ministry is locked</Text>
        <Text style={s.text}>{profile ? `Hi ${profile.firstname}! ` : ''}Use your {biometricLabel.toLowerCase()} to open the app.</Text>
        {failed && <Text style={s.failed}>Not recognised. Try again.</Text>}
        <Button title={`Unlock with ${biometricLabel}`} icon="lock-open-outline" onPress={tryUnlock} style={s.button} />
        <Button title="Sign out instead" variant="ghost" onPress={() => signOut()} style={s.button} />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  logo: { width: 64, height: 64, borderRadius: radius.lg, marginBottom: space.lg },
  title: { color: colors.text, fontSize: font.xl, fontWeight: '800' },
  text: { color: colors.textSecondary, fontSize: font.md, textAlign: 'center', lineHeight: 22 },
  failed: { color: colors.danger, fontSize: font.sm, fontWeight: '700' },
  button: { alignSelf: 'stretch' },
});
