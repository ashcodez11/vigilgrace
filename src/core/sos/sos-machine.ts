/**
 * SOS lifecycle state machine (pure, deterministic, unit-tested).
 *
 * Responsibilities:
 *  - optional cancellable countdown before an alert is sent (accidental trigger)
 *  - single stable alertId per emergency (idempotent retries, no duplicates)
 *  - exponential-backoff retries with a hard attempt cap
 *  - "delivered" is only ever entered when the backend has confirmed real
 *    (or explicitly labelled simulated) delivery results — never optimistically.
 *
 * Transport, timers and clock are injected so tests run without React Native.
 */

import type {
  AlertDeliveryReport,
  SosStatus,
  SosTriggerSource,
} from '../types';

export interface SosState {
  status: SosStatus;
  source: SosTriggerSource | null;
  alertId: string | null;
  countdownEndsAt: number | null;
  attempt: number;
  lastError: string | null;
  report: AlertDeliveryReport | null;
  updatedAt: number;
}

export type DispatchOutcome =
  | { kind: 'accepted'; report: AlertDeliveryReport }
  /** Rejected by backend in a way that retrying will not fix (4xx). */
  | { kind: 'rejected'; error: string }
  /** Network / server failure — safe to retry with the SAME alertId. */
  | { kind: 'unavailable'; error: string };

export interface SosScheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SosMachineOptions {
  scheduler: SosScheduler;
  /** Milliseconds of countdown before sending. 0 = send immediately. */
  countdownMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** Must reuse the supplied alertId for retries — that is what de-duplicates. */
  dispatch: (alertId: string, attempt: number, source: SosTriggerSource) => Promise<DispatchOutcome>;
  generateId: () => string;
  onUpdate?: (state: SosState) => void;
}

export const DEFAULT_SOS_OPTIONS = {
  countdownMs: 10000,
  maxAttempts: 6,
  baseBackoffMs: 1000,
  maxBackoffMs: 15000,
};

export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const delay = baseMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(maxMs, delay);
}

export function hasConfirmedDelivery(report: AlertDeliveryReport): boolean {
  return report.results.some(
    (r) => r.state === 'delivered' || r.state === 'simulated' || r.state === 'sent',
  );
}

export class SosMachine {
  private state: SosState = {
    status: 'idle',
    source: null,
    alertId: null,
    countdownEndsAt: null,
    attempt: 0,
    lastError: null,
    report: null,
    updatedAt: 0,
  };
  private countdownTimer: unknown = null;
  private retryTimer: unknown = null;
  private dispatching = false;
  private cancelled = false;

  private readonly countdownMs: number;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(private readonly options: SosMachineOptions) {
    this.countdownMs = options.countdownMs ?? DEFAULT_SOS_OPTIONS.countdownMs;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_SOS_OPTIONS.maxAttempts;
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_SOS_OPTIONS.baseBackoffMs;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_SOS_OPTIONS.maxBackoffMs;
  }

  getState(): SosState {
    return { ...this.state };
  }

  isActive(): boolean {
    return ['countdown', 'sending', 'retrying'].includes(this.state.status);
  }

  private update(patch: Partial<SosState>): void {
    this.state = { ...this.state, ...patch, updatedAt: this.options.scheduler.now() };
    this.options.onUpdate?.(this.getState());
  }

  /** Start an emergency. Shows countdown when configured, otherwise sends now. */
  trigger(source: SosTriggerSource): SosState {
    if (this.isActive()) return this.getState();
    this.cancelled = false;
    const alertId = this.options.generateId();
    this.update({
      status: this.countdownMs > 0 ? 'countdown' : 'sending',
      source,
      alertId,
      countdownEndsAt: this.countdownMs > 0 ? this.options.scheduler.now() + this.countdownMs : null,
      attempt: 0,
      lastError: null,
      report: null,
    });
    if (this.countdownMs > 0) {
      this.countdownTimer = this.options.scheduler.setTimeout(() => {
        this.countdownTimer = null;
        if (!this.cancelled) this.beginSending();
      }, this.countdownMs);
    } else {
      void this.beginSending();
    }
    return this.getState();
  }

  /** Skip the countdown and send right away. */
  confirmNow(): SosState {
    if (this.state.status !== 'countdown') return this.getState();
    this.clearCountdown();
    this.update({ countdownEndsAt: null, status: 'sending' });
    void this.beginSending();
    return this.getState();
  }

  /** Cancel a countdown (accidental trigger). Only possible before sending. */
  cancel(reason = 'Cancelled by user'): SosState {
    if (this.state.status !== 'countdown') return this.getState();
    this.cancelled = true;
    this.clearCountdown();
    this.update({ status: 'cancelled', countdownEndsAt: null, lastError: reason });
    return this.getState();
  }

  /** Return to idle after a finished/failed/cancelled run. */
  reset(): void {
    this.clearCountdown();
    this.clearRetry();
    this.cancelled = false;
    this.dispatching = false;
    this.update({
      status: 'idle',
      source: null,
      alertId: null,
      countdownEndsAt: null,
      attempt: 0,
      lastError: null,
      report: null,
    });
  }

  /** Manual "try again" after a failure — reuses the same alertId. */
  retryNow(): SosState {
    if (this.state.status !== 'failed' || !this.state.alertId || !this.state.source) {
      return this.getState();
    }
    this.clearRetry();
    this.update({ status: 'sending', lastError: null });
    void this.beginSending();
    return this.getState();
  }

  private clearCountdown(): void {
    if (this.countdownTimer !== null) {
      this.options.scheduler.clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      this.options.scheduler.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private async beginSending(): Promise<void> {
    if (this.dispatching || this.cancelled || !this.state.alertId || !this.state.source) return;
    const alertId = this.state.alertId;
    const source = this.state.source;
    this.dispatching = true;
    const attempt = this.state.attempt + 1;
    this.update({ status: attempt > 1 ? 'retrying' : 'sending', attempt, countdownEndsAt: null });

    let outcome: DispatchOutcome;
    try {
      outcome = await this.options.dispatch(alertId, attempt, source);
    } catch (err) {
      outcome = { kind: 'unavailable', error: (err as Error).message || 'Network error' };
    }

    if (this.cancelled || this.state.alertId !== alertId) {
      this.dispatching = false;
      return;
    }

    if (outcome.kind === 'accepted') {
      this.dispatching = false;
      const confirmed = hasConfirmedDelivery(outcome.report);
      this.update({
        status: confirmed ? 'delivered' : 'failed',
        report: outcome.report,
        lastError: confirmed ? null : 'Backend accepted the alert but reported no successful contact delivery',
      });
      return;
    }

    if (outcome.kind === 'rejected') {
      this.dispatching = false;
      this.update({ status: 'failed', lastError: outcome.error });
      return;
    }

    // unavailable → retry with backoff
    if (attempt >= this.maxAttempts) {
      this.dispatching = false;
      this.update({ status: 'failed', lastError: `${outcome.error} (after ${attempt} attempts)` });
      return;
    }

    const delay = backoffDelay(attempt, this.baseBackoffMs, this.maxBackoffMs);
    this.update({ status: 'retrying', lastError: outcome.error });
    this.retryTimer = this.options.scheduler.setTimeout(() => {
      this.retryTimer = null;
      this.dispatching = false;
      void this.beginSending();
    }, delay);
  }
}
