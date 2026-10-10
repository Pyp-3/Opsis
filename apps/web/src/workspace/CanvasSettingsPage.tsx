import { appUrl } from '../app-url';
import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Globe,
  Link2,
  Lock,
  Palette,
  RotateCcw,
  Shapes,
  Share2,
  Type,
} from 'lucide-react';
import type { BoardDocument, BoardVisibility } from '@opsis/schema';
import {
  CANVAS_PALETTES,
  DEFAULT_LOOK,
  ICON_COLORS,
  lookOf,
  sameLook,
  type CanvasLook,
} from './canvas-theme';
import { NodeIcon } from './NodeIcon';
import { navigate } from '../router';

const VISIBILITY_NAMES: Record<BoardVisibility, string> = {
  private: 'Private',
  link: 'Anyone with the link',
  public: 'Public',
};

/**
 * One canvas's own control page: its name and description, and the colours it is painted in.
 * Everything here is saved with the board, so it is undoable and travels with exports.
 */
export function CanvasSettingsPage({
  board,
  busy,
  commit,
  visibility = 'private',
  onVisibility,
  boardId,
}: {
  board: BoardDocument;
  busy: boolean;
  commit: (board: BoardDocument) => void;
  visibility?: BoardVisibility;
  /** Resolves true once the change is saved. */
  onVisibility?: (visibility: BoardVisibility) => Promise<boolean>;
  boardId?: string;
}) {
  const [sharing, setSharing] = useState<BoardVisibility | null>(null);
  const [copied, setCopied] = useState(false);
  const shown = sharing ?? visibility;
  const link = boardId ? `${location.origin}${appUrl('/canvas')}?board=${boardId}` : '';
  const look = lookOf(board);
  const setLook = (next: CanvasLook) => {
    if (!sameLook(next, look) || !board.look) commit({ ...board, look: next });
  };
  useEffect(() => {
    document.title = `${board.title} · Look & details · Opsis`;
    return () => {
      document.title = 'Opsis';
    };
  }, [board.title]);
  const deep = CANVAS_PALETTES.find((palette) => palette.id === look.canvas)?.deep;
  return (
    <main className="page-main settings-page">
      <header className="page-head">
        <a
          href={appUrl('/canvas')}
          className="header-button"
          onClick={(event) => {
            event.preventDefault();
            navigate('/canvas');
          }}
        >
          <ArrowLeft size={15} /> Back to canvas
        </a>
        <span className="eyebrow">
          <Palette size={13} /> Look &amp; details
        </span>
        <h1>{board.title}</h1>
        <p>These settings belong to this canvas only. Other canvases keep their own.</p>
        {onVisibility && (
          <span className={`visibility-badge is-${visibility}`}>
            {visibility === 'public' ? (
              <Globe size={12} />
            ) : visibility === 'link' ? (
              <Link2 size={12} />
            ) : (
              <Lock size={12} />
            )}
            {VISIBILITY_NAMES[visibility]}
          </span>
        )}
      </header>

      <div className="settings-layout">
        <div className="settings-forms">
          <fieldset className="settings-card" disabled={busy}>
            <legend>
              <Type size={14} /> Details
            </legend>
            <label>
              Name
              <input
                key={`title-${board.title}`}
                defaultValue={board.title}
                maxLength={100}
                onBlur={(event) => {
                  const title = event.target.value.trim();
                  if (title && title !== board.title) commit({ ...board, title });
                }}
              />
            </label>
            <label>
              Big-picture summary
              <textarea
                key={`description-${board.description}`}
                defaultValue={board.description}
                maxLength={500}
                rows={3}
                onBlur={(event) => {
                  const description = event.target.value.trim();
                  if (description !== board.description) commit({ ...board, description });
                }}
              />
            </label>
          </fieldset>

          {onVisibility && (
            <fieldset className="settings-card" disabled={busy || sharing !== null}>
              <legend>
                <Share2 size={14} /> Sharing
              </legend>
              <div className="share-options" role="radiogroup" aria-label="Who can see this canvas">
                {(
                  [
                    ['private', Lock, VISIBILITY_NAMES.private, 'Only you and invited editors.'],
                    [
                      'link',
                      Link2,
                      VISIBILITY_NAMES.link,
                      'Anyone with the link can view and play it, even without an account.',
                    ],
                    [
                      'public',
                      Globe,
                      VISIBILITY_NAMES.public,
                      'Also listed for everyone signed in here, who can save a copy.',
                    ],
                  ] as const
                ).map(([value, Icon, title, note]) => (
                  <button
                    type="button"
                    key={value}
                    role="radio"
                    aria-checked={shown === value}
                    onClick={async () => {
                      if (value === visibility) return;
                      setSharing(value);
                      try {
                        await onVisibility(value);
                      } finally {
                        setSharing(null);
                      }
                    }}
                  >
                    <Icon size={18} />
                    <span>
                      <strong>{title}</strong>
                      <small>{note}</small>
                    </span>
                  </button>
                ))}
              </div>
              <div className={`share-link ${shown !== 'private' && link ? 'is-open' : ''}`}>
                <div>
                  <div className="share-link-row">
                    <code>{link}</code>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(link).then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1600);
                        });
                      }}
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}{' '}
                      {copied ? 'Copied' : 'Copy link'}
                    </button>
                  </div>
                  <small>
                    Viewers never see hidden pages. To show one, send that page’s own link from the
                    page list on the canvas.
                  </small>
                </div>
              </div>
            </fieldset>
          )}

          <fieldset className="settings-card" disabled={busy}>
            <legend>
              <Palette size={14} /> Background
            </legend>
            <div className="look-backgrounds">
              {CANVAS_PALETTES.map((palette) => (
                <button
                  type="button"
                  key={palette.id}
                  aria-pressed={look.canvas === palette.id}
                  style={{
                    ['--swatch-from' as string]: palette.background[0],
                    ['--swatch-to' as string]: palette.background[2],
                    ['--swatch-ink' as string]: palette.ink,
                    ['--swatch-grid' as string]: palette.gridMajor,
                  }}
                  onClick={() => setLook({ ...look, canvas: palette.id })}
                >
                  <span className="look-background-swatch" aria-hidden>
                    {look.canvas === palette.id && <Check size={14} />}
                  </span>
                  <span>{palette.name}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="settings-card" disabled={busy}>
            <legend>
              <Shapes size={14} /> Icons
            </legend>
            <div className="look-icons">
              {ICON_COLORS.map((icon) => (
                <button
                  type="button"
                  key={icon.id}
                  aria-label={icon.name}
                  title={icon.name}
                  aria-pressed={look.icon === icon.id}
                  style={{ ['--swatch' as string]: icon.color, ['--swatch-bg' as string]: deep }}
                  onClick={() => setLook({ ...look, icon: icon.id })}
                >
                  <Shapes size={16} aria-hidden />
                  <span>{icon.name}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="settings-actions">
            <small>Saved with this canvas · undo with Ctrl / ⌘ Z</small>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || sameLook(look, DEFAULT_LOOK)}
              onClick={() => setLook(DEFAULT_LOOK)}
            >
              <RotateCcw size={14} /> Reset colours
            </button>
          </div>
        </div>

        <figure className="look-preview" aria-label="Preview">
          <div className="look-preview-canvas">
            <span className="canvas-kicker">
              <span />
              THE BIG PICTURE
            </span>
            <strong>{board.title}</strong>
            <div className="look-preview-nodes">
              {board.nodes.slice(0, 3).map((node) => (
                <span key={node.id} className="look-preview-node">
                  <span className="node-symbol">
                    <NodeIcon node={node} size={30} strokeWidth={1.4} />
                  </span>
                  <small>{node.label}</small>
                </span>
              ))}
            </div>
          </div>
          <figcaption>Live preview</figcaption>
        </figure>
      </div>
    </main>
  );
}
