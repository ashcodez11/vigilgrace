import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { radius, spacing } from '../theme';
import { haptic } from './haptics';
import { useTokens } from './use-tokens';

export type VigilButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function VigilButton({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  icon,
  style,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: VigilButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const t = useTokens();
  const reduce = useReducedMotion();
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const bg =
    variant === 'primary' ? t.accent : variant === 'danger' ? t.emergency : variant === 'secondary' ? t.surfaceSunken : 'transparent';
  const fg =
    variant === 'primary' ? t.textOnAccent : variant === 'danger' ? t.textOnEmergency : t.textPrimary;
  const inactive = !!disabled || !!loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      disabled={inactive}
      onPressIn={() => {
        if (!reduce) scale.set(withTiming(0.98, { duration: 90 }));
      }}
      onPressOut={() => {
        if (!reduce) scale.set(withTiming(1, { duration: 140 }));
      }}
      onPress={() => {
        haptic('tap');
        onPress();
      }}
    >
      <Animated.View
        style={[
          styles.base,
          { backgroundColor: bg, opacity: disabled ? 0.45 : 1 },
          variant === 'ghost' && { borderWidth: 1, borderColor: t.borderStrong },
          anim,
          style,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={fg} />
        ) : (
          <View style={styles.content}>
            {icon}
            <Text style={[styles.text, { color: fg }]}>{label}</Text>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  text: { fontSize: 16, fontWeight: '700', letterSpacing: 0.1 },
});
