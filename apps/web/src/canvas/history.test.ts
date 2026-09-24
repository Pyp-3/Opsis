import { describe, expect, it } from 'vitest';
import { SnapshotHistory } from './history';

describe('SnapshotHistory', () => {
  it('undoes and redoes more than 50 edits in order', () => {
    const history = new SnapshotHistory(0, 100);
    for (let value = 1; value <= 60; value += 1) history.push(value);
    for (let value = 59; value >= 0; value -= 1) expect(history.undo()).toBe(value);
    expect(history.undo()).toBeUndefined();
    for (let value = 1; value <= 60; value += 1) expect(history.redo()).toBe(value);
    expect(history.redo()).toBeUndefined();
  });

  it('bounds history and clears redo after a new edit', () => {
    const history = new SnapshotHistory(0, 50);
    for (let value = 1; value <= 60; value += 1) history.push(value);
    for (let count = 0; count < 50; count += 1) expect(history.undo()).toBeDefined();
    expect(history.current()).toBe(10);
    expect(history.undo()).toBeUndefined();
    history.redo();
    history.push(99);
    expect(history.redo()).toBeUndefined();
  });
});
