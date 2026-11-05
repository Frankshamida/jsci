import React, { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useSession } from '../session';
import { Banner, Button, Card, Field, Icon, Logo, Screen } from '../components';
import { font, fonts, makeStyles, radius, space, useTheme } from '../theme';

export default function LoginScreen() {
  const { signIn, notice } = useSession();
  // The Light / Dark choice from Settings stays after signing out.
  const { colors: c } = useTheme();
  const s = useStyles();
  const passwordRef = useRef<TextInput>(null);
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
    <Screen center>
      <View style={s.brand}>
        <Logo size={112} />
        <Text style={s.title}>JSCI Ministry</Text>
        <Text style={s.subtitle}>Praise & Worship Team</Text>
      </View>

      {notice?.tone === 'farewell' && (
        <View style={s.farewell}>
          <Icon name="hands-praying" size={18} color={c.goldText} />
          <View style={s.flex}>
            <Text style={s.farewellTitle}>{notice.text}</Text>
            <Text style={s.farewellText}>You have signed out. God bless your ministry!</Text>
          </View>
        </View>
      )}

      <Card>
        {notice?.tone === 'warn' && <Banner tone="warn" text={notice.text} />}
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
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <Field
          label="Password"
          inputRef={passwordRef}
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          autoComplete="password"
          textContentType="password"
          placeholder="Your JSCI password"
          returnKeyType="go"
          onSubmitEditing={submit}
          right={(
            <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10} style={s.eye} accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}>
              <Icon name={showPassword ? 'eye-slash' : 'eye'} size={17} color={c.textSecondary} />
            </Pressable>
          )}
        />

        <Button title="Sign In" icon="right-to-bracket" onPress={submit} loading={busy} style={s.submit} />
      </Card>

      <Text style={s.foot}>
        For Ministry Members of Joyful Sound Church. Use the same email and password as the JSCI website.
      </Text>
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  farewell: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: c.goldMuted, marginBottom: space.md },
  farewellTitle: { color: c.goldText, fontSize: font.md, fontFamily: fonts.bold },
  farewellText: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, marginTop: 2 },
  brand: { alignItems: 'center', marginBottom: space.xl },
  title: { color: c.goldText, fontSize: font.hero, fontFamily: fonts.heavy, letterSpacing: 0.3, marginTop: space.md },
  subtitle: { color: c.textSecondary, fontSize: font.md, fontFamily: fonts.medium, marginTop: 2 },
  eye: { padding: 10 },
  submit: { marginTop: space.sm },
  foot: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular, textAlign: 'center', marginTop: space.lg, lineHeight: 17, paddingHorizontal: space.lg },
}));
