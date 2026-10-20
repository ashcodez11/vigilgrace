import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { radius, spacing } from '../theme';
import { useTokens } from './use-tokens';

export function VigilField({
  label,
  hint,
  error,
  style,
  onFocus,
  onBlur,
  ...inputProps
}: TextInputProps & { label: string; hint?: string; error?: string; style?: StyleProp<ViewStyle> }) {
  const t = useTokens();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? t.dangerText : focused ? t.focusRing : t.borderStrong;

  return (
    <View style={[styles.field, style]}>
      <Text style={[styles.label, { color: t.textPrimary }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.textSecondary}
        selectionColor={t.accent}
        style={[
          styles.input,
          {
            backgroundColor: t.surface,
            color: t.textPrimary,
            borderColor,
            borderWidth: focused || error ? 2 : 1,
          },
        ]}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...inputProps}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: t.dangerText }]}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={[styles.hint, { color: t.textSecondary }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 12, lineHeight: 16 },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: 16,
  },
});
