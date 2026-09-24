/** A bounded snapshot history. The current value is not counted as an undo step. */
export class SnapshotHistory<T> {
  private readonly past: T[] = [];
  private readonly future: T[] = [];

  constructor(
    private currentValue: T,
    private readonly limit = 100,
  ) {
    if (!Number.isInteger(limit) || limit < 50) {
      throw new Error('history limit must retain at least 50 steps');
    }
  }

  /** The snapshot currently shown. */
  current(): T {
    return this.currentValue;
  }

  /** Records a new snapshot and invalidates the redo branch. */
  push(next: T): void {
    this.past.push(this.currentValue);
    if (this.past.length > this.limit) this.past.shift();
    this.currentValue = next;
    this.future.length = 0;
  }

  /** Restores the previous snapshot, if any. */
  undo(): T | undefined {
    const previous = this.past.pop();
    if (previous === undefined) return undefined;
    this.future.push(this.currentValue);
    this.currentValue = previous;
    return previous;
  }

  /** Restores the next snapshot, if any. */
  redo(): T | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(this.currentValue);
    this.currentValue = next;
    return next;
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }
}
