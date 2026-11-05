// Font Awesome 6, the icon set of the JSCI website, with the same icons for
// the same things (sidebar, Monthly Planner, Praise & Worship pages).
import React from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';

export type IconName =
  // navigation and actions
  | 'house' | 'people-arrows' | 'clipboard-check' | 'user' | 'chevron-right' | 'arrow-up' | 'arrow-down'
  | 'plus' | 'check' | 'xmark' | 'paper-plane' | 'trash-can' | 'pen-to-square' | 'rotate-right'
  | 'right-from-bracket' | 'right-to-bracket' | 'arrow-up-right-from-square' | 'link'
  // lineup
  | 'music' | 'microphone' | 'microphone-lines' | 'users' | 'guitar' | 'person-running' | 'hands-praying'
  | 'compact-disc' | 'headphones' | 'play' | 'pause' | 'stop' | 'cloud-arrow-up' | 'folder-open'
  | 'leaf' | 'bolt' | 'youtube'
  // dates and requests
  | 'calendar' | 'calendar-check' | 'calendar-minus' | 'calendar-xmark' | 'calendar-week' | 'clock'
  | 'hand' | 'heart' | 'user-check' | 'user-clock' | 'hourglass-half'
  // status
  | 'circle-check' | 'circle-info' | 'circle-exclamation' | 'triangle-exclamation' | 'ban'
  // account
  | 'fingerprint' | 'lock' | 'lock-open' | 'eye' | 'eye-slash' | 'envelope' | 'key' | 'globe' | 'gift'
  | 'id-badge' | 'church' | 'book-bible' | 'moon' | 'sun' | 'circle-half-stroke' | 'face-smile';

const BRANDS = new Set<IconName>(['youtube']);

export function Icon({ name, size = 16, color, style }: { name: IconName; size?: number; color: string; style?: StyleProp<TextStyle> }) {
  const brand = BRANDS.has(name);
  return <FontAwesome6 name={name} size={size} color={color} solid={!brand} brand={brand} style={style} />;
}
