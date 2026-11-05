// Shared building blocks: one look across every screen, in the website's
// style - white (or navy) cards, the gold gradient, Font Awesome, Outfit.
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, Image, Pressable, RefreshControl, Text, TextInput, View,
  type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon, type IconName } from './icons';
import { KeyboardScroll, useRevealOnFocus } from './keyboard';
import { font, fonts, makeStyles, radius, space, tint, useTheme, type Palette } from './theme';
import { initials } from './utils';

export { Icon };
export type { IconName };

// ---- Page ----

// `stacked`: a screen under the navigation header, which already covers the
// status bar, so only the sides and the bottom keep clear of the notch.
// `center`: the content sits in the middle (sign-in, lock).
// `onRefresh`: pull down to refresh. The spinner shows only for a pull, not
// for the quiet refreshes the app does by itself.
export function Screen({ children, onRefresh, scroll = true, padded = true, stacked = false, center = false }: {
  children: React.ReactNode; onRefresh?: () => unknown; scroll?: boolean; padded?: boolean; stacked?: boolean; center?: boolean;
}) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const [pulling, setPulling] = useState(false);
  const pull = async () => {
    setPulling(true);
    try { await onRefresh?.(); } finally { setPulling(false); }
  };
  const inner = [padded && s.padded, center && s.center];
  return (
    <SafeAreaView style={s.screen} edges={stacked ? ['left', 'right', 'bottom'] : ['top', 'left', 'right']}>
      {scroll ? (
        <KeyboardScroll
          contentContainerStyle={[...inner, s.scrollEnd]}
          refreshControl={onRefresh
            ? <RefreshControl refreshing={pulling} onRefresh={pull} tintColor={c.secondary} colors={[c.secondary]} progressBackgroundColor={c.card} />
            : undefined}
        >
          {children}
        </KeyboardScroll>
      ) : <View style={[s.flex, ...inner]}>{children}</View>}
    </SafeAreaView>
  );
}

export function Card({ children, style, onPress, raised }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; raised?: boolean }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const box = [s.card, raised && s.cardRaised, style];
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [...box, pressed && s.pressed]} android_ripple={{ color: tint(c.secondary, 0.12) }}>
        {children}
      </Pressable>
    );
  }
  return <View style={box}>{children}</View>;
}

// ---- Buttons ----

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ title, onPress, variant = 'primary', icon, loading, disabled, style, compact }: {
  title: string; onPress: () => void; variant?: ButtonVariant; icon?: IconName; loading?: boolean; disabled?: boolean;
  style?: StyleProp<ViewStyle>; compact?: boolean;
}) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const off = disabled || loading;
  const fg = { primary: c.onGold, secondary: c.text, ghost: c.goldText, danger: c.danger }[variant];
  const body = (
    <>
      {loading ? <ActivityIndicator color={fg} size="small" /> : icon ? <Icon name={icon} size={compact ? 12 : 15} color={fg} /> : null}
      <Text style={[s.buttonText, compact && s.buttonTextCompact, { color: fg }]}>{title}</Text>
    </>
  );
  const inner = [s.buttonInner, compact && s.buttonInnerCompact];
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [s.button, compact && s.buttonCompact, variant !== 'primary' && s[variant], off && s.disabled, pressed && s.pressed, style]}
    >
      {variant === 'primary'
        ? <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={inner}>{body}</LinearGradient>
        : <View style={inner}>{body}</View>}
    </Pressable>
  );
}

// A round icon-only button (theme toggle, show password).
export function IconButton({ icon, onPress, label, color, size = 16 }: { icon: IconName; onPress: () => void; label: string; color?: string; size?: number }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [s.iconButton, pressed && s.pressed]}>
      <Icon name={icon} size={size} color={color || c.textSecondary} />
    </Pressable>
  );
}

// ---- People and labels ----

export function Avatar({ name, picture, size = 40, ring }: { name: string; picture?: string | null; size?: number; ring?: string }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const dims = { width: size, height: size, borderRadius: size / 2 };
  const border = ring ? { borderWidth: 2, borderColor: ring } : null;
  if (picture) return <Image source={{ uri: picture }} style={[dims, border, s.avatarImg]} />;
  return (
    <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[dims, border, s.avatar]}>
      <Text style={[s.avatarText, { fontSize: size * 0.36 }]}>{initials(name)}</Text>
    </LinearGradient>
  );
}

// Text that reads on a solid chip of this colour.
const onColor = (hex: string) => {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? '#1a1a2e' : '#ffffff';
};

