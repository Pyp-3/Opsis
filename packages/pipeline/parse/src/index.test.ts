import { describe, expect, it } from 'vitest';
import * as parse from './index';

describe('@opsis/parse', () => {
  it('exposes its package name and public API', () => {
    expect(parse.PACKAGE_NAME).toBe('@opsis/parse');
    expect(typeof parse.parseUtterance).toBe('function');
    expect(typeof parse.ruleBasedParse).toBe('function');
    expect(typeof parse.MockLLMClient).toBe('function');
  });
});
