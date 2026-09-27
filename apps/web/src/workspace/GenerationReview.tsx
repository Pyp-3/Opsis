import type { BoardDocument } from '@opsis/schema';

export function GenerationReview({
  before,
  candidate,
  changes,
  apply,
  discard,
}: {
  before: BoardDocument;
  candidate: BoardDocument;
  changes: string[];
  apply: () => void;
  discard: () => void;
}) {
  return (
    <section className="generation-review" aria-label="Review proposed changes">
      <h3>Review changes before applying</h3>
      <p>Your saved board has not changed. The agent proposes changes to existing content:</p>
      <ul>
        {changes.map((change) => (
          <li key={change}>{change}</li>
        ))}
      </ul>
      <details>
        <summary>Compare complete content</summary>
        <div className="review-columns">
          <div>
            <h4>Current</h4>
            <pre>
              {JSON.stringify(
                {
                  title: before.title,
                  description: before.description,
                  nodes: before.nodes,
                  edges: before.edges,
                },
                null,
                2,
              )}
            </pre>
          </div>
          <div>
            <h4>Proposed</h4>
            <pre>
              {JSON.stringify(
                {
                  title: candidate.title,
                  description: candidate.description,
                  nodes: candidate.nodes,
                  edges: candidate.edges,
                },
                null,
                2,
              )}
            </pre>
          </div>
        </div>
      </details>
      <button onClick={discard}>Keep current board</button>{' '}
      <button onClick={apply}>Apply reviewed changes</button>
    </section>
  );
}
