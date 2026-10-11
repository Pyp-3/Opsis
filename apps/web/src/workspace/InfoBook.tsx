import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
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
import { BookFace, BookSpread, useBookMetrics, type SpreadTurn } from './InfoSpread';

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
  const bar = useRef<HTMLDivElement>(null);
  const metrics = useBookMetrics(scroller, bar);
  const editing = textDraft !== null || noteDraft !== null;
  // Reading on a wide enough desk is an open book; writing, and narrow windows, one page.
  const spreadMode = !!metrics && !editing;
  // Which spread is open, for the board page it belongs to; another page opens at its start.
  const [at, setAt] = useState<{ pageId: string | null; spread: number }>({ pageId, spread: 0 });
  const spread = at.pageId === pageId ? at.spread : 0;
  const [columns, setColumns] = useState<{ pageId: string | null; count: number } | null>(null);
  const pageColumns = columns?.pageId === pageId ? columns.count : null;
  const lastSpread = pageColumns ? Math.ceil(pageColumns / 2) - 1 : 0;
  /** Turning back into the previous board page opens its last spread, once it is measured. */
  // Undefined when no such turn is pending: a one-page board's page id is null.
  const openAtEnd = useRef<string | null | undefined>(undefined);
  const position = useRef<{ pageId: string | null; spread: number }>({ pageId, spread });
  const [spreadTurn, setSpreadTurn] = useState<{
    key: number;
    direction: 'next' | 'previous';
    from: { pageId: string | null; spread: number };
  } | null>(null);
  const onColumns = useCallback(
    (count: number) => {
      setColumns((current) =>
        current?.pageId === pageId && current.count === count ? current : { pageId, count },
      );
      if (openAtEnd.current === pageId)
        setAt((current) => {
          const spread = Math.ceil(count / 2) - 1;
          return current.pageId === pageId && current.spread === spread
            ? current
            : { pageId, spread };
        });
    },
    [pageId],
  );

  // Turning to another page, from here, the canvas or the page list, flips the leaf over.
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = pageId;
    if (before === pageId) return;
    setTextDraft(null);
    setNoteDraft(null);
    scroller.current?.scrollTo({ top: 0 });
    // The open book turns its own leaves; see below.
    if (reducedMotion() || spreadMode) return;
    const from = pages.findIndex((item) => item.id === before);
    if (from < 0) return;
    setTurn((current) => ({
      key: (current?.key ?? 0) + 1,
      from: before,
      direction: from < index ? 'next' : 'previous',
    }));
  }, [pageId, pages, index, spreadMode]);

  // In the open book, every move to another spread (here, on the canvas or from the page list)
  // turns a leaf: from the spread that was open to the one now open.
  useLayoutEffect(() => {
    if (!spreadMode) {
      position.current = { pageId, spread };
      return;
    }
    // Wait for a page turned back into to be measured and opened at its end.
    if (openAtEnd.current === pageId && (pageColumns === null || spread !== lastSpread)) return;
    openAtEnd.current = undefined;
    const from = position.current;
    position.current = { pageId, spread };
    if ((from.pageId === pageId && from.spread === spread) || reducedMotion()) return;
    const was = pages.findIndex((item) => item.id === from.pageId);
    const forward = from.pageId === pageId ? spread > from.spread : was < index;
    if (from.pageId !== pageId && was < 0 && pages.length) return;
    setSpreadTurn((current) => ({
      key: (current?.key ?? 0) + 1,
      direction: forward ? 'next' : 'previous',
      from,
    }));
  }, [spreadMode, pageId, spread, pageColumns, lastSpread, pages, index]);

  const clearTurn = useCallback(() => setSpreadTurn(null), []);

  const go = (step: 1 | -1) => {
    if (spreadMode && step === 1 && spread < lastSpread) {
      setAt({ pageId, spread: spread + 1 });
      return;
    }
    if (spreadMode && step === -1 && spread > 0) {
      setAt({ pageId, spread: spread - 1 });
      return;
    }
    const next = pages[index + step];
    if (!next || locked) return;
    if (spreadMode && step === -1) openAtEnd.current = next.id;
    onOpenPage(next.id, step === 1 ? 'next' : 'previous');
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

  /** A board page's text as it flows in the book; copies get their own anchors. */
  const chapterLeaf = (chapterId: string | null, copy: string | null) => {
    const at = Math.max(
      0,
      pages.findIndex((item) => item.id === chapterId),
    );
    const live = copy === null;
    const noop = () => undefined;
    return (
      <InfoLeaf
        {...leafProps}
        bound
        page={boardPage(full, chapterId)}
        title={pages[at]?.title ?? full.title}
        number={at + 1}
        lead={at === 0 ? full.description.trim() : ''}
        anchors={live ? anchors : `${anchors}-${copy}`}
        onShowConcept={live ? onShowConcept : onShowConcept && noop}
        onWrite={canWrite ? (live ? () => setTextDraft('') : noop) : undefined}
        onAddNote={
          canWrite
            ? live
              ? (target) => setNoteDraft({ id: null, target, text: '' })
              : noop
            : undefined
        }
        onEditNote={
          live
            ? (note) => setNoteDraft({ id: note.id, target: note.target, text: note.text })
            : noop
        }
        onRemoveNote={live ? removeNote : noop}
      />
    );
  };
  const chapterTitle = (chapterId: string | null) =>
    pages.find((item) => item.id === chapterId)?.title ?? full.title;
  const face = (chapterId: string | null, column: number, side: 'left' | 'right', copy: string) =>
    metrics && (
      <BookFace
        metrics={metrics}
        side={side}
        head={side === 'left' ? full.title : chapterTitle(chapterId)}
        folio={column + 1}
        column={column}
      >
        {chapterLeaf(chapterId, copy)}
      </BookFace>
    );
  const leafTurn: SpreadTurn | null =
    spreadTurn && metrics
      ? spreadTurn.direction === 'next'
        ? {
            key: spreadTurn.key,
            direction: 'next',
            front: face(spreadTurn.from.pageId, 2 * spreadTurn.from.spread + 1, 'right', 'front'),
            back: face(pageId, 2 * spread, 'left', 'back'),
            under: face(spreadTurn.from.pageId, 2 * spreadTurn.from.spread, 'left', 'under'),
          }
        : {
            key: spreadTurn.key,
            direction: 'previous',
            front: face(spreadTurn.from.pageId, 2 * spreadTurn.from.spread, 'left', 'front'),
            back: face(pageId, 2 * spread + 1, 'right', 'back'),
            under: face(spreadTurn.from.pageId, 2 * spreadTurn.from.spread + 1, 'right', 'under'),
          }
      : null;
  const canBack = spreadMode ? spread > 0 || index > 0 : index > 0;
  const canForward = spreadMode
    ? spread < lastSpread || index < pages.length - 1
    : index < pages.length - 1;
  const crossing = (forward: boolean) =>
    spreadMode ? (forward ? spread >= lastSpread : spread === 0) : true;

  return (
    <div
      className={`info-book ${spreadMode ? 'is-spread' : ''}`}
      ref={scroller}
      onKeyDown={onKeyDown}
    >
      <div className="info-bar" role="toolbar" aria-label="Book" ref={bar}>
        <div className="info-bar-pages">
          <button
            type="button"
            aria-label="Previous page"
            title="Previous page (←)"
            disabled={!canBack || (locked && crossing(false))}
            onClick={() => go(-1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="info-bar-where" aria-live="polite">
            {pages.length > 1 ? `Page ${index + 1} of ${pages.length}` : 'One page'}
            {spreadMode && pageColumns !== null && pageColumns > 2 && (
              <small>
                {' '}
                ·{' '}
                {2 * spread + 2 <= pageColumns
                  ? `${2 * spread + 1}–${2 * spread + 2}`
                  : `${2 * spread + 1}`}{' '}
                of {pageColumns}
              </small>
            )}
          </span>
          <button
            type="button"
            aria-label="Next page"
            title="Next page (→)"
            disabled={!canForward || (locked && crossing(true))}
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
      {spreadMode && metrics ? (
        <div className="info-desk">
          <BookSpread
            key={pageId ?? 'first'}
            metrics={metrics}
            label={`Info: ${title}`}
            spread={spread}
            onSpread={(next) => setAt({ pageId, spread: next })}
            onColumns={onColumns}
            heads={{ left: full.title, right: title }}
            turn={leafTurn}
            onTurned={clearTurn}
            corners={
              <>
                {canBack && (
                  <button
                    type="button"
                    className="info-corner is-previous"
                    aria-label="Turn to the previous page"
                    disabled={locked && crossing(false)}
                    onClick={() => go(-1)}
                  >
                    <ChevronLeft size={16} aria-hidden />
                  </button>
                )}
                {canForward && (
                  <button
                    type="button"
                    className="info-corner is-next"
                    aria-label="Turn to the next page"
                    disabled={locked && crossing(true)}
                    onClick={() => go(1)}
                  >
                    <ChevronRight size={16} aria-hidden />
                  </button>
                )}
              </>
            }
          >
            {chapterLeaf(pageId, null)}
          </BookSpread>
        </div>
      ) : (
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
      )}
    </div>
  );
}
