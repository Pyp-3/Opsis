import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A native bundle is required for Finder launches and standard macOS app identity.
// Ad-hoc signing allows local execution; it is not Developer ID or notarization.
export function bundleMacOS({ executable, destination, icon, version, build }, run = execFileSync) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[1-9]\d*$/.test(build))
    throw new Error('Invalid macOS bundle version.');
  const contents = join(destination, 'Contents');
  const resources = join(contents, 'Resources');
  const binary = join(contents, 'MacOS/opsis');
  mkdirSync(join(contents, 'MacOS'), { recursive: true });
  mkdirSync(resources, { recursive: true });
  cpSync(executable, binary);
  chmodSync(binary, 0o755);
  const iconset = join(resources, 'Opsis.iconset');
  mkdirSync(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256]) {
    run(
      'sips',
      ['-z', String(size), String(size), icon, '--out', join(iconset, `icon_${size}x${size}.png`)],
      { stdio: 'pipe' },
    );
    if (size <= 128)
      run(
        'sips',
        [
          '-z',
          String(size * 2),
          String(size * 2),
          icon,
          '--out',
          join(iconset, `icon_${size}x${size}@2x.png`),
        ],
        { stdio: 'pipe' },
      );
  }
  run('iconutil', ['-c', 'icns', iconset, '-o', join(resources, 'Opsis.icns')], {
    stdio: 'inherit',
  });
  writeFileSync(
    join(contents, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>io.github.pyp-3.opsis</string>
  <key>CFBundleName</key><string>Opsis</string>
  <key>CFBundleDisplayName</key><string>Opsis</string>
  <key>CFBundleExecutable</key><string>opsis</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>Opsis.icns</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${build}</string>
  <key>LSMinimumSystemVersion</key><string>15.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
`,
  );
  run('plutil', ['-lint', join(contents, 'Info.plist')], { stdio: 'inherit' });
  run('codesign', ['--force', '--sign', '-', destination], { stdio: 'inherit' });
  run('codesign', ['--verify', '--strict', destination], { stdio: 'inherit' });
}
