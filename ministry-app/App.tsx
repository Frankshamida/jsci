import React, { useEffect } from 'react';
import { AppState, Keyboard, Platform } from 'react-native';
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
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
  const [fontsLoaded, fontError] = useFonts({ Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold, Outfit_800ExtraBold });
  const loaded = ready && (fontsLoaded || !!fontError);
  useHiddenNavigationBar();
  // Behind every screen (and screen changes): the page colour of the mode.
  useEffect(() => { SystemUI.setBackgroundColorAsync(colors.background).catch(() => {}); }, [colors.background]);

  useEffect(() => { if (loaded) SplashScreen.hideAsync().catch(() => {}); }, [loaded]);
  if (!loaded) return null;

  return (
    <DialogProvider>
      <SessionProvider>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <RootNavigator />
      </SessionProvider>
    </DialogProvider>
  );
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
