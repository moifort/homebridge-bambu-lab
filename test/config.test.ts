import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PlatformConfig } from 'homebridge';

import { readPrinters } from '../src/config.js';

const platform = (extra: Record<string, unknown>): PlatformConfig => ({ platform: 'Homebridge Bambu Plugin', ...extra });

const X2D = { name: 'Office', model: 'X2D', ipAddress: '192.168.1.50', serialNumber: '0938AC123456789', lanAccessCode: '12345678' };

describe('readPrinters', () => {
  it('reads a complete printer and builds the RTSPS URL', () => {
    const { printers, skipped } = readPrinters(platform({ printers: [X2D] }));
    assert.deepEqual(skipped, []);
    assert.deepEqual(printers, [{
      name: 'Office',
      model: 'X2D',
      serialNumber: '0938AC123456789',
      streamUrl: 'rtsps://bblp:12345678@192.168.1.50:322/streaming/live/1',
      cameraName: 'Office Camera',
      ffmpegPath: 'ffmpeg',
      snapshotFile: 'bambu-0938AC123456789-snapshot.jpg',
    }]);
  });

  it('applies defaults for the name, model, camera name and ffmpeg path', () => {
    const { printers } = readPrinters(platform({ printers: [{ ipAddress: '10.0.0.2', serialNumber: '01S00C123456789', lanAccessCode: 'abcd1234' }] }));
    assert.equal(printers[0].model, 'Bambu Printer');
    assert.equal(printers[0].name, 'Bambu Printer 6789');
    assert.equal(printers[0].cameraName, 'Bambu Printer 6789 Camera');
    assert.equal(printers[0].ffmpegPath, 'ffmpeg');
  });

  it('trims values and keeps custom names and paths', () => {
    const { printers } = readPrinters(platform({ printers: [{ ...X2D, name: '  Lab  ', cameraName: ' Cam ', ffmpegPath: ' /usr/bin/ffmpeg ' }] }));
    assert.equal(printers[0].name, 'Lab');
    assert.equal(printers[0].cameraName, 'Cam');
    assert.equal(printers[0].ffmpegPath, '/usr/bin/ffmpeg');
  });

  it('encodes the access code in the URL', () => {
    const { printers } = readPrinters(platform({ printers: [{ ...X2D, lanAccessCode: 'a@b:c/d' }] }));
    assert.equal(printers[0].streamUrl, 'rtsps://bblp:a%40b%3Ac%2Fd@192.168.1.50:322/streaming/live/1');
  });

  it('puts an IPv6 address between brackets', () => {
    const { printers } = readPrinters(platform({ printers: [{ ...X2D, ipAddress: 'fe80::1' }, { ...X2D, serialNumber: 'B', ipAddress: '[fd00::2]' }] }));
    assert.equal(printers[0].streamUrl, 'rtsps://bblp:12345678@[fe80::1]:322/streaming/live/1');
    assert.equal(printers[1].streamUrl, 'rtsps://bblp:12345678@[fd00::2]:322/streaming/live/1');
  });

  it('accepts a host name', () => {
    const { printers } = readPrinters(platform({ printers: [{ ...X2D, ipAddress: 'x2d.local' }] }));
    assert.equal(printers[0].streamUrl, 'rtsps://bblp:12345678@x2d.local:322/streaming/live/1');
  });

  it('does not require the IP address and access code with a custom stream URL', () => {
    const { printers, skipped } = readPrinters(platform({
      printers: [{ name: 'P1S', serialNumber: '01P00A123456789', cameraRtspUrl: 'rtsp://bridge.local:8554/p1s' }],
    }));
    assert.deepEqual(skipped, []);
    assert.equal(printers[0].streamUrl, 'rtsp://bridge.local:8554/p1s');
  });

  it('skips a printer without serial number, with the reason', () => {
    const { printers, skipped } = readPrinters(platform({ printers: [{ ...X2D, serialNumber: ' ' }] }));
    assert.deepEqual(printers, []);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].serialNumber, undefined);
    assert.match(skipped[0].reason, /serial number/);
    assert.match(skipped[0].label, /Office/);
  });

  it('skips a printer without IP address or access code, and keeps its serial number', () => {
    const { printers, skipped } = readPrinters(platform({
      printers: [{ ...X2D, ipAddress: undefined }, { ...X2D, serialNumber: 'B', lanAccessCode: '' }],
    }));
    assert.deepEqual(printers, []);
    assert.deepEqual(skipped.map((entry) => entry.serialNumber), ['0938AC123456789', 'B']);
    assert.match(skipped[0].reason, /IP address/);
    assert.match(skipped[1].reason, /access code/);
  });

  it('skips an invalid IP address', () => {
    const { skipped } = readPrinters(platform({ printers: [{ ...X2D, ipAddress: '192.168.1.50/24' }] }));
    assert.match(skipped[0].reason, /IP address/);
  });

  it('skips a custom stream URL that is not RTSP, without showing it', () => {
    const urls = ['http://bridge.local/stream', 'not a url', 'rtsp://user:secret@'];
    const { printers, skipped } = readPrinters(platform({
      printers: urls.map((cameraRtspUrl, index) => ({ ...X2D, serialNumber: `S${index}`, cameraRtspUrl })),
    }));
    assert.deepEqual(printers, []);
    assert.equal(skipped.length, 3);
    for (const entry of skipped) {
      assert.match(entry.reason, /rtsp/);
      assert.doesNotMatch(entry.reason, /secret|bridge/);
    }
  });

  it('skips a second printer with the same serial number', () => {
    const { printers, skipped } = readPrinters(platform({ printers: [X2D, { ...X2D, name: 'Copy' }] }));
    assert.equal(printers.length, 1);
    assert.equal(skipped[0].serialNumber, X2D.serialNumber);
    assert.match(skipped[0].reason, /same serial number/);
  });

  it('skips an entry that is not an object', () => {
    const { printers, skipped } = readPrinters(platform({ printers: [null, 'x', X2D] }));
    assert.equal(printers.length, 1);
    assert.equal(skipped.length, 2);
  });

  it('never shows the access code in a reason or label', () => {
    const { skipped } = readPrinters(platform({ printers: [{ ...X2D, ipAddress: 'bad host', lanAccessCode: 'TOPSECRET' }] }));
    assert.doesNotMatch(`${skipped[0].label} ${skipped[0].reason}`, /TOPSECRET/);
  });

  it('makes the serial number safe to use in the snapshot file name', () => {
    const { printers } = readPrinters(platform({ printers: [{ ...X2D, serialNumber: '../../etc/passwd' }] }));
    assert.equal(printers[0].serialNumber, '../../etc/passwd');
    assert.doesNotMatch(printers[0].snapshotFile, /\//);
    assert.equal(printers[0].snapshotFile, 'bambu-.._.._etc_passwd-snapshot.jpg');
  });

  it('reads the flat configuration of 1.x at the platform root', () => {
    const { printers } = readPrinters(platform({ name: 'Legacy', ipAddress: '192.168.1.50', serialNumber: 'ABC', lanAccessCode: '12345678' }));
    assert.equal(printers.length, 1);
    assert.equal(printers[0].name, 'Legacy');
    assert.equal(printers[0].model, 'Bambu Printer');
  });

  it('returns nothing when no printer is configured', () => {
    assert.deepEqual(readPrinters(platform({})), { printers: [], skipped: [] });
    assert.deepEqual(readPrinters(platform({ printers: [] })), { printers: [], skipped: [] });
  });
});
