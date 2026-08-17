export const colors = {
  // Brand & Primary
  primary: '#2563eb',
  primaryDark: '#1d4ed8',
  primaryLight: '#dbeafe',
  textOnPrimary: '#ffffff',

  // Surfaces & Backgrounds
  background: '#f8fafc',
  surface: '#ffffff',
  surfaceHover: '#f1f5f9',
  surfaceCard: '#ffffff',

  // Borders & Dividers
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',

  // Typography Hierarchy
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',

  // Shop Floor & Production Status Colors (matching domain & web)
  statusPending: '#64748b',
  statusCut: '#0284c7',
  statusEdged: '#d97706',
  statusAssembled: '#16a34a',
  statusInstalled: '#7c3aed',

  // Alerts & Feedback
  success: '#16a34a',
  successBg: '#f0fdf4',
  warning: '#d97706',
  warningBg: '#fffbeb',
  danger: '#dc2626',
  dangerBg: '#fef2f2',

  // Icon badge chips (2-col grid actions in HomeScreen)
  chipPurpleBg: '#f3e8ff',
  chipPurpleIcon: '#7c3aed',
  chipGreenBg: '#dcfce7',
  chipGreenIcon: '#16a34a',
  chipAmberBg: '#fef3c7',
  chipAmberIcon: '#d97706',
  chipBlueBg: '#e0f2fe',
  chipBlueIcon: '#0284c7',
  chipFuchsiaBg: '#fae8ff',
  chipFuchsiaIcon: '#c026d3',
  chipRedBg: '#fee2e2',
  chipRedIcon: '#dc2626',
  chipOrangeBg: '#ffedd5',
  chipOrangeIcon: '#ea580c',
  chipIndigoBg: '#dbeafe',
  chipIndigoIcon: '#2563eb',

  // Scanner dark-UI overlay (night-vision / production floor)
  scannerBg: '#090d16',
  scannerHeaderBg: '#0f172a',
  scannerTextOnDark: '#ffffff',
  scannerSubtextOnDark: '#cbd5e1',
  scannerSuccessOnDark: '#34d399',
  scannerMutedOnDark: '#94a3b8',
  scannerErrorOnDark: '#f87171',

  // Piece assembled state (BenchPaperlessScreen)
  assembledBorder: '#86efac',
  assembledBg: '#f0fdf4',
  assembledText: '#166534',
  assembledPrimaryDark: '#1d4ed8',
} as const;
