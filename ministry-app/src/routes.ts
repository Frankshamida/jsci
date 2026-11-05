// Route names and their params, apart from navigation.tsx so screens can use
// them without importing the navigator (which imports the screens).
import { useNavigation, type CompositeNavigationProp, type NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';

export type TabParams = {
  Home: undefined;
  Requests: undefined;
  Chat: undefined;
  Attendance: undefined;
  Profile: undefined;
};

export type RootStackParams = {
  Tabs: NavigatorScreenParams<TabParams> | undefined;
  Lineup: { scheduleId: string; date?: string }; // date: to load its month when it is not cached
  SongEditor: { scheduleId: string };
  Recorder: { scheduleId: string };
  // excuse: any date from today on; sub / swap: one of your upcoming lineups
  RequestForm: { mode: 'excuse' | 'sub' | 'swap'; scheduleId?: string; date?: string };
  // A song's lyrics, written by the Media team (lyrics_library)
  LyricsEditor: { title: string; link?: string; lyricsId?: string; scheduleId?: string };
  // A teammate: their ministry roles and their lineup history
  Member: { userId: string; name: string };
  // A group chat
  ChatRoom: { room: string; title: string };
  // Schedule Plotter tools: the month's lineups, and approvals
  Planner: { tab?: 'lineups' | 'approvals'; month?: string } | undefined;
  // Make or change one lineup (Schedule Plotter)
  LineupEditor: { scheduleId?: string; date?: string };
};

export type StackProps<R extends keyof RootStackParams> = NativeStackScreenProps<RootStackParams, R>;

// From any screen: the tabs, and the screens stacked over them.
export type AppNav = CompositeNavigationProp<BottomTabNavigationProp<TabParams>, NativeStackNavigationProp<RootStackParams>>;
export const useAppNav = () => useNavigation<AppNav>();
