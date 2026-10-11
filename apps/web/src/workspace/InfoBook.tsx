import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, PencilLine, Redo2, Undo2 } from 'lucide-react';
import {
  boardPage,
  boardPages,
  tidyPageInfo,
  type BoardDocument,
  type Footnote,
  type PageInfo,
} from '@opsis/schema';
import { infoImageSource } from './info-images';
import { InfoLeaf } from './InfoLeaf';
import { NoteEditor, ReadingControls, TextEditor, type NoteDraft } from './InfoEditors';

type Turn = { key: number; from: string | null; direction: 'next' | 'previous' };

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A page edit with its Info replaced; an empty Info is removed rather than saved. */
function withInfo(page: BoardDocument, info: PageInfo | undefined): BoardDocument {
  const next = { ...page };
  const tidy = tidyPageInfo(info);
  if (tidy) next.info = tidy;
  else delete next.info;
  return next;
}

const footnoteId = () => `note-${crypto.randomUUID().slice(0, 8)}`;

/**
 * The Info tab: the open page read as a page of a book, beside and in step with the canvas.
 * Turning a page here turns the canvas too, and the other way round. Owners and editors write
 * the page's text (plain text with links and pictures) and footnotes on its objects; each save
 * is one undoable edit of the page.
 */
export function InfoBook({
  document: full,
  pageId,
  boardId,
  editable,
  locked = false,
  signedOut = false,
  showReadingControls = true,
  onOpenPage,
  onCommit,
  onShowConcept,
  history,
}: {
  document: BoardDocument | null;
  pageId: string | null;
  boardId: string;
  /** Whether this reader may write on the page (owner or editor, and not busy). */
  editable: boolean;
  /** Keeps the page on screen while a chat answer to it is in progress or under review. */
  locked?: boolean;
  /** Signed-out link visitors read images through the board's open address. */
  signedOut?: boolean;
  /** Reading settings are account settings, so they are offered only when signed in. */
  showReadingControls?: boolean;
  onOpenPage(id: string, direction: 'next' | 'previous'): void;
  /** Commits an edit of the open page as one undoable step. */
  onCommit?: (page: BoardDocument) => void;
  onShowConcept?: (id: string) => void;
  /** The board's undo and redo, so edits made here can be taken back here. */
  history?: { canUndo: boolean; canRedo: boolean; onUndo(): void; onRedo(): void };
}) {
  const pages = boardPages(full);
  const index = Math.max(
    0,
    pages.findIndex((page) => page.id === pageId),
  );
  const page = full ? boardPage(full, pageId) : null;
  const scroller = useRef<HTMLDivElement>(null);
  const [turn, setTurn] = useState<Turn | null>(null);
  const shown = useRef<string | null>(pageId);
  const [textDraft, setTextDraft] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  const anchors = useId().replace(/:/g, '');

  // Turning to another page, from here, the canvas or the page list, flips the leaf over.
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = pageId;
    if (before === pageId) return;
    setTextDraft(null);
    setNoteDraft(null);
    scroller.current?.scrollTo({ top: 0 });
    if (reducedMotion()) return;
    const from = pages.findIndex((item) => item.id === before);
    if (from < 0) return;
    setTurn((current) => ({
      key: (current?.key ?? 0) + 1,
      from: before,
      direction: from < index ? 'next' : 'previous',
    }));
  }, [pageId, pages, index]);

  const go = (step: 1 | -1) => {
    const next = pages[index + step];
    if (next && !locked) onOpenPage(next.id, step === 1 ? 'next' : 'previous');
  };
  // Arrow keys turn pages while the book has focus and nothing is being typed.
  const onKeyDown = (event: KeyboardEvent) => {
    const typing = (event.target as HTMLElement).closest(
      'input, textarea, select, [contenteditable]',
    );
    if (typing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowRight') go(1);
    else if (event.key === 'ArrowLeft') go(-1);
    else return;
    event.preventDefault();
  };

  if (!full || !page)
    return (
      <div className="info-book is-empty">
        <p className="info-empty">Open a board to read its pages.</p>
      </div>
    );

  const current = pages[index];
  const title = current?.title ?? full.title;
  const lead = index === 0 ? full.description.trim() : '';
  const imageSource = (id: string) => infoImageSource(boardId, id, signedOut);
  const canWrite = editable && !!onCommit;
  const saveText = () => {
    if (textDraft === null || !onCommit) return;
    if ((page.info?.text ?? '') !== textDraft)
      onCommit(withInfo(page, { ...page.info, text: textDraft }));
    setTextDraft(null);
  };
  const saveNote = () => {
    if (!noteDraft || !onCommit || !noteDraft.text.trim()) return;
    const notes = page.info?.footnotes ?? [];
    const note: Footnote = {
      id: noteDraft.id ?? footnoteId(),
      target: noteDraft.target,
      text: noteDraft.text.trim(),
    };
    const footnotes = noteDraft.id
      ? notes.map((item) => (item.id === noteDraft.id ? note : item))
      : [...notes, note];
    onCommit(withInfo(page, { ...page.info, footnotes }));
    setNoteDraft(null);
  };
  const removeNote = (note: Footnote) => {
    if (!onCommit) return;
    const footnotes = (page.info?.footnotes ?? []).filter((item) => item.id !== note.id);
    onCommit(withInfo(page, { ...page.info, footnotes }));
  };
  const leafProps = {
    total: Math.max(1, pages.length),
    boardTitle: full.title,
    imageSource,
    editable: canWrite,
  };
  const turning = turn && full ? boardPage(full, turn.from) : null;
  const turningIndex = turn ? pages.findIndex((item) => item.id === turn.from) : -1;

  return (
    <div className="info-book" ref={scroller} onKeyDown={onKeyDown}>
      <div className="info-bar" role="toolbar" aria-label="Book">
        <div className="info-bar-pages">
          <button
            type="button"
            aria-label="Previous page"
            title="Previous page (←)"
            disabled={index === 0 || locked}
            onClick={() => go(-1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="info-bar-where" aria-live="polite">
            {pages.length > 1 ? `Page ${index + 1} of ${pages.length}` : 'One page'}
          </span>
          <button
            type="button"
            aria-label="Next page"
            title="Next page (→)"
            disabled={index >= pages.length - 1 || locked}
            onClick={() => go(1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="info-bar-actions">
          {canWrite && history && (
            <>
              <button
                type="button"
                className="info-bar-icon"
                aria-label="Undo"
                title="Undo (Ctrl / ⌘ Z)"
                disabled={!history.canUndo}
                onClick={history.onUndo}
              >
                <Undo2 size={15} />
              </button>
              <button
                type="button"
                className="info-bar-icon"
                aria-label="Redo"
                title="Redo (Ctrl / ⌘ Shift Z)"
                disabled={!history.canRedo}
                onClick={history.onRedo}
              >
                <Redo2 size={15} />
              </button>
            </>
          )}
          {canWrite && textDraft === null && (
            <button
              type="button"
              className="info-bar-edit"
              onClick={() => setTextDraft(page.info?.text ?? '')}
            >
              <PencilLine size={14} aria-hidden /> Edit text
            </button>
          )}
          {showReadingControls && <ReadingControls />}
        </div>
      </div>
      <div className="info-desk">
        <div className="info-stack">
          <article
            className="info-leaf"
            aria-label={`Info: ${title}`}
            tabIndex={-1}
            // Re-mounting per page restarts nothing; the key keeps footnote ids stable per page.
            key={pageId ?? 'first'}
          >
            <InfoLeaf
              {...leafProps}
              page={page}
              title={title}
              number={index + 1}
              lead={lead}
              anchors={anchors}
              onShowConcept={onShowConcept}
              onWrite={canWrite ? () => setTextDraft('') : undefined}
              onAddNote={
                canWrite ? (target) => setNoteDraft({ id: null, target, text: '' }) : undefined
              }
              onEditNote={(note) =>
                setNoteDraft({ id: note.id, target: note.target, text: note.text })
              }
              onRemoveNote={removeNote}
              textEditor={
                textDraft !== null ? (
                  <TextEditor
                    value={textDraft}
                    boardId={boardId}
                    onChange={setTextDraft}
                    onSave={saveText}
                    onCancel={() => setTextDraft(null)}
                  />
                ) : undefined
              }
              noteEditor={
                noteDraft ? (
                  <NoteEditor
                    page={page}
                    draft={noteDraft}
                    onChange={setNoteDraft}
                    onSave={saveNote}
                    onCancel={() => setNoteDraft(null)}
                  />
                ) : undefined
              }
            />
            {index < pages.length - 1 && (
              <button
                type="button"
                className="info-corner is-next"
                aria-label="Turn to the next page"
                disabled={locked}
                onClick={() => go(1)}
              >
                <ChevronRight size={16} aria-hidden />
              </button>
            )}
            {index > 0 && (
              <button
                type="button"
                className="info-corner is-previous"
                aria-label="Turn to the previous page"
                disabled={locked}
                onClick={() => go(-1)}
              >
                <ChevronLeft size={16} aria-hidden />
              </button>
            )}
          </article>
          {turn && turning && (
            <div
              key={turn.key}
              className={`info-leaf is-turning is-${turn.direction}`}
              aria-hidden
              onAnimationEnd={() => setTurn(null)}
            >
              <InfoLeaf
                {...leafProps}
                editable={false}
                page={turning}
                title={pages[turningIndex]?.title ?? full.title}
                number={turningIndex + 1}
                lead={turningIndex === 0 ? full.description.trim() : ''}
                anchors={null}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
