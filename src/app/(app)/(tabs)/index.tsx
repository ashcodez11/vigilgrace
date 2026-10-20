/**
 * Safety dashboard: manual SOS + countdown, live location preview,
 * trigger status summary and voice-distress corroboration prompt.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  ACOUSTIC_PRESETS,
  DEFAULT_ACOUSTIC_CONFIG,
  type DistressEvent,
} from '@/core/voice/acoustic-analyzer';
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
import { useSettingsStore } from '@/state/settings-store';
import { useVoiceLogStore } from '@/state/voice-log-store';
import { AppButton, Badge, Banner, Card, Row, Screen } from '@/ui/components';
import { useTheme } from '@/ui/theme-context';
import { radius, spacing } from '@/ui/theme';

const VOICE_CORROBORATION_WINDOW_MS = 15000;

export default function DashboardScreen() {
  const { theme } = useTheme();
  const colors = theme.colors;
  const { state, trigger, cancel, confirmNow, retry, reset, evidenceRecording } = useSosController();
  const contacts = useContactsStore((s) => s.contacts);
  const userName = useAuthStore((s) => s.user?.name ?? '');
  const voiceEnabled = useSettingsStore((s) => s.voiceEnabled);
  const voiceSensitivity = useSettingsStore((s) => s.voiceSensitivity);
  const voiceRequireCorroboration = useSettingsStore((s) => s.voiceRequireCorroboration);
  const voiceKeywords = useSettingsStore((s) => s.voiceKeywords);
  // Built from stable selectors: `useSettingsStore((s) => s.acousticConfig())`
  // returns a brand-new object on every snapshot, which makes
  // useSyncExternalStore re-render forever ("Maximum update depth exceeded"
  // the moment this screen mounted).
  const voiceConfig = useMemo(
    () => ({
      ...ACOUSTIC_PRESETS[voiceSensitivity],
      enabled: voiceEnabled,
      cooldownMs: DEFAULT_ACOUSTIC_CONFIG.cooldownMs,
      requireCorroboration: voiceRequireCorroboration,
      keywords: voiceKeywords,
    }),
    [voiceSensitivity, voiceEnabled, voiceRequireCorroboration, voiceKeywords],
  );
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
    // Deferred so the initial permission check does not call setState
    // synchronously from the effect body (React Compiler rejects that).
    const timer = setTimeout(() => {
      void refreshLocation(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshLocation]);

  const verifiedCount = contacts.filter((c) => c.verified).length;
  // The visible countdown is state driven by a timer. It used to be written into
  // a ref during render and read straight back, with Date.now() called while
  // rendering: that is impure (React Compiler rejects it) and could show a
  // second that had already elapsed. Tick immediately (deferred), then 4x/s.
  const [countdownLeft, setCountdownLeft] = useState(0);
  useEffect(() => {
    if (state.status !== 'countdown' || !state.countdownEndsAt) return undefined;
    const endsAt = state.countdownEndsAt;
    const tick = () => setCountdownLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 250);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [state.status, state.countdownEndsAt]);

  const previewUrl = useMemo(
    () => (location ? buildOsmPreviewUrl(location, 600, 300) : null),
    [location],
  );

  const shareLink = location ? buildShareLink(location) : null;

  return (
    <Screen title="Safety dashboard" subtitle={userName}>
      <SosPanel
        state={state}
        countdownLeft={countdownLeft}
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
            onPress={() => router.push('/contacts')}
          >
            Open contacts
          </Text>
        </Banner>
      ) : null}

      {pendingVoice ? (
        <Card style={{ borderColor: colors.warning }}>
          <Text style={[styles.promptTitle, { color: colors.warning }]}>Possible distress detected</Text>
          <Text style={[styles.promptBody, { color: colors.text }]}>
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
          <Text style={[styles.cardTitle, { color: colors.text }]}>Live location</Text>
          <Badge label={location ? 'acquired' : 'idle'} />
        </View>
        {previewUrl ? (
          <Pressable onPress={() => location && void openInMaps(location)}>
            <Image
              source={{ uri: previewUrl }}
              style={[styles.map, { backgroundColor: colors.surfaceAlt }]}
              contentFit="cover"
              accessibilityLabel="Map preview of current location"
            />
          </Pressable>
        ) : (
          <Text style={[styles.muted, { color: colors.textMuted }]}>
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
        <Text style={[styles.cardTitle, { color: colors.text }]}>Trigger status</Text>
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
        <Text style={[styles.footnote, { color: colors.textMuted }]}>
          Monitoring runs only while VigilGrace is in the foreground. Background detection is not
          claimed or supported.
        </Text>
        <View style={styles.rowActions}>
          <AppButton label="Motion" variant="ghost" onPress={() => router.push('/(app)/motion')} style={{ flex: 1 }} />
          <AppButton label="Voice" variant="ghost" onPress={() => router.push('/(app)/voice')} style={{ flex: 1 }} />
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
  const { theme } = useTheme();
  const colors = theme.colors;
  const active = ['countdown', 'sending', 'retrying'].includes(state.status);
  const mock = state.report?.deliveryMode === 'mock';
  const deliveredCount =
    state.report?.results.filter((r) => ['delivered', 'simulated', 'sent'].includes(r.state)).length ??
    0;

  const sosButtonBg =
    state.status === 'countdown'
      ? theme.id === 'soft-girl' ? '#E89B9B' : '#8A1C13'
      : (state.status === 'sending' || state.status === 'retrying')
        ? theme.id === 'soft-girl' ? '#D4A5A5' : '#5A2A25'
        : colors.danger;

  const sosBorderColor =
    state.status === 'countdown' || state.status === 'sending' || state.status === 'retrying'
      ? colors.warning
      : theme.id === 'soft-girl' ? '#F5A5A5' : '#FF6A5E';

  return (
    <View style={styles.sosWrap}>
      <Pressable
        onPress={active ? undefined : onTrigger}
        disabled={active}
        accessibilityRole="button"
        accessibilityLabel="Send emergency SOS alert"
        style={({ pressed }) => [
          styles.sosButton,
          {
            backgroundColor: sosButtonBg,
            borderColor: sosBorderColor,
          },
          pressed && !active ? { opacity: 0.9 } : null,
        ]}
      >
        <Text style={[styles.sosText, { color: theme.id === 'soft-girl' ? colors.text : '#FFFFFF' }]}>
          {state.status === 'countdown'
            ? `CANCEL? ${countdownLeft}`
            : state.status === 'sending' || state.status === 'retrying'
              ? `SENDING… (${state.attempt})`
              : 'SOS'}
        </Text>
        <Text style={[styles.sosHint, { color: theme.id === 'soft-girl' ? colors.text : '#FFE9E7' }]}>
          {state.status === 'countdown'
            ? 'Tap CANCEL below if accidental'
            : `Tap to alert contacts · ${countdownSeconds}s countdown`}
        </Text>
      </Pressable>

      {evidenceRecording ? (
        <Text style={[styles.evidenceNote, { color: colors.warning }]}>● Recording consented evidence clip (on-device only)</Text>
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
          title={mock ? 'SOS recorded — SIMULATED delivery' : 'SOS dispatched'}
          actions={<AppButton label="Dismiss" variant="ghost" onPress={onDismiss} />}
        >
          {mock
            ? `Backend accepted the alert in mock mode and simulated delivery to ${deliveredCount} contact(s). No real SMS or calls were placed.`
            : `The backend dispatched the alert to ${deliveredCount} contact(s). The provider accepted it; that is not proof the message reached the handset.`}
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
          {'\n\n'}
          {state.report
            ? 'The backend recorded this alert but no contact delivery succeeded. Retry re-attempts delivery only to contacts who were not already reached.'
            : 'No alert was recorded, so retrying cannot duplicate a message.'}
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
    borderRadius: radius.lg,
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    borderWidth: 4,
  },
  sosCountdown: {},
  sosSending: {},
  sosText: { fontSize: 56, fontWeight: '900', letterSpacing: 2 },
  sosHint: { fontSize: 14, marginTop: spacing.sm, textAlign: 'center' },
  evidenceNote: { fontSize: 13, textAlign: 'center' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  muted: { fontSize: 14, lineHeight: 20 },
  map: {
    width: '100%',
    height: 180,
    borderRadius: radius.sm,
  },
  rowActions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  footnote: { fontSize: 12, lineHeight: 17 },
  promptTitle: { fontWeight: '800', fontSize: 16 },
  promptBody: { fontSize: 14, lineHeight: 20 },
  promptActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
});
