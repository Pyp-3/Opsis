import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'opsis-desktop-qa-'));
const child = spawn(
  resolve(process.env.OPSIS_QA_DESKTOP_BINARY ?? 'output/desktop/opsis'),
  ['--serve'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      OPSIS_DATA_DIR: directory,
      OPSIS_DB_PATH: join(directory, 'opsis.sqlite'),
      OPSIS_SPEECH: 'off',
      OPSIS_RATE_LIMIT: '10000',
    },
  },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => {
  rmSync(directory, { recursive: true, force: true });
  process.exit(1);
});
child.on('exit', (code) => {
  rmSync(directory, { recursive: true, force: true });
  process.exit(code ?? 0);
});
