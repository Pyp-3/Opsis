import { apiFetch as fetch } from '../app-url';
import { useEffect, useState } from 'react';
import { ArrowRight, Search, TextSearch } from 'lucide-react';
import { z } from 'zod';
import type { SearchField } from '@opsis/schema';

const HitSchema = z.object({
  boardId: z.string(),
  boardTitle: z.string(),
  access: z.enum(['owner', 'editor']),
  conceptId: z.string().optional(),
  pageId: z.string().optional(),
  label: z.string(),
  field: z.string(),
  snippet: z.string(),
});
type Hit = z.infer<typeof HitSchema>;

const FIELD_LABELS: Record<SearchField, string> = {
  title: 'Board title',
  description: 'Board description',
  group: 'Group',
  label: 'Concept',
  summary: 'Summary',
  explanation: 'Explanation',
  notes: 'Notes',
  source: 'Source',
  connection: 'Connection',
};

/** Searches every board the account owns or edits; a result opens its concept on the canvas. */
export function SearchPage({
  onOpen,
}: {
  onOpen: (boardId: string, conceptId?: string, pageId?: string) => Promise<void>;
}) {
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get('q') ?? '');
  const [results, setResults] = useState<Hit[] | null>(null);
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);
  const term = query.trim();
  useEffect(() => {
    document.title = 'Search · Opsis';
    return () => {
      document.title = 'Opsis';
    };
  }, []);
  useEffect(() => {
    if (term.length < 2) return;
    let live = true;
    // Wait for typing to pause before searching.
    const timer = setTimeout(() => {
      setSearching(true);
      fetch(`/v1/search?q=${encodeURIComponent(term)}`)
        .then(async (response) => {
          if (!response.ok) throw new Error('Search is unavailable right now.');
          const body = z.object({ results: z.array(HitSchema) }).parse(await response.json());
          if (!live) return;
          setResults(body.results);
          setError('');
        })
        .catch((e: Error) => live && setError(e.message))
        .finally(() => live && setSearching(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term]);
  const shown = term.length < 2 ? null : results;
  return (
    <main className="page-main search-main">
      <div className="boards-intro">
        <span className="eyebrow">
          <TextSearch size={13} /> Search
        </span>
        <h1>Search your boards</h1>
        <p>
          Find concepts by words in their labels, summaries, explanations, notes, sources and
          connections, across every board you own or can edit. Archived and other people’s public
          boards are not searched.
        </p>
      </div>
      <label className="concept-search search-input">
        <Search size={16} />
        <input
          autoFocus
          type="search"
          aria-label="Search all boards"
          value={query}
          maxLength={200}
          placeholder="e.g. spam filter"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {error && (
        <p className="workspace-error" role="alert">
          {error}
        </p>
      )}
      <p className="boards-count" role="status">
        {term.length < 2
          ? 'Type at least two characters.'
          : searching && !shown
            ? 'Searching…'
            : shown
              ? `${shown.length} ${shown.length === 1 ? 'result' : 'results'}`
              : ''}
      </p>
      {shown && (
        <ul className="search-results" aria-label="Search results">
          {shown.map((hit) => (
            <li key={`${hit.boardId}:${hit.conceptId ?? ''}`}>
              <button
                aria-label={`Open ${hit.label} in ${hit.boardTitle}`}
                onClick={() => void onOpen(hit.boardId, hit.conceptId, hit.pageId)}
              >
                <span className="search-result-board">
                  {hit.boardTitle}
                  {hit.access === 'editor' ? ' · Shared with you' : ''}
                </span>
                <strong>{hit.label}</strong>
                <small>{FIELD_LABELS[hit.field as SearchField] ?? hit.field}</small>
                <span className="search-result-snippet">{hit.snippet}</span>
                <ArrowRight size={14} className="search-result-go" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {shown && !shown.length && <p className="boards-empty">Nothing matches “{term}”.</p>}
    </main>
  );
}
