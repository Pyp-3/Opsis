import { useEffect, useState } from 'react';
import { VERBS, type AgentActivity as Activity } from './agentActivity';
import { usePrefersReducedMotion } from './Illustration';

/** The spark Claude Code spins while it works, growing then shrinking. */
const SPARK = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
/** How long each verb shows while the agent works silently. */
const VERB_MS = 3200;
/** Notes often arrive together; each gets a beat of its own so they read as steps. */
const NOTE_MS = 900;

function Spark({ still }: { still: boolean }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (still) return;
    const timer = setInterval(() => setFrame((current) => (current + 1) % SPARK.length), 120);
    return () => clearInterval(timer);
  }, [still]);
  return (
    <span className="activity-spark" aria-hidden="true">
      {still ? '✻' : SPARK[frame]}
    </span>
  );
}

/** Advances through the notes received so far, one at a time. */
function useRevealed(count: number, still: boolean) {
  const [shown, setShown] = useState(0);
  const target = still ? count : Math.min(count, shown + 1);
  useEffect(() => {
    if (shown >= count) return;
    // The first note shows straight away; later ones wait their turn.
    const timer = setTimeout(() => setShown(target), shown === 0 || still ? 0 : NOTE_MS);
    return () => clearTimeout(timer);
  }, [shown, count, target, still]);
  return shown;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const tokens = (count: number) =>
  count >= 1000 ? `${(count / 1000).toFixed(1)}k tokens` : `${count} tokens`;

/**
 * A live status line for an agent at work, like Claude Code's: a spinning spark, the step it
 * is on, how long it has taken and how much it has produced, with its earlier steps beneath.
 * It conveys progress only; the agent's private reasoning is never shown.
 */
export function AgentActivity({
  activity,
  elapsed,
  agent,
}: {
  activity: Activity;
  elapsed: number;
  agent: string;
}) {
  const still = usePrefersReducedMotion();
  const shown = useRevealed(activity.notes.length, still);
  const notes = activity.notes.slice(0, shown);
  const catchingUp = shown < activity.notes.length;
  // While nothing has been said, the verb moves on every few seconds from where it started.
  const verb =
    VERBS[(VERBS.indexOf(activity.verb) + Math.floor((elapsed * 1000) / VERB_MS)) % VERBS.length]!;
  const current =
    activity.phase === 'arranging'
      ? 'Arranging the canvas'
      : catchingUp || (!activity.note && activity.phase !== 'drafting')
        ? (notes.at(-1) ?? verb)
        : activity.note
          ? activity.note
          : activity.drafted?.latest
            ? `Drawing ${activity.drafted.latest}`
            : 'Drawing the diagram';
  const earlier = notes.filter((note) => note !== current).slice(-3);
  const drafted = activity.drafted && !catchingUp ? activity.drafted : null;
  const meta = [
    `${elapsed}s`,
    activity.thinking > 0 && `${tokens(activity.thinking)} estimated thinking`,
    drafted &&
      drafted.items > 0 &&
      [plural(drafted.items, 'object'), drafted.links > 0 && plural(drafted.links, 'link')]
        .filter(Boolean)
        .join(', '),
  ].filter(Boolean);
  return (
    <section className="agent-activity" aria-label={`${agent} is working`}>
      <p className="activity-line">
        <Spark still={still} />
        <span key={current} className="activity-headline">
          {current}…
        </span>
        <span className="activity-meta">({meta.join(' · ')})</span>
      </p>
      {earlier.length > 0 && (
        <ol className="activity-steps">
          {earlier.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ol>
      )}
      {/* Screen readers hear each step once, not every streamed word. */}
      <span className="sr-only" role="status">
        {notes.at(-1) ?? `${agent} is working`}
      </span>
    </section>
  );
}
