import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme';

export type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  style?: ViewStyle;
}

export function Badge({ label, variant = 'default', style }: BadgeProps) {
  return (
    <View style={[styles.badge, variantStyles[variant], style]}>
      <Text style={[styles.text, variantTextStyles[variant]]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  text: {
    ...typography.captionBold,
  },
});

const variantStyles = StyleSheet.create({
  default: {
    backgroundColor: colors.surfaceHover,
    borderWidth: 1,
    borderColor: colors.border,
  },
  primary: {
    backgroundColor: colors.primaryLight,
  },
  success: {
    backgroundColor: colors.successBg,
  },
  warning: {
    backgroundColor: colors.warningBg,
  },
  danger: {
    backgroundColor: colors.dangerBg,
  },
  info: {
    backgroundColor: '#e0f2fe',
  },
});

const variantTextStyles = StyleSheet.create({
  default: {
    color: colors.textSecondary,
  },
  primary: {
    color: colors.primaryDark,
  },
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
  danger: {
    color: colors.danger,
  },
  info: {
    color: '#0284c7',
  },
});
