/** v2 adds OPEN and END; both peers must run v2. */
export enum Message {
  PORT = 0,
  DATA = 1,
  CLOSE = 2,
  OPEN = 3,
  END = 4,
}
export const HEADER_SIZE = 6;
export const MAX_FRAME_SIZE = 64 * 1024;
export interface Frame {
  type: Message;
  id: number;
  body: Buffer;
}

function validate(type: number, id: number, length: number): void {
  if (!Number.isInteger(id) || id < 0 || id > 255) throw new Error('Invalid channel ID');
  if (!Number.isInteger(length) || length < 0 || length > MAX_FRAME_SIZE)
    throw new Error('Frame too large');
  if (type === Message.PORT) {
    if (id !== 0 || length !== 4) throw new Error('Invalid PORT frame');
  } else if (type === Message.DATA) {
    if (length === 0) throw new Error('Empty DATA frame');
  } else if ([Message.CLOSE, Message.OPEN, Message.END].includes(type)) {
    if (length !== 0) throw new Error('Invalid control frame');
  } else throw new Error('Unknown message type');
}

export function encode(type: Message, id: number, body: Buffer = Buffer.alloc(0)): Buffer {
  validate(type, id, body.length);
  const frame = Buffer.allocUnsafe(HEADER_SIZE + body.length);
  frame.writeUInt8(type, 0);
  frame.writeUInt8(id, 1);
  frame.writeUInt32BE(body.length, 2);
  body.copy(frame, HEADER_SIZE);
  return frame;
}

/** Incremental parser copies each byte once, including one-byte TCP fragments. */
export class Decoder {
  private header = Buffer.alloc(HEADER_SIZE);
  private headerBytes = 0;
  private body = Buffer.alloc(0);
  private bodyBytes = 0;
  private type: Message = Message.PORT;
  private id = 0;

  push(chunk: Buffer, receive: (frame: Frame) => void): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.headerBytes < HEADER_SIZE) {
        const count = Math.min(HEADER_SIZE - this.headerBytes, chunk.length - offset);
        chunk.copy(this.header, this.headerBytes, offset, offset + count);
        this.headerBytes += count;
        offset += count;
        if (this.headerBytes < HEADER_SIZE) continue;
        this.type = this.header.readUInt8(0);
        this.id = this.header.readUInt8(1);
        const length = this.header.readUInt32BE(2);
        validate(this.type, this.id, length);
        this.body = Buffer.allocUnsafe(length);
        this.bodyBytes = 0;
      }
      const count = Math.min(this.body.length - this.bodyBytes, chunk.length - offset);
      chunk.copy(this.body, this.bodyBytes, offset, offset + count);
      this.bodyBytes += count;
      offset += count;
      if (this.bodyBytes === this.body.length) {
        const frame = { type: this.type, id: this.id, body: this.body };
        this.headerBytes = 0;
        this.body = Buffer.alloc(0);
        receive(frame);
      }
    }
  }
}
