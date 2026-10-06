import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { bundleMacOS } from './bundle-macos.mjs';

test('macOS bundle retains the executable and validates metadata before signing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'opsis-bundle-test-'));
  try {
    const executable = join(directory, 'opsis');
    writeFileSync(executable, 'fixture executable');
    const destination = join(directory, 'Opsis.app');
    const calls = [];
    bundleMacOS(
      { executable, destination, icon: 'icon.png', version: '0.1.0', build: '57' },
      (command, args) => calls.push([command, args]),
    );
    assert.equal(
      readFileSync(join(destination, 'Contents/MacOS/opsis'), 'utf8'),
      'fixture executable',
    );
    const plist = readFileSync(join(destination, 'Contents/Info.plist'), 'utf8');
    assert.match(plist, /CFBundleExecutable<\/key><string>opsis<\/string>/);
    assert.match(plist, /CFBundleVersion<\/key><string>57<\/string>/);
    assert.deepEqual(
      calls.slice(-3).map(([command]) => command),
      ['plutil', 'codesign', 'codesign'],
    );
    assert.deepEqual(calls.at(-1), ['codesign', ['--verify', '--strict', destination]]);
    assert.throws(() =>
      bundleMacOS({ executable, destination, icon: '', version: '<invalid>', build: '1' }),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
