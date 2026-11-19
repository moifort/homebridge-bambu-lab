import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { CaptureCancelledError, SnapshotCache } from '../src/snapshotCache.js';

const IMAGE = Buffer.from('jpeg-1');
const NEWER_IMAGE = Buffer.from('jpeg-2');

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bambu-snapshot-test-'));
  filePath = join(dir, 'snapshot.jpg');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A capture that answers with the queued results in turn, counting its calls. */
function queuedCapture(...results: Array<Buffer | Error>) {
  const calls: unknown[][] = [];
  const capture = (...args: unknown[]) => {
    calls.push(args);
    const result = results.shift() ?? IMAGE;
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  };
  return { calls, capture };
}

/** Waits for background work (capture, file write) to settle. */
async function eventually(check: () => Promise<boolean> | boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) {
      return;
    }
    await sleep(10);
  }
  assert.fail('condition not reached');
}

const fileContains = (image: Buffer) => async () => (await readFile(filePath).catch(() => Buffer.alloc(0))).equals(image);

async function writeOldSnapshot(image: Buffer) {
  await writeFile(filePath, image);
  const old = new Date(Date.now() - 120_000);
  await utimes(filePath, old, old);
}

describe('SnapshotCache', () => {
  it('captures a frame when nothing is cached, and stores it', async () => {
    const { calls, capture } = queuedCapture(IMAGE);
    const cache = new SnapshotCache(filePath, capture, () => false);
    assert.deepEqual(await cache.get(), IMAGE);
    assert.equal(calls.length, 1);
    assert.deepEqual(await readFile(filePath), IMAGE);
  });

  it('serves a recent snapshot without capturing', async () => {
    await writeFile(filePath, IMAGE);
    const { calls, capture } = queuedCapture();
    const cache = new SnapshotCache(filePath, capture, () => false);
    assert.deepEqual(await cache.get(), IMAGE);
    assert.equal(calls.length, 0);
  });

  it('serves an old snapshot at once and refreshes it in the background', async () => {
    await writeOldSnapshot(IMAGE);
    const { calls, capture } = queuedCapture(NEWER_IMAGE);
    const cache = new SnapshotCache(filePath, capture, () => false);
    assert.deepEqual(await cache.get(), IMAGE);
    assert.equal(calls.length, 1);
    await eventually(fileContains(NEWER_IMAGE));
  });

  it('shares one capture between concurrent requests', async () => {
    const { calls, capture } = queuedCapture(IMAGE);
    const cache = new SnapshotCache(filePath, capture, () => false);
    await Promise.all([cache.get(), cache.get(), cache.get()]);
    assert.equal(calls.length, 1);
  });

  it('never captures while a live stream holds the printer connection', async () => {
    const { calls, capture } = queuedCapture();
    const cache = new SnapshotCache(filePath, capture, () => true);
    await assert.rejects(cache.get());
    assert.equal(calls.length, 0);
  });

  it('waits before capturing again after a failure', async () => {
    const { calls, capture } = queuedCapture(new Error('unreachable'));
    const cache = new SnapshotCache(filePath, capture, () => false);
    await assert.rejects(cache.get(), /unreachable/);
    await assert.rejects(cache.get(), /retrying later/);
    assert.equal(calls.length, 1);
  });

  it('forgets past failures when the printer is back', async () => {
    const { calls, capture } = queuedCapture(new Error('unreachable'), IMAGE);
    const cache = new SnapshotCache(filePath, capture, () => false);
    await assert.rejects(cache.get());
    cache.refreshAfterReconnect();
    await eventually(fileContains(IMAGE));
    assert.equal(calls.length, 2);
  });

  it('does not count a capture cancelled by the plugin as a failure', async () => {
    const { calls, capture } = queuedCapture(new CaptureCancelledError(), IMAGE);
    const cache = new SnapshotCache(filePath, capture, () => false);
    await assert.rejects(cache.get(), CaptureCancelledError);
    assert.deepEqual(await cache.get(), IMAGE);
    assert.equal(calls.length, 2);
  });

  it('captures at one fixed size whatever the request, so a small tile never shrinks the cached image', async () => {
    const { calls, capture } = queuedCapture(IMAGE);
    const cache = new SnapshotCache(filePath, capture, () => false);
    await cache.get();
    assert.deepEqual(calls, [[]]);
  });
});
