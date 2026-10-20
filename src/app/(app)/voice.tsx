/**
 * Voice-distress trigger settings: sensitivity, corroboration, editable
 * keyword list, a temporary test window and an honest status of the
 * acoustic prototype.
 */

import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ACOUSTIC_PRESETS, type VoiceSensitivity } from '@/core/voice/acoustic-analyzer';
import { useSettingsStore } from '@/state/settings-store';
import { useVoiceLogStore } from '@/state/voice-log-store';
import { AppButton, Badge, Banner, Card, Field, Row, Screen, ToggleRow } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

const SENSITIVITIES: VoiceSensitivity[] = ['low', 'medium', 'high'];
const TEST_WINDOW_MS = 8000;

export default function VoiceSettingsScreen() {
  const voiceEnabled = useSettingsStore((s) => s.voiceEnabled);
  const setVoiceEnabled = useSettingsStore((s) => s.setVoiceEnabled);
  const sensitivity = useSettingsStore((s) => s.voiceSensitivity);
  const setVoiceSensitivity = useSettingsStore((s) => s.setVoiceSensitivity);
  const requireCorroboration = useSettingsStore((s) => s.voiceRequireCorroboration);
  const setRequireCorroboration = useSettingsStore((s) => s.setVoiceRequireCorroboration);
  const keywords = useSettingsStore((s) => s.voiceKeywords);
  const setKeywords = useSettingsStore((s) => s.setVoiceKeywords);

  const { entries, clear } = useVoiceLogStore();
  const [keywordDraft, setKeywordDraft] = useState('');
  const wasEnabled = useRef(voiceEnabled);
  const testTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (testTimer.current) clearTimeout(testTimer.current);
    },
    [],
  );

  const startTest = () => {
    if (voiceEnabled) {
      // Live monitor already running on the dashboard — just show its log.
      return;
    }
    wasEnabled.current = false;
    clear();
    setVoiceEnabled(true);
    testTimer.current = setTimeout(() => setVoiceEnabled(false), TEST_WINDOW_MS);
  };

  const addKeyword = () => {
    const word = keywordDraft.trim().toLowerCase();
    if (!word || keywords.includes(word)) return;
    setKeywords([...keywords, word]);
    setKeywordDraft('');
  };

  return (
    <Screen title="Voice distress" subtitle="Acoustic prototype — status is honest below">
      <Banner tone="warning" title="PROTOTYPE — not a confirmed detector">
        VigilGrace performs on-device acoustic analysis (loudness in dBFS, zero-crossing-rate
        speech-likeness and sustained-shout energy). There is NO on-device speech-to-text, no
        keyword matching and no classification model. A candidate event alone never sends an SOS
        unless you configure it that way (see corroboration) — even then, treat it as unconfirmed.
      </Banner>

      <ToggleRow
        label="Enable voice monitoring"
        description={
          voiceEnabled
            ? 'Running while the app is foregrounded on any tab'
            : 'Paused — monitoring only runs while VigilGrace is open'
        }
        value={voiceEnabled}
        onValueChange={setVoiceEnabled}
      />

      <Card>
        <Text style={styles.sectionTitle}>Sensitivity</Text>
        <View style={styles.segment}>
          {SENSITIVITIES.map((option) => (
            <AppButton
              key={option}
              label={option}
              variant={sensitivity === option ? 'primary' : 'secondary'}
              onPress={() => setVoiceSensitivity(option)}
              style={styles.flex}
            />
          ))}
        </View>
        <Row
          label="Candidate threshold"
          value={`confidence ≥ ${ACOUSTIC_PRESETS[sensitivity].minConfidence.toFixed(2)} · burst ≥ ${Math.round(
            ACOUSTIC_PRESETS[sensitivity].minBurstMs,
          )} ms`}
        />
        <ToggleRow
          label="Require corroboration"
          description="Recommended. A candidate only becomes an SOS after a confirmation prompt, or when a shake-to-SOS fired in the previous 15 s."
          value={requireCorroboration}
          onValueChange={setRequireCorroboration}
        />
        {!requireCorroboration ? (
          <Banner tone="error" title="Risky configuration">
            With corroboration disabled, high-confidence acoustic candidates automatically start the
            SOS countdown. Only do this if you accept false positives from loud noise.
          </Banner>
        ) : null}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Keyword list (not active yet)</Text>
        <Text style={styles.hint}>
          These words are saved for a future on-device speech recogniser. In this build nothing is
          transcribed and no keyword is matched against audio, so the list does not change the
          score. Shouting or saying a word only triggers an event through loudness and
          speech-likeness, not through the words themselves.
        </Text>
        {keywords.map((word) => (
          <View key={word} style={styles.chipRow}>
            <Text style={styles.chip}>{word}</Text>
            <AppButton
              label="remove"
              variant="ghost"
              onPress={() => setKeywords(keywords.filter((k) => k !== word))}
            />
          </View>
        ))}
        <Field
          label="Add keyword"
          value={keywordDraft}
          onChangeText={setKeywordDraft}
          autoCapitalize="none"
          placeholder="help"
          onSubmitEditing={addKeyword}
        />
        <AppButton label="Add keyword" variant="secondary" onPress={addKeyword} />
      </Card>

      <Card>
        <View style={styles.headerRow}>
          <Text style={styles.sectionTitle}>Detection log</Text>
          <Badge label={voiceEnabled ? 'live' : 'idle'} tone={voiceEnabled ? colors.success : colors.textMuted} />
        </View>
        {entries.length === 0 ? (
          <Text style={styles.hint}>No candidate events yet.</Text>
        ) : (
          entries.map((entry) => (
            <Row
              key={`${entry.at}`}
              label={`${new Date(entry.at).toLocaleTimeString()} · ${(entry.confidence * 100).toFixed(0)}% · ${entry.dbfs.toFixed(0)} dBFS`}
              value={`${entry.voiced ? 'speech-like' : 'noise burst'}${entry.highConfidence ? ' · high' : ''}`}
            />
          ))
        )}
        <View style={styles.actions}>
          <AppButton
            label={voiceEnabled ? 'Monitor is live on the Safety tab' : `Test monitor (${TEST_WINDOW_MS / 1000}s)`}
            variant="secondary"
            loading={voiceEnabled}
            onPress={startTest}
            style={styles.flex}
          />
          <AppButton label="Clear log" variant="ghost" onPress={clear} style={styles.flex} />
        </View>
        <Text style={styles.hint}>
          Say “help” or shout during a test window, then watch the Safety tab’s voice row.
        </Text>
      </Card>

      <Banner tone="info" title="Known limitations">
        Microphone access is required. Backgrounding the app stops the monitor. Very noisy
        environments (traffic, music, construction) can produce candidates. Keyword matching is
        English-oriented and pronunciation-sensitive.
      </Banner>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  segment: { flexDirection: 'row', gap: spacing.sm },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  chipRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chip: { color: colors.text, fontSize: 15, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