export function Chip({ label, color, icon, solid }: { label: string; color?: string; icon?: IconName; solid?: boolean }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const tone = color || c.goldText;
  const fg = solid ? onColor(tone) : tone;
  return (
    <View style={[s.chip, { backgroundColor: solid ? tone : tint(tone, 0.12), borderColor: tint(tone, solid ? 0.9 : 0.3) }]}>
      {icon && <Icon name={icon} size={10} color={fg} />}
      <Text style={[s.chipText, { color: fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export function statusColor(c: Palette, status: string): string {
  if (['Approved', 'Accepted', 'Present'].includes(status)) return c.success;
  if (['Pending', 'Pending Admin', 'Late'].includes(status)) return c.warning;
  if (['Open for Sub', 'Excused'].includes(status)) return c.info;
  if (['Rejected', 'Absent'].includes(status)) return c.danger;
  return c.textSecondary;
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const { colors: c } = useTheme();
  return <Chip label={label || status} color={statusColor(c, status)} />;
}

export function SectionTitle({ title, icon, action, onAction }: { title: string; icon?: IconName; action?: string; onAction?: () => void }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  return (
    <View style={s.sectionRow}>
      <View style={s.sectionLeft}>
        {icon && <Icon name={icon} size={14} color={c.goldText} />}
        <Text style={s.sectionTitle}>{title}</Text>
      </View>
      {action && onAction && <Pressable onPress={onAction} hitSlop={10}><Text style={s.sectionAction}>{action}</Text></Pressable>}
    </View>
  );
}

export function EmptyState({ icon, title, text }: { icon: IconName; title: string; text?: string }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}><Icon name={icon} size={24} color={c.goldText} /></View>
      <Text style={s.emptyTitle}>{title}</Text>
      {text ? <Text style={s.emptyText}>{text}</Text> : null}
    </View>
  );
}

// ---- Forms ----

// A labelled text box. `right`: something inside the box on the right (show password).
export function Field({ label, hint, right, inputRef, onFocus, ...input }: TextInputProps & {
  label: string; hint?: string; right?: React.ReactNode; inputRef?: React.Ref<TextInput>;
}) {
  const { colors: c, scheme } = useTheme();
  const s = useStyles();
  const reveal = useRevealOnFocus();
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={[s.inputBox, input.multiline && s.inputBoxMultiline]}>
        <TextInput
          ref={inputRef}
          placeholderTextColor={c.textMuted}
          keyboardAppearance={scheme}
          selectionColor={c.secondary}
          cursorColor={c.secondary}
          {...input}
          onFocus={(e) => { reveal(); onFocus?.(e); }}
          style={[s.input, input.multiline && s.inputMultiline, input.style]}
        />
        {right}
      </View>
      {hint ? <Text style={s.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

const BANNER_ICON: Record<'info' | 'warn' | 'danger' | 'success', IconName> = {
  info: 'circle-info', warn: 'triangle-exclamation', danger: 'circle-exclamation', success: 'circle-check',
};
export function Banner({ text, tone = 'info', icon }: { text: string; tone?: 'info' | 'warn' | 'danger' | 'success'; icon?: IconName }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const color = { info: c.info, warn: c.warning, danger: c.danger, success: c.success }[tone];
  return (
    <View style={[s.banner, { backgroundColor: tint(color, 0.1), borderColor: tint(color, 0.3) }]}>
      <Icon name={icon || BANNER_ICON[tone]} size={15} color={color} style={s.bannerIcon} />
      <Text style={[s.bannerText, { color }]}>{text}</Text>
    </View>
  );
}

// A row of choices where one is picked ("Slow Song" / "Fast Song", a date).
export function ChoiceRow<T extends string>({ options, value, onChange, labels }: {
  options: T[]; value: T | null; onChange: (v: T) => void; labels?: Partial<Record<T, string>>;
}) {
  const s = useStyles();
  return (
    <View style={s.choiceRow}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable key={o} onPress={() => onChange(o)} style={[s.choice, on && s.choiceOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
            <Text style={[s.choiceText, on && s.choiceTextOn]}>{labels?.[o] || o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Logo({ size = 88 }: { size?: number }) {
  return <Image source={require('../assets/logo.png')} style={{ width: size, height: size }} resizeMode="contain" accessibilityLabel="JSCI logo" />;
}

// One calm loading screen, in the middle of the phone: the logo breathing in a
// soft gold glow, three dots, and what is being loaded.
export function LoadingView({ message }: { message?: string }) {
  const s = useStyles();
  const breathe = useRef(new Animated.Value(0)).current;
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0.25))).current;

  useEffect(() => {
    const ease = Easing.inOut(Easing.quad);
    const glow = Animated.loop(Animated.sequence([
      Animated.timing(breathe, { toValue: 1, duration: 1100, easing: ease, useNativeDriver: true }),
      Animated.timing(breathe, { toValue: 0, duration: 1100, easing: ease, useNativeDriver: true }),
    ]));
    const dance = Animated.loop(Animated.stagger(180, dots.map((d) => Animated.sequence([
      Animated.timing(d, { toValue: 1, duration: 320, easing: ease, useNativeDriver: true }),
      Animated.timing(d, { toValue: 0.25, duration: 320, easing: ease, useNativeDriver: true }),
    ]))));
    glow.start();
    dance.start();
    return () => { glow.stop(); dance.stop(); };
  }, [breathe, dots]);

  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] });
  const halo = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.8] });

  return (
    <View style={s.loading} accessibilityRole="progressbar" accessibilityLabel={message || 'Loading'}>
      <View style={s.loadingMark}>
        <Animated.View style={[s.loadingHalo, { opacity: halo, transform: [{ scale }] }]} />
        <Animated.View style={{ transform: [{ scale }] }}><Logo size={92} /></Animated.View>
      </View>
      <View style={s.loadingDots}>
        {dots.map((d, i) => <Animated.View key={i} style={[s.loadingDot, { opacity: d, transform: [{ scale: d }] }]} />)}
      </View>
      {message ? <Text style={s.loadingText}>{message}</Text> : null}
    </View>
  );
}

// ---- Styles ----

export const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: c.background },
  padded: { padding: space.lg },
  center: { flexGrow: 1, justifyContent: 'center' },
  scrollEnd: { paddingBottom: space.xxl * 2 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },

  card: {
    backgroundColor: c.card,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
    borderWidth: 1,
    borderColor: c.scheme === 'light' ? '#eceef1' : c.border,
    boxShadow: c.scheme === 'light' ? '0px 2px 10px rgba(0, 0, 0, 0.05)' : undefined,
  },
  cardRaised: { backgroundColor: c.cardRaised, borderColor: tint(c.secondary, 0.35) },

  button: { borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: 'transparent' },
  buttonCompact: { borderRadius: radius.sm },
  buttonInner: { minHeight: 48, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  buttonInnerCompact: { minHeight: 36, paddingHorizontal: space.md },
  buttonText: { fontFamily: fonts.semibold, fontSize: font.md },
  buttonTextCompact: { fontSize: font.sm },
  secondary: { backgroundColor: c.card, borderColor: c.borderStrong },
  ghost: { backgroundColor: 'transparent', borderColor: tint(c.secondary, 0.55) },
  danger: { backgroundColor: tint(c.danger, 0.1), borderColor: tint(c.danger, 0.35) },
  iconButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.border },

  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarImg: { backgroundColor: c.cardRaised },
  avatarText: { color: '#ffffff', fontFamily: fonts.bold },

  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, maxWidth: '100%' },
  chipText: { fontFamily: fonts.semibold, fontSize: font.xs },

  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.lg, marginBottom: space.sm },
  sectionLeft: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sectionTitle: { color: c.text, fontSize: font.lg, fontFamily: fonts.bold },
  sectionAction: { color: c.goldText, fontSize: font.sm, fontFamily: fonts.semibold },

  empty: { alignItems: 'center', paddingVertical: space.xl, gap: 6 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: c.goldMuted, marginBottom: 4 },
  emptyTitle: { color: c.text, fontSize: font.md, fontFamily: fonts.semibold, textAlign: 'center' },
  emptyText: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, textAlign: 'center', lineHeight: 19 },

  field: { marginBottom: space.md },
  fieldLabel: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.semibold, marginBottom: 6 },
  fieldHint: { color: c.warning, fontSize: font.xs, fontFamily: fonts.medium, marginTop: 4 },
  inputBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.input, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingRight: 4 },
  inputBoxMultiline: { alignItems: 'flex-start' },
  input: { flex: 1, paddingHorizontal: space.md, paddingVertical: 12, color: c.text, fontSize: font.md, fontFamily: fonts.regular },
  inputMultiline: { minHeight: 90, textAlignVertical: 'top' },

  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, marginBottom: space.md },
  bannerIcon: { marginTop: 2 },
  bannerText: { flex: 1, fontSize: font.sm, lineHeight: 19, fontFamily: fonts.medium },

  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  choice: { paddingHorizontal: space.md, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  choiceOn: { borderColor: c.secondary, backgroundColor: c.goldMuted },
  choiceText: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.medium },
  choiceTextOn: { color: c.goldText, fontFamily: fonts.bold },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background, padding: space.xl },
  loadingMark: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center' },
  loadingHalo: { position: 'absolute', width: 150, height: 150, borderRadius: 75, backgroundColor: tint(c.secondary, c.scheme === 'dark' ? 0.18 : 0.14) },
  loadingDots: { flexDirection: 'row', gap: 8, marginTop: space.lg },
  loadingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.secondary },
  loadingText: { color: c.textSecondary, fontSize: font.md, fontFamily: fonts.medium, marginTop: space.md, textAlign: 'center' },
}));
