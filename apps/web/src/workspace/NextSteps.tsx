import { useId } from 'react';
import { ChevronDown, Lightbulb, X } from 'lucide-react';
import { useRememberedOpen } from './useRememberedOpen';

export type NextStep = { label: string; prompt: string };

export const RETURN_PATHS: NextStep = {
  label: 'Show return paths',
  prompt:
    'Audit the actual interactions in this diagram. Add genuine response, acknowledgment, feedback or retry edges to their actual recipients, with explicit kinds and labels. Do not invent reverse flows. Preserve unrelated content and IDs; explain any necessary correction to existing relationships.',
};

/**
 * Suggested follow-ups, tucked behind one small toggle so they never cover the diagram.
 * Whether the list is open is remembered between visits.
 */
export function NextSteps({
  suggestions,
  onPick,
}: {
  suggestions: NextStep[];
  onPick: (step: NextStep) => void;
}) {
  const [open, setOpen] = useRememberedOpen('opsis:next-steps-open', false);
  const panel = useId();
  if (!suggestions.length) return null;
  return (
    <div
      className={`next-steps ${open ? 'is-open' : ''}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      {open && (
        <div className="next-steps-panel" id={panel} role="group" aria-label="Next steps">
          <div className="next-steps-head">
            <span>What to explore next</span>
            <button aria-label="Hide next steps" onClick={() => setOpen(false)}>
              <X size={14} />
            </button>
          </div>
          <ul>
            {suggestions.map((step) => (
              <li key={step.label}>
                <button
                  onClick={() => {
                    setOpen(false);
                    onPick(step);
                  }}
                >
                  {step.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        className="next-steps-toggle"
        aria-expanded={open}
        aria-controls={open ? panel : undefined}
        onClick={() => setOpen(!open)}
      >
        <Lightbulb size={13} aria-hidden />
        Next steps
        <span className="next-steps-count">{suggestions.length}</span>
        <ChevronDown className="chevron" size={13} aria-hidden />
      </button>
    </div>
  );
}
