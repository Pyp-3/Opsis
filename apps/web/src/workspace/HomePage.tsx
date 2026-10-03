import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, ArrowUpRight, Clock, FolderOpen, Sparkles } from 'lucide-react';
import { DNS_DEMO, EMAIL_DEMO, type BoardDocument, type BoardGraph } from '@opsis/schema';
import type { useBoardLibrary } from './useBoardLibrary';
import { BrandMark } from './BrandMark';
import { NodeIcon } from './NodeIcon';
import { boardIcons } from './icons';
import { updatedLabel } from './BoardsPage';
import { navigate } from '../router';

const EXAMPLES = [
  { title: 'An email’s journey', graph: EMAIL_DEMO },
  { title: 'DNS lookups', graph: DNS_DEMO },
] as const;

const QUESTIONS = [
  'How does a vaccine train the immune system?',
  'What happens when I tap my card to pay?',
  'How does the water cycle work?',
];

/** The front door: ask a question, pick up where you left off, or open an example. */
export function HomePage({
  board,
  busy,
  library,
  onStart,
  onOpen,
  onExample,
}: {
  board: BoardDocument | null;
  busy: boolean;
  library: ReturnType<typeof useBoardLibrary>;
  onStart: (question: string) => void;
  onOpen: (id: string) => void;
  onExample: (graph: BoardGraph) => void;
}) {
  const [question, setQuestion] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    document.title = 'Opsis';
  }, []);
  const recent = library.entries
    .filter((entry) => entry.id !== library.activeId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 6);
  const start = (text: string) => {
    if (text.trim() && !busy) onStart(text.trim());
  };
  return (
    <main className="page-main home-page">
      <section className="home-hero">
        <div className="welcome-identity">
          <span className="welcome-mark">
            <BrandMark size={56} />
          </span>
          <span className="welcome-wordmark">
            opsis<span>.</span>
          </span>
        </div>
        <h1>See what you mean.</h1>
        <p>Turn a question into a diagram you can explore, play and share.</p>
        <form
          className="home-ask"
          onSubmit={(event) => {
            event.preventDefault();
            start(question);
          }}
        >
          <label className="sr-only" htmlFor="home-question">
            Start a new canvas with a question
          </label>
          <input
            ref={input}
            id="home-question"
            value={question}
            maxLength={4000}
            disabled={busy}
            placeholder="What would you like to understand?"
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button aria-label="Start a canvas" disabled={busy || !question.trim()}>
            <ArrowUp size={18} />
          </button>
        </form>
        <ul className="home-questions" aria-label="Suggested questions">
          {QUESTIONS.map((text) => (
            <li key={text}>
              <button
                disabled={busy}
                onClick={() => {
                  setQuestion(text);
                  input.current?.focus();
                }}
              >
                {text} <ArrowUpRight size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </section>

      {board && (
        <section className="home-section" aria-labelledby="home-continue">
          <h2 id="home-continue" className="home-section-title">
            <Clock size={14} /> Continue where you left off
          </h2>
          <a
            href="/canvas"
            className="home-continue"
            onClick={(event) => {
              event.preventDefault();
              navigate('/canvas');
            }}
          >
            <span className="home-continue-icons" aria-hidden>
              {board.nodes.slice(0, 4).map((node) => (
                <NodeIcon key={node.id} node={node} size={18} />
              ))}
            </span>
            <span className="home-continue-text">
              <strong>{board.title}</strong>
              <small>
                {board.nodes.length} {board.nodes.length === 1 ? 'concept' : 'concepts'}
                {board.description ? ` · ${board.description}` : ''}
              </small>
            </span>
            <span className="home-go">
              Open canvas <ArrowRight size={14} />
            </span>
          </a>
        </section>
      )}

      {recent.length > 0 && (
        <section className="home-section" aria-labelledby="home-recent">
          <div className="home-section-head">
            <h2 id="home-recent" className="home-section-title">
              <FolderOpen size={14} /> Recent boards
            </h2>
            <a
              href="/boards"
              onClick={(event) => {
                event.preventDefault();
                navigate('/boards');
              }}
            >
              All boards <ArrowRight size={13} />
            </a>
          </div>
          <nav aria-label="Saved boards">
            <ul className="home-cards">
              {recent.map((entry) => (
                <li key={entry.id}>
                  <button
                    disabled={busy}
                    aria-label={entry.title}
                    aria-describedby={`updated-${entry.id}`}
                    onClick={() => onOpen(entry.id)}
                  >
                    <strong>{entry.title}</strong>
                    <small id={`updated-${entry.id}`}>{updatedLabel(entry.updatedAt)}</small>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </section>
      )}

      <section className="home-section" aria-labelledby="home-examples">
        <h2 id="home-examples" className="home-section-title">
          <Sparkles size={14} /> Examples · no agent needed
        </h2>
        <nav aria-label="Examples">
          <ul className="home-cards">
            {EXAMPLES.map(({ title, graph }) => {
              const Icon = boardIcons[graph.nodes[1]!.icon];
              return (
                <li key={title}>
                  <button
                    disabled={busy}
                    aria-label={`Open example: ${title}`}
                    onClick={() => onExample(graph)}
                  >
                    <span className="home-card-icon">
                      <Icon size={18} />
                    </span>
                    <strong>{title}</strong>
                    <small>{graph.nodes.length} concepts · playable</small>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </section>
    </main>
  );
}
