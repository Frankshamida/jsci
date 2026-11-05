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
  Keyboard, Platform, ScrollView, TextInput, View,
  type RefreshControlProps, type StyleProp, type ViewStyle,
} from 'react-native';

const GAP = 24; // space kept between the field and the keyboard

const RevealContext = createContext<() => void>(() => {});
// Fields call this when focused, so the next field also comes into view.
export const useRevealOnFocus = () => useContext(RevealContext);

export function KeyboardScroll({ children, contentContainerStyle, refreshControl }: {
  children: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  refreshControl?: React.ReactElement<RefreshControlProps>;
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

  return (
    <RevealContext.Provider value={Platform.OS === 'android' ? reveal : noop}>
      <View ref={boxRef} style={{ flex: 1 }} collapsable={false}>
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
