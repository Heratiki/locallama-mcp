export const SERVER_REMINDER_INTERVAL_MS = 30 * 60 * 1000;

type ServerReminderGateOptions = {
  intervalMs?: number;
  now?: () => number;
};

export class ServerReminderGate {
  private readonly intervalMs: number;
  private readonly now: () => number;
  private lastEmittedAt: number | null = null;

  constructor(options: ServerReminderGateOptions = {}) {
    this.intervalMs = options.intervalMs ?? SERVER_REMINDER_INTERVAL_MS;
    this.now = options.now ?? Date.now;
  }

  claimIfDue(): boolean {
    const currentTime = this.now();
    if (this.lastEmittedAt !== null && currentTime - this.lastEmittedAt < this.intervalMs) {
      return false;
    }

    this.lastEmittedAt = currentTime;
    return true;
  }
}

let serverReminderGate = new ServerReminderGate();

export function claimServerReminderIfDue(): boolean {
  return serverReminderGate.claimIfDue();
}

export function _resetServerReminderGateForTests(options: ServerReminderGateOptions = {}): void {
  serverReminderGate = new ServerReminderGate(options);
}
