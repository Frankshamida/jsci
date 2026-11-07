import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer, type LinkingOptions, type NavigationState, type Theme as NavTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { RootStackParams, TabParams } from './routes';
import { useSession } from './session';
import { fonts, useTheme } from './theme';
import { Button, EmptyState, LoadingView, Screen } from './components';
import { MiniPlayer, PlayerProvider } from './player';
import { TabBar, useTabBarHeight } from './tabbar';
import { useChatUnreadCount } from './chat';
import { IS_WEB } from './platform';
import LoginScreen from './screens/LoginScreen';
import LockScreen from './screens/LockScreen';
import HomeScreen from './screens/HomeScreen';
import RequestsScreen from './screens/RequestsScreen';
import ChatListScreen from './screens/ChatListScreen';
import AttendanceScreen from './screens/AttendanceScreen';
import ProfileScreen from './screens/ProfileScreen';
import LineupScreen from './screens/LineupScreen';
import SongEditorScreen from './screens/SongEditorScreen';
import RecorderScreen from './screens/RecorderScreen';
import RequestFormScreen from './screens/RequestFormScreen';
import LyricsEditorScreen from './screens/LyricsEditorScreen';
import MemberScreen from './screens/MemberScreen';
import ChatRoomScreen from './screens/ChatRoomScreen';
import PlannerScreen from './screens/PlannerScreen';
import LineupEditorScreen from './screens/LineupEditorScreen';

const Stack = createNativeStackNavigator<RootStackParams>();
const Tab = createBottomTabNavigator<TabParams>();


// The bottom tabs. Their bar is the app's own (tabbar.tsx), the same on every phone.
function Tabs() {
  const { home } = useSession();
  const openForMe = (home?.openSubs.length || 0) + (home?.swapsForMe?.length || 0);
  const unread = useChatUnreadCount();
  return (
    <Tab.Navigator
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Requests" component={RequestsScreen} options={{ title: 'Requests', tabBarBadge: openForMe || undefined }} />
      <Tab.Screen name="Chat" component={ChatListScreen} options={{ title: 'Chat', tabBarBadge: unread ? (unread > 99 ? '99+' : unread) : undefined }} />
      <Tab.Screen name="Attendance" component={AttendanceScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

// The web app (sanctuaryhub.vercel.app/ministrysystem): every screen has its
// own address, so the browser's Back button and a reload keep your place.
const BASE = 'ministrysystem';
const webLinking: LinkingOptions<RootStackParams> | undefined = IS_WEB ? {
  prefixes: [],
  config: {
    initialRouteName: 'Tabs',
    screens: {
      Tabs: { path: BASE, screens: { Home: '', Requests: 'requests', Chat: 'chat', Attendance: 'attendance', Profile: 'profile' } },
      Lineup: `${BASE}/lineup/:scheduleId`,
      SongEditor: `${BASE}/lineup/:scheduleId/songs`,
      Recorder: `${BASE}/lineup/:scheduleId/record`,
      RequestForm: `${BASE}/request/:mode`,
      LyricsEditor: `${BASE}/lyrics`,
      Member: `${BASE}/member/:userId`,
      ChatRoom: `${BASE}/chat/:room`,
      Planner: `${BASE}/plotter`,
      LineupEditor: `${BASE}/plotter/lineup`,
    },
  },
} : undefined;

// Is the screen on top one of the tabs (so the mini player sits on the tab bar)?
const onTabsNow = (state: NavigationState | undefined) => !state || state.routes[state.index]?.name === 'Tabs';

export default function RootNavigator() {
  const { status, locked, home, loadError, refresh, refreshing, signOut } = useSession();
  const { colors: c, scheme } = useTheme();
  const [onTabs, setOnTabs] = useState(true);
  const tabBarHeight = useTabBarHeight();
  const onStateChange = useCallback((state: NavigationState | undefined) => setOnTabs(onTabsNow(state)), []);

  const navTheme = useMemo<NavTheme>(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    const face = (fontFamily: string) => ({ fontFamily, fontWeight: 'normal' as const });
    return {
      ...base,
      colors: { ...base.colors, background: c.background, card: c.surface, primary: c.goldText, text: c.text, border: c.border, notification: c.danger },
      fonts: { regular: face(fonts.regular), medium: face(fonts.medium), bold: face(fonts.bold), heavy: face(fonts.heavy) },
    };
  }, [c, scheme]);

  if (status === 'loading') return <LoadingView />;
  if (status === 'signedOut') return <LoginScreen />;
  if (locked) return <LockScreen />;

  // Signed in, first load: the whole phone is the loading screen (no tab bar
  // yet), and the tabs appear with the schedule already in them.
  if (!home) {
    if (!loadError || refreshing) return <LoadingView message="Preparing your schedule…" />;
    return (
      <Screen center>
        <EmptyState icon="wifi" title="Could not load your schedule" text={loadError} />
        <Button title="Try again" icon="rotate-right" onPress={() => refresh(true)} />
        <View style={{ height: 12 }} />
        <Button title="Sign out" icon="right-from-bracket" variant="ghost" onPress={() => signOut()} />
      </Screen>
    );
  }

  return (
    <PlayerProvider>
      <NavigationContainer theme={navTheme} onStateChange={onStateChange} linking={webLinking}
        documentTitle={{ formatter: (options, route) => `${options?.title || route?.name || 'Home'} · JSCI Ministry` }}>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: c.surface },
            headerTintColor: c.goldText,
            headerTitleStyle: { fontFamily: fonts.bold, color: c.text },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: c.background },
          }}
        >
          <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
          <Stack.Screen name="Lineup" component={LineupScreen} options={{ title: 'Lineup' }} />
          <Stack.Screen name="SongEditor" component={SongEditorScreen} options={{ title: 'Lineup Songs', gestureEnabled: false }} />
          <Stack.Screen name="Recorder" component={RecorderScreen} options={{ title: 'Record Practice', gestureEnabled: false }} />
          <Stack.Screen name="RequestForm" component={RequestFormScreen} options={{ title: 'Request' }} />
          <Stack.Screen name="LyricsEditor" component={LyricsEditorScreen} options={{ title: 'Lyrics', gestureEnabled: false }} />
          <Stack.Screen name="Member" component={MemberScreen} options={{ title: 'Teammate' }} />
          <Stack.Screen name="ChatRoom" component={ChatRoomScreen} options={{ title: 'Chat' }} />
          <Stack.Screen name="Planner" component={PlannerScreen} options={{ title: 'Schedule Plotter' }} />
          <Stack.Screen name="LineupEditor" component={LineupEditorScreen} options={{ title: 'Lineup', gestureEnabled: false }} />
        </Stack.Navigator>
        <MiniPlayer onTabs={onTabs} tabBarHeight={tabBarHeight} />
      </NavigationContainer>
    </PlayerProvider>
  );
}
