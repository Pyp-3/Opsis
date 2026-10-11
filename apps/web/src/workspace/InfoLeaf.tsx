import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { MapPin, NotebookPen, PencilLine, Plus, Trash2 } from 'lucide-react';
import {
  MAX_FOOTNOTES,
  footnoteObjects,
  infoSpans,
  numberedFootnotes,
  parseInfoText,
  sameFootnoteTarget,
  type BoardDocument,
  type Footnote,
  type FootnoteTarget,
  type InfoSpan,
  type NumberedFootnote,
} from '@opsis/schema';
import { NodeIcon } from './NodeIcon';

/** Text with its safe links; everything else is text, never markup. */
function SpanList({ spans }: { spans: InfoSpan[] }) {
  return (
    <>
      {spans.map((span, index) =>
        span.href ? (
          <a key={index} href={span.href} target="_blank" rel="noopener noreferrer nofollow">
            {span.text}
          </a>
        ) : (
          <Fragment key={index}>{span.text}</Fragment>
        ),
      )}
    </>
  );
}

const Spans = ({ text }: { text: string }) => <SpanList spans={infoSpans(text)} />;

function InfoImage({ src, description }: { src: string; description: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="info-figure">
      {failed ? (
        <div className="info-figure-missing" role="img" aria-label={description || 'Picture'}>
          Picture unavailable
        </div>
      ) : (
        <img
          src={src}
          alt={description}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
      {description && <figcaption>{description}</figcaption>}
    </figure>
  );
}

function InfoText({ text, imageSource }: { text: string; imageSource(id: string): string }) {
  return (
    <>
      {parseInfoText(text).map((block, index) =>
        block.kind === 'image' ? (
          <InfoImage key={index} src={imageSource(block.image)} description={block.description} />
        ) : (
          <p key={index}>
            {block.lines.map((line, at) => (
              <Fragment key={at}>
                {at > 0 && <br />}
                <SpanList spans={line} />
              </Fragment>
            ))}
          </p>
        ),
      )}
    </>
  );
}

/** Superscript links to a set of footnotes, as a book prints them after a word. */
function NoteMarks({ notes, anchors }: { notes: NumberedFootnote[]; anchors: string | null }) {
  if (!notes.length) return null;
  return (
    <sup className="info-note-marks">
      {notes.map(({ number }, index) => (
        <Fragment key={number}>
          {index > 0 && ','}
          {anchors ? (
            <a
              href={`#${anchors}-note-${number}`}
              id={`${anchors}-ref-${number}`}
              aria-label={`Footnote ${number}`}
              onClick={(event) => {
                event.preventDefault();
                const target = document.getElementById(`${anchors}-note-${number}`);
                target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                target?.focus({ preventScroll: true });
              }}
            >
              {number}
            </a>
          ) : (
            number
          )}
        </Fragment>
      ))}
    </sup>
  );
}

export type LeafProps = {
  page: BoardDocument;
  title: string;
  number: number;
  total: number;
  boardTitle: string;
  /** The board's description, shown on its first page. */
  lead: string;
  imageSource(id: string): string;
  /** Prefix for footnote anchors; null on the copy that turns away, which has none. */
  anchors: string | null;
  editable: boolean;
  onShowConcept?: ((id: string) => void) | undefined;
  onAddNote?: ((target: FootnoteTarget) => void) | undefined;
  onEditNote?: ((note: Footnote) => void) | undefined;
  onRemoveNote?: ((note: Footnote) => void) | undefined;
  onWrite?: (() => void) | undefined;
  /** Replaces the editor's text while it is being edited. */
  textEditor?: ReactNode;
  /** The form for a footnote being added or changed. */
  noteEditor?: ReactNode;
};

/** One page of the book, as a printed page lays it out. */
export function InfoLeaf({
  page,
  title,
  number,
  total,
  boardTitle,
  lead,
  imageSource,
  anchors,
  editable,
  onShowConcept,
  onAddNote,
  onEditNote,
  onRemoveNote,
  onWrite,
  textEditor,
  noteEditor,
}: LeafProps) {
  const notes = numberedFootnotes(page);
  const notesOn = (target: FootnoteTarget) =>
    notes.filter((item) => sameFootnoteTarget(item.note.target, target));
  const text = page.info?.text ?? '';
  const empty = !page.nodes.length && !text.trim() && !notes.length;
  return (
    <>
      <header className="info-running-head">
        <span>{boardTitle}</span>
        {total > 1 && (
          <span>
            Page {number} of {total}
          </span>
        )}
      </header>
      <h2 className="info-title">{title}</h2>
      {lead && <p className="info-lead">{lead}</p>}

      {textEditor ??
        (text.trim() ? (
          <div className="info-prose">
            <InfoText text={text} imageSource={imageSource} />
          </div>
        ) : (
          editable &&
          onWrite && (
            <button type="button" className="info-write" onClick={onWrite}>
              <PencilLine size={15} aria-hidden /> Write about this page
            </button>
          )
        ))}

      {empty && !textEditor && <p className="info-empty">Nothing is written on this page yet.</p>}

      {page.nodes.length > 0 && (
        <section className="info-objects" aria-label="On this page">
          {page.nodes.map((node) => {
            const out = page.edges.filter((edge) => edge.source === node.id);
            const target = { kind: 'concept' as const, id: node.id };
            return (
              <article key={node.id} className="info-object">
                <span className="info-object-icon" aria-hidden>
                  <NodeIcon node={node} size={22} strokeWidth={1.8} />
                </span>
                <div className="info-object-body">
                  <h3>
                    {node.label}
                    <NoteMarks notes={notesOn(target)} anchors={anchors} />
                  </h3>
                  <p className="info-summary">{node.summary}</p>
                  {node.explanation.trim() !== node.summary.trim() &&
                    node.explanation
                      .split(/\n\s*\n/)
                      .map((paragraph, index) => <p key={index}>{paragraph}</p>)}
                  {node.caveat && (
                    <p className="info-caveat">
                      <em>{node.caveat}</em>
                    </p>
                  )}
                  {out.length > 0 && (
                    <p className="info-leads-to">
                      Leads to{' '}
                      {out.map((edge, index) => {
                        const to = page.nodes.find((item) => item.id === edge.target);
                        return (
                          <Fragment key={edge.id}>
                            {index > 0 && (index === out.length - 1 ? ' and ' : ', ')}
                            <strong>{to?.label ?? edge.target}</strong>
                            {edge.label && ` (${edge.label})`}
                            <NoteMarks
                              notes={notesOn({ kind: 'connection', id: edge.id })}
                              anchors={anchors}
                            />
                          </Fragment>
                        );
                      })}
                      .
                    </p>
                  )}
                  {anchors && (onShowConcept || (editable && onAddNote)) && (
                    <div className="info-object-actions">
                      {onShowConcept && (
                        <button type="button" onClick={() => onShowConcept(node.id)}>
                          <MapPin size={13} aria-hidden /> Show on canvas
                        </button>
                      )}
                      {editable && onAddNote && notes.length < MAX_FOOTNOTES && (
                        <button
                          type="button"
                          aria-label={`Add a footnote to ${node.label}`}
                          onClick={() => onAddNote(target)}
                        >
                          <NotebookPen size={13} aria-hidden /> Add footnote
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {(notes.length > 0 || noteEditor || (editable && anchors && onAddNote)) && (
        <section className="info-notes" aria-label="Footnotes">
          <h3>Notes</h3>
          {notes.length > 0 && (
            <ol>
              {notes.map((item) => (
                <li
                  key={item.note.id}
                  id={anchors ? `${anchors}-note-${item.number}` : undefined}
                  tabIndex={anchors ? -1 : undefined}
                  value={item.number}
                >
                  <span className="info-note-on">
                    {item.object ? item.object.label : 'No longer on this page'}:
                  </span>{' '}
                  <Spans text={item.note.text} />
                  {anchors && editable && (
                    <span className="info-note-actions">
                      <button
                        type="button"
                        aria-label={`Edit footnote ${item.number}`}
                        title="Edit"
                        onClick={() => onEditNote?.(item.note)}
                      >
                        <PencilLine size={13} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete footnote ${item.number}`}
                        title="Delete"
                        onClick={() => onRemoveNote?.(item.note)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
          {noteEditor}
          {!noteEditor && anchors && editable && onAddNote && notes.length < MAX_FOOTNOTES && (
            <button
              type="button"
              className="info-add-note"
              onClick={() =>
                onAddNote(footnoteObjects(page)[0]?.target ?? { kind: 'concept', id: '' })
              }
              disabled={!footnoteObjects(page).length}
              title={footnoteObjects(page).length ? undefined : 'Add something to the canvas first'}
            >
              <Plus size={14} aria-hidden /> Add a footnote
            </button>
          )}
        </section>
      )}
      <footer className="info-folio" aria-hidden>
        {number}
      </footer>
    </>
  );
}
