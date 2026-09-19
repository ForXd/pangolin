import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import net from 'node:net';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, Server } from '../dist/index.js';

async function listen(server, port = 0) {
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
async function fixture(t, handler, options = {}) {
  const sockets = new Set();
  const target = net.createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    handler(socket);
  });
  const targetPort = await listen(target);
  const server = new Server({
    listenPort: 0,
    host: '127.0.0.1',
    forwardHost: '127.0.0.1',
    ...options.server,
  });
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map((client) => client.close()));
    await server.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => target.close(resolve));
  });
  await server.init();
  const client = new Client({
    serverIP: '127.0.0.1',
    serverPort: server.address.port,
    targetIP: '127.0.0.1',
    targetPort,
    listenPort: 0,
    reconnectDelay: 20,
    ...options.client,
  });
  clients.push(client);
  const ready = once(client, 'ready', { signal: t.signal });
  client.init();
  await ready;
  return { server, client, target, targetPort, sockets };
}
async function exchange(port, data, slow = false) {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  const chunks = [];
  socket.on('data', (chunk) => {
    chunks.push(chunk);
    if (slow) {
      socket.pause();
      setTimeout(() => socket.resume(), 1);
    }
  });
  const end = once(socket, 'end');
  socket.end(data);
  await end;
  socket.destroy();
  return Buffer.concat(chunks);
}

test('large binary transfer, slow consumer, and concurrent isolated channels', {
  timeout: 15000,
}, async (t) => {
  const { client } = await fixture(t, (socket) => socket.pipe(socket));
  const inputs = [
    randomBytes(5 * 1024 * 1024),
    ...Array.from({ length: 20 }, () => randomBytes(8193)),
  ];
  const outputs = await Promise.all(
    inputs.map((data, index) => exchange(client.listenPort, data, index === 0)),
  );
  outputs.forEach((output, index) => {
    assert.equal(output.length, inputs[index].length);
    assert.ok(output.equals(inputs[index]));
  });
});
test('target sends first and client can half-close before receiving a response', {
  timeout: 5000,
}, async (t) => {
  const { client } = await fixture(t, (socket) => {
    socket.write('hello');
    socket.resume();
    socket.on('end', () => socket.end(' goodbye'));
  });
  const socket = net.createConnection({ host: '127.0.0.1', port: client.listenPort });
  t.after(() => socket.destroy());
  const [greeting] = await once(socket, 'data');
  assert.equal(greeting.toString(), 'hello');
  const data = once(socket, 'data');
  socket.end();
  assert.equal((await data)[0].toString(), ' goodbye');
});
test('more than 256 sequential connections reuse IDs without stale handlers', {
  timeout: 15000,
}, async (t) => {
  const { client } = await fixture(t, (socket) => socket.pipe(socket));
  for (let i = 0; i < 300; i++) {
    const input = Buffer.from(`connection-${i}`);
    assert.deepEqual(await exchange(client.listenPort, input), input);
  }
});
test('target refusal closes only that channel', { timeout: 5000 }, async (t) => {
  const { client, target, targetPort } = await fixture(t, (socket) => socket.pipe(socket));
  await new Promise((resolve) => target.close(resolve));
  const socket = net.createConnection({ host: '127.0.0.1', port: client.listenPort });
  socket.on('error', () => {});
  socket.resume();
  await once(socket, 'close');
  assert.equal(client.connected, true);
  await listen(target, targetPort);
  assert.equal(
    (await exchange(client.listenPort, Buffer.from('recovered'))).toString(),
    'recovered',
  );
});
test('server restart reconnects once and close cancels retries', { timeout: 5000 }, async (t) => {
  const { server, client } = await fixture(t, (socket) => socket.pipe(socket));
  const serverPort = server.address.port;
  const disconnected = once(client, 'disconnect');
  await server.close();
  await disconnected;
  assert.equal(client.connected, false);
  const replacement = new Server({
    listenPort: serverPort,
    host: '127.0.0.1',
    forwardHost: '127.0.0.1',
  });
  t.after(() => replacement.close());
  const ready = once(client, 'ready', { signal: t.signal });
  await replacement.init();
  await ready;
  assert.equal((await exchange(client.listenPort, Buffer.from('again'))).toString(), 'again');
  await client.close();
  let unexpected = 0;
  client.on('ready', () => unexpected++);
  await delay(80);
  assert.equal(unexpected, 0);
});
test('malformed peer is isolated; denied ports and duplicate handshakes fail closed', {
  timeout: 5000,
}, async (t) => {
  const server = new Server({ listenPort: 0, host: '127.0.0.1', allowedPorts: [] });
  t.after(() => server.close());
  await server.init();
  const errors = [];
  server.on('tunnelError', (error) => errors.push(error));
  for (const input of [
    Buffer.from([1, 0, 255, 255, 255, 255]),
    Buffer.from([0, 0, 0, 0, 0, 4, 0, 0, 0, 80]),
  ]) {
    const socket = net.createConnection({ host: '127.0.0.1', port: server.address.port });
    socket.on('error', () => {});
    socket.resume();
    const closed = once(socket, 'close');
    socket.write(input);
    await closed;
  }
  assert.equal(errors.length, 2);
});
test('startup errors reject and shutdown is idempotent', { timeout: 5000 }, async (t) => {
  const server = new Server({ listenPort: 0, host: '127.0.0.1' });
  t.after(() => server.close());
  assert.equal(server.init(), server.init());
  await server.init();
  const conflict = new Server({ listenPort: server.address.port, host: '127.0.0.1' });
  await assert.rejects(conflict.init(), { code: 'EADDRINUSE' });
  await conflict.close();
  await Promise.all([server.close(), server.close()]);
  await server.init();
  assert.ok(server.address.port);
});
test('invalid configuration is rejected synchronously', () => {
  assert.throws(() => new Server({ listenPort: -1 }), RangeError);
  assert.throws(() => new Server({ listenPort: 0, maxConnections: 257 }), RangeError);
  assert.throws(
    () =>
      new Client({
        serverIP: '',
        serverPort: 1,
        targetIP: 'localhost',
        targetPort: 1,
        listenPort: 0,
      }),
    TypeError,
  );
});

