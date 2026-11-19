import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { describe, it } from 'node:test';

import { PrinterPresence, rtspEndpoint, type PortState } from '../src/printerPresence.js';

const HOST = '192.168.1.50';
const STREAM_PORT = 322;
const IDLE_PORT = 9;

/** A probe answering from a table that the test changes, recording every port asked. */
function fakeProbe(states: Record<number, PortState>) {
  const asked: number[] = [];
  const probe = (_host: string, port: number) => {
    asked.push(port);
    return Promise.resolve(states[port] ?? 'silent');
  };
  return { asked, probe, states };
}

function presence(states: Record<number, PortState>, busy = () => false) {
  const changes: boolean[] = [];
  const fake = fakeProbe(states);
  const instance = new PrinterPresence(HOST, STREAM_PORT, (online) => changes.push(online), busy, fake.probe);
  return { instance, changes, ...fake };
}

describe('rtspEndpoint', () => {
  it('uses port 322 for rtsps and 554 for rtsp by default', () => {
    assert.deepEqual(rtspEndpoint('rtsps://bblp:code@192.168.1.50/streaming/live/1'), { host: '192.168.1.50', port: 322 });
    assert.deepEqual(rtspEndpoint('rtsp://bridge.local/live'), { host: 'bridge.local', port: 554 });
  });

  it('keeps an explicit port', () => {
    assert.deepEqual(rtspEndpoint('rtsps://bblp:code@192.168.1.50:322/streaming/live/1'), { host: '192.168.1.50', port: 322 });
    assert.deepEqual(rtspEndpoint('rtsp://192.168.1.60:8554/printer'), { host: '192.168.1.60', port: 8554 });
  });

  it('removes the brackets of an IPv6 host', () => {
    assert.deepEqual(rtspEndpoint('rtsps://bblp:code@[fe80::1]:322/streaming/live/1'), { host: 'fe80::1', port: 322 });
  });

  it('throws on a string that is not a URL', () => {
    assert.throws(() => rtspEndpoint('not a url'));
  });
});

describe('PrinterPresence', () => {
  it('asks the stream port first and reports the printer on', async () => {
    const { instance, changes, asked } = presence({ [STREAM_PORT]: 'open', [IDLE_PORT]: 'refused' });
    assert.equal(await instance.check(0), true);
    assert.deepEqual(changes, [true]);
    assert.ok(asked.includes(STREAM_PORT));
  });

  it('then only asks the idle port while the printer stays on', async () => {
    const { instance, asked } = presence({ [STREAM_PORT]: 'open', [IDLE_PORT]: 'refused' });
    await instance.check(0);
    await tick();
    asked.length = 0;
    assert.equal(await instance.check(0), true);
    assert.equal(await instance.check(0), true);
    assert.deepEqual(asked, [IDLE_PORT, IDLE_PORT]);
  });

  it('reports the printer off when the idle port stops answering, then asks the stream port again', async () => {
    const { instance, changes, asked, states } = presence({ [STREAM_PORT]: 'open', [IDLE_PORT]: 'refused' });
    await instance.check(0);
    await tick();
    states[IDLE_PORT] = 'silent';
    states[STREAM_PORT] = 'silent';
    assert.equal(await instance.check(0), false);
    assert.deepEqual(changes, [true, false]);
    asked.length = 0;
    await instance.check(0);
    assert.ok(asked.includes(STREAM_PORT));
  });

  it('keeps asking the stream port when the host drops connections to the idle port', async () => {
    const { instance, asked } = presence({ [STREAM_PORT]: 'open', [IDLE_PORT]: 'silent' });
    await instance.check(0);
    await tick();
    asked.length = 0;
    await instance.check(0);
    assert.ok(asked.includes(STREAM_PORT));
  });

  it('reports a printer whose stream port is closed as off', async () => {
    const { instance, changes } = presence({ [STREAM_PORT]: 'refused', [IDLE_PORT]: 'refused' });
    assert.equal(await instance.check(0), false);
    assert.deepEqual(changes, [false]);
  });

  it('asks the stream port again on recheck', async () => {
    const { instance, asked } = presence({ [STREAM_PORT]: 'open', [IDLE_PORT]: 'refused' });
    await instance.check(0);
    await tick();
    asked.length = 0;
    await instance.recheck();
    assert.ok(asked.includes(STREAM_PORT));
  });

  it('answers from the last result while it is recent', async () => {
    const { instance, asked } = presence({ [STREAM_PORT]: 'open', [IDLE_PORT]: 'refused' });
    await instance.check(0);
    await tick();
    asked.length = 0;
    assert.equal(await instance.check(), true);
    assert.deepEqual(asked, []);
  });

  it('shares one probe between concurrent checks', async () => {
    const { instance, asked } = presence({ [STREAM_PORT]: 'open', [IDLE_PORT]: 'refused' });
    await Promise.all([instance.check(0), instance.check(0), instance.check(0)]);
    assert.equal(asked.filter((port) => port === STREAM_PORT).length, 1);
  });

  it('never probes while ffmpeg holds a connection', async () => {
    const { instance, asked, changes } = presence({}, () => true);
    assert.equal(await instance.check(0), true);
    assert.deepEqual(asked, []);
    assert.deepEqual(changes, []);
  });
});
