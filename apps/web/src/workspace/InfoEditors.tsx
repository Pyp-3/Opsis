import { useEffect, useId, useRef, useState } from 'react';
import { ImagePlus, Link2, Type } from 'lucide-react';
import {
  MAX_FOOTNOTE_TEXT,
  MAX_INFO_IMAGES,
  MAX_INFO_TEXT,
  footnoteObjects,
  infoImageMarkup,
  infoLinkMarkup,
  infoTextImages,
  sameFootnoteTarget,
  type BoardDocument,
  type FootnoteTarget,
} from '@opsis/schema';
import { READING_FONTS, READING_SIZES } from './app-theme';
import { useAppearance } from './useAppearance';
import { INFO_IMAGE_ACCEPT, prepareInfoImage, uploadInfoImage } from './info-images';

/** Inserts `text` at the textarea's caret, on its own line when `ownLine`. */
function insertAt(area: HTMLTextAreaElement | null, value: string, text: string, ownLine = false) {
  const start = area?.selectionStart ?? value.length;
  const end = area?.selectionEnd ?? value.length;
  let insert = text;
  if (ownLine) {
    if (start > 0 && value[start - 1] !== '\n') insert = `\n${insert}`;
    if (end < value.length && value[end] !== '\n') insert = `${insert}\n`;
  }
  return { next: value.slice(0, start) + insert + value.slice(end), caret: start + insert.length };
}

export function TextEditor({
  value,
  boardId,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  boardId: string;
  onChange(value: string): void;
  onSave(): void;
  onCancel(): void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [tool, setTool] = useState<'link' | 'image' | null>(null);
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const ids = useId();
  useEffect(() => area.current?.focus(), []);
  const place = (text: string, ownLine = false) => {
    const { next, caret } = insertAt(area.current, value, text, ownLine);
    if (next.length > MAX_INFO_TEXT) {
      setMessage(`The text can be up to ${MAX_INFO_TEXT.toLocaleString()} characters.`);
      return false;
    }
    onChange(next);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(caret, caret);
    });
    return true;
  };
  const addLink = () => {
    const markup = infoLinkMarkup(label, address);
    if (!markup) {
      setMessage('Use a web address starting with https:// or http://, or a mailto: address.');
      return;
    }
    if (place(markup)) {
      setTool(null);
      setLabel('');
      setAddress('');
      setMessage('');
    }
  };
  const addImage = async () => {
    if (!file) return;
    if (infoTextImages(value).length >= MAX_INFO_IMAGES) {
      setMessage(`A page can show up to ${MAX_INFO_IMAGES} pictures.`);
      return;
    }
    setUploading(true);
    setMessage('');
    try {
      const id = await uploadInfoImage(boardId, await prepareInfoImage(file));
      if (place(infoImageMarkup(id, description), true)) {
        setTool(null);
        setFile(null);
        setDescription('');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The picture could not be added.');
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="info-editor">
      <div className="info-editor-tools" role="toolbar" aria-label="Insert">
        <button
          type="button"
          aria-pressed={tool === 'link'}
          onClick={() => setTool(tool === 'link' ? null : 'link')}
        >
          <Link2 size={14} aria-hidden /> Link
        </button>
        <button
          type="button"
          aria-pressed={tool === 'image'}
          onClick={() => setTool(tool === 'image' ? null : 'image')}
        >
          <ImagePlus size={14} aria-hidden /> Picture
        </button>
        <small className="info-editor-count" aria-live="polite">
          {value.length.toLocaleString()} / {MAX_INFO_TEXT.toLocaleString()}
        </small>
      </div>
      {tool === 'link' && (
        <div className="info-editor-panel">
          <label>
            Link text
            <input value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label>
            Address
            <input
              value={address}
              inputMode="url"
              placeholder="https://"
              maxLength={2000}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addLink();
                }
              }}
            />
          </label>
          <button type="button" className="primary-button" onClick={addLink}>
            Insert link
          </button>
        </div>
      )}
      {tool === 'image' && (
        <div className="info-editor-panel">
          <label>
            Picture
            <input
              type="file"
              accept={INFO_IMAGE_ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            Description
            <input
              value={description}
              maxLength={200}
              placeholder="What the picture shows"
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={!file || uploading}
            onClick={() => void addImage()}
          >
            {uploading ? 'Adding…' : 'Insert picture'}
          </button>
          <small>PNG, JPEG, WebP or GIF. Pictures are re-drawn and their metadata removed.</small>
        </div>
      )}
      {message && (
        <p className="info-editor-message" role="alert">
          {message}
        </p>
      )}
      <label className="sr-only" htmlFor={`${ids}-text`}>
        Page text
      </label>
      <textarea
        id={`${ids}-text`}
        ref={area}
        value={value}
        maxLength={MAX_INFO_TEXT}
        rows={10}
        placeholder="Write about this page. Leave a blank line between paragraphs."
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSave();
        }}
      />
      <div className="info-editor-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary-button" onClick={onSave}>
          Save text
        </button>
      </div>
    </div>
  );
}

