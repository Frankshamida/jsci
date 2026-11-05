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
import { initials, monthLabel, parseYmd, shiftMonth } from './utils';
import { useMiniPlayerInset } from './player';
import { IS_WEB, NATIVE_DRIVER } from './platform';

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
  const playerInset = useMiniPlayerInset(); // the song player sits at the bottom
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
          contentContainerStyle={[...inner, s.scrollEnd, playerInset ? { paddingBottom: space.xxl * 2 + playerInset } : null]}
          refreshControl={onRefresh && !IS_WEB
            ? <RefreshControl refreshing={pulling} onRefresh={pull} tintColor={c.secondary} colors={[c.secondary]} progressBackgroundColor={c.card} />
            : undefined}
          onPullRefresh={onRefresh && IS_WEB ? async () => { await onRefresh(); } : undefined}
        >
          {children}
        </KeyboardScroll>
      ) : <View style={[s.flex, ...inner, playerInset ? { paddingBottom: playerInset } : null]}>{children}</View>}
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
// `error`: what is wrong with this field, in red under it (and a red border).
export function Field({ label, hint, error, right, inputRef, onFocus, ...input }: TextInputProps & {
  label: string; hint?: string; error?: string | null; right?: React.ReactNode; inputRef?: React.Ref<TextInput>;
}) {
  const { colors: c, scheme } = useTheme();
  const s = useStyles();
  const reveal = useRevealOnFocus();
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={[s.inputBox, input.multiline && s.inputBoxMultiline, !!error && s.inputBoxError]}>
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
      {error ? (
        <View style={s.fieldErrorRow} accessibilityLiveRegion="polite">
          <Icon name="circle-exclamation" size={12} color={c.danger} />
          <Text style={s.fieldError}>{error}</Text>
        </View>
      ) : hint ? <Text style={s.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

// A tick box with its label ("Keep me signed in").
export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  return (
    <Pressable onPress={() => onChange(!checked)} hitSlop={6} style={s.check} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label}>
      {checked ? (
        <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.checkBox, s.checkBoxOn]}>
          <Icon name="check" size={12} color="#ffffff" />
        </LinearGradient>
      ) : <View style={s.checkBox} />}
      <Text style={s.checkLabel}>{label}</Text>
    </Pressable>
  );
}

