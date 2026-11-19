import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { redactUrls } from '../src/redact.js';

describe('redactUrls', () => {
  it('hides the user and password of every URL', () => {
    assert.equal(
      redactUrls('rtsps://bblp:12345678@192.168.1.50:322/streaming/live/1: Connection refused, then rtsp://u:p@[fe80::1]/x'),
      'rtsps://***@192.168.1.50:322/streaming/live/1: Connection refused, then rtsp://***@[fe80::1]/x',
    );
  });

  it('leaves URLs without credentials and other text untouched', () => {
    assert.equal(redactUrls('rtsp://bridge.local:8554/p1s timed out'), 'rtsp://bridge.local:8554/p1s timed out');
    assert.equal(redactUrls('user@example.com'), 'user@example.com');
  });
});
