// Font Awesome 6, the icon set of the JSCI website, with the same icons for
// the same things (sidebar, Monthly Planner, Praise & Worship pages).
// Any Font Awesome 6 Free name works: <Icon name="calendar-check" />.
import React from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';

export type IconName = React.ComponentProps<typeof FontAwesome6>['name'];

// The brand icons in use (everything else is the solid style).
const BRANDS = new Set<string>(['youtube', 'google', 'facebook-messenger', 'android', 'apple']);

export function Icon({ name, size = 16, color, style, regular }: {
  name: IconName; size?: number; color: string; style?: StyleProp<TextStyle>; regular?: boolean;
}) {
  const brand = BRANDS.has(name);
  return <FontAwesome6 name={name} size={size} color={color} solid={!brand && !regular} brand={brand} style={style} />;
}
