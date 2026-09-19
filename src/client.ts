import { EventEmitter } from 'node:events';
import { createConnection, type Socket } from 'node:net';
import { host, port } from './options.js';
import { connectionLimit } from './server.js';
import { Tunnel } from './tunnel.js';

export interface ClientOptions {
  serverIP: string;
  serverPort: number;
  targetIP: string;
  targetPort: number;
  listenPort: number;
  reconnectDelay?: number;
  connectTimeout?: number;
  maxConnections?: number;
}
export interface ClientEvents {
  ready: [port: number];
  connectionError: [error: Error];
  disconnect: [];
}
export class Client extends EventEmitter<ClientEvents> {
  private options: Required<ClientOptions>;
  private running = false;
  private socket: Socket | undefined;
  private tunnel: Tunnel | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  connected = false;
  /** Actual public port, set after the server acknowledges its listener. */
  listenPort: number | undefined;
  constructor(options: ClientOptions) {
    super();
    this.options = {
      serverIP: host(options.serverIP, 'serverIP'),
      serverPort: port(options.serverPort, 'serverPort'),
      targetIP: host(options.targetIP, 'targetIP'),
      targetPort: port(options.targetPort, 'targetPort'),
      listenPort: port(options.listenPort, 'listenPort', true),
      reconnectDelay: options.reconnectDelay ?? 1000,
      connectTimeout: options.connectTimeout ?? 10_000,
      maxConnections: connectionLimit(options.maxConnections),
    };
    for (const name of ['reconnectDelay', 'connectTimeout'] as const) {
      const value = this.options[name];
      if (!Number.isInteger(value) || value < 1 || value > 2 ** 31 - 1)
        throw new RangeError(`Invalid ${name}`);
    }
  }
  init(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }
  private connect(): void {
    if (!this.running) return;
    const socket = createConnection({ host: this.options.serverIP, port: this.options.serverPort });
    this.socket = socket;
    const tunnel = new Tunnel(socket, this.options);
    this.tunnel = tunnel;
    this.connectTimer = setTimeout(
      () => tunnel.fail(new Error('Connection handshake timed out')),
      this.options.connectTimeout,
    );
    this.connectTimer.unref();
    tunnel.on('tunnelError', (error) => this.emit('connectionError', error));
    tunnel.on('port', (value: number) => {
      if (
        this.connected ||
        value < 1 ||
        value > 65535 ||
        (this.options.listenPort !== 0 && value !== this.options.listenPort)
      ) {
        tunnel.fail(new Error('Invalid PORT acknowledgement'));
        return;
      }
      clearTimeout(this.connectTimer);
      this.connectTimer = undefined;
      this.listenPort = value;
      this.connected = true;
      this.emit('ready', value);
    });
    socket.once('connect', () => tunnel.sendPort(this.options.listenPort));
    tunnel.once('close', () => {
      clearTimeout(this.connectTimer);
      this.connectTimer = undefined;
      this.connected = false;
      this.listenPort = undefined;
      this.socket = undefined;
      this.tunnel = undefined;
      if (this.running) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          this.connect();
        }, this.options.reconnectDelay);
      }
      this.emit('disconnect');
    });
  }
  close(): Promise<void> {
    this.running = false;
    clearTimeout(this.timer);
    clearTimeout(this.connectTimer);
    this.timer = undefined;
    this.connectTimer = undefined;
    const socket = this.socket;
    if (!socket) return Promise.resolve();
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    this.tunnel?.destroy();
    return closed;
  }
}
