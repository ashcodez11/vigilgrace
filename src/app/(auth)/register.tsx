import { useState } from 'react';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';

import { isValidEmail } from '@/core/contacts/contacts';
import { useAuthStore } from '@/state/auth-store';
import { AppButton, Banner, Card, Field, Screen } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

export default function RegisterScreen() {
  const register = useAuthStore((s) => s.register);
  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const emailOk = isValidEmail(email);
  const passwordOk = password.length >= 8;
  const ready = name.trim().length >= 2 && emailOk && passwordOk;

  const onSubmit = () => {
    clearError();
    void register(email.trim(), password, name.trim()).catch(() => {
      // error surfaced via store
    });
  };

  return (
    <Screen title="Create account" subtitle="Your keys are generated on this device">
      <Card>
        <Field label="Full name" value={name} onChangeText={setName} placeholder="Your name" />
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@example.com"
          hint={email && !emailOk ? 'Enter a valid email address' : undefined}
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="At least 8 characters"
          hint={password && !passwordOk ? 'Minimum 8 characters' : undefined}
        />
        {error ? (
          <Banner tone="error" title="Registration failed">
            {error}
          </Banner>
        ) : null}
        <AppButton label="Create account" onPress={onSubmit} loading={busy} disabled={!ready} />
      </Card>
      <Banner tone="warning" title="Development note">
        Registration provisions your post-quantum identity keys and seeds your initial emergency
        contacts from private local configuration. No messages or calls are made during setup.
      </Banner>
      <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' }}>
        <Text style={{ color: colors.textMuted }}>Already registered?</Text>
        <Link href="/(auth)/login" style={{ color: colors.primary, fontWeight: '700' }}>
          Sign in
        </Link>
      </View>
    </Screen>
  );
}
