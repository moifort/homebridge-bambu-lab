import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { describe, it } from 'node:test';

import { bindUdpSocket, closeSocket } from '../src/udpSocket.js';

describe('bindUdpSocket', () => {
  it('resolves with a socket bound on a random port', async () => {
    const socket = await bindUdpSocket('udp4', () => assert.fail('no later error expected'));
    try {
      assert.ok(socket.address().port > 0);
    } finally {
      closeSocket(socket);
    }
  });

  it('sends errors raised after the bind to the later-error handler, every time, without throwing', async () => {
    const errors: Error[] = [];
    const socket = await bindUdpSocket('udp4', (error) => errors.push(error));
    try {
      socket.emit('error', new Error('first'));
      socket.emit('error', new Error('second'));
      assert.deepEqual(errors.map((error) => error.message), ['first', 'second']);
    } finally {
      closeSocket(socket);
    }
  });

  it('rejects once when the bind fails, and never calls the later-error handler', async () => {
    let laterErrors = 0;
    // 192.0.2.1 (TEST-NET-1) is not an address of this host: the bind fails.
    await assert.rejects(bindUdpSocket('udp4', () => laterErrors++, '192.0.2.1'));
    await tick();
    assert.equal(laterErrors, 0);
  });
});

describe('closeSocket', () => {
  it('ignores a socket that is already closed', async () => {
    const socket = await bindUdpSocket('udp4', () => undefined);
    closeSocket(socket);
    assert.doesNotThrow(() => closeSocket(socket));
  });
});
