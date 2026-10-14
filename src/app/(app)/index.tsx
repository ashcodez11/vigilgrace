/**
 * Safety dashboard: manual SOS + countdown, live location preview,
 * trigger status summary and voice-distress corroboration prompt.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { DistressEvent } from '@/core/voice/acoustic-analyzer';
import type { GeoLocationFix } from '@/core/types';
import { useShakeMonitor } from '@/hooks/use-shake-monitor';
import { useSosController } from '@/hooks/use-sos-controller';
import { useVoiceMonitor } from '@/hooks/use-voice-monitor';
import {
  buildOsmPreviewUrl,
  buildShareLink,
  checkLocationPermission,
  getCurrentFix,
  openInMaps,
  requestLocationPermission,
} from '@/services/location';
import { useAuthStore } from '@/state/auth-store';
import { useContactsStore } from '@/state/contacts-store';
import { usePendantStore } from '@/state/pendant-store';
import { useSettingsStore } from '@/state/settings-store';
import { useVoiceLogStore } from '@/state/voice-log-store';
import { AppButton, Badge, Banner, Card, Row, Screen } from '@/ui/components';
import { colors, radius, spacing } from '@/ui/theme';

const VOICE_CORROBORATION_WINDOW_MS = 15000;

export default function DashboardScreen() {
  const { state, trigger, cancel, confirmNow, retry, reset, evidenceRecording } = useSosController();
  const contacts = useContactsStore((s) => s.contacts);
  const userName = useAuthStore((s) => s.user?.name ?? '');
  const voiceConfig = useSettingsStore((s) => s.acousticConfig());
  const voiceEnabled = useSettingsStore((s) => s.voiceEnabled);
  const shakeEnabled = useSettingsStore((s) => s.shakeEnabled);
  const countdownSeconds = useSettingsStore((s) => s.countdownSeconds);

  const lastShakeAt = useRef<number | null>(null);
  const [pendingVoice, setPendingVoice] = useState<DistressEvent | null>(null);

  const shake = useShakeMonitor((source) => {
    lastShakeAt.current = Date.now();
    trigger(source);
  });

  const onVoiceEvent = useCallback(
    (event: DistressEvent) => {
      useVoiceLogStore.getState().push(event);
      const corroboratedByShake =
        lastShakeAt.current !== null && Date.now() - lastShakeAt.current < VOICE_CORROBORATION_WINDOW_MS;
      if (!voiceConfig.requireCorroboration && event.highConfidence) {
        trigger('voice');
        return;
      }
      if (corroboratedByShake) {
        trigger('voice');
        return;
      }
      setPendingVoice(event);
    },
    [trigger, voiceConfig.requireCorroboration],
  );

  const voice = useVoiceMonitor(voiceConfig, onVoiceEvent);

  // Pendant double-press → SOS
  const initPendant = usePendantStore((s) => s.initService);
  const lastDoublePressAt = usePendantStore((s) => s.lastDoublePressAt);
  useEffect(() => {
    void initPendant();
  }, [initPendant]);
  const lastHandledPress = useRef<number | null>(null);
  useEffect(() => {
    if (lastDoublePressAt && lastDoublePressAt !== lastHandledPress.current) {
      lastHandledPress.current = lastDoublePressAt;
      trigger('pendant');
    }
  }, [lastDoublePressAt, trigger]);

  // Live location
  const [location, setLocation] = useState<GeoLocationFix | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);

  const refreshLocation = useCallback(async (ask: boolean) => {
    setLocationBusy(true);
    setLocationError(null);
    try {
      const permission = ask ? await requestLocationPermission() : await checkLocationPermission();
      if (!permission.granted) {
        setLocationError('Location permission denied — SOS will be sent without coordinates.');
        setLocation(null);
        return;
      }
      const fix = await getCurrentFix();
      if (!fix) {
        setLocationError('No location fix available yet.');
        return;
      }
      setLocation(fix);
    } finally {
      setLocationBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshLocation(false);
  }, [refreshLocation]);

  const verifiedCount = contacts.filter((c) => c.verified).length;
  const countdownLeft = useRef(0);
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (state.status !== 'countdown' || !state.countdownEndsAt) return undefined;
    const timer = setInterval(() => {
      countdownLeft.current = Math.max(
        0,
        Math.ceil((state.countdownEndsAt! - Date.now()) / 1000),
      );
      forceTick((n) => n + 1);
    }, 250);
    return () => clearInterval(timer);
  }, [state.status, state.countdownEndsAt]);
  countdownLeft.current =
    state.status === 'countdown' && state.countdownEndsAt
      ? Math.max(0, Math.ceil((state.countdownEndsAt - Date.now()) / 1000))
      : 0;

  const previewUrl = useMemo(
    () => (location ? buildOsmPreviewUrl(location, 600, 300) : null),
    [location],
  );

  const shareLink = location ? buildShareLink(location) : null;

  return (
    <Screen title="Safety dashboard" subtitle={userName}>
      <SosPanel
        state={state}
        countdownLeft={countdownLeft.current}
        countdownSeconds={countdownSeconds}
        evidenceRecording={evidenceRecording}
        onTrigger={() => trigger('manual')}
        onCancel={cancel}
        onConfirmNow={confirmNow}
        onRetry={retry}
        onDismiss={reset}
      />

      {verifiedCount === 0 ? (
        <Banner tone="warning" title="No verified contacts">
          Add and verify at least one emergency contact so your SOS can be delivered.{' '}
          <Text
            style={{ color: colors.primary, fontWeight: '700' }}
            onPress={() => router.push('/(app)/contacts')}
          >
            Open contacts
          </Text>
        </Banner>
      ) : null}

      {pendingVoice ? (
        <Card style={{ borderColor: colors.warning }}>
          <Text style={styles.promptTitle}>Possible distress detected</Text>
          <Text style={styles.promptBody}>
            Acoustic prototype confidence {(pendingVoice.confidence * 100).toFixed(0)}% at{' '}
            {pendingVoice.dbfs.toFixed(0)} dBFS{pendingVoice.voiced ? ' (speech-like)' : ''}. This is
            NOT a confirmed emergency — corroboration is required before sending an alert.
          </Text>
          <View style={styles.promptActions}>
            <AppButton
              label="Send SOS now"
              variant="danger"
              onPress={() => {
                setPendingVoice(null);
                trigger('voice');
              }}
              style={{ flex: 1 }}
            />
            <AppButton
              label="Dismiss"
              variant="secondary"
              onPress={() => setPendingVoice(null)}
              style={{ flex: 1 }}
            />
          </View>
        </Card>
      ) : null}

      <Card>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Live location</Text>
          <Badge label={location ? 'acquired' : 'idle'} />
        </View>
        {previewUrl ? (
          <Pressable onPress={() => location && void openInMaps(location)}>
            <Image
              source={{ uri: previewUrl }}
              style={styles.map}
              contentFit="cover"
              accessibilityLabel="Map preview of current location"
            />
          </Pressable>
        ) : (
          <Text style={styles.muted}>
            {locationError ?? 'Location not acquired yet. Tap refresh and allow location access.'}
          </Text>
        )}
        {location ? (
          <>
            <Row label="Coordinates" value={`${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`} />
            <Row
              label="Accuracy"
              value={location.accuracyMeters ? `±${Math.round(location.accuracyMeters)} m` : 'unknown'}
            />
          </>
        ) : null}
        <View style={styles.rowActions}>
          <AppButton
            label={locationBusy ? 'Locating…' : 'Refresh'}
            variant="secondary"
            loading={locationBusy}
            onPress={() => void refreshLocation(true)}
            style={{ flex: 1 }}
          />
          <AppButton
            label="Copy link"
            variant="secondary"
            disabled={!shareLink}
            onPress={() => shareLink && void Clipboard.setStringAsync(shareLink)}
            style={{ flex: 1 }}
          />
          <AppButton
            label="Open maps"
            variant="secondary"
            disabled={!location}
            onPress={() => location && void openInMaps(location)}
            style={{ flex: 1 }}
          />
        </View>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Trigger status</Text>
        <Row
          label="Shake-to-SOS"
          value={shakeEnabled ? `${shake.status}${shake.error ? ` — ${shake.error}` : ''}` : 'off (Settings)'}
        />
        <Row
          label="Voice distress"
          value={
            voiceEnabled
              ? `${voice.status}${voice.error ? ` — ${voice.error}` : ''}`
              : 'off (Settings)'
          }
        />
        <Text style={styles.footnote}>
          Monitoring runs only while VigilGrace is in the foreground. Background detection is not
          claimed or supported.
        </Text>
        <View style={styles.rowActions}>
          <AppButton label="Motion" variant="ghost" onPress={() => router.push('/(app)/motion')} style={{ flex: 1 }} />
          <AppButton label="Voice" variant="ghost" onPress={() => router.push('/(app)/voice')} style={{ flex: 1 }} />
          <AppButton label="Pendant" variant="ghost" onPress={() => router.push('/(app)/pendant')} style={{ flex: 1 }} />
          <AppButton label="Security" variant="ghost" onPress={() => router.push('/(app)/security')} style={{ flex: 1 }} />
        </View>
      </Card>
    </Screen>
  );
}

function SosPanel({
  state,
  countdownLeft,
  countdownSeconds,
  evidenceRecording,
  onTrigger,
  onCancel,
  onConfirmNow,
  onRetry,
  onDismiss,
}: {
  state: ReturnType<typeof useSosController>['state'];
  countdownLeft: number;
  countdownSeconds: number;
  evidenceRecording: boolean;
  onTrigger: () => void;
  onCancel: () => void;
  onConfirmNow: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const active = ['countdown', 'sending', 'retrying'].includes(state.status);
  const mock = state.report?.deliveryMode === 'mock';
  const deliveredCount =
    state.report?.results.filter((r) => ['delivered', 'simulated', 'sent'].includes(r.state)).length ??
    0;

  return (
    <View style={styles.sosWrap}>
      <Pressable
        onPress={active ? undefined : onTrigger}
        disabled={active}
        accessibilityRole="button"
        accessibilityLabel="Send emergency SOS alert"
        style={({ pressed }) => [
          styles.sosButton,
          state.status === 'countdown' && styles.sosCountdown,
          (state.status === 'sending' || state.status === 'retrying') && styles.sosSending,
          pressed && !active ? { opacity: 0.9 } : null,
        ]}
      >
        <Text style={styles.sosText}>
          {state.status === 'countdown'
            ? `CANCEL? ${countdownLeft}`
            : state.status === 'sending' || state.status === 'retrying'
              ? `SENDING… (${state.attempt})`
              : 'SOS'}
        </Text>
        <Text style={styles.sosHint}>
          {state.status === 'countdown'
            ? 'Tap CANCEL below if accidental'
            : `Tap to alert contacts · ${countdownSeconds}s countdown`}
        </Text>
      </Pressable>

      {evidenceRecording ? (
        <Text style={styles.evidenceNote}>● Recording consented evidence clip (on-device only)</Text>
      ) : null}

      {state.status === 'countdown' ? (
        <View style={styles.rowActions}>
          <AppButton label="CANCEL" variant="secondary" onPress={onCancel} style={{ flex: 1 }} large />
          <AppButton label="SEND NOW" variant="danger" onPress={onConfirmNow} style={{ flex: 1 }} large />
        </View>
      ) : null}

      {state.status === 'delivered' ? (
        <Banner
          tone={mock ? 'warning' : 'success'}
          title={mock ? 'SOS recorded — SIMULATED delivery' : 'SOS delivered'}
          actions={<AppButton label="Dismiss" variant="ghost" onPress={onDismiss} />}
        >
          {mock
            ? `Backend accepted the alert in mock mode and simulated delivery to ${deliveredCount} contact(s). No real SMS or calls were placed.`
            : `Delivery confirmed by the backend for ${deliveredCount} contact(s).`}
          {state.report ? ` Mode: ${state.report.deliveryMode}.` : ''}
        </Banner>
      ) : null}

      {state.status === 'failed' ? (
        <Banner
          tone="error"
          title="SOS failed"
          actions={
            <View style={styles.rowActions}>
              <AppButton label="Retry (same alert ID)" variant="danger" onPress={onRetry} style={{ flex: 1 }} />
              <AppButton label="Dismiss" variant="secondary" onPress={onDismiss} style={{ flex: 1 }} />
            </View>
          }
        >
          {state.lastError ?? 'Unknown failure'}
        </Banner>
      ) : null}

      {state.status === 'cancelled' ? (
        <Banner
          tone="info"
          title="SOS cancelled"
          actions={<AppButton label="OK" variant="ghost" onPress={onDismiss} />}
        >
          The countdown was cancelled — no alert was sent.
        </Banner>
      ) : null}

      {(state.status === 'sending' || state.status === 'retrying') && state.lastError ? (
        <Banner tone="warning" title={state.status === 'retrying' ? 'Retrying…' : 'Sending…'}>
          {state.lastError}
        </Banner>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sosWrap: { gap: spacing.md },
  sosButton: {
    backgroundColor: colors.danger,
    borderRadius: radius.lg,
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    borderWidth: 4,
    borderColor: '#FF6A5E',
  },
  sosCountdown: { backgroundColor: '#8A1C13', borderColor: colors.warning },
  sosSending: { backgroundColor: '#5A2A25', borderColor: colors.warning },
  sosText: { color: '#FFFFFF', fontSize: 56, fontWeight: '900', letterSpacing: 2 },
  sosHint: { color: '#FFE9E7', fontSize: 14, marginTop: spacing.sm, textAlign: 'center' },
  evidenceNote: { color: colors.warning, fontSize: 13, textAlign: 'center' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  muted: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  map: {
    width: '100%',
    height: 180,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  rowActions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  footnote: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  promptTitle: { color: colors.warning, fontWeight: '800', fontSize: 16 },
  promptBody: { color: colors.text, fontSize: 14, lineHeight: 20 },
  promptActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
});
