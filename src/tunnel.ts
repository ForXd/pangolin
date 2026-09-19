import { EventEmitter } from 'node:events';
import { createConnection, type Socket } from 'node:net';
import { asError } from './options.js';
import { Decoder, encode, type Frame, MAX_FRAME_SIZE, Message } from './protocol.js';

interface Channel {
  socket: Socket;
  closing: boolean;
  remoteEnded: boolean;
}
interface TunnelOptions {
  targetIP?: string;
  targetPort?: number;
  maxConnections: number;
}

/** One transport, bounded frame storage, and at most 256 logical streams. */
export class Tunnel extends EventEmitter {
  private channels = new Map<number, Channel>();
  private rejected = new Set<number>();
  private blocked = new Set<Socket>();
  private decoder = new Decoder();
  private disposed = false;
  private transportBlocked = false;
  constructor(
    readonly socket: Socket,
    private options: TunnelOptions,
  ) {
    super();
    socket.setNoDelay(true);
    socket.on('data', (chunk: Buffer) => {
      try {
        this.decoder.push(chunk, (frame) => {
          if (!this.disposed) this.receive(frame);
        });
      } catch (error) {
        this.fail(asError(error));
      }
    });
    socket.on('drain', () => {
      this.transportBlocked = false;
      for (const channel of this.channels.values()) if (!channel.closing) channel.socket.resume();
    });
    socket.on('error', (error) => this.emit('tunnelError', error));
    socket.once('close', () => this.destroy());
    socket.once('end', () => this.destroy());
  }
  sendPort(port: number): void {
    const body = Buffer.alloc(4);
    body.writeUInt32BE(port);
    this.send(Message.PORT, 0, body);
  }
  open(socket: Socket): boolean {
    if (this.disposed || this.channels.size >= this.options.maxConnections) {
      socket.destroy();
      return false;
    }
    let id = 0;
    while (this.channels.has(id)) id++;
    this.attach(id, socket);
    this.send(Message.OPEN, id);
    return true;
  }
  private attach(id: number, socket: Socket): void {
    const channel: Channel = { socket, closing: false, remoteEnded: false };
    this.channels.set(id, channel);
    socket.setNoDelay(true);
    if (this.transportBlocked) socket.pause();
    socket.on('data', (data: Buffer) => {
      if (channel.closing) return;
      for (let start = 0; start < data.length; start += MAX_FRAME_SIZE) {
        this.send(Message.DATA, id, data.subarray(start, start + MAX_FRAME_SIZE));
      }
    });
    socket.once('end', () => {
      if (!channel.closing) this.send(Message.END, id);
    });
    // Error is followed by close; close owns the handshake and ID release.
    socket.on('error', () => socket.destroy());
    socket.once('close', () => {
      this.unblock(socket);
      if (this.disposed || this.channels.get(id) !== channel || channel.closing) return;
      channel.closing = true;
      this.send(Message.CLOSE, id);
    });
    socket.on('drain', () => this.unblock(socket));
  }
  private unblock(socket: Socket): void {
    this.blocked.delete(socket);
    if (this.blocked.size === 0 && !this.disposed) this.socket.resume();
  }
  private receive({ type, id, body }: Frame): void {
    if (type === Message.PORT) {
      this.emit('port', body.readUInt32BE());
      return;
    }
    if (type === Message.OPEN) {
      if (
        this.options.targetPort === undefined ||
        this.options.targetIP === undefined ||
        this.channels.has(id) ||
        this.rejected.has(id)
      )
        throw new Error('Unexpected OPEN');
      if (this.channels.size >= this.options.maxConnections) {
        this.rejected.add(id);
        this.send(Message.CLOSE, id);
        return;
      }
      const socket = createConnection({
        host: this.options.targetIP,
        port: this.options.targetPort,
        allowHalfOpen: true,
      });
      this.attach(id, socket);
      return;
    }
    if (this.rejected.has(id)) {
      if (type === Message.CLOSE) this.rejected.delete(id);
      return;
    }
    const channel = this.channels.get(id);
    if (!channel) {
      // A rejection CLOSE may race with in-flight data from the rejected channel.
      if (type === Message.CLOSE) return;
      throw new Error('Unknown channel');
    }
    if (type === Message.CLOSE) {
      if (channel.closing) {
        this.channels.delete(id);
        this.unblock(channel.socket);
      } else {
        channel.closing = true;
        // END may be followed by CLOSE in the same TCP chunk. Flush queued
        // destination bytes before acknowledging and releasing this channel ID.
        channel.socket.once('close', () => {
          this.channels.delete(id);
          this.unblock(channel.socket);
          this.send(Message.CLOSE, id);
        });
        if (channel.remoteEnded) channel.socket.destroySoon();
        else channel.socket.destroy();
      }
    } else if (!channel.closing && type === Message.END) {
      if (channel.remoteEnded) throw new Error('Duplicate END');
      channel.remoteEnded = true;
      channel.socket.end();
    } else if (!channel.closing && type === Message.DATA) {
      if (channel.remoteEnded) throw new Error('DATA after END');
      if (!channel.socket.write(body)) {
        this.blocked.add(channel.socket);
        this.socket.pause();
      }
    }
  }
  private send(type: Message, id: number, body?: Buffer): void {
    if (this.disposed || this.socket.destroyed) return;
    if (!this.socket.write(encode(type, id, body))) {
      this.transportBlocked = true;
      for (const channel of this.channels.values()) channel.socket.pause();
    }
  }
  fail(error: Error): void {
    this.emit('tunnelError', error);
    this.destroy();
  }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.socket.destroy();
    for (const channel of this.channels.values()) channel.socket.destroy();
    this.channels.clear();
    this.rejected.clear();
    this.blocked.clear();
    this.emit('close');
  }
}
