/**
 * Profile & permissions: account info, OS permission status,
 * session actions, and the honest capability checklist.
 */

import { useCallback, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { checkLocationPermission, requestLocationPermission } from '@/services/location';
import { checkMicrophonePermission } from '@/services/permissions';
import { useAuthStore } from '@/state/auth-store';
import { useContactsStore } from '@/state/contacts-store';
import { AppButton, Badge, Banner, Card, Row, Screen } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

/**
 * Open this app's own settings page.
 *
 * The previous Android branch built a `package:` data URI from
 * `Platform.constants.ApplicationId`, which does not exist in React Native — so
 * the intent was sent with `package:vigilgrace` and opened nothing useful.
 * `Linking.openSettings()` is the supported, platform-agnostic way to reach the
 * app's permission settings.
 */
function openSettings() {
  void Linking.openSettings();
}

export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const contacts = useContactsStore((s) => s.contacts);
  const [locationGranted, setLocationGranted] = useState<boolean | null>(null);
  const [micGranted, setMicGranted] = useState<boolean | null>(null);

  const refreshPermissions = useCallback(async () => {
    const loc = await checkLocationPermission();
    setLocationGranted(loc.granted);
    const mic = await checkMicrophonePermission();
    setMicGranted(mic.granted);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshPermissions();
    }, [refreshPermissions]),
  );

  const verifiedCount = contacts.filter((c) => c.verified).length;

  return (
    <Screen title="Profile" subtitle={user?.name ?? ''}>
      <Card>
        <Text style={styles.sectionTitle}>Account</Text>
        <Row label="Name" value={user?.name ?? '—'} />
        <Row label="User ID" value={user?.id ?? '—'} />
        {/* Accounts are email + password only; there is no phone on the profile. */}
        <Row label="Email" value={user?.email ?? '—'} />
        <Row label="Contacts" value={`${contacts.length} (${verifiedCount} verified)`} />
        <AppButton label="Sign out" variant="danger" onPress={() => void logout()} />
      </Card>

      <Card>
        <View style={styles.headerRow}>
          <Text style={styles.sectionTitle}>Permissions</Text>
          <AppButton label="Re-check" variant="ghost" onPress={() => void refreshPermissions()} />
        </View>
        <View style={styles.permRow}>
          <Text style={styles.permLabel}>Location</Text>
          <Badge
            label={locationGranted === null ? 'unknown' : locationGranted ? 'granted' : 'denied'}
            tone={
              locationGranted === null
                ? colors.textMuted
                : locationGranted
                  ? colors.success
                  : colors.danger
            }
          />
          {locationGranted === false ? (
            <AppButton
              label="Open system settings"
              variant="secondary"
              onPress={openSettings}
            />
          ) : null}
        </View>
        <View style={styles.permRow}>
          <Text style={styles.permLabel}>Microphone (evidence clip)</Text>
          <Badge
            label={micGranted === null ? 'unknown' : micGranted ? 'granted' : 'denied'}
            tone={
              micGranted === null ? colors.textMuted : micGranted ? colors.success : colors.danger
            }
          />
        </View>
        <Text style={styles.note}>
          Location permission can be re-requested from the dashboard. Microphone permission is
          requested the first time consented evidence recording runs.
        </Text>
        {locationGranted === false ? (
          <AppButton
            label="Request location again"
            variant="secondary"
            onPress={() =>
              void requestLocationPermission().then((result) => setLocationGranted(result.granted))
            }
          />
        ) : null}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Capability checklist (honest)</Text>
        <Row label="Manual SOS + countdown" value="implemented" />
        <Row label="PQC envelope (ML-KEM/ML-DSA)" value="implemented + tested" />
        <Row label="Contacts + verification flow" value="implemented" />
        <Row label="Shake / voice triggers" value="foreground-only; device sensors untested" />
        <Row label="Evidence recording" value="consent + digest; on-device only" />
        <Row label="Delivery" value="mock mode labelled; Twilio via env config" />
        <AppButton
          label="Back to safety dashboard"
          variant="secondary"
          onPress={() => router.replace('/')}
        />
      </Card>

      <Banner tone="warning" title="Foreground-only monitoring">
        Shake and voice monitoring stop when VigilGrace is backgrounded or killed. There is no
        notification listener, lock-screen or hardware-button trigger.
      </Banner>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  permLabel: { color: colors.text, fontSize: 15, flex: 1 },
  note: { color: colors.textMuted, fontSize: 12.5, lineHeight: 18 },
});
