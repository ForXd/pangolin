import assert from 'node:assert/strict';
import test from 'node:test';
import { Decoder, encode, MAX_FRAME_SIZE } from '../dist/protocol.js';

test('fragmented and coalesced frames preserve binary payloads and unsigned IDs', () => {
  const frames = [encode(3, 255), encode(1, 255, Buffer.from([0, 255, 128])), encode(4, 255)];
  for (const step of [1, 2, 5, 6, 7, 100]) {
    const decoder = new Decoder();
    const received = [];
    const input = Buffer.concat(frames);
    for (let i = 0; i < input.length; i += step)
      decoder.push(input.subarray(i, i + step), (frame) => received.push(frame));
    assert.deepEqual(
      received.map(({ type, id, body }) => [type, id, [...body]]),
      [
        [3, 255, []],
        [1, 255, [0, 255, 128]],
        [4, 255, []],
      ],
    );
  }
});
test('reject invalid headers before allocating payload storage', () => {
  for (const [type, id, length] of [
    [1, 0, MAX_FRAME_SIZE + 1],
    [1, 0, 0xffffffff],
    [9, 0, 0],
    [0, 1, 4],
    [0, 0, 3],
    [3, 0, 1],
    [1, 0, 0],
  ]) {
    const header = Buffer.alloc(6);
    header[0] = type;
    header[1] = id;
    header.writeUInt32BE(length, 2);
    assert.throws(() => new Decoder().push(header, () => assert.fail('invalid frame accepted')));
  }
  assert.throws(() => encode(3, 256));
});
