import { useEffect, useRef, type ReactNode } from 'react';
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

type BoardHeaderProps = {
  board: BoardDocument | null;
  busy: boolean;
  working: boolean;
  saved: string;
  railToggle: ReactNode;
  onImport: () => void;
  setError: (error: string) => void;
};

export function BoardHeader({
  board,
  busy,
  working,
  saved,
  railToggle,
  onImport,
  setError,
}: BoardHeaderProps) {
  const exportMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const menu = exportMenu.current;
      if (menu?.open && !menu.contains(event.target as globalThis.Node)) menu.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
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
    <header className="workspace-header">
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
      <div className="header-actions">
        <span className={`save-status ${saved.startsWith('Could') ? 'is-warning' : ''}`}>
          {saved && !saved.startsWith('Could') && <Check size={13} />}
          {saved}
        </span>
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
        <details className="export-menu" ref={exportMenu}>
          <summary>
            <Download size={15} /> Export <ChevronDown className="chevron" size={14} />
          </summary>
          <div className="export-menu-panel">
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
                exportAs(JSON.stringify(board, null, 2), 'opsis-board.json', 'application/json')
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
