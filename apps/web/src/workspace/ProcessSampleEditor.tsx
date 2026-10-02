import { useState } from 'react';

export function ProcessSampleEditor({
  text,
  disabled,
  onUpdate,
}: {
  text: string;
  disabled: boolean;
  onUpdate: (text: string) => Promise<void>;
}) {
  const [sample, setSample] = useState(text);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className="process-sample-editor" aria-label="Process sample data">
      <label>
        Sample data
        <textarea
          aria-label="Sample data"
          rows={5}
          maxLength={1000}
          value={sample}
          disabled={disabled || updating}
          onChange={(event) => setSample(event.target.value)}
        />
      </label>
      <button
        disabled={disabled || updating || sample === text}
        onClick={async () => {
          setUpdating(true);
          setError('');
          try {
            await onUpdate(sample);
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Could not update sample data.');
          } finally {
            setUpdating(false);
          }
        }}
      >
        {updating ? 'Calculating…' : 'Update sample'}
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
