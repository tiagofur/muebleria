import React from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  PressableProps,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '../../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style'> {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  icon,
  onPress,
  style,
  textStyle,
  ...rest
}: ButtonProps) {
  const handlePress = async (e: any) => {
    if (disabled || loading) return;
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      // Haptics might fail on non-supported devices, ignore
    }
    onPress?.(e);
  };

  const getContainerStyle = ({ pressed }: { pressed: boolean }): ViewStyle[] => {
    const base: ViewStyle = {
      ...styles.base,
      ...sizeStyles[size],
      ...variantStyles[variant],
    };

    if (pressed) {
      base.opacity = 0.85;
      base.transform = [{ scale: 0.98 }];
    }

    if (disabled) {
      base.opacity = 0.5;
    }

    return [base, style as ViewStyle];
  };

  const getTextStyle = (): TextStyle => {
    return {
      ...styles.textBase,
      ...textSizeStyles[size],
      ...variantTextStyles[variant],
      ...(disabled ? styles.textDisabled : {}),
      ...textStyle,
    };
  };

  return (
    <Pressable
      disabled={disabled || loading}
      onPress={handlePress}
      style={getContainerStyle}
      accessibilityRole="button"
      {...rest}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' || variant === 'danger' ? '#ffffff' : colors.primary}
          size="small"
        />
      ) : (
        <>
          {icon ? <>{icon}</> : null}
          <Text style={getTextStyle()}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    gap: spacing.sm,
    minHeight: spacing.touchTargetMin,
  },
  textBase: {
    textAlign: 'center',
  },
  textDisabled: {
    color: colors.textMuted,
  },
});

const sizeStyles = StyleSheet.create({
  sm: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    minHeight: 38,
  },
  md: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    minHeight: spacing.touchTargetMin,
  },
  lg: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    minHeight: spacing.touchTargetHero,
  },
});

const textSizeStyles = StyleSheet.create({
  sm: {
    ...typography.captionBold,
  },
  md: {
    ...typography.bodyBold,
  },
  lg: {
    ...typography.h3,
  },
});

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.surfaceHover,
    borderWidth: 1,
    borderColor: colors.border,
  },
  danger: {
    backgroundColor: colors.danger,
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
});

const variantTextStyles = StyleSheet.create({
  primary: {
    color: colors.textOnPrimary,
  },
  secondary: {
    color: colors.textPrimary,
  },
  danger: {
    color: colors.textOnPrimary,
  },
  outline: {
    color: colors.primary,
  },
  ghost: {
    color: colors.primary,
  },
});
