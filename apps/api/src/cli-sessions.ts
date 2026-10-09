import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sessionDirectory } from './harness/client.js';
import {
  parseSessionTranscripts,
  type SessionStore,
  type SessionTranscript,
} from './harness/sessions.js';

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

/** Where each CLI keeps its saved sessions; the same defaults and overrides the CLIs use. */
export type TranscriptHomes = { claude: string; codex: string };
export const defaultTranscriptHomes = (): TranscriptHomes => ({
  claude: process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'),
  codex: process.env.CODEX_HOME || join(homedir(), '.codex'),
});

/** Removes deleted threads' native sessions; see `removeThreadSessions`. */
export type ThreadSessionCleaner = (keys: readonly string[]) => Promise<void>;

export function fileThreadSessionCleaner(
  root: string,
  homes: TranscriptHomes = defaultTranscriptHomes(),
): ThreadSessionCleaner {
  return async (keys) => {
    for (const key of keys) await removeThreadSessions(root, key, homes).catch(() => 0);
  };
}

/**
 * Removes a deleted thread's native CLI sessions: each transcript its state lists, in the CLI's
 * own store, and then the thread's working directory. Only files named by a recorded session id
 * are touched, so the reader's own CLI sessions are never affected. Returns how many sessions
 * had files removed.
 */
export async function removeThreadSessions(root: string, key: string, homes: TranscriptHomes) {
  const directory = sessionDirectory(root, key);
  const state = await readFile(join(directory, 'session.json'), 'utf8').catch(() => null);
  let removed = 0;
  for (const transcript of parseSessionTranscripts(state))
    if (
      transcript.provider === 'claude'
        ? await removeClaudeSession(homes.claude, transcript.id)
        : await removeCodexSession(homes.codex, transcript)
    )
      removed++;
  await rm(directory, { recursive: true, force: true });
  return removed;
}

const names = (directory: string) => readdir(directory).catch((): string[] => []);

/** Removes `path` when it exists; reports whether it did. */
async function removePath(path: string) {
  try {
    await rm(path, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Claude saves a session as `projects/<directory>/<id>.jsonl`, with a folder of the same id for
 * its tool results, plus per-session folders and to-do files elsewhere in its home.
 */
async function removeClaudeSession(home: string, id: string) {
  let removed = false;
  const projects = join(home, 'projects');
  for (const project of await names(projects)) {
    removed = (await removePath(join(projects, project, `${id}.jsonl`))) || removed;
    removed = (await removePath(join(projects, project, id))) || removed;
  }
  for (const folder of ['file-history', 'session-env'])
    removed = (await removePath(join(home, folder, id))) || removed;
  for (const name of await names(join(home, 'todos')))
    if (name.startsWith(`${id}-`))
      removed = (await removePath(join(home, 'todos', name))) || removed;
  return removed;
}

/**
 * Codex saves a session as `sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl` under the local date
 * it started. The recorded day and its neighbours are searched; an older record without a day
 * searches every date folder.
 */
async function removeCodexSession(home: string, transcript: SessionTranscript) {
  const sessions = join(home, 'sessions');
  const days = transcript.day ? nearbyDays(transcript.day) : await everyDay(sessions);
  let removed = false;
  for (const day of days) {
    const folder = join(sessions, ...day);
    for (const name of await names(folder))
      if (name.startsWith('rollout-') && name.endsWith(`-${transcript.id}.jsonl`))
        removed = (await removePath(join(folder, name))) || removed;
  }
  return removed;
}

function nearbyDays(day: string): string[][] {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return [-1, 0, 1].map((offset) => {
    const at = new Date(year, month - 1, date + offset);
    const pad = (value: number) => String(value).padStart(2, '0');
    return [String(at.getFullYear()), pad(at.getMonth() + 1), pad(at.getDate())];
  });
}

async function everyDay(sessions: string): Promise<string[][]> {
  const days: string[][] = [];
  for (const year of await names(sessions))
    for (const month of await names(join(sessions, year)))
      for (const date of await names(join(sessions, year, month))) days.push([year, month, date]);
  return days;
}
