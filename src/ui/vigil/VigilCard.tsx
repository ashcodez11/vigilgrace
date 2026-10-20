import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../theme-context';
import { radius, spacing } from '../theme';
import { useTokens } from './use-tokens';

export function VigilCard({
  children,
  elevated,
  style,
}: {
  children: ReactNode;
  elevated?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: elevated ? t.surfaceElevated : t.surface,
          borderColor: t.separator,
        },
        elevated && {
          shadowColor: theme.effects.shadowColor,
          shadowOpacity: theme.effects.shadowOpacity,
          shadowRadius: theme.effects.shadowRadius,
          shadowOffset: theme.effects.shadowOffset,
          elevation: 3,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.sm,
  },
});
