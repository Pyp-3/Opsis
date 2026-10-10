import {
  AgentDrawingSchema,
  BoardNodeSchema,
  MAX_AGENT_DRAWINGS,
  type AgentDrawing,
  type BoardDocument,
} from '@opsis/schema';
import { ReportedUsageSchema, type ReportedUsage } from '@opsis/schema';
import { AgentProgressSchema, type AgentProgress } from '@opsis/schema';
export type { AgentProgress } from '@opsis/schema';

/** What the live status line shows. */
export type AgentActivity = {
  phase: 'waiting' | 'starting' | 'thinking' | 'writing' | 'drafting' | 'arranging';
  /** A verb for the wait before the agent says anything, chosen once per request. */
  verb: string;
  thinking: number;
  usage: ReportedUsage[];
  nodes: BoardDocument['nodes'];
  /** Sketch drawings validated as they streamed in; provisional until the answer passes. */
  drawings: AgentDrawing[];
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
    usage: [],
    nodes: [],
    drawings: [],
    notes: [],
    note: null,
    drafted: null,
  };
}

export function applyProgress(activity: AgentActivity, progress: AgentProgress): AgentActivity {
  const checked = AgentProgressSchema.safeParse(progress);
  if (!checked.success) return activity;
  progress = checked.data;
  switch (progress.type) {
    case 'preview-reset':
      return { ...activity, nodes: [], drawings: [] };
    case 'drawing': {
      const parsed = AgentDrawingSchema.safeParse(progress.drawing);
      if (!parsed.success) return activity;
      const at = activity.drawings.findIndex((drawing) => drawing.id === parsed.data.id);
      // A drawing sent again replaces the earlier one, as a sketch edit does.
      if (at >= 0)
        return {
          ...activity,
          drawings: activity.drawings.map((drawing, i) => (i === at ? parsed.data : drawing)),
        };
      return activity.drawings.length < MAX_AGENT_DRAWINGS
        ? { ...activity, drawings: [...activity.drawings, parsed.data] }
        : activity;
    }
    case 'node': {
      const parsed = BoardNodeSchema.safeParse(progress.node);
      return parsed.success &&
        activity.nodes.length < 50 &&
        !activity.nodes.some((node) => node.id === parsed.data.id)
        ? { ...activity, nodes: [...activity.nodes, parsed.data] }
        : activity;
    }
    case 'usage': {
      const parsed = ReportedUsageSchema.safeParse(progress.usage);
      return parsed.success
        ? { ...activity, usage: [...activity.usage, parsed.data].slice(-10) }
        : activity;
    }
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
                : [...activity.notes, progress.text].slice(-50),
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
    if (pending.length + (value?.length ?? 0) > 20_000_000) {
      await reader.cancel();
      throw new Error('The agent response exceeded the stream limit.');
    }
    const lines = (pending + (value ?? '')).split('\n');
    pending = done ? '' : (lines.pop() ?? '');
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as
        | { type: 'progress'; progress: AgentProgress }
        | { type: 'result'; status: number; body: Record<string, unknown> };
      if (event.type === 'progress') {
        const parsed = AgentProgressSchema.safeParse(event.progress);
        if (parsed.success) onProgress(parsed.data);
      } else if (event.type === 'result')
        return { ok: event.status < 400, status: event.status, body: event.body };
    }
    if (done) throw new Error('The agent’s response ended unexpectedly.');
  }
}

/** Asks agent routes to stream progress, falling back to JSON where they cannot. */
export const STREAM_ACCEPT = 'application/x-ndjson, application/json';
