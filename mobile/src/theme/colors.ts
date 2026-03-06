// ============================================
// JSCI Mobile — Theme Colors
// Dark navy + gold accent matching the web app
// ============================================

export const Colors = {
  // Core backgrounds
  background: '#0d0d1a',
  surface: '#141425',
  card: '#1a1a30',
  cardElevated: '#20203a',
  cardBorder: '#2a2a45',

  // Primary (Gold)
  primary: '#c9980b',
  primaryLight: '#ffc300',
  primaryDark: '#926c15',
  primaryMuted: 'rgba(201, 152, 11, 0.15)',
  primarySoft: 'rgba(255, 195, 0, 0.08)',

  // Text
  textPrimary: '#f0f0f0',
  textSecondary: '#9a9ab0',
  textMuted: '#6c6c85',
  textInverse: '#0d0d1a',

  // Accents
  success: '#28a745',
  successMuted: 'rgba(40, 167, 69, 0.15)',
  danger: '#dc3545',
  dangerMuted: 'rgba(220, 53, 69, 0.15)',
  warning: '#ffc107',
  warningMuted: 'rgba(255, 193, 7, 0.15)',
  info: '#17a2b8',
  infoMuted: 'rgba(23, 162, 184, 0.15)',

  // UI
  border: '#2a2a45',
  borderLight: '#3a3a55',
  inputBg: '#1a1a30',
  inputBorder: '#3a3a55',
  inputFocusBorder: '#c9980b',
  overlay: 'rgba(0, 0, 0, 0.6)',
  shadow: 'rgba(0, 0, 0, 0.3)',

  // Tab bar
  tabBarBg: '#111122',
  tabBarActive: '#ffc300',
  tabBarInactive: '#6c6c85',

  // Status
  online: '#28a745',
  offline: '#6c757d',
  verified: '#28a745',
  unverified: '#ffc107',
} as const;

export type ColorKey = keyof typeof Colors;
