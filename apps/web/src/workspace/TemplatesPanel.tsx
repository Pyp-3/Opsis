import { apiFetch as fetch } from '../app-url';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { Trash2 } from 'lucide-react';
import { AUTH_EXPIRED } from './board-library-api';
import type { useBoardLibrary } from './useBoardLibrary';

const Templates = z.array(
  z.object({ id: z.string().uuid(), title: z.string(), createdAt: z.number() }),
);

export function TemplatesPanel({
  library,
  onCreated,
}: {
  library: ReturnType<typeof useBoardLibrary>;
  onCreated: () => void;
}) {
  const [templates, setTemplates] = useState<z.infer<typeof Templates> | null>(null);
  const [selected, setSelected] = useState('');
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch('/v1/templates');
        if (response.status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED));
        if (!response.ok) throw new Error('Could not load templates.');
        const list = Templates.parse(await response.json());
        if (live) setTemplates(list);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not load templates.');
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  const disabled = busy || library.switching;
  return (
    <section className="boards-public" aria-label="Templates">
      <p>
        Save a board as a template from My boards. Each use creates an independent, private board
        with fresh undo history.
      </p>
      <label className="concept-search">
        <input
          aria-label="Search templates"
          placeholder="Search templates"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {(error || library.error) && (
        <p className="workspace-error" role="alert">
          {error || library.error}
        </p>
      )}
      {templates === null && !error && <p role="status">Loading templates…</p>}
      {templates?.length === 0 && (
        <p className="boards-empty">
          No templates yet. Save a board as a template to reuse it across projects.
        </p>
      )}
      <ul className="board-cards">
        {templates
          ?.filter((template) => template.title.toLowerCase().includes(query.trim().toLowerCase()))
          .map((template) => (
            <li key={template.id}>
              <button
                className="board-card-open"
                disabled={disabled}
                onClick={() => {
                  setSelected(template.id);
                  setTitle(template.title);
                  setDeleting(null);
                }}
              >
                <strong>{template.title}</strong>
                <span className="board-card-go">Use template</span>
              </button>
              {selected === template.id && (
                <form
                  className="board-rename"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (
                      await library.manage(
                        'create',
                        undefined,
                        title.trim(),
                        undefined,
                        template.id,
                      )
                    )
                      onCreated();
                  }}
                >
                  <label>
                    New project board name
                    <input
                      autoFocus
                      required
                      maxLength={100}
                      value={title}
                      disabled={disabled}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </label>
                  <div>
                    <button disabled={disabled || !title.trim()}>Create from template</button>
                    <button type="button" disabled={disabled} onClick={() => setSelected('')}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              <div className="board-card-actions">
                <button
                  disabled={disabled}
                  aria-label={`Delete template ${template.title}`}
                  onClick={() => {
                    setDeleting(template.id);
                    setSelected('');
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              {deleting === template.id && (
                <div
                  className="board-delete-confirm"
                  role="group"
                  aria-label="Confirm template deletion"
                >
                  <p>Delete “{template.title}”? Boards created from it will remain.</p>
                  <div>
                    <button
                      className="danger"
                      disabled={disabled}
                      onClick={async () => {
                        setBusy(true);
                        setError('');
                        try {
                          const response = await fetch(`/v1/templates/${template.id}`, {
                            method: 'DELETE',
                          });
                          if (response.status === 401)
                            window.dispatchEvent(new Event(AUTH_EXPIRED));
                          if (!response.ok) throw new Error('Could not delete this template.');
                          setTemplates(
                            (list) => list?.filter((entry) => entry.id !== template.id) ?? null,
                          );
                          setDeleting(null);
                        } catch (e) {
                          setError(
                            e instanceof Error ? e.message : 'Could not delete this template.',
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Delete permanently
                    </button>
                    <button disabled={disabled} onClick={() => setDeleting(null)}>
                      Keep template
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
      </ul>
    </section>
  );
}