test('client channel limit rejects excess traffic without disconnecting healthy channels', {
  timeout: 5000,
}, async (t) => {
  const { client } = await fixture(t, (socket) => socket.pipe(socket), {
    client: { maxConnections: 1 },
  });
  const first = net.createConnection({ host: '127.0.0.1', port: client.listenPort });
  t.after(() => first.destroy());
  const firstData = once(first, 'data');
  first.write('keep');
  await firstData;
  const excess = net.createConnection({ host: '127.0.0.1', port: client.listenPort });
  excess.on('error', () => {});
  excess.resume();
  const closed = new Promise((resolve) => excess.once('close', resolve));
  excess.write(Buffer.alloc(200000, 42));
  await closed;
  assert.equal(client.connected, true);
  const nextData = once(first, 'data');
  first.write('still alive');
  assert.equal((await nextData)[0].toString(), 'still alive');
});

test('handshake timeout closes idle peers and duplicate PORT never leaks listeners', {
  timeout: 5000,
}, async (t) => {
  const { encode } = await import('../dist/protocol.js');
  const server = new Server({
    listenPort: 0,
    host: '127.0.0.1',
    forwardHost: 'localhost',
    handshakeTimeout: 25,
  });
  t.after(() => server.close());
  await server.init();
  const errors = [];
  server.on('tunnelError', (error) => errors.push(error.message));
  const idle = net.createConnection({ host: '127.0.0.1', port: server.address.port });
  idle.resume();
  await once(idle, 'close');
  assert.ok(errors.includes('PORT handshake timed out'));
  const socket = net.createConnection({ host: '127.0.0.1', port: server.address.port });
  socket.resume();
  socket.on('error', () => {});
  const closed = new Promise((resolve) => socket.once('close', resolve));
  socket.write(Buffer.concat([encode(0, 0, Buffer.alloc(4)), encode(0, 0, Buffer.alloc(4))]));
  await closed;
  assert.ok(errors.includes('Duplicate PORT handshake'));
});

test('forward port collision is reported and does not stop the control server', {
  timeout: 5000,
}, async (t) => {
  const occupied = net.createServer();
  const occupiedPort = await listen(occupied);
  t.after(() => new Promise((resolve) => occupied.close(resolve)));
  const server = new Server({ listenPort: 0, host: '127.0.0.1', forwardHost: '127.0.0.1' });
  t.after(() => server.close());
  await server.init();
  const client = new Client({
    serverIP: '127.0.0.1',
    serverPort: server.address.port,
    targetIP: '127.0.0.1',
    targetPort: occupiedPort,
    listenPort: occupiedPort,
    reconnectDelay: 1000,
  });
  t.after(() => client.close());
  const error = once(server, 'tunnelError');
  client.init();
  assert.equal((await error)[0].code, 'EADDRINUSE');
  await client.close();
  assert.ok(server.address);
});

test('response queued at half-close reaches a slow receiver in full', {
  timeout: 10000,
}, async (t) => {
  const response = randomBytes(8 * 1024 * 1024 + 123);
  const { client } = await fixture(t, (socket) => {
    socket.resume();
    socket.on('end', () => socket.end(response));
  });
  const output = await exchange(client.listenPort, Buffer.from('request'), true);
  assert.equal(output.length, response.length);
  assert.ok(output.equals(response));
});
