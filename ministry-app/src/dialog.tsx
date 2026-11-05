// ============================================================
// Dialogs in the app's own style (instead of the phone's plain alerts):
//   const dialog = useDialog();
//   if (await dialog.confirm({ title: 'Sign out?', confirmText: 'Sign out', tone: 'danger' })) ...
//   await dialog.alert({ title: 'Welcome, Frank!', icon: 'hands-praying' });
// Drawn over the app (not a separate window), so Android's hidden Home / Back
// buttons stay hidden. The phone's Back button closes it like Cancel.
// ============================================================
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Button } from './components';
import { Icon, type IconName } from './icons';
import { font, fonts, makeStyles, radius, space, tint, useTheme } from './theme';
import { NATIVE_DRIVER } from './platform';

export type DialogTone = 'gold' | 'danger' | 'success' | 'info';

export interface DialogOptions {
  title: string;
  message?: string;
  icon?: IconName;
  tone?: DialogTone;
  confirmText?: string;
  cancelText?: string;
  content?: React.ReactNode; // extra lines under the message
}

interface Open extends DialogOptions { id: number; kind: 'alert' | 'confirm'; resolve: (ok: boolean) => void }

interface DialogApi {
  confirm: (o: DialogOptions) => Promise<boolean>;
  alert: (o: DialogOptions) => Promise<void>;
}

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const value = useContext(DialogContext);
  if (!value) throw new Error('useDialog must be inside <DialogProvider>');
  return value;
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null);
  const current = useRef<Open | null>(null);
  const queue = useRef<Open[]>([]);
  const nextId = useRef(1);

  // One at a time; a second one waits until the first is closed.
  const show = useCallback((d: Omit<Open, 'id'>) => {
    const dialog = { ...d, id: nextId.current++ };
    if (current.current) { queue.current.push(dialog); return; }
    current.current = dialog;
    setOpen(dialog);
  }, []);

  const api = useRef<DialogApi>({
    confirm: (o) => new Promise<boolean>((resolve) => show({ ...o, kind: 'confirm', resolve })),
    alert: (o) => new Promise<void>((resolve) => show({ ...o, kind: 'alert', resolve: () => resolve() })),
  }).current;

  const close = useCallback((ok: boolean) => {
    const done = current.current;
    const next = queue.current.shift() || null;
    current.current = next;
    setOpen(next);
    done?.resolve(ok);
  }, []);

  return (
    <DialogContext.Provider value={api}>
      <View style={StyleSheet.absoluteFill}>
        {children}
        {open && <DialogView key={open.id} dialog={open} onClose={close} />}
      </View>
    </DialogContext.Provider>
  );
}

function DialogView({ dialog, onClose }: { dialog: Open; onClose: (ok: boolean) => void }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const fade = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE_DRIVER }),
      Animated.spring(pop, { toValue: 1, friction: 7, tension: 90, useNativeDriver: NATIVE_DRIVER }),
    ]).start();
  }, [fade, pop]);

  const finish = useCallback((ok: boolean) => {
    if (closing.current) return;
    closing.current = true;
    Animated.parallel([
      Animated.timing(fade, { toValue: 0, duration: 140, useNativeDriver: NATIVE_DRIVER }),
      Animated.timing(pop, { toValue: 0, duration: 140, useNativeDriver: NATIVE_DRIVER }),
    ]).start(() => onClose(ok));
  }, [fade, pop, onClose]);

  // Android Back closes it like Cancel.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { finish(false); return true; });
    return () => sub.remove();
  }, [finish]);

  const tone = dialog.tone || 'gold';
  const toneColor = { gold: c.goldText, danger: c.danger, success: c.success, info: c.info }[tone];
  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });
  const isConfirm = dialog.kind === 'confirm';

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <Animated.View style={[StyleSheet.absoluteFill, s.backdrop, { opacity: fade }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => finish(false)} accessibilityLabel="Close" />
      </Animated.View>
      <View style={s.center} pointerEvents="box-none">
        <Animated.View style={[s.card, { opacity: fade, transform: [{ scale }] }]} accessibilityRole="alert">
          {dialog.icon && (
            tone === 'gold' ? (
              <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.badge}>
                <Icon name={dialog.icon} size={24} color="#ffffff" />
              </LinearGradient>
            ) : (
              <View style={[s.badge, { backgroundColor: tint(toneColor, 0.14) }]}>
                <Icon name={dialog.icon} size={24} color={toneColor} />
              </View>
            )
          )}
          <Text style={s.title}>{dialog.title}</Text>
          {dialog.message ? <Text style={s.message}>{dialog.message}</Text> : null}
          {dialog.content}
          <View style={s.buttons}>
            {isConfirm && (
              <Button title={dialog.cancelText || 'Cancel'} variant="secondary" onPress={() => finish(false)} style={s.flex} />
            )}
            <Button
              title={dialog.confirmText || 'OK'}
              variant={tone === 'danger' ? 'danger' : 'primary'}
              onPress={() => finish(true)}
              style={s.flex}
            />
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  backdrop: { backgroundColor: c.scheme === 'dark' ? 'rgba(5, 5, 15, 0.7)' : 'rgba(26, 26, 46, 0.45)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  card: {
    width: '100%', maxWidth: 380, alignItems: 'center', backgroundColor: c.card, borderRadius: radius.xl,
    paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.lg,
    borderWidth: 1, borderColor: c.scheme === 'light' ? '#eceef1' : c.border,
    boxShadow: '0px 18px 48px rgba(0, 0, 0, 0.25)',
  },
  badge: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginBottom: space.md },
  title: { color: c.text, fontSize: font.xl, fontFamily: fonts.bold, textAlign: 'center' },
  message: { color: c.textSecondary, fontSize: font.md, fontFamily: fonts.regular, textAlign: 'center', lineHeight: 22, marginTop: space.sm },
  buttons: { flexDirection: 'row', gap: space.sm, alignSelf: 'stretch', marginTop: space.xl },
}));
