import { useRef } from 'react';
import { FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, type BoardAttachment } from '@opsis/schema';

const ACCEPT =
  '.pdf,.txt,.md,.markdown,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.log,.toml,.sql,.js,.ts,.tsx,.jsx,.py,.go,.rs,.java,.c,.h,.cpp,.cs,.rb,.php,.sh,.png,.jpg,.jpeg,.gif,.webp';

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read “${file.name}”.`));
    // A data URL is "data:<type>;base64,<payload>"; only the payload is sent.
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
    reader.readAsDataURL(file);
  });
}

/** Paperclip button that reads chosen files into base64 attachments for the agent. */
export function AttachButton({
  attachments,
  disabled,
  onChange,
  onError,
}: {
  attachments: BoardAttachment[];
  disabled: boolean;
  onChange: (next: BoardAttachment[]) => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    const chosen = [...files];
    if (attachments.length + chosen.length > MAX_ATTACHMENTS)
      return onError(`Attach up to ${MAX_ATTACHMENTS} documents at a time.`);
    const large = chosen.find((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (large) return onError(`“${large.name}” is too large. Keep each file under 10 MB.`);
    try {
      const read = await Promise.all(
        chosen.map(async (file) => ({
          name: file.name,
          mediaType: file.type,
          data: await readBase64(file),
        })),
      );
      onChange([...attachments, ...read]);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not read that file.');
    }
  };
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={(event) => {
          void add(event.target.files);
          event.target.value = '';
        }}
      />
      <button
        type="button"
        className="attach-document"
        aria-label="Attach documents"
        title="Attach documents (PDF, text, code or images) for the agent to work from"
        disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
        onClick={() => input.current?.click()}
      >
        <Paperclip size={18} />
      </button>
    </>
  );
}

/** Removable chips for the documents that will be sent with the next prompt. */
export function AttachmentChips({
  attachments,
  disabled,
  onChange,
}: {
  attachments: BoardAttachment[];
  disabled: boolean;
  onChange: (next: BoardAttachment[]) => void;
}) {
  if (!attachments.length) return null;
  return (
    <ul className="attachment-chips" aria-label="Attached documents">
      {attachments.map((attachment, index) => {
        const Icon = attachment.mediaType.startsWith('image/') ? ImageIcon : FileText;
        const kb = Math.max(1, Math.round((attachment.data.length * 3) / 4 / 1024));
        return (
          <li key={`${attachment.name}-${index}`}>
            <Icon size={14} aria-hidden="true" />
            <span className="attachment-name">{attachment.name}</span>
            <span className="attachment-size">
              {kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`}
            </span>
            <button
              type="button"
              aria-label={`Remove ${attachment.name}`}
              disabled={disabled}
              onClick={() => onChange(attachments.filter((_, i) => i !== index))}
            >
              <X size={13} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
