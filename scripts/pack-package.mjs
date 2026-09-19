import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
export function packPackage(destination = '.artifacts') {
  destination = path.resolve(destination);
  mkdirSync(destination, { recursive: true });
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const staging = mkdtempSync(path.join(tmpdir(), 'pangolin-pack-'));
  let archive;
  try {
    for (const file of ['dist', 'readme.md', 'LICENSE'])
      cpSync(file, path.join(staging, file), { recursive: true });
    writeFileSync(
      path.join(staging, 'package.json'),
      `${JSON.stringify({ ...manifest, gitHead }, null, 2)}\n`,
    );
    [archive] = JSON.parse(
      execFileSync(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', destination], {
        cwd: staging,
        encoding: 'utf8',
      }),
    );
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  assert.equal(archive.name, manifest.name);
  assert.equal(archive.version, manifest.version);
  const files = new Set(archive.files.map((file) => file.path));
  for (const file of ['package.json', 'readme.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts'])
    assert.ok(files.has(file), `Missing ${file}`);
  for (const file of files)
    assert.ok(
      file.startsWith('dist/') || ['package.json', 'readme.md', 'LICENSE'].includes(file),
      `Unexpected ${file}`,
    );
  const tarball = path.join(destination, archive.filename);
  console.log(`Verified archive: ${archive.name}@${archive.version}, ${files.size} files`);
  return tarball;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
  packPackage();
