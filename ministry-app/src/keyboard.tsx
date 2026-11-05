// ============================================================
// Typing never hides behind the keyboard.
// KeyboardScroll is the scrolling body of every screen. When the keyboard
// opens it makes room under the content and scrolls the field being typed in
// to just above the keyboard; moving to the next field does the same.
//   iOS      ScrollView's own automaticallyAdjustKeyboardInsets does it
//   Android  the app draws edge to edge, so the window does not shrink for the
//            keyboard: the room and the scroll are measured here
// ============================================================
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Keyboard, Platform, ScrollView, TextInput, View,
  type GestureResponderEvent, type RefreshControlProps, type StyleProp, type ViewStyle,
} from 'react-native';
import { Icon } from './icons';
import { useTheme } from './theme';

const GAP = 24; // space kept between the field and the keyboard

const RevealContext = createContext<() => void>(() => {});
// Fields call this when focused, so the next field also comes into view.
export const useRevealOnFocus = () => useContext(RevealContext);

// Pull this far (after the resistance) to refresh, in the web app.
const PULL_TO_REFRESH = 64;

// `onPullRefresh`: the web app's pull-to-refresh (browsers have none of their
// own inside an app page); the phone app uses `refreshControl`.
export function KeyboardScroll({ children, contentContainerStyle, refreshControl, onPullRefresh }: {
  children: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  onPullRefresh?: () => Promise<unknown>;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const boxRef = useRef<View>(null);
  const scrollY = useRef(0);
  const keyboardTop = useRef<number | null>(null);
  const [room, setRoom] = useState(0);

  const reveal = useCallback(() => {
    // After the extra room has been laid out.
    setTimeout(() => {
      const top = keyboardTop.current;
      const input = TextInput.State.currentlyFocusedInput();
      if (top == null || !input) return;
      input.measureInWindow((_x, y, _w, h) => {
        const hidden = y + h + GAP - top;
        if (hidden > 0) scrollRef.current?.scrollTo({ y: scrollY.current + hidden, animated: true });
      });
    }, 80);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      const top = e.endCoordinates.screenY;
      keyboardTop.current = top;
      // How much of this screen the keyboard covers (none if the window shrank for it).
      boxRef.current?.measureInWindow((_x, y, _w, h) => {
        setRoom(Math.max(0, Math.min(e.endCoordinates.height + 48, y + h - top)));
        reveal();
      });
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => { keyboardTop.current = null; setRoom(0); });
    return () => { show.remove(); hide.remove(); };
  }, [reveal]);

  // ---- Web: pull down at the top to refresh ----
  const { colors: c } = useTheme();
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [pulling, setPulling] = useState(false);
  const pullRef = useRef(0);
  const web = Platform.OS === 'web' && !!onPullRefresh;
  const touchY = (e: GestureResponderEvent) => e.nativeEvent.touches?.[0]?.pageY ?? e.nativeEvent.pageY;
  const touch = web ? {
    onTouchStart: (e: GestureResponderEvent) => { startY.current = scrollY.current <= 0 && !pulling ? touchY(e) : null; },
    onTouchMove: (e: GestureResponderEvent) => {
      if (startY.current == null) return;
      if (scrollY.current > 0) { startY.current = null; pullRef.current = 0; setPull(0); return; }
      const next = Math.max(0, Math.min(110, (touchY(e) - startY.current) * 0.5));
      pullRef.current = next;
      setPull(next);
    },
    onTouchEnd: () => {
      const go = pullRef.current >= PULL_TO_REFRESH;
      startY.current = null;
      pullRef.current = 0;
      setPull(0);
      if (go && onPullRefresh) {
        setPulling(true);
        Promise.resolve(onPullRefresh()).finally(() => setPulling(false));
      }
    },
  } : {};
  const shown = pulling ? PULL_TO_REFRESH : pull;

  return (
    <RevealContext.Provider value={Platform.OS === 'android' ? reveal : noop}>
      <View ref={boxRef} style={{ flex: 1 }} collapsable={false} {...touch}>
        {web && shown > 0 && (
          <View pointerEvents="none" style={{
            position: 'absolute', top: Math.min(shown, PULL_TO_REFRESH) - 30, alignSelf: 'center', zIndex: 10,
            width: 38, height: 38, borderRadius: 19, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center',
            boxShadow: '0px 2px 10px rgba(0, 0, 0, 0.18)', opacity: Math.min(1, shown / PULL_TO_REFRESH),
          }}>
            {pulling
              ? <ActivityIndicator size="small" color={c.secondary} />
              : <Icon name="rotate-right" size={15} color={pull >= PULL_TO_REFRESH ? c.secondary : c.textMuted} style={{ transform: [{ rotate: `${pull * 3}deg` }] }} />}
          </View>
        )}
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={contentContainerStyle}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          automaticallyAdjustKeyboardInsets
          onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={32}
        >
          {children}
          {room > 0 && <View style={{ height: room }} />}
        </ScrollView>
      </View>
    </RevealContext.Provider>
  );
}

const noop = () => {};
