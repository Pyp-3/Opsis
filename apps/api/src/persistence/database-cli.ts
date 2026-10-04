import { exportLegacyDatabase } from './legacy-export.js';
import { copyDatabase } from './database-copy.js';

const [action, source, destination, ...extra] = process.argv.slice(2);
if (
  !['backup', 'restore', 'export-legacy'].includes(action ?? '') ||
  !source ||
  !destination ||
  extra.length
) {
  console.error(
    'Usage: pnpm database <backup|restore|export-legacy> SOURCE.sqlite NEW_DESTINATION',
  );
  process.exitCode = 1;
} else {
  try {
    if (action === 'export-legacy') console.log(exportLegacyDatabase(source, destination));
    else console.log(`Database ${action} created: ${copyDatabase(source, destination)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Database copy failed.');
    process.exitCode = 1;
  }
}
