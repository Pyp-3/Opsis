// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TERMINAL_PIPELINE_EXAMPLE } from '@opsis/schema';
import type { ProcessFailure } from '@opsis/engine';
import { TerminalDetails } from './TerminalDetails';

afterEach(cleanup);

describe('TerminalDetails', () => {
  it('shows a step failure instead of the model preview while other steps succeed', () => {
    const step = TERMINAL_PIPELINE_EXAMPLE.nodes[2]!.terminal!;
    const failure: ProcessFailure = {
      status: 'failed',
      id: 'sorted',
      error: {
        code: 'output_too_long',
        message: 'Calculated output is limited to 1000 characters. Shorten the sample.',
      },
    };
    render(
      <TerminalDetails
        step={step}
        failure={failure}
        calculation={{ status: 'ready', results: new Map(), failures: new Map(), message: '' }}
      />,
    );
    expect(screen.getByText(failure.error.message)).toBeTruthy();
    expect(screen.queryByText(step.output.replace(/\r?\n$/, ''))).toBeNull();
    expect(screen.queryByText(step.success)).toBeNull();
  });
});
