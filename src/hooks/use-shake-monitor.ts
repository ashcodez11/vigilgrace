/**
 * Shake-to-SOS monitor lifecycle hook (foreground only).
 */

import { useEffect, useRef, useState } from 'react';

import type { SosTriggerSource } from '@/core/types';
import { ShakeService, type ShakeStatus } from '@/services/shake-service';
import { useSettingsStore } from '@/state/settings-store';

export function useShakeMonitor(onTrigger: (source: SosTriggerSource) => void) {
  const shakeEnabled = useSettingsStore((s) => s.shakeEnabled);
  const shakeSensitivity = useSettingsStore((s) => s.shakeSensitivity);
  const onTriggerRef = useRef(onTrigger);
  onTriggerRef.current = onTrigger;

  const serviceRef = useRef<ShakeService | null>(null);
  const [status, setStatus] = useState<ShakeStatus>('stopped');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shakeEnabled) {
      serviceRef.current?.stop();
      serviceRef.current = null;
      setStatus('stopped');
      setError(null);
      return undefined;
    }

    let disposed = false;
    const service = new ShakeService({
      onTrigger: () => onTriggerRef.current('shake'),
      onUpdate: (nextStatus, nextError) => {
        if (disposed) return;
        setStatus(nextStatus);
        setError(nextError);
      },
    });
    service.setSensitivity(shakeSensitivity);
    serviceRef.current = service;
    void service.start();

    return () => {
      disposed = true;
      service.stop();
      if (serviceRef.current === service) serviceRef.current = null;
    };
  }, [shakeEnabled, shakeSensitivity]);

  return { status, error, enabled: shakeEnabled };
}
