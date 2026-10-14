/**
 * BLE pendant pairing + diagnostics.
 *
 * The pendant is a physical BLE button (ESP32 firmware contract in
 * docs/security/pendant.md). Bluetooth requires a development build — this
 * screen degrades gracefully on Expo Go and on devices without BLE.
 */

import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { DEFAULT_DOUBLE_PRESS_CONFIG } from '@/core/pendant/double-press';
import { usePendantStore } from '@/state/pendant-store';
import { AppButton, Badge, Banner, Card, EmptyState, Row, Screen } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

export default function PendantScreen() {
  const {
    status,
    error,
    devices,
    scanning,
    connectedDeviceId,
    hasPsk,
    lastDoublePressAt,
    initService,
    scan,
    connect,
    disconnect,
    provisionPsk,
    clearPendant,
  } = usePendantStore();

  const [pskForFlash, setPskForFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void initService();
  }, [initService]);

  const onProvision = useCallback(async () => {
    const b64 = await provisionPsk();
    setPskForFlash(b64);
  }, [provisionPsk]);

  const onPair = useCallback(
    async (deviceId: string) => {
      setBusy(true);
      try {
        await connect(deviceId);
      } finally {
        setBusy(false);
      }
    },
    [connect],
  );

  const unsupported =
    status === 'requires-dev-build' ||
    status === 'unsupported' ||
    status === 'unauthorized' ||
    status === 'powered-off';

  const doublePressAgo = lastDoublePressAt ? Date.now() - lastDoublePressAt : null;

  return (
    <Screen title="Pendant (BLE)" subtitle="Double-press trigger on a paired wearable button">
      {status === 'requires-dev-build' || status === 'unsupported' ? (
        <Banner tone="warning" title="Bluetooth unavailable">
          {Platform.OS === 'web'
            ? 'Web Bluetooth is not supported by this app.'
            : 'BLE is not available in this build. Use a development build (npx expo run:android|ios) — react-native-ble-plx is not included in Expo Go.'}
        </Banner>
      ) : null}
      {status === 'unauthorized' ? (
        <Banner tone="error" title="Bluetooth permission denied">
          Grant the Bluetooth permission in system settings, then return here.
        </Banner>
      ) : null}
      {status === 'powered-off' ? (
        <Banner tone="warning" title="Bluetooth is off">
          Turn Bluetooth on, then tap Init / Scan again.
        </Banner>
      ) : null}

      <Banner tone="warning" title="Hardware not tested">
        The BLE contract is implemented in the app, but no physical pendant has been paired in this
        environment. Treat the pendant path as UNVERIFIED until you flash the ESP32 firmware
        (docs/security/pendant.md) and complete the steps below.
      </Banner>

      <Card>
        <View style={styles.headerRow}>
          <Text style={styles.sectionTitle}>Status</Text>
          <Badge
            label={status}
            tone={status === 'authenticated' ? colors.success : unsupported ? colors.warning : colors.info}
          />
        </View>
        <Row label="Paired device ID" value={connectedDeviceId ?? 'none'} />
        <Row label="Pendant PSK" value={hasPsk ? 'stored in SecureStore' : 'not provisioned'} />
        <Row
          label="Last double-press"
          value={
            doublePressAgo !== null
              ? `${(doublePressAgo / 1000).toFixed(1)}s ago (SOS triggered)`
              : 'never'
          }
        />
        <Row
          label="Double-press window"
          value={`${DEFAULT_DOUBLE_PRESS_CONFIG.maxGapMs} ms`}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Pairing</Text>
        {!hasPsk ? (
          <>
            <Text style={styles.body}>
              Generate a fresh 32-byte pre-shared key. Flash its base64 value onto the ESP32
              (see docs/security/pendant.md) BEFORE pairing — the app refuses to connect without a
              stored key.
            </Text>
            <AppButton label="Generate pendant key" onPress={() => void onProvision()} />
            {pskForFlash ? (
              <Banner tone="warning" title="Provision this key on the pendant now">
                {pskForFlash}
              </Banner>
            ) : null}
            {pskForFlash ? (
              <View style={styles.actions}>
                <AppButton
                  label="Copy key"
                  variant="secondary"
                  onPress={() => void Clipboard.setStringAsync(pskForFlash)}
                  style={styles.flex}
                />
                <AppButton
                  label="I flashed it — hide"
                  variant="ghost"
                  onPress={() => setPskForFlash(null)}
                  style={styles.flex}
                />
              </View>
            ) : null}
          </>
        ) : (
          <AppButton
            label={scanning ? 'Scanning…' : 'Scan for pendant'}
            onPress={() => void scan()}
            loading={scanning}
          />
        )}

        {devices.length === 0 && !scanning ? (
          <EmptyState text={hasPsk ? 'No pendant discovered yet.' : 'Provision a key first.'} />
        ) : null}

        {devices.map((device) => (
          <Card key={device.deviceId} style={styles.deviceCard}>
            <Text style={styles.deviceName}>{device.name}</Text>
            <Text style={styles.deviceId}>{device.deviceId}</Text>
            <AppButton
              label={connectedDeviceId === device.deviceId ? 'Reconnect' : 'Pair & connect'}
              variant={connectedDeviceId === device.deviceId ? 'primary' : 'secondary'}
              loading={busy}
              onPress={() => void onPair(device.deviceId)}
            />
          </Card>
        ))}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Actions</Text>
        <View style={styles.actions}>
          <AppButton
            label="Disconnect"
            variant="secondary"
            disabled={status !== 'authenticated' && status !== 'connected'}
            onPress={() => void disconnect()}
            style={styles.flex}
          />
          <AppButton
            label="Forget device"
            variant="danger"
            onPress={() => void clearPendant()}
            style={styles.flex}
          />
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Pairing procedure</Text>
        <Text style={styles.body}>
          {`1. Flash the ESP32 firmware (docs/security/pendant.md) with the generated PSK.
2. Power the pendant and hold it near the phone.
3. Tap Scan — the app connects to service 5afe0001-… and reads INFO.
4. The app writes a random nonce to AUTH_CHALLENGE; the pendant replies on AUTH_RESPONSE with HMAC-SHA256(psk, nonce|deviceId). Verification is local.
5. Two presses within ${DEFAULT_DOUBLE_PRESS_CONFIG.maxGapMs} ms trigger the normal SOS flow (countdown + contacts).`}
        </Text>
      </Card>

      <Banner tone="info" title="Security notes">
        The shared HMAC key lives only in the device keychain (SecureStore), never in plain
        preferences or logs. Forget the device here and rotate the key if the pendant is lost.
        Double-press is debounced to avoid pocket presses.
      </Banner>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  body: { color: colors.textMuted, fontSize: 13.5, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 13 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  deviceCard: { backgroundColor: colors.surfaceAlt },
  deviceName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  deviceId: { color: colors.textMuted, fontSize: 12, fontFamily: 'monospace' },
});
