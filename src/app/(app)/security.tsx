/**
 * Secure communication status: post-quantum identity, server key cache,
 * local envelope self-test, and an honest description of the crypto design.
 */

import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { toBase64 } from '@/core/crypto/bytes';
import { sealAlertEnvelope, verifyEnvelopeSignature } from '@/core/crypto/envelope';
import { hashBytes } from '@/core/crypto/pqc';
import type { EmergencyAlertPayload } from '@/core/types';
import { loadOrCreateIdentity, getCachedServerKeys, type Identity } from '@/services/identity-keys';
import { cryptoRandom } from '@/services/random';
import { useAuthStore } from '@/state/auth-store';
import { AppButton, Badge, Banner, Card, LoadingView, Row, Screen } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

function fingerprint(publicKey: Uint8Array): string {
  const digest = hashBytes(publicKey);
  const hex = Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex}…`;
}

export default function SecurityScreen() {
  const user = useAuthStore((s) => s.user);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [serverKeys, setServerKeys] = useState<Awaited<ReturnType<typeof getCachedServerKeys>>>(null);
  const [selfTest, setSelfTest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const id = await loadOrCreateIdentity();
      const keys = await getCachedServerKeys();
      if (!mounted) return;
      setIdentity(id);
      setServerKeys(keys);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const runSelfTest = useCallback(async () => {
    if (!identity) return;
    setBusy(true);
    setSelfTest(null);
    try {
      // Local loop-back: seal a dummy alert to our own KEM public key and
      // verify the ML-DSA signature. Proves the pipeline works on this device
      // without contacting the backend.
      const payload: EmergencyAlertPayload = {
        alertId: `self-test-${Date.now()}`,
        userId: user?.id ?? 'self-test',
        trigger: 'manual',
        createdAt: new Date().toISOString(),
        location: null,
        message: 'VigilGrace local envelope self-test',
      };
      const envelope = sealAlertEnvelope({
        payload,
        serverKemPublicKey: identity.kem.publicKey,
        signer: identity.dsa,
        random: cryptoRandom,
      });
      const signatureOk = verifyEnvelopeSignature(envelope);
      const expectedHash = toBase64(hashBytes(new TextEncoder().encode(JSON.stringify(payload))));
      setSelfTest(
        signatureOk
          ? `Sealed ${envelope.alertId} — ML-DSA-65 signature valid. Envelope size ~${JSON.stringify(envelope).length} bytes.`
          : `FAILED: signature invalid (expected hash ${expectedHash.slice(0, 12)}…)`,
      );
    } catch (err) {
      setSelfTest(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [identity]);

  if (!identity) return <LoadingView text="Loading post-quantum identity…" />;

  return (
    <Screen title="Secure communication" subtitle="Post-quantum crypto status for this device">
      <Card>
        <View style={styles.headerRow}>
          <Text style={styles.sectionTitle}>Your identity</Text>
          <Badge label={identity.created ? 'created now' : 'loaded'} tone={colors.success} />
        </View>
        <Row label="KEM" value="ML-KEM-768 (FIPS 203)" />
        <Row label="Signature" value="ML-DSA-65 (FIPS 204)" />
        <Row label="KEM public key" value={fingerprint(identity.kem.publicKey)} />
        <Row label="DSA public key" value={fingerprint(identity.dsa.publicKey)} />
        <Row label="Registered as" value={user?.name ?? 'unknown user'} />
        <Text style={styles.note}>
          Private keys are derived from 32/64-byte seeds held in the platform keystore
          (SecureStore). They never leave this device. The DSA public key is uploaded at
          registration so the backend can verify your alerts.
        </Text>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Server key cache</Text>
        {serverKeys ? (
          <>
            <Row label="KEM fingerprint" value={fingerprint(base64ToBytes(serverKeys.kemPublicKeyB64))} />
            <Row label="DSA fingerprint" value={fingerprint(base64ToBytes(serverKeys.sigPublicKeyB64))} />
            <Row label="Fetched" value={new Date(serverKeys.fetchedAt).toLocaleString()} />
            <Text style={styles.note}>
              Alerts are sealed to the server KEM key over TLS. The cache is pinned at first fetch;
              a mismatch after re-deployment requires clearing it (sign out and in again).
            </Text>
          </>
        ) : (
          <Banner tone="info" title="Not cached yet">
            The backend’s post-quantum public keys are fetched on first login or first SOS attempt.
          </Banner>
        )}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Local self-test</Text>
        <Text style={styles.note}>
          Seals a dummy alert to this device’s own KEM key and verifies the ML-DSA signature —
          proves the crypto pipeline runs here without sending anything.
        </Text>
        <AppButton label="Run envelope self-test" variant="secondary" loading={busy} onPress={() => void runSelfTest()} />
        {selfTest ? <Text style={styles.selfTest}>{selfTest}</Text> : null}
      </Card>

      <Banner tone="info" title="Design (honest summary)">
        ML-KEM-768 protects the shared secret, HKDF-SHA-256 derives an AES-256-GCM key, ML-DSA-65
        signs every alert, and SHA-256 hashes payloads for evidence integrity. Transport security
        additionally relies on TLS to the backend. Alert contents are encrypted end-to-app-server;
        the server must decrypt to dispatch SMS/calls, so it is part of the trust boundary — it is
        not end-to-end encrypted against the server itself.
      </Banner>
    </Screen>
  );
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  note: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  selfTest: { color: colors.info, fontSize: 13, fontFamily: 'monospace' },
});
