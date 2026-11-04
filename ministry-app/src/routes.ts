// Route names and their params, apart from navigation.tsx so screens can use
// them without importing the navigator (which imports the screens).
import { useNavigation, type CompositeNavigationProp, type NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';

export type TabParams = {
  Home: undefined;
  Requests: undefined;
  Attendance: undefined;
  Profile: undefined;
};

export type RootStackParams = {
  Tabs: NavigatorScreenParams<TabParams> | undefined;
  Lineup: { scheduleId: string };
  SongEditor: { scheduleId: string };
  Recorder: { scheduleId: string };
  RequestForm: { mode: 'excuse' | 'sub'; scheduleId?: string; date?: string };
};

export type StackProps<R extends keyof RootStackParams> = NativeStackScreenProps<RootStackParams, R>;

// From any screen: the tabs, and the screens stacked over them.
export type AppNav = CompositeNavigationProp<BottomTabNavigationProp<TabParams>, NativeStackNavigationProp<RootStackParams>>;
export const useAppNav = () => useNavigation<AppNav>();
