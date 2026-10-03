import type { RefObject } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Pencil,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { BoardDocumentSchema, type BoardDocument } from '@opsis/schema';
import { applyProcessResults } from '@opsis/engine';
import { TerminalDetails } from './TerminalDetails';
import { ProcessSampleEditor } from './ProcessSampleEditor';
import { calculateProcess, processRequest } from './process-engine';
import type { ProcessState } from './useProcessEngine';
import { NodeIcon } from './NodeIcon';
import { IconPicker } from './IconPicker';
import { removeNode } from './model';

type ConceptDetailsProps = {
  board: BoardDocument;
  boardRef: RefObject<BoardDocument | null>;
  activeNode: BoardDocument['nodes'][number];
  process: ProcessState;
  busy: boolean;
  showIcons: boolean;
  promptInput: RefObject<HTMLTextAreaElement>;
  commit: (board: BoardDocument) => void;
  editNode: (patch: Partial<BoardDocument['nodes'][number]>) => void;
  selectNode: (id: string) => void;
  setSelected: (id: string | null) => void;
  setPrompt: (prompt: string) => void;
  setShowIcons: (show: boolean) => void;
  setArranging: (arranging: boolean) => void;
};

export function ConceptDetails({
  board,
  boardRef,
  activeNode,
  process,
  busy,
  showIcons,
  promptInput,
  commit,
  editNode,
  selectNode,
  setSelected,
  setPrompt,
  setShowIcons,
  setArranging,
}: ConceptDetailsProps) {
  const index = board.nodes.indexOf(activeNode);
  const previous = index > 0 ? board.nodes[index - 1] : undefined;
  const next = index >= 0 && index < board.nodes.length - 1 ? board.nodes[index + 1] : undefined;
  return (
    <aside
      key={activeNode.id}
      className="detail-panel"
      aria-label={`Details for ${activeNode.label}`}
    >
      <div className="detail-top">
        <span className="eyebrow">
          <SlidersHorizontal size={13} /> Concept details
        </span>
        <button aria-label="Close details" onClick={() => setSelected(null)}>
          <X size={17} />
        </button>
      </div>
      {/* Step through concepts in reading order, mirroring the process player's next/previous. */}
      <nav className="detail-steps" aria-label="Step through concepts">
        <button
          disabled={!previous}
          aria-label={previous ? `Previous concept: ${previous.label}` : 'No previous concept'}
          onClick={() => previous && selectNode(previous.id)}
        >
          <ChevronLeft size={15} /> Previous
        </button>
        <span className="detail-steps-count">
          {index + 1} / {board.nodes.length}
        </span>
        <button
          className="is-next"
          disabled={!next}
          aria-label={next ? `Next concept: ${next.label}` : 'No next concept'}
          onClick={() => next && selectNode(next.id)}
        >
          Next <ChevronRight size={15} />
        </button>
      </nav>
      <div className="detail-body">
        {activeNode.confidence && activeNode.confidence !== 'normal' && (
          <p className="node-caveat">
            <strong>{activeNode.confidence}</strong>:{' '}
            {activeNode.caveat || 'This concept needs independent verification.'}
          </p>
        )}
        <div className="detail-hero">
          <div className="detail-icon">
            <NodeIcon node={activeNode} size={28} strokeWidth={1.6} />
          </div>
          <div>
            <span className={`kind-tag ${activeNode.kind === 'decision' ? 'is-decision' : ''}`}>
              {activeNode.kind === 'decision' ? 'Decision' : 'Concept'}
              <span>{String(board.nodes.indexOf(activeNode) + 1).padStart(2, '0')}</span>
            </span>
            <h2>{activeNode.label}</h2>
          </div>
        </div>
        {activeNode.terminal ? (
          <TerminalDetails
            step={activeNode.terminal}
            {...(activeNode.process
              ? {
                  calculation: process,
                  result: process.results.get(activeNode.id),
                  failure: process.failures.get(activeNode.id),
                }
              : {})}
          />
        ) : (
          <>
            <p className="detail-summary">{activeNode.summary}</p>
            <section className="detail-section">
              <h3>How it works</h3>
              <p className="detail-explanation">{activeNode.explanation}</p>
            </section>
          </>
        )}
        {activeNode.process?.op === 'source' && (
          <ProcessSampleEditor
            key={activeNode.process.text}
            text={activeNode.process.text}
            disabled={busy}
            onUpdate={async (text) => {
              const current = board;
              setArranging(true);
              try {
                const parsed = BoardDocumentSchema.safeParse({
                  ...current,
                  nodes: current.nodes.map((node) =>
                    node.id === activeNode.id ? { ...node, process: { op: 'source', text } } : node,
                  ),
                });
                if (!parsed.success)
                  throw new Error(parsed.error.issues[0]?.message ?? 'Use a smaller sample.');
                const result = await calculateProcess(processRequest(parsed.data));
                const failure = result.nodes.find((node) => node.status === 'failed');
                if (failure) {
                  const label = current.nodes.find((node) => node.id === failure.id)?.label;
                  throw new Error(
                    label ? `${label}: ${failure.error.message}` : failure.error.message,
                  );
                }
                if (boardRef.current === current) commit(applyProcessResults(parsed.data, result));
              } finally {
                setArranging(false);
              }
            }}
          />
        )}
        <section className="detail-section" aria-label="Connected concepts">
          {(() => {
            const links = board.edges.filter(
              (edge) => edge.source === activeNode.id || edge.target === activeNode.id,
            );
            return (
              <>
                <h3>
                  Connections{' '}
                  <span>
                    {links.length} {links.length === 1 ? 'path' : 'paths'}
                  </span>
                </h3>
                <div className="connection-list">
                  {links.map((edge) => {
                    const outgoing = edge.source === activeNode.id;
                    const neighbor = board.nodes.find(
                      (node) => node.id === (outgoing ? edge.target : edge.source),
                    );
                    if (!neighbor) return null;
                    return (
                      <button key={edge.id} onClick={() => selectNode(neighbor.id)}>
                        <ArrowRight size={15} className={outgoing ? '' : 'incoming-arrow'} />
                        <span>
                          {neighbor.label}
                          <small>
                            {outgoing ? 'Leads to' : 'Comes from'}
                            {edge.label ? ` · ${edge.label}` : ''}
                          </small>
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    );
                  })}
                </div>
                {!links.length && (
                  <p className="detail-note">
                    Drag a dot on this icon to another concept to connect them.
                  </p>
                )}
              </>
            );
          })()}
        </section>
        <button
          className="expand-concept"
          disabled={busy}
          onClick={() => {
            setPrompt(
              `Expand “${activeNode.label}” into its substeps while keeping the rest of the diagram`,
            );
            promptInput.current?.focus();
          }}
        >
          <GitBranch size={15} /> Explore this step <ArrowRight size={15} />
        </button>
        <details className="edit-concept">
          <summary>
            <Pencil size={14} /> Edit this concept <ChevronRight size={14} />
          </summary>
          <fieldset disabled={busy}>
            <label>
              Label
              <input
                key={`${activeNode.id}-label-${activeNode.label}`}
                defaultValue={activeNode.label}
                maxLength={80}
                onBlur={(event) => {
                  const label = event.target.value.trim();
                  if (label && label !== activeNode.label) editNode({ label });
                }}
              />
            </label>
            <label>
              Summary
              <textarea
                key={`${activeNode.id}-summary-${activeNode.summary}`}
                defaultValue={activeNode.summary}
                maxLength={400}
                onBlur={(event) => {
                  const summary = event.target.value.trim();
                  if (summary && summary !== activeNode.summary) editNode({ summary });
                }}
              />
            </label>
            <label>
              Explanation
              <textarea
                key={`${activeNode.id}-explanation-${activeNode.explanation}`}
                defaultValue={activeNode.explanation}
                maxLength={3000}
                onBlur={(event) => {
                  const explanation = event.target.value.trim();
                  if (explanation && explanation !== activeNode.explanation)
                    editNode({ explanation });
                }}
              />
            </label>
            <div className="fieldset-actions">
              <button
                type="button"
                className="secondary-button"
                aria-expanded={showIcons}
                onClick={() => setShowIcons(!showIcons)}
              >
                <Search size={14} /> Change icon
              </button>
              <button
                type="button"
                className="delete-concept"
                disabled={busy}
                onClick={() => {
                  commit(removeNode(board, activeNode.id));
                  setSelected(null);
                }}
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
            {showIcons && (
              <IconPicker
                value={activeNode.icon}
                custom={activeNode.customIcon}
                onPick={(icon) => {
                  editNode({ icon });
                  setShowIcons(false);
                }}
              />
            )}
          </fieldset>
        </details>
        {!activeNode.terminal && (
          <p className="detail-note">
            {board.agent === 'demo'
              ? 'Curated example.'
              : `Generated with ${board.agent === 'claude' ? 'Claude' : 'Codex'}.`}{' '}
            A simplified explanation — ask your agent to check anything uncertain.
          </p>
        )}
      </div>
    </aside>
  );
}
