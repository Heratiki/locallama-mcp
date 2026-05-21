import { describe, expect, it } from '@jest/globals';
import { ServerReminderGate } from '../../../dist/modules/server-reminder/gate.js';

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
});
