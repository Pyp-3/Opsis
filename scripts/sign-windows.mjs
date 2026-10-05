import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Authenticode-signs Windows files when a certificate is configured, else does nothing.
 *
 * WINDOWS_CERTIFICATE           base64-encoded PFX (code-signing certificate and key)
 * WINDOWS_CERTIFICATE_PASSWORD  its password
 * WINDOWS_TIMESTAMP_URL         optional RFC 3161 server (default: DigiCert)
 *
 * Returns whether the files were signed. Other providers (cloud HSMs, Azure Artifact
 * Signing, SignPath) can replace the signtool call here without touching packaging.
 */
export function signWindows(files, env = process.env) {
  const certificate = env.WINDOWS_CERTIFICATE?.trim();
  if (!certificate) {
    console.log('Windows code signing skipped: WINDOWS_CERTIFICATE is not configured.');
    return false;
  }
  const signtool = findSigntool();
  const directory = mkdtempSync(join(tmpdir(), 'opsis-sign-'));
  try {
    const pfx = join(directory, 'certificate.pfx');
    writeFileSync(pfx, Buffer.from(certificate, 'base64'), { mode: 0o600 });
    execFileSync(
      signtool,
      [
        'sign',
        '/fd',
        'SHA256',
        '/tr',
        env.WINDOWS_TIMESTAMP_URL || 'http://timestamp.digicert.com',
        '/td',
        'SHA256',
        '/d',
        'Opsis',
        '/f',
        pfx,
        '/p',
        env.WINDOWS_CERTIFICATE_PASSWORD ?? '',
        ...files,
      ],
      // The password is an argument; never echo the command line.
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
    execFileSync(signtool, ['verify', '/pa', '/q', ...files], { stdio: 'inherit' });
    return true;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function findSigntool() {
  const kits = join(
    process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)',
    'Windows Kits/10/bin',
  );
  const versions = existsSync(kits)
    ? readdirSync(kits)
        .filter((name) => /^10\.\d+\.\d+\.\d+$/.test(name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .reverse()
    : [];
  for (const version of versions) {
    const candidate = join(kits, version, 'x64/signtool.exe');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('signtool.exe was not found; install the Windows SDK signing tools.');
}
