import type { ProcessResult } from '@opsis/engine';
import { usePrefersReducedMotion } from './Illustration';

/** The data transformation and its paths come from the engine; the browser only draws them. */
export function ProcessDataView({
  result,
  command,
  animate = false,
}: {
  result: ProcessResult;
  command: string;
  animate?: boolean;
}) {
  const still = usePrefersReducedMotion();
  return (
    <section className="process-data" aria-label="Calculated sample flow">
      <header>
        <code>{command}</code>
        <span>
          {result.inputRows} → {result.outputRows} lines
        </span>
      </header>
      <div className="process-data-labels">
        <small>
          {result.inputs.length > 1 ? `${result.inputs.length} inputs, stacked` : 'Input'}
        </small>
        <span />
        <small>Output</small>
      </div>
      <div className="process-data-scroll">
        <div className="process-data-columns">
          <div>
            <pre>{result.input ? result.input.replace(/\r?\n$/, '') : '(empty)'}</pre>
          </div>
          <svg
            viewBox={`0 0 120 ${result.drawing.height}`}
            height={result.drawing.height * 1.4}
            preserveAspectRatio="none"
            aria-label={`${result.outputRows} lines passed through; ${result.inputRows - result.outputRows} stopped`}
            role="img"
          >
            {result.drawing.paths.map((trace, index) => (
              <g key={index} className={trace.kept ? 'data-kept' : 'data-stopped'}>
                <path d={trace.d} fill="none" stroke="currentColor" strokeWidth="1.5" />
                <circle cx={6} cy={9 + index * 10} r={2} fill="currentColor" />
                {trace.kept && animate && !still && (
                  <circle r={2} fill="currentColor">
                    <animateMotion
                      path={trace.d}
                      dur="1.6s"
                      begin={`${index * 0.08}s`}
                      repeatCount="indefinite"
                    />
                  </circle>
                )}
              </g>
            ))}
          </svg>
          <div>
            <pre>{result.output ? result.output.replace(/\r?\n$/, '') : '(empty)'}</pre>
          </div>
        </div>
      </div>
      <footer>Example data · calculated</footer>
    </section>
  );
}
