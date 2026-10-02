import type { TerminalStep } from '@opsis/schema';
import { Terminal, Check, CircleAlert } from 'lucide-react';
import type { ProcessResult } from '@opsis/engine';
import type { ProcessState } from './useProcessEngine';

export function TerminalDetails({
  step,
  result,
  calculation,
}: {
  step: TerminalStep;
  result?: ProcessResult | undefined;
  calculation?: ProcessState;
}) {
  const waiting = calculation && calculation.status !== 'ready';
  const sampleInput = result ? result.input : waiting ? '' : step.exampleInput;
  const output = result
    ? result.output || '(empty)'
    : waiting
      ? calculation.status === 'failed'
        ? calculation.message
        : 'Calculating sample…'
      : step.output;
  return (
    <section className="terminal-details" aria-label="Terminal step expectations">
      <div className="terminal-window">
        <div className="terminal-titlebar">
          <Terminal size={14} aria-hidden />
          <span>Example output</span>
          <small>{result ? 'Calculated' : 'Preview'}</small>
        </div>
        <div className="terminal-transcript">
          <div className="terminal-input">
            <span>input</span>
            <code>{result ? `${result.inputRows} example lines` : step.input}</code>
          </div>
          {sampleInput && (
            <details className="terminal-sample-input">
              <summary>Sample input</summary>
              <pre>{sampleInput}</pre>
            </details>
          )}
          <div className="terminal-command">
            <span aria-hidden>$</span>
            <code>{step.command}</code>
          </div>
          <pre className="terminal-output">{output.replace(/\r?\n$/, '')}</pre>
          {!waiting && (
            <div className="terminal-success">
              <Check size={13} aria-hidden />
              <code>
                {result ? `${result.inputRows} → ${result.outputRows} lines` : step.success}
              </code>
            </div>
          )}
        </div>
      </div>
      <p className="terminal-environment">{step.environment}</p>
      {step.issues.length > 0 && (
        <div className="terminal-failures">
          <h3>
            <CircleAlert size={14} aria-hidden /> Failure paths
          </h3>
          {step.issues.map((issue) => (
            <details className="terminal-issue" key={issue.symptom}>
              <summary>{issue.symptom}</summary>
              <div className="terminal-recovery">
                <code className="terminal-error">! {issue.symptom}</code>
                <code className="terminal-cause"># {issue.cause}</code>
                <code className="terminal-remedy">↳ {issue.remedy}</code>
              </div>
            </details>
          ))}
        </div>
      )}
      <p className="terminal-explanation-note">Example data · no commands executed</p>
    </section>
  );
}
