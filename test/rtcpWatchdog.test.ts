import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RtcpWatchdog } from '../src/rtcpWatchdog.js';

describe('RtcpWatchdog', () => {
  it('fires when no report arrives after the start, even if none ever did', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let fired = 0;
    const watchdog = new RtcpWatchdog(15_000, 5_000, () => fired++);
    watchdog.start();
    t.mock.timers.tick(14_999);
    assert.equal(fired, 0);
    t.mock.timers.tick(1);
    assert.equal(fired, 1);
  });

  it('waits the regular delay after each report', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let fired = 0;
    const watchdog = new RtcpWatchdog(15_000, 5_000, () => fired++);
    watchdog.start();
    t.mock.timers.tick(1_000);
    watchdog.feed();
    t.mock.timers.tick(4_000);
    watchdog.feed();
    t.mock.timers.tick(4_999);
    assert.equal(fired, 0);
    t.mock.timers.tick(1);
    assert.equal(fired, 1);
  });

  it('fires only once', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let fired = 0;
    const watchdog = new RtcpWatchdog(1_000, 1_000, () => fired++);
    watchdog.start();
    t.mock.timers.tick(1_000);
    watchdog.feed();
    t.mock.timers.tick(5_000);
    assert.equal(fired, 1);
  });

  it('never fires once stopped', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let fired = 0;
    const watchdog = new RtcpWatchdog(1_000, 1_000, () => fired++);
    watchdog.start();
    watchdog.stop();
    watchdog.feed();
    t.mock.timers.tick(10_000);
    assert.equal(fired, 0);
  });
});
