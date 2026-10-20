import { useEffect } from 'react';
import { Stack, router } from 'expo-router';

import { useAuthStore } from '@/state/auth-store';
import { colors } from '@/ui/theme';

export default function AuthLayout() {
  const status = useAuthStore((s) => s.status);

  // The root redirect (src/app/index.tsx) unmounts as soon as an auth screen is
  // pushed, so it can never observe the transition to signedIn. Without this
  // guard a successful sign-in or registration left the user sitting on the
  // form while the token, keys and contacts had already been saved.
  useEffect(() => {
    if (status === 'signedIn') router.replace('/');
  }, [status]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
