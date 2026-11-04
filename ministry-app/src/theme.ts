// Dark navy and gold, the same as the JSCI website and member app.
export const colors = {
  background: '#0d0d1a',
  surface: '#141425',
  card: '#1a1a30',
  cardRaised: '#20203a',
  border: '#2a2a45',
  borderLight: '#3a3a55',

  gold: '#c9980b',
  goldLight: '#ffc300',
  goldDark: '#926c15',
  goldMuted: 'rgba(201, 152, 11, 0.15)',

  text: '#f0f0f0',
  textSecondary: '#9a9ab0',
  textMuted: '#6c6c85',
  textOnGold: '#0d0d1a',

  success: '#3ccf6e',
  successMuted: 'rgba(60, 207, 110, 0.14)',
  danger: '#ef5361',
  dangerMuted: 'rgba(239, 83, 97, 0.14)',
  warning: '#ffb84d',
  warningMuted: 'rgba(255, 184, 77, 0.14)',
  info: '#4cc3e0',
  infoMuted: 'rgba(76, 195, 224, 0.14)',

  // One colour per part on a lineup
  leader: '#ffc300',
  backup: '#4cc3e0',
  band: '#a58bf0',
  dance: '#f06aa8',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 };
export const font = { xs: 11, sm: 13, md: 15, lg: 17, xl: 20, xxl: 26, hero: 30 };

// The colour of a part on a lineup ("Song Leader", "Backup Singer", "Keyboard", "Dancer", ...).
export function partColor(part: string): string {
  if (part === 'Song Leader') return colors.leader;
  if (part === 'Backup Singer') return colors.backup;
  if (part === 'Dancer') return colors.dance;
  return colors.band;
}
