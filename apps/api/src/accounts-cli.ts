import { createAccount, generatedPassword, resetAccountPassword } from './accounts.js';
import { ApiStore } from './storage.js';

const USAGE = `Usage:
  pnpm accounts list DATABASE.sqlite
  pnpm accounts create DATABASE.sqlite EMAIL "NAME" [--password-stdin]
  pnpm accounts reset-password DATABASE.sqlite EMAIL [--password-stdin]

Without --password-stdin a strong password is generated and printed once.
Resetting a password signs the account out on every device.`;

async function readPassword(fromStdin: boolean) {
  if (!fromStdin) return { password: generatedPassword(), generated: true };
  let text = '';
  for await (const chunk of process.stdin) text += String(chunk);
  return { password: text.replace(/\r?\n$/u, ''), generated: false };
}

const args = process.argv.slice(2);
const fromStdin = args.includes('--password-stdin');
const [action, database, email, name, ...extra] = args.filter((arg) => arg !== '--password-stdin');
const valid =
  !!database &&
  !extra.length &&
  ((action === 'list' && !email) ||
    (action === 'create' && !!email && !!name) ||
    (action === 'reset-password' && !!email && !name));

if (!valid) {
  console.error(USAGE);
  process.exitCode = 1;
} else {
  const store = new ApiStore(database);
  try {
    if (action === 'list') {
      for (const user of store.listUsers())
        console.log(`${user.email}\t${user.name}\t${new Date(user.createdAt).toISOString()}`);
    } else {
      const { password, generated } = await readPassword(fromStdin);
      const user =
        action === 'create'
          ? await createAccount(store, { email: email!, name: name!, password })
          : await resetAccountPassword(store, email!, password);
      console.log(
        action === 'create' ? `Created ${user.email}.` : `Reset the password of ${user.email}.`,
      );
      if (generated) console.log(`Password (shown once): ${password}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Account command failed.');
    process.exitCode = 1;
  } finally {
    store.close();
  }
}
