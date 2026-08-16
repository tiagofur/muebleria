import React from 'react';
import { View, StyleSheet, ViewStyle, Pressable, PressableProps } from 'react-native';
import { colors, radius, spacing } from '../../theme';

export interface CardProps extends ViewStyle {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: PressableProps['onPress'];
  elevated?: boolean;
}

export function Card({ children, style, onPress, elevated = false }: CardProps) {
  const containerStyle = [
    styles.card,
    elevated && styles.elevated,
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          ...containerStyle,
          pressed && styles.pressed,
        ]}
      >
        {children}
      </Pressable>
    );
  }

  return <View style={containerStyle}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceCard,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  elevated: {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
});
