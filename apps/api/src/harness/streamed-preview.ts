import {
  AgentDrawingSchema,
  BoardNodeSchema,
  MAX_AGENT_DRAWINGS,
  type AgentProgress,
} from '@opsis/schema';

/** Where in the answer each kind of previewed object sits: an array, by its key path. */
const PREVIEWED: Record<string, 'node' | 'drawing'> = {
  nodes: 'node',
  drawings: 'drawing',
  'sketchEdits.put': 'drawing',
};
const LIMITS = { node: 50, drawing: MAX_AGENT_DRAWINGS };

type Container = { kind: 'object' | 'array'; path: string };

/**
 * A bounded, one-pass scanner of complete objects in the answer's concept and sketch lists, so
 * they can be shown while the rest streams. Each object is validated on its own; partial JSON
 * never reaches a renderer, and the whole answer is still checked when it completes. A drawing
 * that arrives again with the same id (a replacement) is sent again.
 */
export class StreamedPreview {
  private stack: Container[] = [];
  private string = false;
  private escaped = false;
  private token = '';
  private key = '';
  private expectKey = false;
  private object = '';
  private collecting: 'node' | 'drawing' | null = null;
  private collectDepth = 0;
  private bytes = 0;
  private nodes = new Set<string>();
  private drawings = new Set<string>();
  add(chunk: string): AgentProgress[] {
    this.bytes += chunk.length;
    if (this.bytes > 2_000_000) return [];
    const found: AgentProgress[] = [];
    for (const char of chunk) {
      if (this.collecting) this.object += char;
      if (this.string) {
        if (this.escaped) {
          this.escaped = false;
          this.token += char;
        } else if (char === '\\') {
          this.escaped = true;
          this.token += char;
        } else if (char === '"') {
          this.string = false;
          if (this.expectKey) this.key = this.token;
        } else this.token += char;
        continue;
      }
      const top = this.stack.at(-1);
      if (char === '"') {
        this.string = true;
        this.token = '';
      } else if (char === ':') this.expectKey = false;
      else if (char === ',') this.expectKey = top?.kind === 'object';
      else if (char === '{' || char === '[') {
        // A container's path is its parent's plus the key it is under; array items add nothing.
        const path =
          top?.kind === 'object'
            ? top.path
              ? `${top.path}.${this.key}`
              : this.key
            : (top?.path ?? '');
        const kind = char === '{' ? 'object' : 'array';
        if (kind === 'object' && top?.kind === 'array' && !this.collecting) {
          const previewed = PREVIEWED[top.path];
          if (previewed) {
            this.collecting = previewed;
            this.collectDepth = this.stack.length;
            this.object = '{';
          }
        }
        this.stack.push({ kind, path: this.stack.length ? path : '' });
        this.expectKey = kind === 'object';
      } else if (char === '}' || char === ']') {
        this.stack.pop();
        if (char === '}' && this.collecting && this.stack.length === this.collectDepth) {
          const event = this.read(this.collecting, this.object);
          if (event) found.push(event);
          this.collecting = null;
          this.object = '';
        }
        this.expectKey = false;
      }
    }
    return found;
  }

  private read(kind: 'node' | 'drawing', text: string): AgentProgress | null {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return null; // Invalid fragments wait for the final validation and repair.
    }
    if (kind === 'node') {
      const parsed = BoardNodeSchema.safeParse(value);
      if (!parsed.success || this.nodes.size >= LIMITS.node || this.nodes.has(parsed.data.id))
        return null;
      this.nodes.add(parsed.data.id);
      return { type: 'node', node: parsed.data };
    }
    const parsed = AgentDrawingSchema.safeParse(value);
    if (!parsed.success) return null;
    if (!this.drawings.has(parsed.data.id) && this.drawings.size >= LIMITS.drawing) return null;
    this.drawings.add(parsed.data.id);
    return { type: 'drawing', drawing: parsed.data };
  }
}
