import { useState } from 'react';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';

import { useAuthStore } from '@/state/auth-store';
import { AppButton, Banner, Card, Field, Screen } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

export default function LoginScreen() {
  const login = useAuthStore((s) => s.login);
  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const onSubmit = () => {
    clearError();
    void login(email.trim(), password).catch(() => {
      // error surfaced via store
    });
  };

  return (
    <Screen title="VigilGrace" subtitle="Post-quantum secured women safety companion">
      <Banner tone="info" title="Encrypted end-to-end">
        Emergency alerts are sealed with ML-KEM-768 + AES-256-GCM and signed with ML-DSA-65 before
        they ever leave this device.
      </Banner>
      <Card>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@example.com"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          placeholder="••••••••"
        />
        {error ? (
          <Banner tone="error" title="Sign-in failed">
            {error}
          </Banner>
        ) : null}
        <AppButton label="Sign in" onPress={onSubmit} loading={busy} disabled={!email || !password} />
      </Card>
      <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' }}>
        <Text style={{ color: colors.textMuted }}>New here?</Text>
        <Link href="/(auth)/register" style={{ color: colors.primary, fontWeight: '700' }}>
          Create an account
        </Link>
      </View>
    </Screen>
  );
}
