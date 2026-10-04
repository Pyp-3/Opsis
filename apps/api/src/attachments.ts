import { extname } from 'node:path';
import { MAX_ATTACHMENT_BYTES, type BoardAgent, type BoardAttachment } from '@opsis/schema';
import { pdfText } from './harness/pdf.js';
import { AttachmentError, type PreparedAttachments } from './attachment-contract.js';
export {
  AttachmentError,
  attachmentInstructions,
  type PreparedAttachments,
} from './attachment-contract.js';

/** Total extracted text inlined into one prompt; the rest is cut with a visible note. */
const TEXT_BUDGET = 120_000;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.json',
  '.yaml',
  '.yml',
  '.xml',
  '.html',
  '.htm',
  '.log',
  '.ini',
  '.toml',
  '.sql',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.h',
  '.cpp',
  '.cs',
  '.rb',
  '.php',
  '.sh',
  '.swift',
  '.kt',
  '.tf',
  '.proto',
  '.rst',
]);
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/** Keeps a name that is safe to write into the private harness workspace. */
function safeName(name: string, index: number): string {
  const extension = extname(name)
    .toLowerCase()
    .replace(/[^a-z0-9.]/gu, '');
  const stem = name
    .slice(0, name.length - extname(name).length)
    .replace(/[^A-Za-z0-9_-]+/gu, '-')
    .slice(0, 60);
  return `${index + 1}-${stem || 'document'}${extension}`;
}

function kindOf(attachment: BoardAttachment): 'text' | 'pdf' | 'image' | null {
  const extension = extname(attachment.name).toLowerCase();
  const type = attachment.mediaType.toLowerCase();
  if (type === 'application/pdf' || extension === '.pdf') return 'pdf';
  if (IMAGE_TYPES[extension] || Object.values(IMAGE_TYPES).includes(type)) return 'image';
  if (type.startsWith('text/') || type === 'application/json' || TEXT_EXTENSIONS.has(extension))
    return 'text';
  return null;
}

/**
 * Turns uploads into what each agent can actually use. Both agents get extracted text inline.
 * Claude reads staged images and scanned PDFs with its Read tool; Codex attaches images with
 * `--image` but has no PDF reader, so a PDF without a text layer is refused for Codex.
 */
export async function prepareAttachments(
  attachments: readonly BoardAttachment[],
  agent: Exclude<BoardAgent, 'demo'>,
  extractPdf: (data: Buffer) => Promise<string> = pdfText,
): Promise<PreparedAttachments> {
  const prepared: PreparedAttachments = { documents: [], files: [] };
  let total = 0;
  let budget = TEXT_BUDGET;
  for (const [index, attachment] of attachments.entries()) {
    const data = Buffer.from(attachment.data, 'base64');
    total += data.length;
    if (data.length > MAX_ATTACHMENT_BYTES || total > MAX_TOTAL_BYTES)
      throw new AttachmentError(`“${attachment.name}” is too large. Keep each file under 10 MB.`);
    const kind = kindOf(attachment);
    if (!kind)
      throw new AttachmentError(
        `“${attachment.name}” is not a supported type. Upload PDF, text, Markdown, CSV, JSON, code or PNG/JPEG/GIF/WebP images.`,
      );
    const name = safeName(attachment.name, index);
    let text = '';
    if (kind === 'text') {
      text = data.toString('utf8');
      if (text.includes('\u0000'))
        throw new AttachmentError(`“${attachment.name}” looks like a binary file, not text.`);
    } else if (kind === 'pdf') {
      text = (await extractPdf(data)).replace(/\f/gu, '\n').trim();
      // A PDF with little extractable text is probably scanned; only Claude can read it visually.
      if (text.replace(/\s/gu, '').length < 40) {
        if (agent !== 'claude')
          throw new AttachmentError(
            `“${attachment.name}” has no text layer (it may be scanned). Use Claude, which can read PDFs visually.`,
          );
        prepared.files.push({ name, data, kind: 'pdf' });
        continue;
      }
    } else {
      prepared.files.push({ name, data, kind: 'image' });
      continue;
    }
    const kept = text.slice(0, Math.max(0, budget));
    budget -= kept.length;
    prepared.documents.push({
      name: attachment.name,
      text:
        kept.length < text.length
          ? `${kept}\n[… truncated: ${text.length - kept.length} more characters not shown]`
          : kept,
    });
  }
  return prepared;
}
