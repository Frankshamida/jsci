import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSession } from '../session';
import { Banner, Button, Field } from '../components';
import { colors, font, radius, space } from '../theme';

export default function LoginScreen() {
  const { signIn, notice } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setBusy(true);
    setError(null);
    const message = await signIn(email, password);
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <View style={s.brand}>
            <Image source={require('../../assets/icon.png')} style={s.logo} />
            <Text style={s.title}>JSCI Ministry</Text>
            <Text style={s.subtitle}>Praise & Worship Team</Text>
          </View>

          {notice && <Banner tone="warn" text={notice} />}
          {error && <Banner tone="danger" text={error} />}

          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            placeholder="you@email.com"
            returnKeyType="next"
          />
          <View>
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoComplete="password"
              textContentType="password"
              placeholder="Your JSCI password"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            <Pressable style={s.eye} onPress={() => setShowPassword((v) => !v)} hitSlop={10} accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}>
              <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={20} color={colors.textSecondary} />
            </Pressable>
          </View>

          <Button title="Sign In" icon="log-in-outline" onPress={submit} loading={busy} style={s.submit} />

          <Text style={s.foot}>
            For Ministry Members of Joyful Sound Church. Use the same email and password as the JSCI website.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flexGrow: 1, justifyContent: 'center', padding: space.xl },
  brand: { alignItems: 'center', marginBottom: space.xl },
  logo: { width: 96, height: 96, borderRadius: radius.xl, marginBottom: space.md },
  title: { color: colors.goldLight, fontSize: font.hero, fontWeight: '900', letterSpacing: 0.5 },
  subtitle: { color: colors.textSecondary, fontSize: font.md, marginTop: 4 },
  eye: { position: 'absolute', right: 14, top: 40 },
  submit: { marginTop: space.sm },
  foot: { color: colors.textMuted, fontSize: font.xs, textAlign: 'center', marginTop: space.xl, lineHeight: 17 },
});
