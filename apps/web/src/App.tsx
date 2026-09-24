import { Suspense, lazy, useState } from 'react';
import type { FixtureId } from './scene/fixtures';

const SceneViewer = lazy(() => import('./scene/SceneViewer'));

const EXAMPLES: { id: FixtureId; sentence: string }[] = [
  { id: 'sun-east', sentence: 'The sun rises in the east.' },
  { id: 'sandwich', sentence: 'A sandwich can contain bread, tomato, ham.' },
];

/** Landing page: pick a North Star sentence and see it as a 3D diagram (M1, fixtures only). */
export function App() {
  const [fixture, setFixture] = useState<FixtureId>('sun-east');
  return (
    <main className="opsis-app">
      <h1>Opsis</h1>
      <p>See what you mean.</p>
      <div role="group" aria-label="Example sentences" className="opsis-examples">
        {EXAMPLES.map(({ id, sentence }) => (
          <button
            key={id}
            type="button"
            aria-pressed={fixture === id}
            onClick={() => setFixture(id)}
          >
            {sentence}
          </button>
        ))}
      </div>
      <Suspense fallback={<p>Loading diagram…</p>}>
        <SceneViewer key={fixture} fixture={fixture} />
      </Suspense>
    </main>
  );
}
