import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { API, Logging, PlatformAccessory } from 'homebridge';

import { BambuPlatform } from '../src/platform.js';

const uuidOf = (serialNumber: string) => `uuid:${serialNumber}-camera`;

let storage: string;

beforeEach(async () => {
  storage = await mkdtemp(join(tmpdir(), 'bambu-platform-test-'));
});

afterEach(async () => {
  await rm(storage, { recursive: true, force: true });
});

/**
 * Just enough of the Homebridge API to start the platform. Its `hap` has no camera types, so
 * building a camera throws: the tests cover printers that are skipped or fail to start.
 */
function fakeHomebridge(config: Record<string, unknown>, cachedSerials: string[]) {
  const handlers = new Map<string, () => void>();
  const unregistered: string[] = [];
  const messages: Array<{ level: string; message: string }> = [];
  const record = (level: string) => (message: string) => messages.push({ level, message });
  const log = { info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug') } as unknown as Logging;

  const api = {
    on: (event: string, handler: () => void) => handlers.set(event, handler),
    user: { storagePath: () => storage },
    hap: { uuid: { generate: (seed: string) => `uuid:${seed}` }, Categories: { IP_CAMERA: 17 } },
    platformAccessory: class {},
    registerPlatformAccessories: () => undefined,
    updatePlatformAccessories: () => undefined,
    unregisterPlatformAccessories: (_plugin: string, _platform: string, accessories: PlatformAccessory[]) => {
      unregistered.push(...accessories.map((accessory) => accessory.UUID));
    },
  } as unknown as API;

  const platform = new BambuPlatform(log, { platform: 'Homebridge Bambu Plugin', ...config }, api);
  for (const serialNumber of cachedSerials) {
    platform.configureAccessory({ UUID: uuidOf(serialNumber), displayName: serialNumber } as unknown as PlatformAccessory);
  }
  platform.configureAccessory({ UUID: 'uuid:1.x-chamber-light' } as unknown as PlatformAccessory);
  handlers.get('didFinishLaunching')!();
  return { unregistered, messages };
}

const valid = (serialNumber: string) => ({ name: serialNumber, ipAddress: '192.168.1.50', serialNumber, lanAccessCode: 'SECRET42' });

describe('BambuPlatform', () => {
  it('keeps the camera of a printer whose config is invalid, and says why once', () => {
    const { unregistered, messages } = fakeHomebridge({ printers: [{ ...valid('KEEP'), ipAddress: '' }] }, ['KEEP']);
    assert.ok(!unregistered.includes(uuidOf('KEEP')));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].level, 'warn');
    assert.match(messages[0].message, /"KEEP".*IP address/);
  });

  it('removes the cameras of printers no longer in the config and 1.x accessories', () => {
    const { unregistered } = fakeHomebridge({ printers: [{ ...valid('KEEP'), lanAccessCode: '' }] }, ['KEEP', 'GONE']);
    assert.deepEqual(unregistered.sort(), [uuidOf('GONE'), 'uuid:1.x-chamber-light'].sort());
  });

  it('removes nothing while an entry has no serial number, since its camera cannot be told apart', () => {
    const { unregistered, messages } = fakeHomebridge({ printers: [{ ...valid('X'), serialNumber: '' }] }, ['MAYBE']);
    assert.deepEqual(unregistered, []);
    assert.match(messages[0].message, /serial number/);
  });

  it('keeps the camera of a printer that fails to start, and logs the error without credentials', () => {
    const { unregistered, messages } = fakeHomebridge({ printers: [valid('FAIL')] }, ['FAIL']);
    assert.ok(!unregistered.includes(uuidOf('FAIL')));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].level, 'error');
    assert.doesNotMatch(messages[0].message, /SECRET42/);
  });

  it('warns when no printer is configured', () => {
    const { messages } = fakeHomebridge({}, []);
    assert.equal(messages.length, 1);
    assert.match(messages[0].message, /No printer configured/);
  });

  it('never logs the access code', () => {
    const { messages } = fakeHomebridge({ printers: [{ ...valid('A'), ipAddress: 'not valid' }, { ...valid('B'), cameraRtspUrl: 'http://u:SECRET42@x' }] }, []);
    assert.equal(messages.length, 2);
    for (const { message } of messages) {
      assert.doesNotMatch(message, /SECRET42/);
    }
  });
});
