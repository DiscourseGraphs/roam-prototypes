export type JournalEvent = {
  seq: number;
  t: number;
  type: string;
  [key: string]: unknown;
};

// Append-only event log for one run, kept in memory so the brain can
// long-poll for what's new. A sink sees every event as it happens; the Node
// runner's sink writes JSONL, so a killed session still leaves its record.
export class Journal {
  private readonly events: JournalEvent[] = [];
  private waiters: Array<() => void> = [];
  private seq = 0;

  constructor(private readonly sink?: (event: JournalEvent) => void) {}

  append(type: string, payload: Record<string, unknown> = {}): JournalEvent {
    this.seq += 1;
    const event: JournalEvent = {
      ...payload,
      seq: this.seq,
      t: Date.now(),
      type,
    };
    this.events.push(event);
    this.sink?.(event);
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
    return event;
  }

  get lastSeq(): number {
    return this.seq;
  }

  all(): JournalEvent[] {
    return [...this.events];
  }

  since(seq: number): JournalEvent[] {
    return this.events.filter((event) => event.seq > seq);
  }

  async wait(seq: number, timeoutMs: number): Promise<JournalEvent[]> {
    const ready = this.since(seq);
    if (ready.length > 0 || timeoutMs <= 0) return ready;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    return this.since(seq);
  }
}
