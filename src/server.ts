import { EventEmitter } from 'node:events';
import { type AddressInfo, createServer, type Server as NetServer } from 'node:net';
import { asError, host, port } from './options.js';
import { Tunnel } from './tunnel.js';

export interface ServerOptions {
  listenPort: number;
  host?: string;
  forwardHost?: string;
  maxConnections?: number;
  maxTunnels?: number;
  handshakeTimeout?: number;
  /** Explicit allowlist for client-requested public ports. */
  allowedPorts?: readonly number[];
}
export function connectionLimit(value = 256): number {
  if (!Number.isInteger(value) || value < 1 || value > 256)
    throw new RangeError('maxConnections must be 1..256');
  return value;
}

export interface ServerEvents {
  listening: [address: AddressInfo];
  forwarding: [address: AddressInfo];
  tunnelError: [error: Error];
  serverError: [error: Error];
  close: [];
}
export class Server extends EventEmitter<ServerEvents> {
  readonly listenPort: number;
  private options: Required<Omit<ServerOptions, 'allowedPorts'>> & {
    allowedPorts: readonly number[] | undefined;
  };
  private listener: NetServer | undefined;
  private tunnels = new Set<Tunnel>();
  private forwards = new Set<NetServer>();
  private starting: Promise<void> | undefined;
  private stopping: Promise<void> | undefined;
  constructor(options: ServerOptions) {
    super();
    this.listenPort = port(options.listenPort, 'listenPort', true);
    this.options = {
      listenPort: this.listenPort,
      host: host(options.host ?? '0.0.0.0', 'host'),
      forwardHost: host(options.forwardHost ?? '0.0.0.0', 'forwardHost'),
      maxConnections: connectionLimit(options.maxConnections),
      maxTunnels: options.maxTunnels ?? 100,
      handshakeTimeout: options.handshakeTimeout ?? 10_000,
      allowedPorts: options.allowedPorts === undefined ? undefined : [...options.allowedPorts],
    };
    if (!Number.isInteger(this.options.maxTunnels) || this.options.maxTunnels < 1)
      throw new RangeError('maxTunnels must be positive');
    if (
      !Number.isInteger(this.options.handshakeTimeout) ||
      this.options.handshakeTimeout < 1 ||
      this.options.handshakeTimeout > 2 ** 31 - 1
    )
      throw new RangeError('Invalid handshakeTimeout');
    for (const value of this.options.allowedPorts ?? []) port(value, 'allowedPorts entry', true);
  }
  get address(): AddressInfo | null {
    const address = this.listener?.address();
    return address && typeof address !== 'string' ? address : null;
  }
  /** Repeated calls share the same startup promise. */
  init(): Promise<void> {
    if (this.stopping) return this.stopping.then(() => this.init());
    if (this.starting) return this.starting;
    const listener = createServer((socket) => {
      if (this.tunnels.size >= this.options.maxTunnels) {
        socket.destroy();
        return;
      }
      const tunnel = new Tunnel(socket, { maxConnections: this.options.maxConnections });
      this.tunnels.add(tunnel);
      let requested = false;
      const timeout = setTimeout(
        () => tunnel.fail(new Error('PORT handshake timed out')),
        this.options.handshakeTimeout,
      );
      timeout.unref();
      tunnel.on('tunnelError', (error) => this.emit('tunnelError', error));
      tunnel.on('port', (requestedPort: number) => {
        try {
          if (requested) throw new Error('Duplicate PORT handshake');
          requested = true;
          port(requestedPort, 'requested port', true);
          if (this.options.allowedPorts && !this.options.allowedPorts.includes(requestedPort))
            throw new Error('Requested port is not allowed');
          clearTimeout(timeout);
          this.listenRemote(requestedPort, tunnel);
        } catch (error) {
          tunnel.fail(asError(error));
        }
      });
      tunnel.once('close', () => {
        clearTimeout(timeout);
        this.tunnels.delete(tunnel);
      });
    });
    this.listener = listener;
    this.starting = new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => {
        this.starting = undefined;
        this.listener = undefined;
        reject(error);
      };
      listener.once('error', failed);
      listener.listen(this.listenPort, this.options.host, () => {
        listener.off('error', failed);
        listener.on('error', (error) => this.emit('serverError', error));
        this.emit('listening', listener.address() as AddressInfo);
        resolve();
      });
    });
    return this.starting;
  }
  private listenRemote(requestedPort: number, tunnel: Tunnel): void {
    const listener = createServer({ allowHalfOpen: true }, (socket) => {
      socket.on('error', () => socket.destroy());
      tunnel.open(socket);
    });
    const controller = new AbortController();
    this.forwards.add(listener);
    listener.on('error', (error) => {
      this.forwards.delete(listener);
      tunnel.fail(error);
    });
    listener.once('close', () => this.forwards.delete(listener));
    tunnel.once('close', () => {
      controller.abort();
    });
    listener.listen(
      { port: requestedPort, host: this.options.forwardHost, signal: controller.signal },
      () => {
        const address = listener.address() as AddressInfo;
        tunnel.sendPort(address.port);
        this.emit('forwarding', address);
      },
    );
  }
  close(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      await this.starting?.catch(() => {});
      const servers = [...this.forwards, ...(this.listener ? [this.listener] : [])];
      // Register completion before destroying tunnels (which also close forwards).
      const closed = servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            if (!server.listening) {
              resolve();
              return;
            }
            server.once('close', resolve);
            server.close();
          }),
      );
      for (const tunnel of this.tunnels) tunnel.destroy();
      await Promise.all(closed);
      this.forwards.clear();
      this.listener = undefined;
      this.starting = undefined;
      this.emit('close');
    })().finally(() => {
      this.stopping = undefined;
    });
    return this.stopping;
  }
}
