/**
 * Settings: SOS countdown, monitoring toggles, evidence consent,
 * backend URL override, plus navigation to sub-screens.
 */

import { useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useAuthStore } from '@/state/auth-store';
import { useSettingsStore } from '@/state/settings-store';
import { getApiBaseUrl, setApiBaseUrlOverride } from '@/services/api';
import { AppButton, Banner, Card, Field, Screen, ToggleRow } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

export default function SettingsScreen() {
  const settings = useSettingsStore();
  const logout = useAuthStore((s) => s.logout);
  const [apiOverride, setApiOverride] = useState('');
  const [apiStatus, setApiStatus] = useState<string | null>(null);

  const saveApiOverride = async () => {
    await setApiBaseUrlOverride(apiOverride.trim() ? apiOverride.trim() : null);
    const url = await getApiBaseUrl();
    setApiStatus(`Active backend: ${url}`);
  };

  return (
    <Screen title="Settings">
      <Card>
        <Text style={styles.sectionTitle}>SOS behaviour</Text>
        <Text style={styles.label}>Countdown: {settings.countdownSeconds}s</Text>
        <View style={styles.stepperRow}>
          <AppButton
            label="−5s"
            variant="secondary"
            onPress={() => settings.setCountdownSeconds(settings.countdownSeconds - 5)}
          />
          <AppButton
            label="−1s"
            variant="secondary"
            onPress={() => settings.setCountdownSeconds(settings.countdownSeconds - 1)}
          />
          <AppButton
            label="+1s"
            variant="secondary"
            onPress={() => settings.setCountdownSeconds(settings.countdownSeconds + 1)}
          />
          <AppButton
            label="+5s"
            variant="secondary"
            onPress={() => settings.setCountdownSeconds(settings.countdownSeconds + 5)}
          />
        </View>
        <Text style={styles.hint}>
          0 sends the alert immediately with no cancellation window. Default is 10 seconds.
        </Text>
        <ToggleRow
          label="Evidence audio recording"
          description="Records a ≤30s clip during an SOS (explicit microphone consent required). Only a SHA-256 digest + metadata is shared; the audio stays on this device."
          value={settings.evidenceRecordingConsent}
          onValueChange={settings.setEvidenceRecordingConsent}
        />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Triggers</Text>
        <ToggleRow
          label="Shake-to-SOS"
          description={settings.shakeEnabled ? 'Enabled (foreground only)' : 'Disabled'}
          value={settings.shakeEnabled}
          onValueChange={settings.setShakeEnabled}
        />
        <ToggleRow
          label="Voice distress monitoring"
          description={
            settings.voiceEnabled
              ? `Enabled — ${settings.voiceSensitivity} sensitivity (prototype)`
              : 'Disabled'
          }
          value={settings.voiceEnabled}
          onValueChange={settings.setVoiceEnabled}
        />
        <View style={styles.linkRow}>
          <AppButton label="Motion settings" variant="ghost" onPress={() => router.push('/(app)/motion')} style={styles.flex} />
          <AppButton label="Voice settings" variant="ghost" onPress={() => router.push('/(app)/voice')} style={styles.flex} />
        </View>
        <View style={styles.linkRow}>
          <AppButton label="Pendant" variant="ghost" onPress={() => router.push('/(app)/pendant')} style={styles.flex} />
          <AppButton label="Security" variant="ghost" onPress={() => router.push('/(app)/security')} style={styles.flex} />
        </View>
        <AppButton label="Profile & permissions" variant="ghost" onPress={() => router.push('/(app)/profile')} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Backend</Text>
        <Text style={styles.hint}>
          Leave empty to use the configured default. Use http://10.0.2.2:4001 for the Android
          emulator. Production deployments must use HTTPS.
        </Text>
        <Field
          label="Backend base URL override"
          value={apiOverride}
          onChangeText={setApiOverride}
          autoCapitalize="none"
          placeholder="https://api.example.com"
        />
        <AppButton label="Save & show active URL" variant="secondary" onPress={() => void saveApiOverride()} />
        {apiStatus ? <Text style={styles.status}>{apiStatus}</Text> : null}
      </Card>

      <Banner tone="warning" title="Development build">
        Pendant Bluetooth requires a development build (react-native-ble-plx is not available in
        Expo Go). Shake and voice monitoring are foreground-only.
      </Banner>

      <AppButton label="Sign out" variant="danger" onPress={() => void logout()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  label: { color: colors.text, fontSize: 15, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: 12.5, lineHeight: 18 },
  status: { color: colors.info, fontSize: 13 },
  stepperRow: { flexDirection: 'row', gap: spacing.sm },
  linkRow: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
