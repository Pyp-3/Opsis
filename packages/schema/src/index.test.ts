import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index';

describe('@opsis/schema', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@opsis/schema');
  });
});
