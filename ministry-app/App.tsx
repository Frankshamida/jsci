import React, { useEffect } from 'react';
import { AppState, Keyboard, Platform, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as NavigationBar from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';
import { useFonts } from 'expo-font';
import { Outfit_400Regular } from '@expo-google-fonts/outfit/400Regular';
import { Outfit_500Medium } from '@expo-google-fonts/outfit/500Medium';
import { Outfit_600SemiBold } from '@expo-google-fonts/outfit/600SemiBold';
import { Outfit_700Bold } from '@expo-google-fonts/outfit/700Bold';
import { Outfit_800ExtraBold } from '@expo-google-fonts/outfit/800ExtraBold';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { IS_WEB } from './src/platform';
import { SessionProvider } from './src/session';
import { ThemeProvider, useTheme } from './src/theme';
import RootNavigator from './src/navigation';
import { DialogProvider } from './src/dialog';

// The launch screen stays up until the font and the saved Light/Dark choice are in.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Android: the Home / Back buttons stay out of the way. Swiping up from the
// bottom edge shows them for a moment; they hide again by themselves.
function useHiddenNavigationBar() {
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const hide = () => {
      NavigationBar.setBehaviorAsync('overlay-swipe').catch(() => {});
      NavigationBar.setVisibilityAsync('hidden').catch(() => {});
    };
    hide();
    // Coming back to the app, or closing the keyboard, can bring them back.
    const app = AppState.addEventListener('change', (state) => { if (state === 'active') hide(); });
    const keyboard = Keyboard.addListener('keyboardDidHide', hide);
    return () => { app.remove(); keyboard.remove(); };
  }, []);
}

function Root() {
  const { scheme, colors, ready } = useTheme();
  // The icons' font too, so no icon blinks in as a blank square (the web app loads it).
  const [fontsLoaded, fontError] = useFonts({ ...FontAwesome6.font, Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold, Outfit_800ExtraBold });
  const loaded = ready && (fontsLoaded || !!fontError);
  useHiddenNavigationBar();
  // Behind every screen (and screen changes): the page colour of the mode.
  useEffect(() => { SystemUI.setBackgroundColorAsync(colors.background).catch(() => {}); }, [colors.background]);

  useEffect(() => {
    if (!loaded) return;
    SplashScreen.hideAsync().catch(() => {});
    // The web app's start-up screen (public/index.html) fades out.
    if (IS_WEB) {
      const boot = (globalThis as unknown as { document?: { getElementById: (id: string) => { classList: { add: (c: string) => void }; remove: () => void } | null } })
        .document?.getElementById('boot');
      if (boot) { boot.classList.add('gone'); setTimeout(() => boot.remove(), 350); }
    }
  }, [loaded]);
  if (!loaded) return null;

  return (
    <DialogProvider>
      <SessionProvider>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <RootNavigator />
        <WebStatusBar />
      </SessionProvider>
    </DialogProvider>
  );
}

// The web app from the iPhone Home Screen draws under the status bar, whose
// text is always white there: a navy band behind it keeps the time readable.
function WebStatusBar() {
  const insets = useSafeAreaInsets();
  if (!IS_WEB || !insets.top) return null;
  return <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: '#1a1a2e', zIndex: 9999 }} />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Root />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
