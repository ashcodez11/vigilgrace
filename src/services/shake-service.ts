/**
 * Shake-to-SOS runtime service.
 *
 * Wraps expo-sensors Accelerometer + the pure ShakeDetectorEngine.
 * IMPORTANT: accelerometer updates are foreground-only in React Native.
 * There is no supported background accelerometer mode for Expo apps; when the
 * app is backgrounded the detector stops receiving samples and therefore
 * stops triggering. Documented in docs/security/monitoring-status.md.
 */

import { Accelerometer } from 'expo-sensors';

import {
  type ShakeConfig,
  SENSITIVITY_PRESETS,
  type ShakeSensitivity,
  ShakeDetectorEngine,
} from '@/core/motion/shake-detector';

export type ShakeStatus =
  | 'stopped'
  | 'unsupported'
  | 'permission-denied'
  | 'running'
  | 'error';

export class ShakeService {
  private engine = new ShakeDetectorEngine();
  private subscription: { remove: () => void } | null = null;
  private status: ShakeStatus = 'stopped';
  private lastError: string | null = null;
  private onTrigger: () => void;
  private onUpdate?: (status: ShakeStatus, error: string | null) => void;

  constructor(options: {
    onTrigger: () => void;
    onUpdate?: (status: ShakeStatus, error: string | null) => void;
  }) {
    this.onTrigger = options.onTrigger;
    this.onUpdate = options.onUpdate;
  }

  getStatus(): { status: ShakeStatus; error: string | null; peaks: number } {
    return { status: this.status, error: this.lastError, peaks: 0 };
  }

  setSensitivity(sensitivity: ShakeSensitivity): void {
    this.engine.setConfig(SENSITIVITY_PRESETS[sensitivity]);
  }

  setConfig(config: ShakeConfig): void {
    this.engine.setConfig(config);
  }

  async start(): Promise<ShakeStatus> {
    if (this.status === 'running') return this.status;
    try {
      const available = await Accelerometer.isAvailableAsync();
      if (!available) {
        return this.updateStatus('unsupported', 'Accelerometer not available on this device');
      }
      const permission = await Accelerometer.requestPermissionsAsync();
      if (!permission.granted) {
        return this.updateStatus('permission-denied', 'Motion permission denied');
      }
      Accelerometer.setUpdateInterval(100); // 10 Hz — plenty for shake detection
      this.subscription = Accelerometer.addListener((measurement) => {
        const evaluation = this.engine.push({
          x: measurement.x,
          y: measurement.y,
          z: measurement.z,
          tMs: Math.round(measurement.timestamp * 1000),
        });
        if (evaluation.triggered) this.onTrigger();
      });
      return this.updateStatus('running', null);
    } catch (err) {
      return this.updateStatus('error', (err as Error).message);
    }
  }

  stop(): void {
    this.subscription?.remove();
    this.subscription = null;
    this.engine.reset();
    this.updateStatus('stopped', null);
  }

  private updateStatus(status: ShakeStatus, error: string | null): ShakeStatus {
    this.status = status;
    this.lastError = error;
    this.onUpdate?.(status, error);
    return status;
  }
}
