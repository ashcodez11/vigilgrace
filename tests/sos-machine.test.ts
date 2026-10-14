import { describe, expect, it, vi } from 'vitest';

import {
  type DispatchOutcome,
  SosMachine,
  backoffDelay,
  hasConfirmedDelivery,
} from '@/core/sos/sos-machine';
import type { AlertDeliveryReport } from '@/core/types';

class FakeScheduler {
  private time = 0;
  private queue: Array<{ at: number; fn: () => void; id: number }> = [];
  private nextId = 1;

  now = () => this.time;

  setTimeout = (fn: () => void, ms: number) => {
    const id = this.nextId++;
    this.queue.push({ at: this.time + ms, fn, id });
    return id;
  };

  clearTimeout = (handle: unknown) => {
    this.queue = this.queue.filter((item) => item.id !== handle);
  };

  /** Advance fake time, firing due timers in order. */
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const due = this.queue
        .filter((q) => q.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.queue = this.queue.filter((q) => q.id !== due.id);
      this.time = due.at;
      due.fn();
    }
    this.time = target;
  }

  /** Let pending microtasks (async dispatch) settle. */
  async settle(): Promise<void> {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  }
}

function report(status: AlertDeliveryReport['status'], delivered = true): AlertDeliveryReport {
  return {
    alertId: 'a',
    status,
    deliveryMode: 'mock',
    results: [
      {
        contactId: 'c1',
        contactName: 'Mom',
        channel: 'sms',
        state: delivered ? 'simulated' : 'failed',
        detail: 'mock delivery',
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

function makeMachine(
  dispatch: (alertId: string, attempt: number) => Promise<DispatchOutcome>,
  opts: { countdownMs?: number; maxAttempts?: number } = {},
) {
  const scheduler = new FakeScheduler();
  let counter = 0;
  const machine = new SosMachine({
    scheduler,
    countdownMs: opts.countdownMs ?? 0,
    maxAttempts: opts.maxAttempts ?? 6,
    baseBackoffMs: 1000,
    maxBackoffMs: 15000,
    generateId: () => `alert-${++counter}`,
    dispatch: (alertId, attempt) => dispatch(alertId, attempt),
  });
  return { machine, scheduler };
}

describe('SosMachine', () => {
  it('runs countdown, allows cancel, and never sends when cancelled', async () => {
    const dispatch = vi.fn(async () => ({ kind: 'accepted', report: report('delivered') }) as const);
    const { machine, scheduler } = makeMachine(dispatch as never, { countdownMs: 5000 });
    machine.trigger('manual');
    expect(machine.getState().status).toBe('countdown');
    scheduler.advance(1000);
    await scheduler.settle();
    expect(dispatch).not.toHaveBeenCalled();

    machine.cancel();
    expect(machine.getState().status).toBe('cancelled');
    scheduler.advance(10000);
    await scheduler.settle();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('confirmNow sends immediately and marks delivered only on backend confirmation', async () => {
    const dispatch = vi.fn(async () => ({ kind: 'accepted', report: report('delivered') }) as const);
    const { machine, scheduler } = makeMachine(dispatch as never, { countdownMs: 5000 });
    machine.trigger('manual');
    machine.confirmNow();
    expect(machine.getState().status).toBe('sending');
    await scheduler.settle();
    expect(machine.getState().status).toBe('delivered');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(machine.getState().report?.results[0]?.state).toBe('simulated');
  });

  it('reports failure when backend accepts but no contact delivery succeeded', async () => {
    const dispatch = vi.fn(async () => ({
      kind: 'accepted',
      report: report('delivered', false),
    }) as const);
    const { machine, scheduler } = makeMachine(dispatch as never);
    machine.trigger('shake');
    await scheduler.settle();
    expect(machine.getState().status).toBe('failed');
    expect(machine.getState().lastError).toMatch(/no successful contact delivery/i);
  });

  it('retries unavailable dispatches with the SAME alertId and stops after maxAttempts', async () => {
    const seen: string[] = [];
    const dispatch = vi.fn(async (alertId: string) => {
      seen.push(alertId);
      return { kind: 'unavailable', error: 'network down' } as const;
    });
    const { machine, scheduler } = makeMachine(dispatch as never, { maxAttempts: 3 });

    machine.trigger('manual');
    for (let i = 0; i < 10; i += 1) {
      await scheduler.settle();
      scheduler.advance(60000);
      await scheduler.settle();
      if (machine.getState().status === 'failed') break;
    }

    expect(machine.getState().status).toBe('failed');
    expect(seen.length).toBe(3);
    expect(new Set(seen).size).toBe(1); // idempotent — no duplicate alerts
    expect(machine.getState().lastError).toMatch(/after 3 attempts/);
  });

  it('does not retry permanent rejections', async () => {
    const dispatch = vi.fn(async () => ({ kind: 'rejected', error: 'bad envelope' }) as const);
    const { machine, scheduler } = makeMachine(dispatch as never);
    machine.trigger('manual');
    await scheduler.settle();
    expect(machine.getState().status).toBe('failed');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(machine.getState().lastError).toBe('bad envelope');
  });

  it('retryNow reuses the original alertId after a failure', async () => {
    let fail = true;
    const seen: string[] = [];
    const dispatch = vi.fn(async (alertId: string) => {
      seen.push(alertId);
      if (fail) return { kind: 'unavailable', error: 'offline' } as const;
      return { kind: 'accepted', report: report('delivered') } as const;
    });
    const { machine, scheduler } = makeMachine(dispatch as never, { maxAttempts: 1 });
    machine.trigger('manual');
    await scheduler.settle();
    expect(machine.getState().status).toBe('failed');

    fail = false;
    machine.retryNow();
    await scheduler.settle();
    expect(machine.getState().status).toBe('delivered');
    expect(new Set(seen).size).toBe(1);
  });

  it('backoff grows exponentially and is capped', () => {
    expect(backoffDelay(1, 1000, 15000)).toBe(1000);
    expect(backoffDelay(2, 1000, 15000)).toBe(2000);
    expect(backoffDelay(3, 1000, 15000)).toBe(4000);
    expect(backoffDelay(10, 1000, 15000)).toBe(15000);
  });

  it('hasConfirmedDelivery requires an actual success state', () => {
    expect(hasConfirmedDelivery(report('delivered', false))).toBe(false);
    expect(hasConfirmedDelivery(report('delivered', true))).toBe(true);
  });
});