// Tabs inside a page ("Song Lead / Backup / Musicians / Dancers"): one pill
// marks the open one. `counts` adds a small number to a label.
export function Segmented<T extends string>({ options, value, onChange, labels, counts, icons }: {
  options: T[]; value: T; onChange: (v: T) => void; labels?: Partial<Record<T, string>>;
  counts?: Partial<Record<T, number>>; icons?: Partial<Record<T, IconName>>;
}) {
  const { colors: c } = useTheme();
  const s = useStyles();
  return (
    <View style={s.segment} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o === value;
        const count = counts?.[o];
        const icon = icons?.[o];
        return (
          <Pressable key={o} onPress={() => onChange(o)} style={[s.segmentItem, on && s.segmentItemOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
            {icon ? <Icon name={icon} size={12} color={on ? c.goldText : c.textSecondary} /> : null}
            <Text style={[s.segmentText, on && s.segmentTextOn]} numberOfLines={1}>{labels?.[o] || o}</Text>
            {count ? <View style={[s.segmentCount, on && s.segmentCountOn]}><Text style={[s.segmentCountText, on && s.segmentCountTextOn]}>{count}</Text></View> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// "<  NOVEMBER 2026  >", with a way back to this month.
export function MonthSwitcher({ month, onChange, current, loading }: { month: string; onChange: (m: string) => void; current: string; loading?: boolean }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const isCurrent = month === current;
  const past = month < current;
  return (
    <View style={s.monthBar}>
      <Pressable onPress={() => onChange(shiftMonth(month, -1))} hitSlop={10} style={({ pressed }) => [s.monthArrow, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel="Previous month">
        <Icon name="chevron-left" size={14} color={c.goldText} />
      </Pressable>
      <View style={s.monthCenter}>
        <Text style={s.monthName}>{monthLabel(month).toUpperCase()}</Text>
        {isCurrent ? (
          <View style={s.monthPill}><Text style={s.monthPillText}>This month</Text></View>
        ) : (
          <Pressable onPress={() => onChange(current)} hitSlop={8} accessibilityRole="button">
            <Text style={s.monthBack}>{loading ? 'Loading…' : past ? 'Past month · back to today' : 'Back to this month'}</Text>
          </Pressable>
        )}
      </View>
      <Pressable onPress={() => onChange(shiftMonth(month, 1))} hitSlop={10} style={({ pressed }) => [s.monthArrow, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel="Next month">
        <Icon name="chevron-right" size={14} color={c.goldText} />
      </Pressable>
    </View>
  );
}

// A date as "NOV / 15 / SUN": gold when it is today, grey when it has passed.
export function DateBox({ date, today, size = 'md' }: { date: string; today: string; size?: 'md' | 'sm' }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const d = parseYmd(date);
  const mon = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  const dow = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  const box = [s.dateBox, size === 'sm' && s.dateBoxSm];
  const body = (on: boolean) => (
    <>
      <Text style={[s.dateMon, on && s.onGold]}>{mon}</Text>
      <Text style={[s.dateDay, size === 'sm' && s.dateDaySm, on && s.onGold]}>{d.getDate()}</Text>
      <Text style={[s.dateDow, on && s.onGoldSoft]}>{dow}</Text>
    </>
  );
  if (date === today) {
    return <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={box}>{body(true)}</LinearGradient>;
  }
  return <View style={[...box, date < today ? s.dateBoxPast : s.dateBoxPlain]}>{body(false)}</View>;
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
      Animated.timing(breathe, { toValue: 1, duration: 1100, easing: ease, useNativeDriver: NATIVE_DRIVER }),
      Animated.timing(breathe, { toValue: 0, duration: 1100, easing: ease, useNativeDriver: NATIVE_DRIVER }),
    ]));
    const dance = Animated.loop(Animated.stagger(180, dots.map((d) => Animated.sequence([
      Animated.timing(d, { toValue: 1, duration: 320, easing: ease, useNativeDriver: NATIVE_DRIVER }),
      Animated.timing(d, { toValue: 0.25, duration: 320, easing: ease, useNativeDriver: NATIVE_DRIVER }),
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
  fieldErrorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  fieldError: { flex: 1, color: c.danger, fontSize: font.sm, fontFamily: fonts.semibold },
  inputBoxError: { borderColor: c.danger, backgroundColor: tint(c.danger, 0.05) },

  check: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, alignSelf: 'flex-start' },
  checkBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: c.borderStrong, backgroundColor: c.input, alignItems: 'center', justifyContent: 'center' },
  checkBoxOn: { borderWidth: 0 },
  checkLabel: { color: c.text, fontSize: font.md, fontFamily: fonts.medium },

  segment: { flexDirection: 'row', backgroundColor: c.scheme === 'light' ? '#eef0f3' : c.cardRaised, borderRadius: radius.pill, padding: 4, marginBottom: space.md, gap: 4 },
  segmentItem: { flex: 1, minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: radius.pill, paddingHorizontal: 6 },
  segmentItemOn: { backgroundColor: c.card, boxShadow: c.scheme === 'light' ? '0px 1px 6px rgba(0, 0, 0, 0.10)' : '0px 1px 6px rgba(0, 0, 0, 0.35)' },
  segmentText: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.medium, flexShrink: 1 },
  segmentTextOn: { color: c.goldText, fontFamily: fonts.bold },
  segmentCount: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: tint(c.textSecondary, 0.18) },
  segmentCountOn: { backgroundColor: c.danger },
  segmentCountText: { color: c.textSecondary, fontSize: 10, fontFamily: fonts.bold },
  segmentCountTextOn: { color: '#ffffff' },

  monthBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  monthArrow: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.goldMuted },
  monthCenter: { flex: 1, alignItems: 'center' },
  monthName: { color: c.text, fontSize: font.lg, fontFamily: fonts.heavy, letterSpacing: 1.6 },
  monthPill: { marginTop: 3, paddingHorizontal: 10, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: c.goldMuted },
  monthPillText: { color: c.goldText, fontSize: font.xs, fontFamily: fonts.bold },
  monthBack: { marginTop: 3, color: c.info, fontSize: font.xs, fontFamily: fonts.semibold },

  dateBox: { width: 54, height: 62, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  dateBoxSm: { width: 46, height: 54 },
  dateBoxPlain: { backgroundColor: c.goldMuted },
  dateBoxPast: { backgroundColor: tint(c.textSecondary, 0.12) },
  dateMon: { color: c.goldText, fontSize: 10.5, fontFamily: fonts.heavy, letterSpacing: 0.8 },
  dateDay: { color: c.text, fontSize: 21, lineHeight: 24, fontFamily: fonts.bold },
  dateDaySm: { fontSize: 18, lineHeight: 21 },
  dateDow: { color: c.textSecondary, fontSize: 9.5, fontFamily: fonts.semibold, letterSpacing: 0.6 },
  onGold: { color: '#ffffff' },
  onGoldSoft: { color: 'rgba(255, 255, 255, 0.85)' },
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
