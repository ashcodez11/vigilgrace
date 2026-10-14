/**
 * Shared UI primitives — accessible, large-target, safety-focused.
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

import { colors, radius, spacing, statusColors } from './theme';

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
  const header = title ? (
    <View style={styles.headerBlock}>
      <Text style={styles.screenTitle} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text style={styles.screenSubtitle}>{subtitle}</Text> : null}
    </View>
  ) : null;

  return (
    <SafeAreaView style={[styles.safe, style]} edges={['top', 'left', 'right']}>
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
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
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
        variant === 'ghost' && styles.buttonGhost,
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
  const color = tone ?? colors.textMuted;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function StatusBadge({ label, status }: { label?: string; status: string }) {
  return <Badge label={label ?? status} tone={statusColors[status] ?? colors.textMuted} />;
}

export function Field({
  label,
  hint,
  style,
  ...inputProps
}: TextInputProps & { label: string; hint?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        accessibilityLabel={label}
        {...inputProps}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
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
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleTexts}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {description ? <Text style={styles.toggleDescription}>{description}</Text> : null}
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
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
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
        ? '#2A2110'
        : tone === 'success'
          ? colors.successSurface
          : colors.surfaceAlt;
  return (
    <View style={[styles.banner, { borderColor: border, backgroundColor: background }]}>
      {title ? <Text style={[styles.bannerTitle, { color: border }]}>{title}</Text> : null}
      {children ? <Text style={styles.bannerBody}>{children}</Text> : null}
      {actions ? <View style={{ marginTop: spacing.sm }}>{actions}</View> : null}
    </View>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

export function LoadingView({ text = 'Loading…' }: { text?: string }) {
  return (
    <View style={styles.empty}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[styles.emptyText, { marginTop: spacing.md }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.md },
  headerBlock: { marginBottom: spacing.xs },
  screenTitle: { color: colors.text, fontSize: 28, fontWeight: '800' },
  screenSubtitle: { color: colors.textMuted, fontSize: 15, marginTop: spacing.xs },
  footer: {
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  button: {
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  buttonLarge: { paddingVertical: 22, minHeight: 72, borderRadius: radius.lg },
  buttonGhost: { borderWidth: 1, borderColor: colors.primary },
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
  fieldLabel: { color: colors.text, fontWeight: '600', fontSize: 14 },
  fieldHint: { color: colors.textMuted, fontSize: 12 },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 48,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  toggleTexts: { flex: 1, gap: 2 },
  toggleLabel: { color: colors.text, fontSize: 16, fontWeight: '600' },
  toggleDescription: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 4 },
  rowLabel: { color: colors.textMuted, fontSize: 14, flexShrink: 1 },
  rowValue: { color: colors.text, fontSize: 14, fontWeight: '600', flexShrink: 2, textAlign: 'right' },
  banner: { borderRadius: radius.sm, borderWidth: 1, padding: spacing.md, gap: 4 },
  bannerTitle: { fontWeight: '800', fontSize: 14, textTransform: 'uppercase' },
  bannerBody: { color: colors.text, fontSize: 14, lineHeight: 20 },
  empty: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: { color: colors.textMuted, fontSize: 15, textAlign: 'center' },
});
