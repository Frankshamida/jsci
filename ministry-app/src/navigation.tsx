import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { RootStackParams, TabParams } from './routes';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSession } from './session';
import { colors } from './theme';
import type { IconName } from './components';
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

const TAB_ICONS: Record<keyof TabParams, [IconName, IconName]> = {
  Home: ['home', 'home-outline'],
  Requests: ['swap-horizontal', 'swap-horizontal-outline'],
  Attendance: ['checkmark-done-circle', 'checkmark-done-circle-outline'],
  Profile: ['person-circle', 'person-circle-outline'],
};

function Tabs() {
  const { home } = useSession();
  const openForMe = home?.openSubs.length || 0;
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.goldLight,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: '#111122', borderTopColor: colors.border },
        tabBarIcon: ({ focused, color, size }) => (
          <Ionicons name={TAB_ICONS[route.name][focused ? 0 : 1]} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen
        name="Requests"
        component={RequestsScreen}
        options={{ title: 'Excuse & Sub', tabBarBadge: openForMe || undefined, tabBarBadgeStyle: { backgroundColor: colors.info } }}
      />
      <Tab.Screen name="Attendance" component={AttendanceScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.background, card: colors.surface, primary: colors.goldLight, text: colors.text, border: colors.border },
};

export default function RootNavigator() {
  const { status, locked } = useSession();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }
  if (status === 'signedOut') return <LoginScreen />;
  if (locked) return <LockScreen />;

  return (
    <NavigationContainer theme={theme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '800' },
          contentStyle: { backgroundColor: colors.background },
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
