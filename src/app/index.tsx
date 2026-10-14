/**
 * Entry redirect — routes to auth or the app based on session state.
 */

import { useEffect } from 'react';
import { router, useSegments } from 'expo-router';

import { useAuthStore } from '@/state/auth-store';
import { LoadingView } from '@/ui/components';

export default function Index() {
  const status = useAuthStore((s) => s.status);
  const segments = useSegments();

  useEffect(() => {
    if (status === 'loading') return;
    const inAuthGroup = segments[0] === '(auth)';
    const atRoot = segments.length === 0;
    if (status === 'signedOut' && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (status === 'signedIn' && (inAuthGroup || atRoot)) {
      router.replace('/(app)/tabs');
    }
  }, [status, segments]);

  if (status === 'loading') return <LoadingView text="Starting VigilGrace…" />;
  return null;
}
