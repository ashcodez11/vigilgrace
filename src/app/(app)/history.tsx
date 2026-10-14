/**
 * Emergency history: past alerts with delivery mode, trigger, location and
 * evidence integrity digests.
 */

import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { useAuthStore } from '@/state/auth-store';
import { useHistoryStore } from '@/state/history-store';
import { AppButton, Badge, Banner, Card, EmptyState, LoadingView, Row, Screen } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

function shortHash(hashB64: string): string {
  if (!hashB64) return '—';
  const hex = Array.from(
    Uint8Array.from(atob(hashB64), (c) => c.charCodeAt(0)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
  return `${hex.slice(0, 12)}…${hex.slice(-6)}`;
}

export default function HistoryScreen() {
  const token = useAuthStore((s) => s.token);
  const { alerts, loading, error, refresh } = useHistoryStore();
  const [copied, setCopied] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (token) void refresh(token);
    }, [refresh, token]),
  );

  if (loading && alerts.length === 0) return <LoadingView text="Loading history…" />;

  return (
    <Screen
      title="Emergency history"
      subtitle="Every alert you have raised, with integrity digests"
      footer={
        <AppButton label="Refresh" variant="secondary" onPress={() => token && void refresh(token)} />
      }
    >
      {error ? (
        <Banner tone="error" title="History error">
          {error}
        </Banner>
      ) : null}

      {alerts.length === 0 ? (
        <EmptyState text="No emergencies recorded yet." />
      ) : null}

      {alerts.map((alert) => (
        <Card key={alert.id}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {new Date(alert.createdAt).toLocaleString()} · {alert.trigger}
            </Text>
            <Badge
              label={alert.deliveryMode === 'mock' ? `simulated (${alert.status})` : alert.status}
              tone={alert.status === 'delivered' ? colors.success : alert.status === 'failed' ? colors.danger : colors.warning}
            />
          </View>
          <Row
            label="Location"
            value={
              alert.location
                ? `${alert.location.latitude.toFixed(4)}, ${alert.location.longitude.toFixed(4)}`
                : 'not available'
            }
          />
          <Row label="Payload digest (SHA-256)" value={shortHash(alert.payloadHashB64)} />
          {alert.evidence && alert.evidence.length > 0 ? (
            <>
              <Text style={styles.section}>Evidence ({alert.evidence.length})</Text>
              {alert.evidence.map((ev) => (
                <View key={ev.id} style={styles.evidenceRow}>
                  <Text style={styles.evidenceKind}>{ev.kind}</Text>
                  <Text style={styles.evidenceMeta}>
                    {new Date(ev.createdAt).toLocaleString()} ·{' '}
                    {ev.uploaded ? 'uploaded metadata' : 'on-device only'}
                  </Text>
                  <Text style={styles.hash}>{shortHash(ev.sha256)}</Text>
                </View>
              ))}
            </>
          ) : null}
          <AppButton
            label={copied === alert.id ? 'Digest copied' : 'Copy full digest'}
            variant="ghost"
            onPress={() => {
              void Clipboard.setStringAsync(alert.payloadHashB64);
              setCopied(alert.id);
              setTimeout(() => setCopied(null), 2000);
            }}
          />
        </Card>
      ))}

      <Banner tone="warning" title="Integrity note">
        Digests let you verify that stored metadata has not changed since it was recorded.
        Digests alone do not prove authorship — authenticity comes from ML-DSA signatures on the
        original sealed alert envelope held by the backend.
      </Banner>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, alignItems: 'flex-start' },
  title: { color: colors.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  section: { color: colors.text, fontWeight: '700', marginTop: spacing.xs },
  evidenceRow: {
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingLeft: spacing.sm,
    gap: 2,
  },
  evidenceKind: { color: colors.text, fontWeight: '600', fontSize: 13 },
  evidenceMeta: { color: colors.textMuted, fontSize: 12 },
  hash: { color: colors.info, fontSize: 12, fontFamily: 'monospace' },
});
