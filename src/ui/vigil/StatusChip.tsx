import { StyleSheet, Text, View } from 'react-native';

import { spacing } from '../theme';
import { Icon, type IconName } from './Icon';
import { useTokens } from './use-tokens';

export type ChipTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/**
 * Honest delivery wording: only `delivered` reads as success. `sent` and
 * `queued` mean a request was made, not that anyone received it.
 */
const STATUS: Record<string, { label: string; tone: ChipTone }> = {
  delivered: { label: 'Delivered', tone: 'success' },
  sent: { label: 'Sent, not confirmed', tone: 'info' },
  queued: { label: 'Queued', tone: 'info' },
  pending: { label: 'Pending', tone: 'neutral' },
  simulated: { label: 'Simulated', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  verified: { label: 'Verified', tone: 'success' },
  unverified: { label: 'Not verified', tone: 'warning' },
};

const ICON: Record<ChipTone, IconName> = {
  success: 'check-circle',
  warning: 'warning',
  danger: 'warning',
  info: 'history',
  neutral: 'history',
};

export function StatusChip({ status, label, tone }: { status?: string; label?: string; tone?: ChipTone }) {
  const t = useTokens();
  const known = status ? STATUS[status] : undefined;
  const resolvedTone = tone ?? known?.tone ?? 'neutral';
  const text = label ?? known?.label ?? status ?? '';
  const color = {
    success: t.success,
    warning: t.warning,
    danger: t.dangerText,
    info: t.info,
    neutral: t.textSecondary,
  }[resolvedTone];

  return (
    <View
      accessible
      accessibilityLabel={`Status: ${text}`}
      style={[styles.chip, { borderColor: color, backgroundColor: t.surfaceSunken }]}
    >
      <Icon name={ICON[resolvedTone]} size={14} color={color} strokeWidth={2} />
      <Text style={[styles.text, { color }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  text: { fontSize: 12, fontWeight: '700' },
});
