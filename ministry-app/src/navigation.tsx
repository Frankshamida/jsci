import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DarkTheme, DefaultTheme, NavigationContainer, type Theme as NavTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { RootStackParams, TabParams } from './routes';
import { useSession } from './session';
import { fonts, useTheme } from './theme';
import { Icon, type IconName } from './icons';
import { LoadingView } from './components';
import LoginScreen from './screens/LoginScreen';
import LockScreen from './screens/LockScreen';
import HomeScreen from './screens/HomeScreen';
import RequestsScreen from './screens/RequestsScreen';
import AttendanceScreen from './screens/AttendanceScreen';
import ProfileScreen from './screens/ProfileScreen';
import LineupScreen from './screens/LineupScreen';
import SongEditorScreen from './screens/SongEditorScreen';
import RecorderScreen from './screens/RecorderScreen';
import RequestFormScreen from './screens/RequestFormScreen';

const Stack = createNativeStackNavigator<RootStackParams>();
const Tab = createBottomTabNavigator<TabParams>();

// The website's sidebar icons for the same pages.
const TAB_ICONS: Record<keyof TabParams, IconName> = {
  Home: 'house',
  Requests: 'people-arrows',
  Attendance: 'clipboard-check',
  Profile: 'user',
};

// A tall, clear tab bar: big icons, the open tab in a gold pill with a bold label.
function Tabs() {
  const { home } = useSession();
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const openForMe = home?.openSubs.length || 0;
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: c.goldText,
        tabBarInactiveTintColor: c.textSecondary,
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopColor: c.border,
          height: 72 + insets.bottom,
          paddingTop: 8,
          paddingBottom: insets.bottom + 8,
          boxShadow: c.scheme === 'light' ? '0px -4px 16px rgba(0, 0, 0, 0.06)' : undefined,
        },
        tabBarIconStyle: { width: 60, height: 34 },
        tabBarIcon: ({ focused, color }) => (
          <View style={{ width: 60, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? c.goldMuted : 'transparent' }}>
            <Icon name={TAB_ICONS[route.name]} size={21} color={color} />
          </View>
        ),
        tabBarLabel: ({ focused, color, children }) => (
          <Text style={{ color, fontSize: 12, marginTop: 3, fontFamily: focused ? fonts.bold : fonts.medium }} numberOfLines={1}>{children}</Text>
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen
        name="Requests"
        component={RequestsScreen}
        options={{ title: 'Excuse & Sub', tabBarBadge: openForMe || undefined, tabBarBadgeStyle: { backgroundColor: c.danger, color: '#ffffff', fontFamily: fonts.bold, fontSize: 11 } }}
      />
      <Tab.Screen name="Attendance" component={AttendanceScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { status, locked } = useSession();
  const { colors: c, scheme } = useTheme();

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

  return (
    <NavigationContainer theme={navTheme}>
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
      </Stack.Navigator>
    </NavigationContainer>
  );
}
