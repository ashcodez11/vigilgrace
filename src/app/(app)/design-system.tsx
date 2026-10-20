/**
 * Design-system preview: renders the shared tokens and core components in the
 * active theme. Static sample content only — it triggers no alerts and reads or
 * changes no user data. The SOS sample just cycles its own presentation state.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/ui/components';
import { spacing } from '@/ui/theme';
import { useTheme } from '@/ui/theme-context';
import {
  Icon,
  SosButton,
  StatusChip,
  VigilButton,
  VigilCard,
  VigilField,
  useTokens,
  type IconName,
  type SosMode,
} from '@/ui/vigil';

const ICONS: IconName[] = ['shield-alert', 'location', 'contacts', 'lock', 'history', 'sliders', 'activity', 'profile'];

export default function DesignSystemScreen() {
  const t = useTokens();
  const { theme } = useTheme();
  const [mode, setMode] = useState<SosMode>('ready');
  const [secs, setSecs] = useState(5);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <Screen title="Design system" subtitle={`${theme.name} — preview only, sends nothing`}>
      <VigilCard elevated>
        <Text style={[styles.h, { color: t.textPrimary }]}>SOS control (sample)</Text>
        <SosButton
          mode={mode}
          secondsLeft={secs}
          onPress={() => {
            if (mode === 'ready') {
              setSecs(5);
              setMode('countdown');
            } else setMode('ready');
          }}
        />
        <Text style={[styles.note, { color: t.textSecondary }]}>
          Sample only: tap to see the countdown state, tap again to cancel. No alert is sent.
        </Text>
      </VigilCard>

      <VigilCard>
        <Text style={[styles.h, { color: t.textPrimary }]}>Buttons</Text>
        <VigilButton label="Primary action" onPress={() => {}} />
        <VigilButton label="Secondary" variant="secondary" onPress={() => {}} />
        <VigilButton label="Ghost" variant="ghost" onPress={() => {}} />
        <VigilButton
          label="Loading state"
          loading={busy}
          onPress={() => {
            setBusy(true);
            setTimeout(() => setBusy(false), 1200);
          }}
        />
        <VigilButton label="Disabled" disabled onPress={() => {}} />
      </VigilCard>

      <VigilCard>
        <Text style={[styles.h, { color: t.textPrimary }]}>Field</Text>
        <VigilField label="Contact name" hint="Helper text" value={name} onChangeText={setName} placeholder="e.g. Asha" />
        <VigilField label="Phone" error="Enter a valid phone number" placeholder="+91" />
      </VigilCard>

      <VigilCard>
        <Text style={[styles.h, { color: t.textPrimary }]}>Status chips</Text>
        <View style={styles.wrap}>
          {['delivered', 'sent', 'queued', 'pending', 'simulated', 'failed', 'verified', 'unverified'].map((s) => (
            <StatusChip key={s} status={s} />
          ))}
        </View>
      </VigilCard>

      <VigilCard>
        <Text style={[styles.h, { color: t.textPrimary }]}>Icons</Text>
        <View style={styles.wrap}>
          {ICONS.map((n) => (
            <View key={n} style={[styles.icon, { backgroundColor: t.accentSoft }]}>
              <Icon name={n} size={26} color={t.textPrimary} />
            </View>
          ))}
        </View>
      </VigilCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  h: { fontSize: 17, fontWeight: '800' },
  note: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  icon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
