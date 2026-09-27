// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelControls } from './ModelControls';
import { MODEL_SETTINGS_KEY, readModelPreferences } from './model-settings';

afterEach(() => {
  cleanup();
  localStorage.clear();
});
describe('model configuration', () => {
  it('defaults to economical models rather than account defaults', () => {
    expect(readModelPreferences()).toEqual({
      claude: { model: 'haiku', effort: 'low' },
      codex: { model: 'gpt-6-luna', effort: 'low' },
    });
  });
  it('restores separate settings for each provider', () => {
    localStorage.setItem(
      MODEL_SETTINGS_KEY,
      JSON.stringify({
        claude: { model: 'sonnet', effort: 'medium' },
        codex: { model: 'gpt-6-luna', effort: 'high' },
      }),
    );
    expect(readModelPreferences().claude).toEqual({ model: 'sonnet', effort: 'medium' });
    expect(readModelPreferences().codex.effort).toBe('high');
  });
  it('makes unsupported Haiku effort explicit', () => {
    render(
      <ModelControls
        agent="claude"
        value={{ model: 'haiku', effort: 'low' }}
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    expect((screen.getByLabelText('Reasoning effort') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText('Not supported by Haiku')).toBeDefined();
  });
  it('lets users independently change model and effort', () => {
    const change = vi.fn();
    render(
      <ModelControls
        agent="claude"
        value={{ model: 'sonnet', effort: 'medium' }}
        disabled={false}
        onChange={change}
      />,
    );
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'opus' } });
    expect(change).toHaveBeenLastCalledWith({ model: 'opus', effort: 'medium' });
    fireEvent.change(screen.getByLabelText('Reasoning effort'), { target: { value: 'low' } });
    expect(change).toHaveBeenLastCalledWith({ model: 'sonnet', effort: 'low' });
  });
});
