import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { probeCapabilities } from '../src/ffmpegCapabilities.js';
import { describeExit, FfmpegProcess, runForOutput, StderrTail } from '../src/ffmpegProcess.js';

/** Node itself stands in for ffmpeg: `node -e <script>`. */
const NODE = process.execPath;
const MISSING = '/nonexistent/ffmpeg';

describe('StderrTail', () => {
  it('keeps the last ten non-empty lines, across chunks', () => {
    const tail = new StderrTail(null);
    tail.push('line 0\nline ');
    tail.push('1\n\n');
    for (let index = 2; index < 15; index++) {
      tail.push(`line ${index}\r\n`);
    }
    tail.push('partial');
    const expected = [...Array.from({ length: 10 }, (_, index) => `line ${index + 5}`), 'partial'];
    assert.deepEqual(tail.text().split('\n'), expected);
  });

  it('caps the length of a line', () => {
    const tail = new StderrTail(null);
    tail.push(`${'x'.repeat(2_000)}\n`);
    assert.equal(tail.text().length, 500);
  });
});

describe('describeExit', () => {
  it('names the exit code, the signal or the spawn error, then the stderr lines', () => {
    assert.equal(describeExit(1, null, 'Connection refused'), 'exit code 1\nConnection refused');
    assert.equal(describeExit(null, 'SIGKILL', ''), 'killed by SIGKILL');
    assert.equal(describeExit(null, null, '', new Error('spawn ffmpeg ENOENT')), 'spawn ffmpeg ENOENT');
  });
});

describe('runForOutput', () => {
  it('returns stdout when the command succeeds', async () => {
    const { result } = runForOutput(NODE, ['-e', 'process.stdout.write("jpeg")'], 5_000);
    assert.equal((await result).toString(), 'jpeg');
  });

  it('rejects with the exit code and the last stderr lines', async () => {
    const { result } = runForOutput(NODE, ['-e', 'process.stderr.write("first\\nlast error\\n"); process.exit(1)'], 5_000);
    await assert.rejects(result, (error: Error) => error.message === 'exit code 1\nfirst\nlast error');
  });

  it('rejects when nothing was written', async () => {
    const { result } = runForOutput(NODE, ['-e', ''], 5_000);
    await assert.rejects(result, /exit code 0/);
  });

  it('rejects when the binary does not exist', async () => {
    const { result } = runForOutput(MISSING, [], 5_000);
    await assert.rejects(result, /ENOENT/);
  });

  it('kills the command after the timeout', async () => {
    const { result } = runForOutput(NODE, ['-e', 'setTimeout(() => {}, 60_000)'], 100);
    await assert.rejects(result, /no frame within 0.1 s/);
  });

  it('can be killed by the caller', async () => {
    const { result, kill } = runForOutput(NODE, ['-e', 'setTimeout(() => {}, 60_000)'], 60_000);
    kill();
    await assert.rejects(result, /SIGKILL/);
  });
});

describe('FfmpegProcess', () => {
  it('reports an unexpected end with its stderr', async () => {
    const reason = await new Promise<string>((resolve) => {
      new FfmpegProcess(NODE, ['-e', 'process.stderr.write("stream ended\\n"); process.exit(1)'], resolve);
    });
    assert.equal(reason, 'exit code 1\nstream ended');
  });

  it('reports a binary that does not exist', async () => {
    const reason = await new Promise<string>((resolve) => {
      new FfmpegProcess(MISSING, [], resolve);
    });
    assert.match(reason, /ENOENT/);
  });

  it('stays silent when stopped by the plugin', async () => {
    let reported = false;
    const ffmpeg = new FfmpegProcess(NODE, ['-e', 'setTimeout(() => {}, 60_000)'], () => {
      reported = true;
    });
    ffmpeg.stop();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(reported, false);
  });
});

describe('probeCapabilities', () => {
  it('says why ffmpeg cannot be used when the binary does not exist', async () => {
    const caps = await probeCapabilities(MISSING);
    assert.equal(caps.unavailable, 'ENOENT');
    assert.equal(caps.tlsVerifyOption, false);
  });
});
