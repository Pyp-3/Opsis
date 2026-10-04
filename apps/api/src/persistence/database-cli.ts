import { copyDatabase } from './database-copy.js';

const [action, source, destination, ...extra] = process.argv.slice(2);
if (!['backup', 'restore'].includes(action ?? '') || !source || !destination || extra.length) {
  console.error('Usage: pnpm database <backup|restore> SOURCE.sqlite NEW_DESTINATION.sqlite');
  process.exitCode = 1;
} else {
  try {
    console.log(`Database ${action} created: ${copyDatabase(source, destination)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Database copy failed.');
    process.exitCode = 1;
  }
}
