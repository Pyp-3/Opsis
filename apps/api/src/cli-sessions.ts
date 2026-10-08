import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sessionDirectory } from './harness/client.js';
import type { SessionStore } from './harness/sessions.js';

/**
 * Chat threads' native CLI session state, kept beside each thread's working directory. The
 * harness itself never reads files; this store holds only Opsis's own record of which session
 * to resume, never anything the CLI writes.
 */
export function fileSessionStore(root: string): SessionStore {
  const file = (key: string) => join(sessionDirectory(root, key), 'session.json');
  return {
    read: (key) =>
      readFile(file(key), 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      }),
    async write(key, state) {
      await mkdir(sessionDirectory(root, key), { recursive: true, mode: 0o700 });
      await writeFile(file(key), state, { mode: 0o600 });
    },
    clear: (key) => rm(file(key), { force: true }),
  };
}
