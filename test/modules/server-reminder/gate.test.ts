import { describe, expect, it } from '@jest/globals';
import { ServerReminderGate, claimServerReminderIfDue, _resetServerReminderGateForTests } from '../../../dist/modules/server-reminder/gate.js';

describe('ServerReminderGate', () => {
  it('allows a fresh process instance to emit immediately', () => {
    const gate = new ServerReminderGate({ now: () => 1_000 });

    expect(gate.claimIfDue()).toBe(true);
  });

  it('blocks repeat emissions inside the 30-minute interval', () => {
    let now = 1_000;
    const gate = new ServerReminderGate({ now: () => now });

    expect(gate.claimIfDue()).toBe(true);
    now += 30 * 60 * 1_000 - 1;

    expect(gate.claimIfDue()).toBe(false);
  });

  it('allows the next interaction after the 30-minute interval elapses', () => {
    let now = 1_000;
    const gate = new ServerReminderGate({ now: () => now });

    expect(gate.claimIfDue()).toBe(true);
    now += 30 * 60 * 1_000;

    expect(gate.claimIfDue()).toBe(true);
    expect(gate.claimIfDue()).toBe(false);
  });

  it('uses synchronous check-and-set semantics so only one concurrent caller wins', async () => {
    let now = 1_000;
    const gate = new ServerReminderGate({ now: () => now });
    expect(gate.claimIfDue()).toBe(true);
    now += 30 * 60 * 1_000;

    const claims = await Promise.all(
      Array.from({ length: 20 }, async () => gate.claimIfDue()),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('resets singleton gate state to allow immediate emission after restart', () => {
    let now = 1_000;
    _resetServerReminderGateForTests({ now: () => now, intervalMs: 5_000 });

    expect(claimServerReminderIfDue()).toBe(true);
    now += 1_000;
    expect(claimServerReminderIfDue()).toBe(false);

    _resetServerReminderGateForTests({ now: () => now, intervalMs: 5_000 });
    expect(claimServerReminderIfDue()).toBe(true);
  });
});
