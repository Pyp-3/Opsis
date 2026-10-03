import { type BoardSnapshot } from '@opsis/schema';
import { z } from 'zod';
import { restoreBoard } from './model';
import { BoardEntrySchema } from './board-library-api';

const RECOVERY_BASE = 'opsis:library-recovery:v1';
/** Recovery copies are kept per account, so people sharing a browser never see each other's. */
let RECOVERY = RECOVERY_BASE;
let scoped = false;
export function setRecoveryScope(userId: string) {
  RECOVERY = `${RECOVERY_BASE}:${userId}`;
  scoped = true;
}
export function writeRecovery(value: unknown) {
  const text = JSON.stringify(value);
  // A per-tab copy prevents another tab from replacing unsaved recovery data.
  let saved = false;
  for (const storage of [sessionStorage, localStorage]) {
    try {
      storage.setItem(RECOVERY, text);
      saved = true;
    } catch {
      /* Try the other store. */
    }
  }
  if (!saved) throw new Error('Browser recovery storage is full or unavailable.');
}
export function restoreLibrary(): z.infer<typeof BoardEntrySchema> & { error: string } {
  try {
    const raw = sessionStorage.getItem(RECOVERY) ?? localStorage.getItem(RECOVERY);
    if (raw) return { ...BoardEntrySchema.parse(JSON.parse(raw)), error: '' };
    return {
      id: crypto.randomUUID(),
      revision: 0,
      // The pre-library browser board belongs to whoever used this browser before accounts.
      snapshot: { board: scoped ? null : restoreBoard(), past: [], future: [] } as BoardSnapshot,
      error: '',
    };
  } catch {
    return {
      id: crypto.randomUUID(),
      revision: 0,
      snapshot: { board: null, past: [], future: [] } as BoardSnapshot,
      error:
        'Saved recovery data could not be read. It has not been overwritten. Import a backup to continue.',
    };
  }
}
