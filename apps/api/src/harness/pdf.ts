import { execFile } from 'node:child_process';

const PDF_TIMEOUT_MS = 20_000;

/** Extracts a PDF's text layer with Poppler's pdftotext, or returns '' when unavailable. */
export function pdfText(data: Buffer): Promise<string> {
  return new Promise((resolve) => {
    const child = execFile(
      'pdftotext',
      ['-layout', '-enc', 'UTF-8', '-', '-'],
      { timeout: PDF_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => resolve(error ? '' : stdout),
    );
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(data);
  });
}
