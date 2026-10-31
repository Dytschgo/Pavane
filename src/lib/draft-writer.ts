export const MAX_DRAFT_BYTES = 64 * 1024;

export interface DraftSnapshot {
  chatId: string;
  content: string;
  version: number;
}

/** Persist immediately, keeping only the latest queued snapshot per chat. */
export class DraftWriter {
  private pending = new Map<string, DraftSnapshot>();
  private active: Promise<void> | null = null;

  constructor(
    private save: (chatId: string, content: string) => Promise<void>,
    private saved: (snapshot: DraftSnapshot) => void,
    private failed: (error: unknown) => void,
    private busy: (value: boolean) => void,
  ) {}

  enqueue(snapshot: DraftSnapshot) {
    this.pending.set(snapshot.chatId, snapshot);
    this.start();
  }

  async flush() {
    while (this.active) await this.active;
  }

  private start() {
    if (this.active) return;
    this.busy(true);
    this.active = this.drain().finally(() => {
      this.active = null;
      // An edit can arrive between drain resolving and this finalizer.
      if (this.pending.size) this.start();
      else this.busy(false);
    });
  }

  private async drain() {
    while (this.pending.size) {
      const snapshot = this.pending.values().next().value!;
      this.pending.delete(snapshot.chatId);
      try {
        await this.save(snapshot.chatId, snapshot.content);
        this.saved(snapshot);
      } catch (error) {
        this.failed(error);
      }
    }
  }
}
