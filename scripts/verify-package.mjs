import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { npm, packPackage } from './pack-package.mjs';

const index = process.argv.indexOf('--tarball');
const tarball = index === -1 ? packPackage() : path.resolve(process.argv[index + 1]);
const directory = mkdtempSync(path.join(tmpdir(), 'pangolin-consumer-'));
try {
  writeFileSync(path.join(directory, 'package.json'), '{"private":true,"type":"module"}');
  execFileSync(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], {
    cwd: directory,
    stdio: 'pipe',
  });
  const manifest = JSON.parse(
    readFileSync(path.join(directory, 'node_modules/@zllling/pangolin/package.json'), 'utf8'),
  );
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
  execFileSync(
    process.execPath,
    [
      '--input-type=commonjs',
      '-e',
      "const {Server,Client}=require('@zllling/pangolin'); if(typeof Server!=='function'||typeof Client!=='function')process.exit(1)",
    ],
    { cwd: directory, stdio: 'inherit' },
  );
  writeFileSync(
    path.join(directory, 'consumer.mjs'),
    `
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { Server, Client } from '@zllling/pangolin';
const deadline = setTimeout(() => { console.error('Consumer timed out'); process.exit(1); }, 10000);
const target = net.createServer(socket => socket.pipe(socket));
target.listen(0, '127.0.0.1'); await once(target, 'listening');
const server = new Server({listenPort: 0, host:'127.0.0.1', forwardHost:'127.0.0.1'});
await server.init();
const client = new Client({serverIP:'127.0.0.1', serverPort:server.address.port, targetIP:'127.0.0.1', targetPort:target.address().port, listenPort:0});
const ready = once(client, 'ready'); client.init(); await ready;
const socket = net.createConnection({host:'127.0.0.1', port:client.listenPort});
const data = once(socket, 'data'); socket.write('installed package');
assert.equal((await data)[0].toString(), 'installed package'); socket.destroy();
await client.close(); await server.close(); await new Promise(resolve => target.close(resolve));
clearTimeout(deadline);
`,
  );
  execFileSync(process.execPath, ['consumer.mjs'], {
    cwd: directory,
    stdio: 'inherit',
    timeout: 15000,
  });
  // Compile the installed declarations in both module modes using TS7.
  const compiler = path.resolve('node_modules/typescript/bin/tsc');
  for (const extension of ['mts', 'cts']) {
    writeFileSync(
      path.join(directory, `consumer.${extension}`),
      `import { Server, Client, type ServerOptions, type ClientOptions } from '@zllling/pangolin';\nconst config: ServerOptions = {listenPort:0};\nconst server = new Server(config);\nconst options: ClientOptions = {serverIP:'localhost',serverPort:1,targetIP:'localhost',targetPort:2,listenPort:3};\nconst client = new Client(options);\nvoid server.init(); client.init(); void client.close();\n// @ts-expect-error port must be numeric\nnew Server({listenPort:'invalid'});\n`,
    );
  }
  execFileSync(
    npm,
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--save-dev',
      `@types/node@${manifest.devDependencies['@types/node']}`,
    ],
    { cwd: directory, stdio: 'pipe' },
  );
  execFileSync(
    process.execPath,
    [
      compiler,
      '--strict',
      '--types',
      'node',
      '--noEmit',
      '--module',
      'NodeNext',
      '--target',
      'ES2022',
      'consumer.mts',
      'consumer.cts',
    ],
    { cwd: directory, stdio: 'inherit' },
  );
  console.log(
    'Installed package: CommonJS, ESM, TCP round trip, and TypeScript declarations passed.',
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
