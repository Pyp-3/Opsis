import { apiFetch as fetch } from '../app-url';
import { useEffect, useState } from 'react';
import type { UsageRecord } from '@opsis/schema';
import { measuredLabel, usageByCollection, type UsageGroup } from './usage-summary';

const tokens = new Intl.NumberFormat('en-GB');
const dollars = (value: number) => `$${value.toFixed(4)}`;

/** Reported usage grouped by each board's current collection. Costs are CLI estimates only. */
export function UsageByCollection({ usage }: { usage: UsageRecord[] }) {
  const [groups, setGroups] = useState<UsageGroup[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    Promise.all([fetch('/v1/boards'), fetch('/v1/collections')])
      .then(async ([boards, collections]) => {
        if (!boards.ok || !collections.ok) throw new Error('Could not load your collections.');
        const grouped = usageByCollection(
          usage,
          (await boards.json()) as { id: string; collectionId?: string | null }[],
          (await collections.json()) as { id: string; name: string }[],
        );
        if (live) setGroups(grouped);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [usage]);
  if (!usage.length) return null;
  return (
    <section className="usage-by-collection" aria-label="Usage by collection">
      <h4>Usage by collection</h4>
      {error && <p role="alert">{error}</p>}
      {groups && (
        <table>
          <thead>
            <tr>
              <th scope="col">Collection</th>
              <th scope="col">Requests</th>
              <th scope="col">Input tokens</th>
              <th scope="col">Output tokens</th>
              <th scope="col">CLI-estimated USD</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.key}>
                <th scope="row">{group.name}</th>
                <td>{group.requests}</td>
                <td>{measuredLabel(group.inputTokens, group.attempts, tokens.format)}</td>
                <td>{measuredLabel(group.outputTokens, group.attempts, tokens.format)}</td>
                <td>{measuredLabel(group.estimatedCostUSD, group.attempts, dollars)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p>
        Grouped by each board’s current collection. Estimates come from the CLI and are not billing;
        “unreported” counts attempts that did not report that measurement.
      </p>
    </section>
  );
}
