import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useSession } from '../session';
import { Banner, Button, Card, Checkbox, Field, Icon, Logo, Screen } from '../components';
import { font, fonts, makeStyles, radius, space, tint, useTheme } from '../theme';
import { isAndroidWeb, isIosWeb, isStandalone } from '../platform';

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen() {
  const { signIn, notice, rememberedEmail, rememberChoice } = useSession();
  // The Light / Dark choice from Settings stays after signing out.
  const { colors: c } = useTheme();
  const s = useStyles();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState(rememberedEmail);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(rememberChoice);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  // A problem with one field shows under it; anything else above the form.
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The saved email arrives a moment after the screen opens.
  useEffect(() => { if (rememberedEmail && !email) setEmail(rememberedEmail); }, [rememberedEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const e = email.trim();
    setError(null);
    setEmailError(!e ? 'Enter your email.' : !EMAIL_SHAPE.test(e) ? 'That is not an email address.' : null);
    setPasswordError(!password ? 'Enter your password.' : null);
    if (!e || !EMAIL_SHAPE.test(e) || !password) return;
    setBusy(true);
    const problem = await signIn(e, password, remember);
    setBusy(false);
    if (!problem) return;
    if (problem.field === 'email') setEmailError(problem.message);
    else if (problem.field === 'password') { setPasswordError(problem.message); setPassword(''); passwordRef.current?.focus(); }
    else setError(problem.message);
  };

  return (
    <Screen center>
      <View style={s.brand}>
        <Logo size={112} />
        <Text style={s.title}>JSCI Ministry</Text>
        <Text style={s.subtitle}>Joyful Sound Church International</Text>
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
          onChangeText={(v) => { setEmail(v); if (emailError) setEmailError(null); }}
          error={emailError}
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
          onChangeText={(v) => { setPassword(v); if (passwordError) setPasswordError(null); }}
          error={passwordError}
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

        <View style={s.rememberRow}>
          <Checkbox checked={remember} onChange={setRemember} label="Keep me signed in" />
        </View>
        {!remember && <Text style={s.rememberHint}>You will be signed out when you close the app.</Text>}

        <Button title="Sign In" icon="right-to-bracket" onPress={submit} loading={busy} style={s.submit} />
      </Card>

      <Text style={s.foot}>
        For Ministry Members of Joyful Sound Church. Use the same email and password as the JSCI website.
      </Text>
      <InstallTip />
    </Screen>
  );
}

// Opened in the phone's browser (not from the Home Screen): how to add it as
// an app, so it opens full screen like the Android app.
function InstallTip() {
  const { colors: c } = useTheme();
  const s = useStyles();
  const [hidden, setHidden] = useState(false);
  const ios = isIosWeb();
  if (hidden || isStandalone() || !(ios || isAndroidWeb())) return null;
  const steps: { icon: React.ComponentProps<typeof Icon>['name']; text: React.ReactNode }[] = ios
    ? [
      { icon: 'arrow-up-from-bracket', text: <>Tap <Text style={s.tipStrong}>Share</Text> at the bottom of Safari</> },
      { icon: 'square-plus', text: <>Choose <Text style={s.tipStrong}>Add to Home Screen</Text>, then Add</> },
      { icon: 'mobile-screen', text: <>Open <Text style={s.tipStrong}>JSCI Ministry</Text> from your Home Screen</> },
    ]
    : [
      { icon: 'ellipsis-vertical', text: <>Tap the <Text style={s.tipStrong}>menu</Text> at the top of Chrome</> },
      { icon: 'square-plus', text: <>Choose <Text style={s.tipStrong}>Add to Home screen</Text> (or Install app)</> },
      { icon: 'mobile-screen', text: <>Open <Text style={s.tipStrong}>JSCI Ministry</Text> from your Home screen</> },
    ];
  return (
    <View style={s.tip}>
      <View style={s.tipHead}>
        <Icon name="mobile-screen-button" size={16} color={c.goldText} />
        <Text style={s.tipTitle}>Add JSCI Ministry to your Home Screen</Text>
        <Pressable onPress={() => setHidden(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hide">
          <Icon name="xmark" size={14} color={c.textMuted} />
        </Pressable>
      </View>
      <Text style={s.tipText}>It opens full screen like an app, and you stay signed in.</Text>
      {steps.map((step, i) => (
        <View key={i} style={s.tipStep}>
          <View style={s.tipNum}><Text style={s.tipNumText}>{i + 1}</Text></View>
          <Icon name={step.icon} size={14} color={c.goldText} />
          <Text style={s.tipStepText}>{step.text}</Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  farewell: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: c.goldMuted, marginBottom: space.md },
  farewellTitle: { color: c.goldText, fontSize: font.md, fontFamily: fonts.bold },
  farewellText: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, marginTop: 2 },
  brand: { alignItems: 'center', marginBottom: space.xl },
  title: { color: c.goldText, fontSize: font.hero, fontFamily: fonts.heavy, letterSpacing: 0.3, marginTop: space.md },
  subtitle: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.medium, marginTop: 2 },
  eye: { padding: 10 },
  rememberRow: { marginTop: -2, marginBottom: 2 },
  rememberHint: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular, marginLeft: 32, marginTop: -2 },
  submit: { marginTop: space.md },
  tip: { marginTop: space.lg, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: tint(c.secondary, 0.45), backgroundColor: c.cardRaised },
  tipHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tipTitle: { flex: 1, color: c.text, fontSize: font.md, fontFamily: fonts.bold },
  tipText: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, marginTop: 4, marginBottom: space.sm },
  tipStep: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 5 },
  tipNum: { width: 20, height: 20, borderRadius: 10, backgroundColor: c.goldMuted, alignItems: 'center', justifyContent: 'center' },
  tipNumText: { color: c.goldText, fontSize: font.xs, fontFamily: fonts.bold },
  tipStepText: { flex: 1, color: c.text, fontSize: font.sm, fontFamily: fonts.regular },
  tipStrong: { fontFamily: fonts.bold },
  foot: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular, textAlign: 'center', marginTop: space.lg, lineHeight: 17, paddingHorizontal: space.lg },
}));
