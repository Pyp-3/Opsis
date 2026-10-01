/** Progress events the API relays from an agent's CLI while it works. */
export type AgentProgress =
  | { type: 'phase'; phase: 'starting' | 'thinking' | 'writing' | 'drafting' }
  | { type: 'thinking'; tokens: number }
  | { type: 'note'; text: string; done: boolean }
  | { type: 'drafting'; items: number; links: number; latest: string | null };

/** What the live status line shows. */
export type AgentActivity = {
  phase: 'waiting' | 'starting' | 'thinking' | 'writing' | 'drafting' | 'arranging';
  /** A verb for the wait before the agent says anything, chosen once per request. */
  verb: string;
  thinking: number;
  /** Finished notes, oldest first. */
  notes: string[];
  /** The note being written now. */
  note: string | null;
  drafted: { items: number; links: number; latest: string | null } | null;
};

/** Verbs for the wait while the agent works silently; they rotate to show it is still busy. */
export const VERBS = [
  'Envisioning',
  'Sketching',
  'Diagramming',
  'Mapping',
  'Tracing',
  'Picturing',
  'Untangling',
  'Connecting',
  'Charting',
  'Considering',
];

export function startActivity(random = Math.random): AgentActivity {
  return {
    phase: 'waiting',
    verb: VERBS[Math.floor(random() * VERBS.length)]!,
    thinking: 0,
    notes: [],
    note: null,
    drafted: null,
  };
}

export function applyProgress(activity: AgentActivity, progress: AgentProgress): AgentActivity {
  switch (progress.type) {
    case 'phase':
      return { ...activity, phase: progress.phase };
    case 'thinking':
      return { ...activity, thinking: Math.max(activity.thinking, progress.tokens) };
    case 'note':
      return progress.done
        ? {
            ...activity,
            notes:
              activity.notes.at(-1) === progress.text
                ? activity.notes
                : [...activity.notes, progress.text],
            note: null,
          }
        : { ...activity, note: progress.text };
    case 'drafting':
      return { ...activity, phase: 'drafting', drafted: progress };
  }
}

type Result = { ok: boolean; status: number; body: Record<string, unknown> };

/**
 * Reads an agent route's response. Streamed responses deliver progress line by line before
 * the result; a plain JSON response (or an older server) is read as before.
 */
export async function agentResponse(
  response: Response,
  onProgress: (progress: AgentProgress) => void,
): Promise<Result> {
  const streamed = response.headers?.get?.('content-type')?.includes('application/x-ndjson');
  if (!streamed || !response.body) {
    const body = (await response.json()) as Record<string, unknown>;
    return { ok: response.ok, status: response.status, body };
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';
  for (;;) {
    const { value, done } = await reader.read();
    const lines = (pending + (value ?? '')).split('\n');
    pending = done ? '' : (lines.pop() ?? '');
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as
        | { type: 'progress'; progress: AgentProgress }
        | { type: 'result'; status: number; body: Record<string, unknown> };
      if (event.type === 'progress') onProgress(event.progress);
      else return { ok: event.status < 400, status: event.status, body: event.body };
    }
    if (done) throw new Error('The agent’s response ended unexpectedly.');
  }
}

/** Asks agent routes to stream progress, falling back to JSON where they cannot. */
export const STREAM_ACCEPT = 'application/x-ndjson, application/json';
