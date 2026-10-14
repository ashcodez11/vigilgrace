/**
 * Motion trigger settings + live accelerometer feedback.
 */

import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Accelerometer } from 'expo-sensors';

import { SENSITIVITY_PRESETS, ShakeDetectorEngine } from '@/core/motion/shake-detector';
import type { ShakeSensitivity } from '@/core/motion/shake-detector';
import { useSettingsStore } from '@/state/settings-store';
import { AppButton, Badge, Banner, Card, Screen, ToggleRow } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

const SENSITIVITIES: ShakeSensitivity[] = ['low', 'medium', 'high'];

export default function MotionSettingsScreen() {
  const shakeEnabled = useSettingsStore((s) => s.shakeEnabled);
  const setShakeEnabled = useSettingsStore((s) => s.setShakeEnabled);
  const sensitivity = useSettingsStore((s) => s.shakeSensitivity);
  const setSensitivity = useSettingsStore((s) => s.setShakeSensitivity);

  const [peaks, setPeaks] = useState(0);
  const [lastDeviation, setLastDeviation] = useState(0);
  const engineRef = useRef(new ShakeDetectorEngine(SENSITIVITY_PRESETS[sensitivity]));

  useEffect(() => {
    engineRef.current.setConfig(SENSITIVITY_PRESETS[sensitivity]);
  }, [sensitivity]);

  useEffect(() => {
    let subscription: { remove: () => void } | null = null;
    let mounted = true;
    if (shakeEnabled) {
      Accelerometer.setUpdateInterval(100);
      subscription = Accelerometer.addListener((m) => {
        if (!mounted) return;
        const evaluation = engineRef.current.push({
          x: m.x,
          y: m.y,
          z: m.z,
          tMs: Math.round(m.timestamp * 1000),
        });
        setPeaks(evaluation.peaksInWindow);
        setLastDeviation(evaluation.deviationG);
      });
    }
    return () => {
      mounted = false;
      subscription?.remove();
      engineRef.current.reset();
      setPeaks(0);
    };
  }, [shakeEnabled, sensitivity]);

  const preset = SENSITIVITY_PRESETS[sensitivity];

  return (
    <Screen title="Motion trigger" subtitle="Shake-to-SOS using the accelerometer">
      <ToggleRow
        label="Enable shake-to-SOS"
        description="When enabled, a deliberate shake triggers the same SOS flow as the big button (with countdown)."
        value={shakeEnabled}
        onValueChange={setShakeEnabled}
      />

      <Card>
        <Text style={styles.sectionTitle}>Sensitivity</Text>
        <View style={styles.segment}>
          {SENSITIVITIES.map((option) => (
            <AppButton
              key={option}
              label={option}
              variant={sensitivity === option ? 'primary' : 'secondary'}
              onPress={() => setSensitivity(option)}
              style={styles.flex}
            />
          ))}
        </View>
        <View style={styles.statsRow}>
          <Badge label={`${preset.peakThresholdG} g threshold`} />
          <Badge label={`${preset.minPeaks} peaks / ${preset.windowMs / 1000}s`} />
          <Badge label={`${preset.cooldownMs / 1000}s cooldown`} />
        </View>
      </Card>

      <Card>
        <View style={styles.headerRow}>
          <Text style={styles.sectionTitle}>Live sensor</Text>
          <Badge label={shakeEnabled ? 'monitoring' : 'paused'} tone={shakeEnabled ? colors.success : colors.textMuted} />
        </View>
        <Text style={styles.metric}>Peaks in window: {peaks}</Text>
        <Text style={styles.metric}>Latest deviation: {lastDeviation.toFixed(2)} g</Text>
        <Text style={styles.hint}>
          Try shaking the phone: peaks should climb toward {preset.minPeaks} and the SOS countdown
          should start.
        </Text>
      </Card>

      <Banner tone="warning" title="Foreground only">
        React Native/Expo does not deliver accelerometer updates while the app is backgrounded or
        killed. Shake detection is a foreground fallback — it is NOT a reliable continuous
        background monitor and has not been tested as one. For always-on triggering use the BLE
        pendant (development build + ESP32 hardware required).
      </Banner>

      <Banner tone="info" title="False-positive safeguards">
        A peak must deviate more than {preset.peakThresholdG} g from gravity, {preset.minPeaks} peaks
        must occur within {preset.windowMs / 1000}s, peaks closer than {preset.peakMinSpacingMs} ms are
        debounced, and every trigger enforces a {preset.cooldownMs / 1000}s cooldown. The normal SOS
        countdown still applies, so an accidental trigger can be cancelled.
      </Banner>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  segment: { flexDirection: 'row', gap: spacing.sm },
  statsRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  metric: { color: colors.text, fontSize: 15, fontVariant: ['tabular-nums'] },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  flex: { flex: 1 },
});
