import { BoardNodeSchema, type BoardDocument } from '@opsis/schema';

/** A bounded, one-pass scanner of complete objects in the root nodes array.
 * Partial JSON never reaches a renderer; full graph references are checked at completion. */
export class StreamedNodes {
  private depth = 0;
  private string = false;
  private escaped = false;
  private token = '';
  private key = '';
  private inNodes = false;
  private object = '';
  private collecting = false;
  private bytes = 0;
  private seen = new Set<string>();
  add(chunk: string): BoardDocument['nodes'] {
    this.bytes += chunk.length;
    if (this.bytes > 2_000_000) return [];
    const nodes: BoardDocument['nodes'] = [];
    for (const char of chunk) {
      if (this.collecting) this.object += char;
      if (this.string) {
        if (this.escaped) {
          this.escaped = false;
          this.token += char;
          continue;
        }
        if (char === '\\') {
          this.escaped = true;
          this.token += char;
          continue;
        }
        if (char === '"') {
          this.string = false;
          if (this.depth === 1) this.key = this.token;
        } else this.token += char;
        continue;
      }
      if (char === '"') {
        this.string = true;
        this.token = '';
        continue;
      }
      if (char === '[' || char === '{') {
        if (char === '[' && this.depth === 1) this.inNodes = this.key === 'nodes';
        if (char === '{' && this.inNodes && this.depth === 2) {
          this.collecting = true;
          this.object = '{';
        }
        this.depth++;
      } else if (char === ']' || char === '}') {
        this.depth--;
        if (char === '}' && this.depth === 2 && this.collecting) {
          this.collecting = false;
          try {
            const parsed = BoardNodeSchema.safeParse(JSON.parse(this.object));
            if (parsed.success && this.seen.size < 50 && !this.seen.has(parsed.data.id)) {
              this.seen.add(parsed.data.id);
              nodes.push(parsed.data);
            }
          } catch {
            /* Invalid fragments wait for the final validation/repair. */
          }
          this.object = '';
        }
        if (this.depth === 1) this.inNodes = false;
      }
    }
    return nodes;
  }
}
