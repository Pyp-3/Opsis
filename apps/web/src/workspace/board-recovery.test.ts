// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EMAIL_DEMO, type BoardSnapshot } from '@opsis/schema';

const snapshot: BoardSnapshot = {
  board: { ...EMAIL_DEMO, version: 2, agent: 'demo', positions: {} },
  past: [],
  future: [],
};
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

it('isolates recovery between accounts and never adopts the pre-account browser board', async () => {
  const { setRecoveryScope, writeRecovery, restoreLibrary } = await import('./board-recovery');
  localStorage.setItem('opsis:board:v2', JSON.stringify(snapshot.board));
  const entry = { id: crypto.randomUUID(), revision: 1, snapshot };
  setRecoveryScope('one');
  expect(restoreLibrary().snapshot.board).toBeNull();
  writeRecovery(entry);
  setRecoveryScope('two');
  expect(restoreLibrary().snapshot.board).toBeNull();
  setRecoveryScope('one');
  expect(restoreLibrary().id).toBe(entry.id);
});

it('prefers this tab’s unsaved recovery over a different tab’s local copy', async () => {
  const { writeRecovery, restoreLibrary } = await import('./board-recovery');
  const entry = { id: crypto.randomUUID(), revision: 1, snapshot };
  writeRecovery(entry);
  localStorage.setItem('opsis:library-recovery:v1', JSON.stringify({ ...entry, revision: 8 }));
  expect(restoreLibrary().revision).toBe(1);
});

it('retains corrupt recovery data and reports the problem', async () => {
  const { restoreLibrary } = await import('./board-recovery');
  sessionStorage.setItem('opsis:library-recovery:v1', 'not-json');
  expect(restoreLibrary().error).toContain('has not been overwritten');
  expect(sessionStorage.getItem('opsis:library-recovery:v1')).toBe('not-json');
});

it('saves to local storage if this tab’s storage is full', async () => {
  const { writeRecovery } = await import('./board-recovery');
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (this === sessionStorage) throw new Error('full');
    return setItem.call(this, key, value);
  });
  writeRecovery({ snapshot });
  expect(localStorage.getItem('opsis:library-recovery:v1')).toBe(JSON.stringify({ snapshot }));
});

it('reports failure if neither recovery store can accept a write', async () => {
  const { writeRecovery } = await import('./board-recovery');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('full');
  });
  expect(() => writeRecovery({ snapshot })).toThrow(
    'Browser recovery storage is full or unavailable.',
  );
});
