// Shared building blocks: one look across every screen.
import React from 'react';
import {
  ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, font, radius, space } from './theme';
import { initials } from './utils';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

// `stacked`: a screen under the navigation header, which already covers the
// status bar, so only the sides and the bottom keep clear of the notch.
export function Screen({ children, refreshing, onRefresh, scroll = true, padded = true, stacked = false }: {
  children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void; scroll?: boolean; padded?: boolean; stacked?: boolean;
}) {
  const inner = padded ? styles.padded : undefined;
  return (
    <SafeAreaView style={styles.screen} edges={stacked ? ['left', 'right', 'bottom'] : ['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[inner, styles.scrollEnd]}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.gold} colors={[colors.gold]} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : <View style={[styles.flex, inner]}>{children}</View>}
    </SafeAreaView>
  );
}

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.card, style, pressed && styles.pressed]} android_ripple={{ color: colors.border }}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ title, onPress, variant = 'primary', icon, loading, disabled, style, compact }: {
  title: string; onPress: () => void; variant?: ButtonVariant; icon?: IconName; loading?: boolean; disabled?: boolean;
  style?: StyleProp<ViewStyle>; compact?: boolean;
}) {
  const v = buttonVariants[variant];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [styles.button, compact && styles.buttonCompact, { backgroundColor: v.bg, borderColor: v.border }, off && styles.disabled, pressed && styles.pressed, style]}
    >
      {loading ? <ActivityIndicator color={v.fg} size="small" /> : icon ? <Ionicons name={icon} size={compact ? 15 : 18} color={v.fg} /> : null}
      <Text style={[styles.buttonText, compact && styles.buttonTextCompact, { color: v.fg }]}>{title}</Text>
    </Pressable>
  );
}
const buttonVariants: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.gold, fg: colors.textOnGold, border: colors.gold },
  secondary: { bg: colors.cardRaised, fg: colors.text, border: colors.borderLight },
  ghost: { bg: 'transparent', fg: colors.goldLight, border: colors.goldDark },
  danger: { bg: colors.dangerMuted, fg: colors.danger, border: 'rgba(239,83,97,0.4)' },
};

export function Avatar({ name, picture, size = 40, ring }: { name: string; picture?: string | null; size?: number; ring?: string }) {
  const dims = { width: size, height: size, borderRadius: size / 2 };
  const border = ring ? { borderWidth: 2, borderColor: ring } : null;
  if (picture) return <Image source={{ uri: picture }} style={[dims, border, styles.avatarImg]} />;
  return (
    <View style={[dims, border, styles.avatar]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.36 }]}>{initials(name)}</Text>
    </View>
  );
}

export function Chip({ label, color = colors.gold, icon, solid }: { label: string; color?: string; icon?: IconName; solid?: boolean }) {
  return (
    <View style={[styles.chip, { backgroundColor: solid ? color : `${color}22`, borderColor: `${color}55` }]}>
      {icon && <Ionicons name={icon} size={12} color={solid ? colors.textOnGold : color} />}
      <Text style={[styles.chipText, { color: solid ? colors.textOnGold : color }]}>{label}</Text>
    </View>
  );
}

const STATUS_TONE: Record<string, string> = {
  Approved: colors.success, Accepted: colors.success, Present: colors.success,
  Pending: colors.warning, 'Pending Admin': colors.warning, Late: colors.warning,
  'Open for Sub': colors.info, Excused: colors.info,
  Rejected: colors.danger, Absent: colors.danger,
};
export const statusColor = (status: string) => STATUS_TONE[status] || colors.textSecondary;
export const StatusBadge = ({ status, label }: { status: string; label?: string }) => <Chip label={label || status} color={statusColor(status)} />;

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action && onAction && <Pressable onPress={onAction} hitSlop={10}><Text style={styles.sectionAction}>{action}</Text></Pressable>}
    </View>
  );
}

export function EmptyState({ icon, title, text }: { icon: IconName; title: string; text?: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={34} color={colors.textMuted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {text ? <Text style={styles.emptyText}>{text}</Text> : null}
    </View>
  );
}

export function Field({ label, hint, ...input }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput placeholderTextColor={colors.textMuted} {...input} style={[styles.input, input.multiline && styles.inputMultiline, input.style]} />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export function Banner({ text, tone = 'info', icon }: { text: string; tone?: 'info' | 'warn' | 'danger' | 'success'; icon?: IconName }) {
  const c = { info: colors.info, warn: colors.warning, danger: colors.danger, success: colors.success }[tone];
  return (
    <View style={[styles.banner, { backgroundColor: `${c}1f`, borderColor: `${c}55` }]}>
      <Ionicons name={icon || (tone === 'success' ? 'checkmark-circle' : tone === 'info' ? 'information-circle' : 'alert-circle')} size={18} color={c} />
      <Text style={[styles.bannerText, { color: c }]}>{text}</Text>
    </View>
  );
}

// A row of choices where one is picked ("Slow Song" / "Fast Song", a date).
export function ChoiceRow<T extends string>({ options, value, onChange, labels }: {
  options: T[]; value: T | null; onChange: (v: T) => void; labels?: Partial<Record<T, string>>;
}) {
  return (
    <View style={styles.choiceRow}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable key={o} onPress={() => onChange(o)} style={[styles.choice, on && styles.choiceOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
            <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{labels?.[o] || o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.background },
  padded: { padding: space.lg },
  scrollEnd: { paddingBottom: space.xxl * 2 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, marginBottom: space.md },
  button: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  buttonCompact: { minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.sm },
  buttonText: { fontSize: font.md, fontWeight: '700' },
  buttonTextCompact: { fontSize: font.sm },
  avatar: { backgroundColor: colors.goldDark, alignItems: 'center', justifyContent: 'center' },
  avatarImg: { backgroundColor: colors.cardRaised },
  avatarText: { color: '#fff', fontWeight: '800' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },
  chipText: { fontSize: font.xs, fontWeight: '700' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.lg, marginBottom: space.sm },
  sectionTitle: { color: colors.text, fontSize: font.lg, fontWeight: '800' },
  sectionAction: { color: colors.goldLight, fontSize: font.sm, fontWeight: '700' },
  empty: { alignItems: 'center', paddingVertical: space.xl, gap: 6 },
  emptyTitle: { color: colors.text, fontSize: font.md, fontWeight: '700' },
  emptyText: { color: colors.textSecondary, fontSize: font.sm, textAlign: 'center', lineHeight: 19 },
  field: { marginBottom: space.md },
  fieldLabel: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '700', marginBottom: 6 },
  fieldHint: { color: colors.textMuted, fontSize: font.xs, marginTop: 4 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, color: colors.text, fontSize: font.md },
  inputMultiline: { minHeight: 90, textAlignVertical: 'top' },
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, marginBottom: space.md },
  bannerText: { flex: 1, fontSize: font.sm, lineHeight: 19, fontWeight: '600' },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  choice: { paddingHorizontal: space.md, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderLight, backgroundColor: colors.surface },
  choiceOn: { borderColor: colors.gold, backgroundColor: colors.goldMuted },
  choiceText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '600' },
  choiceTextOn: { color: colors.goldLight, fontWeight: '800' },
});
