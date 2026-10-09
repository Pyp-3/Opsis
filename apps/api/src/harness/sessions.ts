import { HarnessError } from './errors.js';
import type { HarnessProvider } from './types.js';

/**
 * Native CLI sessions for chat threads. Claude and Codex can save a conversation and resume it,
 * so a chat thread keeps the agent's full context rather than only its recent messages and
 * notes. Each thread has its own working directory, derived by the server from the signed-in
 * account and the thread, so one account can never resume another's session. The CLI keeps the
 * transcript in its own store; Opsis keeps which session to resume, how many turns it has had,
 * and every session the thread has used (`transcripts`), so deleting the thread can remove those
 * transcripts too. Sessions are replaced after `MAX_SESSION_TURNS` turns, when the thread's notes
 * carry the context forward, so resumed context and cost stay bounded.
 */

export const MAX_SESSION_TURNS = 16;
export const SESSION_PROVIDERS: readonly HarnessProvider[] = ['claude', 'codex'];

export type NativeSessionState = {
  provider: HarnessProvider;
  model: string;
  id: string;
  turns: number;
};
/**
 * A CLI session a thread has used, kept after the thread moves on to a new one. `day` is the
 * local date it started, where Codex files its transcript; older records may lack it.
 */
export type SessionTranscript = { provider: HarnessProvider; id: string; day?: string };
/** Enough for 2,000 turns; a thread condenses long before that. */
export const MAX_SESSION_TRANSCRIPTS = 128;
/** How one run uses the thread's session: start one (Codex names its own) or resume it. */
export type SessionPlan = { id?: string; resume: boolean; turns: number };

/** Where a host keeps each thread's session state. Keys come from `sessionKey`. */
export type SessionStore = {
  read(key: string): Promise<string | null>;
  write(key: string, state: string): Promise<void>;
  clear(key: string): Promise<void>;
};

const SEGMENT = /^[A-Za-z0-9_-]{1,80}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** The server-side key for an account's thread, or undefined when either is unusable. */
export function sessionKey(account: string | undefined, thread: string | undefined) {
  if (!account || !thread || !SEGMENT.test(account) || !UUID.test(thread)) return undefined;
  return `${account}/${thread.toLowerCase()}`;
}

/** Validates a key before a host turns it into a directory. */
export function sessionKeyParts(key: string): [string, string] {
  const parts = key.split('/');
  if (parts.length !== 2 || !parts.every((part) => SEGMENT.test(part)))
    throw new HarnessError('harness_config');
  return parts as [string, string];
}

export function parseSessionState(text: string | null): NativeSessionState | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Partial<NativeSessionState>;
    if (
      typeof value.provider === 'string' &&
      SESSION_PROVIDERS.includes(value.provider) &&
      typeof value.model === 'string' &&
      typeof value.id === 'string' &&
      UUID.test(value.id) &&
      Number.isInteger(value.turns) &&
      value.turns! >= 0
    )
      return value as NativeSessionState;
  } catch {
    // An unreadable state starts a new session.
  }
  return null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Every CLI session a thread's state records, including the one it would resume. Unreadable
 * entries are skipped; the result names only validated providers and ids, since a host deletes
 * files by them.
 */
export function parseSessionTranscripts(text: string | null): SessionTranscript[] {
  if (!text) return [];
  let value: { transcripts?: unknown };
  try {
    value = JSON.parse(text) as typeof value;
  } catch {
    return [];
  }
  const listed = (Array.isArray(value?.transcripts) ? value.transcripts : []).flatMap(
    (item: Partial<SessionTranscript>) =>
      item &&
      typeof item.provider === 'string' &&
      SESSION_PROVIDERS.includes(item.provider) &&
      typeof item.id === 'string' &&
      UUID.test(item.id)
        ? [
            {
              provider: item.provider,
              id: item.id,
              ...(typeof item.day === 'string' && DAY.test(item.day) ? { day: item.day } : {}),
            },
          ]
        : [],
  );
  const current = parseSessionState(text);
  return current
    ? recordTranscript(listed, { provider: current.provider, id: current.id })
    : listed;
}

/** Adds a session unless it is already recorded (keeping the day it started), within the bound. */
function recordTranscript(list: SessionTranscript[], transcript: SessionTranscript) {
  if (list.some((item) => item.provider === transcript.provider && item.id === transcript.id))
    return list;
  return [...list, transcript].slice(-MAX_SESSION_TRANSCRIPTS);
}

function localDay(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Resume the thread's session when it belongs to this provider and model and has room. */
export function planSession(
  provider: HarnessProvider,
  model: string,
  state: NativeSessionState | null,
  freshId: string,
): SessionPlan {
  if (
    state &&
    state.provider === provider &&
    state.model === model &&
    state.turns < MAX_SESSION_TURNS
  )
    return { id: state.id, resume: true, turns: state.turns };
  return provider === 'claude'
    ? { id: freshId, resume: false, turns: 0 }
    : { resume: false, turns: 0 };
}

/** The session a run created, from its streamed events. */
export function sessionIdFrom(provider: HarnessProvider, stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/u)) {
    if (!line.includes(provider === 'codex' ? 'thread.started' : 'session_id')) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const id = provider === 'codex' ? event.thread_id : event.session_id;
      if (typeof id === 'string' && UUID.test(id)) return id;
    } catch {
      // Not an event line.
    }
  }
  return null;
}

/**
 * Runs one CLI turn within the thread's session. A failed resume forgets the session and says
 * so; the next message starts a new session with the thread's notes. Nothing is retried here.
 * Every session used stays listed in the state, so deleting the thread can remove it.
 */
export async function withNativeSession(
  options: {
    provider: HarnessProvider;
    model: string;
    key: string | undefined;
    store: SessionStore;
    freshId: () => string;
    /** The local date, `YYYY-MM-DD`; tests fix it. */
    today?: () => string;
  },
  run: (plan: SessionPlan | null) => Promise<string>,
): Promise<string> {
  const { provider, model, key, store } = options;
  if (!key || !SESSION_PROVIDERS.includes(provider)) return run(null);
  const text = await store.read(key);
  const previous = parseSessionState(text);
  let transcripts = parseSessionTranscripts(text);
  const plan = planSession(provider, model, previous, options.freshId());
  const day = (options.today ?? localDay)();
  const save = async (state: NativeSessionState | null) => {
    if (!state && !transcripts.length) return store.clear(key);
    await store.write(key, JSON.stringify({ ...state, transcripts }));
  };
  // A new Claude session is named before it runs, so even a failed first turn is listed.
  if (plan.id && !plan.resume) {
    transcripts = recordTranscript(transcripts, { provider, id: plan.id, day });
    await save(previous);
  }
  let stdout: string;
  try {
    stdout = await run(plan);
  } catch (error) {
    if (plan.resume && error instanceof HarnessError && error.code === 'harness_exit') {
      await save(null);
      throw new HarnessError('harness_session');
    }
    throw error;
  }
  const id = plan.resume || provider === 'claude' ? plan.id : sessionIdFrom(provider, stdout);
  if (id) {
    transcripts = recordTranscript(transcripts, { provider, id, day });
    await save({ provider, model, id, turns: plan.turns + 1 });
  } else await save(null);
  return stdout;
}
