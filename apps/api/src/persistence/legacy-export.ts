import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { importLegacyBoard, LegacyBundleSchema } from '@opsis/schema';

/** Read-only historical database export. The original tables and files are never modified. */
export function exportLegacyDatabase(source: string, destination: string) {
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare('SELECT id,document FROM osg_documents ORDER BY id LIMIT 101')
      .all() as { id: string; document: string }[];
    if (rows.length > 100)
      throw new Error(
        'Export at most 100 legacy documents per database batch; split a copy of the source first.',
      );
    const boards = [],
      rejected = [];
    for (const row of rows) {
      try {
        const board = importLegacyBoard(JSON.parse(row.document));
        const hash = createHash('sha256')
          .update(row.id)
          .update('\0')
          .update(row.document)
          .digest('hex');
        const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
        boards.push({ id, sourceId: row.id.slice(0, 200), board });
      } catch {
        rejected.push({
          sourceId: row.id.slice(0, 200),
          reason: 'Invalid or unsupported OSG document; source retained.',
        });
      }
    }
    const bundle = LegacyBundleSchema.parse({ format: 'opsis-legacy-bundle/v1', boards, rejected });
    writeFileSync(destination, JSON.stringify(bundle, null, 2), { flag: 'wx', mode: 0o600 });
    return { converted: boards.length, rejected: rejected.length };
  } finally {
    db.close();
  }
}
