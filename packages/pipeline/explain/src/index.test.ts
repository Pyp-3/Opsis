import { describe, expect, it } from 'vitest';
import { drilldown, explain, PACKAGE_NAME } from './index';

describe('@opsis/explain', () => {
  it('exposes its package name and the stage-5 entry points', () => {
    expect(PACKAGE_NAME).toBe('@opsis/explain');
    expect(typeof explain).toBe('function');
    expect(typeof drilldown).toBe('function');
  });
});