/** A footnote being written: a new one has no id yet. */
export type NoteDraft = { id: string | null; target: FootnoteTarget; text: string };

export function NoteEditor({
  page,
  draft,
  onChange,
  onSave,
  onCancel,
}: {
  page: BoardDocument;
  draft: NoteDraft;
  onChange(draft: NoteDraft): void;
  onSave(): void;
  onCancel(): void;
}) {
  const ids = useId();
  const objects = footnoteObjects(page);
  const text = useRef<HTMLTextAreaElement>(null);
  useEffect(() => text.current?.focus(), []);
  const key = (target: FootnoteTarget) => `${target.kind}:${target.id}`;
  const known = objects.some((object) => sameFootnoteTarget(object.target, draft.target));
  return (
    <form
      className="info-note-editor"
      aria-label={draft.id ? 'Edit footnote' : 'New footnote'}
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <label htmlFor={`${ids}-on`}>On</label>
      <select
        id={`${ids}-on`}
        value={key(draft.target)}
        onChange={(event) => {
          const object = objects.find((item) => key(item.target) === event.target.value);
          if (object) onChange({ ...draft, target: object.target });
        }}
      >
        {!known && <option value={key(draft.target)}>No longer on this page</option>}
        {objects.map((object) => (
          <option key={key(object.target)} value={key(object.target)}>
            {object.label}
          </option>
        ))}
      </select>
      <label htmlFor={`${ids}-text`}>Note</label>
      <textarea
        id={`${ids}-text`}
        ref={text}
        rows={3}
        maxLength={MAX_FOOTNOTE_TEXT}
        value={draft.text}
        onChange={(event) => onChange({ ...draft, text: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
      />
      <div className="info-editor-actions">
        <small>
          {draft.text.length} / {MAX_FOOTNOTE_TEXT}
        </small>
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary-button" disabled={!draft.text.trim()}>
          {draft.id ? 'Save footnote' : 'Add footnote'}
        </button>
      </div>
    </form>
  );
}

export function ReadingControls() {
  const { theme, set } = useAppearance();
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (menu.current?.open && !menu.current.contains(event.target as Node))
        menu.current.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return (
    <details className="info-reading" ref={menu}>
      <summary aria-label="Text settings" title="Text settings">
        <Type size={15} aria-hidden />
      </summary>
      <div className="info-reading-panel">
        <div role="radiogroup" aria-label="Reading typeface">
          {READING_FONTS.map((font) => (
            <button
              key={font.id}
              type="button"
              role="radio"
              aria-checked={theme.readingFont === font.id}
              style={{ fontFamily: font.display }}
              onClick={() => set({ ...theme, readingFont: font.id })}
            >
              {font.name}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Reading size">
          {READING_SIZES.map((size) => (
            <button
              key={size.id}
              type="button"
              role="radio"
              aria-checked={theme.readingSize === size.id}
              aria-label={size.name}
              onClick={() => set({ ...theme, readingSize: size.id })}
            >
              <span style={{ fontSize: size.px * 0.78 }} aria-hidden>
                A
              </span>
            </button>
          ))}
        </div>
        <small>Saved to your account, like the rest of Appearance.</small>
      </div>
    </details>
  );
}
