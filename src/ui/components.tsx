/**
 * Shared UI primitives — accessible, large-target, safety-focused.
 * Now theme-aware via useTheme hook.
 */

import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from './theme-context';
import { spacing, radius } from './theme';

export function Screen({
  title,
  subtitle,
  children,
  scroll = true,
  footer,
  style,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  const colors = theme.colors;

  const header = title ? (
    <View style={styles.headerBlock}>
      <Text style={[styles.screenTitle, { color: colors.text }]} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text style={[styles.screenSubtitle, { color: colors.textMuted }]}>{subtitle}</Text> : null}
    </View>
  ) : null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }, style]} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {header}
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.scrollContent, { flex: 1 }]}>
          {header}
          {children}
        </View>
      )}
      {footer ? <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  const colors = theme.colors;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          ...theme.effects,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  large,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
  disabled?: boolean;
  loading?: boolean;
  large?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  const colors = theme.colors;

  const background =
    variant === 'primary'
      ? colors.primary
      : variant === 'danger'
        ? colors.danger
        : variant === 'success'
          ? colors.success
          : variant === 'secondary'
            ? colors.surfaceAlt
            : 'transparent';
  const textColor = variant === 'ghost' ? colors.primary : colors.primaryText;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        large && styles.buttonLarge,
        { backgroundColor: background, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'ghost' && [styles.buttonGhost, { borderColor: colors.primary }],
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[styles.buttonText, large && styles.buttonTextLarge, { color: textColor }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Badge({ label, tone }: { label: string; tone?: string }) {
  const { theme } = useTheme();
  const color = tone ?? theme.colors.textMuted;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function StatusBadge({ label, status }: { label?: string; status: string }) {
  const { theme } = useTheme();
  const colors = theme.colors;

  const statusColors: Record<string, string> = {
    implemented: colors.success,
    prototype: colors.warning,
    'requires-dev-build': colors.info,
    'requires-hardware': colors.info,
    'not-implemented': colors.textMuted,
    delivered: colors.success,
    simulated: colors.warning,
    failed: colors.danger,
    pending: colors.textMuted,
    sent: colors.info,
    queued: colors.info,
  };

  return <Badge label={label ?? status} tone={statusColors[status] ?? colors.textMuted} />;
}

export function Field({
  label,
  hint,
  style,
  ...inputProps
}: TextInputProps & { label: string; hint?: string; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  const colors = theme.colors;

  return (
    <View style={[styles.field, style]}>
      <Text style={[styles.fieldLabel, { color: colors.text }]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          {
            backgroundColor: colors.surfaceAlt,
            borderColor: colors.border,
            color: colors.text,
          },
        ]}
        accessibilityLabel={label}
        {...inputProps}
      />
      {hint ? <Text style={[styles.fieldHint, { color: colors.textMuted }]}>{hint}</Text> : null}
    </View>
  );
}

export function ToggleRow({
  label,
  description,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  const colors = theme.colors;

  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleTexts}>
        <Text style={[styles.toggleLabel, { color: colors.text }]}>{label}</Text>
        {description ? <Text style={[styles.toggleDescription, { color: colors.textMuted }]}>{description}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ true: colors.primary, false: colors.border }}
        thumbColor={colors.text}
      />
    </View>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  const { theme } = useTheme();
  const colors = theme.colors;

  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

export function Banner({
  tone = 'info',
  title,
  children,
  actions,
}: {
  tone?: 'info' | 'error' | 'warning' | 'success';
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const { theme } = useTheme();
  const colors = theme.colors;

  const border =
    tone === 'error'
      ? colors.danger
      : tone === 'warning'
        ? colors.warning
        : tone === 'success'
          ? colors.success
          : colors.info;
  const background =
    tone === 'error'
      ? colors.dangerSurface
      : tone === 'warning'
        ? (theme.id === 'soft-girl' ? '#FFF9E6' : '#2A2110')
        : tone === 'success'
          ? colors.successSurface
          : colors.surfaceAlt;

  return (
    <View style={[styles.banner, { borderColor: border, backgroundColor: background }]}>
      {title ? <Text style={[styles.bannerTitle, { color: border }]}>{title}</Text> : null}
      {children ? <Text style={[styles.bannerBody, { color: colors.text }]}>{children}</Text> : null}
      {actions ? <View style={{ marginTop: spacing.sm }}>{actions}</View> : null}
    </View>
  );
}

export function EmptyState({ text }: { text: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>{text}</Text>
    </View>
  );
}

export function LoadingView({ text = 'Loading…' }: { text?: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.empty}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
      <Text style={[styles.emptyText, { color: theme.colors.textMuted, marginTop: spacing.md }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.md },
  headerBlock: { marginBottom: spacing.xs },
  screenTitle: { fontSize: 28, fontWeight: '800' },
  screenSubtitle: { fontSize: 15, marginTop: spacing.xs },
  footer: {
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.sm,
  },
  button: {
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  buttonLarge: { paddingVertical: 24, minHeight: 76, borderRadius: radius.lg },
  buttonGhost: { borderWidth: 1 },
  buttonText: { fontSize: 16, fontWeight: '700' },
  buttonTextLarge: { fontSize: 22 },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  field: { gap: 6 },
  fieldLabel: { fontWeight: '600', fontSize: 14 },
  fieldHint: { fontSize: 12 },
  input: {
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    minHeight: 52,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  toggleTexts: { flex: 1, gap: 2 },
  toggleLabel: { fontSize: 16, fontWeight: '600' },
  toggleDescription: { fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 4 },
  rowLabel: { fontSize: 14, flexShrink: 1 },
  rowValue: { fontSize: 14, fontWeight: '600', flexShrink: 2, textAlign: 'right' },
  banner: { borderRadius: radius.sm, borderWidth: 1, padding: spacing.md, gap: 4 },
  bannerTitle: { fontWeight: '800', fontSize: 14, textTransform: 'uppercase' },
  bannerBody: { fontSize: 14, lineHeight: 20 },
  empty: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: { fontSize: 15, textAlign: 'center' },
});
