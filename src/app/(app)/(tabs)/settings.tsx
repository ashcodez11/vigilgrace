/**
 * Settings: SOS countdown, monitoring toggles, evidence consent,
 * backend URL override, theme switcher, plus navigation to sub-screens.
 */

import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuthStore } from '@/state/auth-store';
import { useSettingsStore } from '@/state/settings-store';
import { getApiTarget, setApiBaseUrlOverride, type ApiTargetInfo } from '@/services/api';
import { healthCheck } from '@/services/backend';
import { AppButton, Banner, Card, Field, Screen, ToggleRow } from '@/ui/components';
import { themes, useTheme, type ThemeId } from '@/ui/theme-context';
import { spacing } from '@/ui/theme';

export default function SettingsScreen() {
  const { theme, themeId, setThemeId } = useTheme();
  const colors = theme.colors;
  const settings = useSettingsStore();
  const logout = useAuthStore((s) => s.logout);
  const [apiOverride, setApiOverride] = useState('');
  const [apiStatus, setApiStatus] = useState<string | null>(null);
  const [apiTarget, setApiTarget] = useState<ApiTargetInfo | null>(null);
  const [testing, setTesting] = useState(false);

  const refreshApiTarget = async () => {
    try {
      setApiTarget(await getApiTarget());
    } catch {
      setApiTarget(null);
    }
  };

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const target = await getApiTarget();
        if (mounted) setApiTarget(target);
      } catch {
        if (mounted) setApiTarget(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const saveApiOverride = async () => {
    await setApiBaseUrlOverride(apiOverride.trim() ? apiOverride.trim() : null);
    await refreshApiTarget();
    setApiStatus('Saved. The next request uses the address shown above.');
  };

  const testConnection = async () => {
    setTesting(true);
    setApiStatus(null);
    try {
      const health = await healthCheck();
      const sms =
        health.smsProvider === 'unknown'
          ? 'SMS provider NOT configured (verification codes are refused with HTTP 503)'
          : `SMS provider: ${health.smsProvider ?? 'unknown'}`;
      setApiStatus(`Reachable — ${health.name} v${health.version}. ${sms}.`);
    } catch (err) {
      // The client already explains what to do; show it verbatim.
      setApiStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
      void refreshApiTarget();
    }
  };

  return (
    <Screen title="Settings">
      <Card>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Appearance</Text>
        <View style={styles.themeRow}>
          {(Object.keys(themes) as ThemeId[]).map((id) => (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityState={{ selected: themeId === id }}
              style={[
                styles.themeButton,
                {
                  backgroundColor: themeId === id ? colors.primary : colors.surfaceAlt,
                  borderColor: themeId === id ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setThemeId(id)}
            >
              <Text style={[styles.themeButtonText, { color: themeId === id ? colors.primaryText : colors.text }]}>
                {themes[id].name}
              </Text>
            </Pressable>
          ))}
        </View>
        <AppButton label="Design system preview" variant="ghost" onPress={() => router.push('/(app)/design-system')} />
      </Card>

      <Card>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>SOS behaviour</Text>
        <Text style={[styles.label, { color: colors.text }]}>Countdown: {settings.countdownSeconds}s</Text>
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
        <Text style={[styles.hint, { color: colors.textMuted }]}>
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
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Triggers</Text>
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
          <AppButton label="Security" variant="ghost" onPress={() => router.push('/(app)/security')} style={styles.flex} />
          <AppButton label="Profile & permissions" variant="ghost" onPress={() => router.push('/(app)/profile')} style={styles.flex} />
        </View>
      </Card>

      <Card>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Backend</Text>
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          Leave empty to use the configured default. On a development build the LAN address of the
          computer is derived automatically from the Expo dev server; the Android emulator uses
          http://10.0.2.2:4001. A physical phone needs the LAN address of the computer (for example
          http://192.168.1.20:4001) and must be on the same Wi-Fi. Production must use HTTPS.
        </Text>
        {apiTarget ? (
          <Text style={[styles.status, { color: colors.info }]}>
            Active: {apiTarget.baseUrl} ({apiTarget.source === 'override' ? 'Settings override' : 'app config'})
            {apiTarget.devServerHost ? ` · dev server host ${apiTarget.devServerHost}` : ''}
          </Text>
        ) : null}
        {apiTarget?.warning ? (
          <Banner tone="warning" title="This address cannot reach the computer">
            {apiTarget.warning}
          </Banner>
        ) : null}
        <Field
          label="Backend base URL override"
          value={apiOverride}
          onChangeText={setApiOverride}
          autoCapitalize="none"
          placeholder="http://192.168.1.20:4001"
        />
        <View style={styles.linkRow}>
          <AppButton label="Save" variant="secondary" onPress={() => void saveApiOverride()} style={styles.flex} />
          <AppButton
            label="Test connection"
            variant="ghost"
            loading={testing}
            onPress={() => void testConnection()}
            style={styles.flex}
          />
        </View>
        {apiStatus ? <Text style={[styles.status, { color: colors.info }]}>{apiStatus}</Text> : null}
      </Card>

      <Banner tone="warning" title="Foreground only">
        Shake and voice monitoring run only while VigilGrace is open. Background, lock-screen and
        hardware-button triggering are not implemented.
      </Banner>

      <AppButton label="Sign out" variant="danger" onPress={() => void logout()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 17, fontWeight: '800' },
  label: { fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 12.5, lineHeight: 18 },
  status: { fontSize: 13 },
  stepperRow: { flexDirection: 'row', gap: spacing.sm },
  linkRow: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  themeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  themeButton: {
    flex: 1,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    minHeight: 56,
  },
  themeButtonText: { fontSize: 16, fontWeight: '700' },
});
