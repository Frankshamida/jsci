// ============================================================
// The tab bar at the bottom (Home, Requests, Chat, Attendance, Profile).
// Drawn by the app itself rather than React Navigation's default, so it is
// the same on Android, iPhone Safari and the Home Screen web app: every part
// has a fixed size, nothing in it can be squeezed, and its height is simply
// what is in it plus the phone's safe area under it.
//   top line 1 + 6, then each tab: 4 + icon pill 34 + 2 + label 16 + 4,
//   then room for the home indicator / gesture bar
// Its background runs to the bottom edge of the screen.
// ============================================================
import React from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Icon, type IconName } from './icons';
import { fonts, makeStyles, useTheme } from './theme';

const ICONS: Record<string, IconName> = {
  Home: 'house',
  Requests: 'people-arrows',
  Chat: 'comments',
  Attendance: 'clipboard-check',
  Profile: 'user',
};

const LINE = 1;
const TOP = 6;
const ITEM = 4 + 34 + 2 + 16 + 4;

// Room under the tabs: the home indicator's safe area, trimmed (the tabs may
// sit a little into it, as iPhone apps do) and capped, so a tall reported
// inset never pushes the tabs up. Phones with buttons get a small margin.
const bottomRoom = (inset: number) => (inset > 0 ? Math.min(Math.max(inset - 12, 10), 24) : 8);

/** The tab bar's full height from the bottom edge of the screen. */
export function useTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  return LINE + TOP + ITEM + bottomRoom(insets.bottom);
}

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  // Five labels share the width: a little smaller on the narrowest phones.
  const width = useWindowDimensions().width;
  const labelSize = width < 340 ? 9.5 : width < 380 ? 10.5 : 11.5;

  return (
    <View
      accessibilityRole="tablist"
      style={[s.bar, { paddingBottom: bottomRoom(insets.bottom), paddingLeft: insets.left, paddingRight: insets.right }]}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const { options } = descriptors[route.key];
        const label = typeof options.title === 'string' ? options.title : route.name;
        const badge = options.tabBarBadge;
        const color = focused ? c.goldText : c.textSecondary;
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            onLongPress={onLongPress}
            style={s.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={badge ? `${label}, ${badge} new` : label}
          >
            <View style={[s.pill, focused && s.pillOn]}>
              <Icon name={ICONS[route.name] || 'circle'} size={20} color={color} />
              {badge != null && badge !== '' ? (
                <View style={s.badge}><Text style={s.badgeText} numberOfLines={1}>{String(badge)}</Text></View>
              ) : null}
            </View>
            <View style={s.labelBox}>
              <Text style={[s.label, { color, fontSize: labelSize, fontFamily: focused ? fonts.bold : fonts.medium }]} numberOfLines={1}>{label}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  bar: {
    flexDirection: 'row',
    backgroundColor: c.surface,
    borderTopWidth: LINE,
    borderTopColor: c.border,
    paddingTop: TOP,
    boxShadow: c.scheme === 'light' ? '0px -4px 16px rgba(0, 0, 0, 0.06)' : undefined,
  },
  tab: { flex: 1, alignItems: 'center', paddingTop: 4, paddingBottom: 4, minWidth: 0 },
  pill: { width: 56, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  pillOn: { backgroundColor: c.goldMuted },
  labelBox: { height: 16, marginTop: 2, alignSelf: 'stretch', justifyContent: 'center', flexShrink: 0, paddingHorizontal: 2 },
  label: { lineHeight: 16, textAlign: 'center' },
  badge: {
    position: 'absolute', top: -2, right: 2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5,
    backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: c.surface,
  },
  badgeText: { color: '#ffffff', fontSize: 10, lineHeight: 12, fontFamily: fonts.bold },
}));
