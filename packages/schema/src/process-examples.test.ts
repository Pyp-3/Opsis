import { describe, it, expect } from 'vitest';
import { BoardGraphSchema, PROCESS_EXAMPLES } from './index';

describe('process examples', () => {
  it('ships valid reusable examples', () => {
    for (const example of PROCESS_EXAMPLES)
      expect(BoardGraphSchema.safeParse(example).success, example.title).toBe(true);
  });
});
