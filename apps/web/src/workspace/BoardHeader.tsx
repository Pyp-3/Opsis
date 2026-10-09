import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronRight,
  ChevronDown,
  Upload,
  Download,
  FileText,
  FileJson,
  ImageIcon,
} from 'lucide-react';
import type { BoardDocument } from '@opsis/schema';
import { boardSvg, boardMarkdown, downloadRaster, download, type RasterFormat } from './export';
import { navigate } from '../router';
import { boardFileJson, collectionNameOf } from './board-file';

type BoardHeaderProps = {
  board: BoardDocument | null;
  busy: boolean;
  working: boolean;
  saved: string;
  railToggle: ReactNode;
  /** The Canvas / Chat switch, between the board name and its actions. */
  tabs?: ReactNode;
  /** Board-level dropdowns (sharing, groups), kept in the header so the canvas keeps its height. */
  menus?: ReactNode;
  onImport: () => void;
  setError: (error: string) => void;
  /** The collection the reader filed this board in, named in its JSON export. */
  collectionId?: string | null | undefined;
};

export function BoardHeader({
  board,
  busy,
  working,
  saved,
  railToggle,
  tabs,
  menus,
  onImport,
  setError,
  collectionId,
}: BoardHeaderProps) {
  // Looked up ahead of time, so the export still runs within the click that asked for it.
  const [collection, setCollection] = useState<{ id: string; name?: string } | null>(null);
  useEffect(() => {
    if (!collectionId) return;
    let current = true;
    void collectionNameOf(collectionId)
      .then((name) => current && setCollection({ id: collectionId, ...(name ? { name } : {}) }))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [collectionId]);
  const collectionName =
    collectionId && collection?.id === collectionId ? collection.name : undefined;
  const header = useRef<HTMLElement>(null);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  // Every header dropdown closes on an outside press or Escape, so none is left over the canvas.
  useEffect(() => {
    const openMenus = () =>
      Array.from(header.current?.querySelectorAll<HTMLDetailsElement>('details[open]') ?? []);
    const close = (event: PointerEvent) => {
      for (const menu of openMenus())
        if (!menu.contains(event.target as globalThis.Node)) menu.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      for (const menu of openMenus()) {
        menu.open = false;
        menu.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  const exportAs = (content: string, filename: string, type: string) => {
    void download(content, filename, type).catch((e: Error) => setError(e.message));
    if (exportMenu.current) exportMenu.current.open = false;
  };
  const exportRaster = (format: RasterFormat) => {
    if (board) void downloadRaster(board, format).catch((e: Error) => setError(e.message));
    if (exportMenu.current) exportMenu.current.open = false;
  };

  return (
    <header className="workspace-header" ref={header}>
      <div className="header-breadcrumb">
        {railToggle}
        <a
          href="/boards"
          className="crumb-root"
          onClick={(event) => {
            event.preventDefault();
            if (!busy) navigate('/boards');
          }}
        >
          Boards
        </a>
        <ChevronRight size={14} aria-hidden />
        <h1>{board?.title ?? 'Untitled canvas'}</h1>
      </div>
      {tabs}
      <div className="header-actions">
        <span className={`save-status ${saved.startsWith('Could') ? 'is-warning' : ''}`}>
          {saved && !saved.startsWith('Could') && <Check size={13} />}
          {saved}
        </span>
        {menus}
        <button
          className="header-button"
          title="Import a saved board"
          aria-label="Import board"
          disabled={working}
          onClick={() => onImport()}
        >
          <Upload size={15} />
          <span className="button-label">Import</span>
        </button>
        <details className="header-menu export-menu" ref={exportMenu}>
          <summary aria-label="Export">
            <Download size={15} /> <span className="button-label">Export</span>{' '}
            <ChevronDown className="chevron" size={14} />
          </summary>
          <div className="header-menu-panel export-menu-panel">
            <p className="export-menu-group">Picture of the diagram</p>
            <button disabled={!board} onClick={() => exportRaster('png')}>
              <ImageIcon size={16} />
              <span>
                <strong>PNG image</strong>
                <small>.png · full diagram, crisp, transparent-safe</small>
              </span>
            </button>
            <button disabled={!board} onClick={() => exportRaster('jpeg')}>
              <ImageIcon size={16} />
              <span>
                <strong>JPEG image</strong>
                <small>.jpg · full diagram, smaller file for email</small>
              </span>
            </button>
            <button
              disabled={!board}
              onClick={() =>
                board && exportAs(boardSvg(board), 'opsis-diagram.svg', 'image/svg+xml')
              }
            >
              <ImageIcon size={16} />
              <span>
                <strong>Vector image</strong>
                <small>.svg · scales losslessly for slides</small>
              </span>
            </button>
            <p className="export-menu-group">Text &amp; data</p>
            <button
              disabled={!board}
              onClick={() =>
                board && exportAs(boardMarkdown(board), 'opsis-notes.md', 'text/markdown')
              }
            >
              <FileText size={16} />
              <span>
                <strong>Markdown notes</strong>
                <small>.md · every concept and path as text</small>
              </span>
            </button>
            <button
              disabled={!board}
              onClick={() =>
                board &&
                exportAs(
                  boardFileJson(board, collectionName),
                  'opsis-board.json',
                  'application/json',
                )
              }
            >
              <FileJson size={16} />
              <span>
                <strong>Editable board</strong>
                <small>.json · import it again later</small>
              </span>
            </button>
          </div>
        </details>
      </div>
    </header>
  );
}
