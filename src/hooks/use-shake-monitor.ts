/**
 * Shake-to-SOS monitor lifecycle hook (foreground only).
 *
 * The latest callback is kept in a ref updated by an effect, never written
 * during render: React Compiler rejects render-time ref mutation, and a stale
 * callback would make the detector trigger with out-of-date settings.
 */

import { useEffect, useRef, useState } from 'react';

import type { SosTriggerSource } from '@/core/types';
import { ShakeService, type ShakeStatus } from '@/services/shake-service';
import { useSettingsStore } from '@/state/settings-store';

export function useShakeMonitor(onTrigger: (source: SosTriggerSource) => void) {
  const shakeEnabled = useSettingsStore((s) => s.shakeEnabled);
  const shakeSensitivity = useSettingsStore((s) => s.shakeSensitivity);
  const onTriggerRef = useRef(onTrigger);

  useEffect(() => {
    onTriggerRef.current = onTrigger;
  }, [onTrigger]);

  const serviceRef = useRef<ShakeService | null>(null);
  const [runtime, setRuntime] = useState<{ status: ShakeStatus; error: string | null }>({
    status: 'stopped',
    error: null,
  });

  useEffect(() => {
    if (!shakeEnabled) {
      // No setState here: the returned status below is derived from the setting,
      // so disabling monitoring cannot cause a cascading render.
      serviceRef.current?.stop();
      serviceRef.current = null;
      return undefined;
    }

    let disposed = false;
    const service = new ShakeService({
      onTrigger: () => onTriggerRef.current('shake'),
      onUpdate: (nextStatus, nextError) => {
        if (disposed) return;
        setRuntime({ status: nextStatus, error: nextError });
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

  return {
    status: shakeEnabled ? runtime.status : ('stopped' as const),
    error: shakeEnabled ? runtime.error : null,
    enabled: shakeEnabled,
  };
}
