import { useState } from 'react';
import { ConceptReferenceSchema, type BoardDocument } from '@opsis/schema';

type Node = BoardDocument['nodes'][number];
export function ConceptSources({
  node,
  disabled,
  onChange,
}: {
  node: Node;
  disabled: boolean;
  onChange: (patch: Partial<Node>) => void;
}) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  return (
    <section className="detail-section concept-sources" aria-label="Notes and sources">
      <h3>Notes and sources</h3>
      <label>
        Personal notes
        <textarea
          key={node.id + (node.notes ?? '')}
          defaultValue={node.notes ?? ''}
          maxLength={5000}
          disabled={disabled}
          onBlur={(event) => {
            if (event.target.value !== (node.notes ?? '')) onChange({ notes: event.target.value });
          }}
        />
      </label>
      <ul>
        {node.references?.map((reference, index) => (
          <li key={index}>
            {reference.url ? (
              <a href={reference.url} target="_blank" rel="noopener noreferrer">
                {reference.title}
              </a>
            ) : (
              <strong>{reference.title}</strong>
            )}
            {reference.excerpt && <blockquote>{reference.excerpt}</blockquote>}
            <button
              disabled={disabled}
              onClick={() =>
                onChange({ references: node.references?.filter((_, i) => i !== index) })
              }
            >
              Remove source {index + 1}
            </button>
          </li>
        ))}
      </ul>
      <label>
        Source title
        <input
          value={title}
          maxLength={200}
          disabled={disabled}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        Source URL (optional)
        <input
          type="url"
          value={url}
          maxLength={2000}
          disabled={disabled}
          onChange={(event) => setUrl(event.target.value)}
        />
      </label>
      <button
        disabled={disabled || !title.trim() || (node.references?.length ?? 0) >= 10}
        onClick={() => {
          const parsed = ConceptReferenceSchema.safeParse({
            title,
            ...(url.trim() ? { url: url.trim() } : {}),
          });
          if (!parsed.success) {
            setError('Enter a source title and an HTTP or HTTPS URL.');
            return;
          }
          onChange({ references: [...(node.references ?? []), parsed.data] });
          setTitle('');
          setUrl('');
          setError('');
        }}
      >
        Add source
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
