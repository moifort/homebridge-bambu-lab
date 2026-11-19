import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { passthroughArgs, snapshotArgs, transcodeArgs, type SrtpTarget, type TranscodeOptions } from '../src/ffmpegArgs.js';
import type { FfmpegCapabilities } from '../src/ffmpegCapabilities.js';

const URL = 'rtsps://bblp:12345678@192.168.1.50:322/streaming/live/1';
const MODERN: FfmpegCapabilities = { tlsVerifyOption: true, socketTimeoutOption: '-timeout' };
const OLD: FfmpegCapabilities = { tlsVerifyOption: false, socketTimeoutOption: '-stimeout' };
const BARE: FfmpegCapabilities = { tlsVerifyOption: false };

const target: SrtpTarget = {
  address: '192.168.1.20',
  port: 50000,
  ssrc: 1234,
  payloadType: 99,
  srtpParams: 'c2VjcmV0',
  mtu: 1378,
};

const video: TranscodeOptions = { width: 640, height: 360, fps: 30, bitrateKbps: 300, profile: 'main', level: '3.1' };

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

describe('input arguments', () => {
  it('read RTSP over TCP without probing the stream', () => {
    const args = passthroughArgs(URL, MODERN, target);
    assert.equal(valueAfter(args, '-rtsp_transport'), 'tcp');
    assert.equal(valueAfter(args, '-probesize'), '32');
    assert.equal(valueAfter(args, '-analyzeduration'), '0');
    assert.equal(valueAfter(args, '-i'), URL);
    assert.ok(!args.includes('-fflags'));
  });

  it('turn TLS verification off and set the socket timeout when ffmpeg supports them', () => {
    const args = passthroughArgs(URL, MODERN, target);
    assert.equal(valueAfter(args, '-tls_verify'), '0');
    assert.equal(valueAfter(args, '-timeout'), '5000000');
  });

  it('use -stimeout on ffmpeg 4 and no TLS option when it does not exist', () => {
    const args = passthroughArgs(URL, OLD, target);
    assert.ok(!args.includes('-tls_verify'));
    assert.equal(valueAfter(args, '-stimeout'), '5000000');
    assert.ok(!args.includes('-timeout'));
  });

  it('omit the socket timeout when ffmpeg has none', () => {
    const args = passthroughArgs(URL, BARE, target);
    assert.ok(!args.includes('-timeout'));
    assert.ok(!args.includes('-stimeout'));
  });

  it('put the input options before -i', () => {
    const args = transcodeArgs(URL, MODERN, video, target);
    const input = args.indexOf('-i');
    for (const flag of ['-rtsp_transport', '-tls_verify', '-timeout', '-probesize', '-analyzeduration', '-threads']) {
      assert.ok(args.indexOf(flag) < input, `${flag} before -i`);
    }
  });
});

describe('passthroughArgs', () => {
  it('forward the H.264 stream untouched with SPS/PPS before keyframes', () => {
    const args = passthroughArgs(URL, MODERN, target);
    assert.equal(valueAfter(args, '-c:v'), 'copy');
    assert.equal(valueAfter(args, '-bsf:v'), 'dump_extra');
    assert.equal(valueAfter(args, '-map'), '0:v:0');
  });

  it('send SRTP to the HomeKit target', () => {
    const args = passthroughArgs(URL, MODERN, target);
    assert.equal(valueAfter(args, '-payload_type'), '99');
    assert.equal(valueAfter(args, '-ssrc'), '1234');
    assert.equal(valueAfter(args, '-srtp_out_suite'), 'AES_CM_128_HMAC_SHA1_80');
    assert.equal(valueAfter(args, '-srtp_out_params'), 'c2VjcmV0');
    assert.equal(args.at(-1), 'srtp://192.168.1.20:50000?rtcpport=50000&pkt_size=1316');
  });

  it('put an IPv6 target between brackets', () => {
    const args = passthroughArgs(URL, MODERN, { ...target, address: 'fe80::1' });
    assert.equal(args.at(-1), 'srtp://[fe80::1]:50000?rtcpport=50000&pkt_size=1316');
  });

  it('fit the packet size to the MTU, within bounds', () => {
    assert.match(passthroughArgs(URL, MODERN, { ...target, mtu: 1000 }).at(-1)!, /pkt_size=1000$/);
    assert.match(passthroughArgs(URL, MODERN, { ...target, mtu: 100 }).at(-1)!, /pkt_size=400$/);
    assert.match(passthroughArgs(URL, MODERN, { ...target, mtu: 0 }).at(-1)!, /pkt_size=1316$/);
    assert.match(passthroughArgs(URL, MODERN, { ...target, mtu: Number.NaN }).at(-1)!, /pkt_size=1316$/);
  });
});

describe('transcodeArgs', () => {
  it('re-encode to the requested size, frame rate and bitrate', () => {
    const args = transcodeArgs(URL, MODERN, video, target);
    assert.equal(valueAfter(args, '-vf'), 'fps=30,scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:-1:-1');
    assert.equal(valueAfter(args, '-c:v'), 'libx264');
    assert.equal(valueAfter(args, '-preset'), 'ultrafast');
    assert.equal(valueAfter(args, '-tune'), 'zerolatency');
    assert.equal(valueAfter(args, '-profile:v'), 'main');
    assert.equal(valueAfter(args, '-level:v'), '3.1');
    assert.equal(valueAfter(args, '-g'), '30');
    assert.equal(valueAfter(args, '-b:v'), '300k');
    assert.equal(valueAfter(args, '-maxrate'), '300k');
    assert.equal(valueAfter(args, '-bufsize'), '300k');
    assert.equal(valueAfter(args, '-threads'), '2');
  });
});

describe('snapshotArgs', () => {
  it('write one JPEG frame to stdout', () => {
    const args = snapshotArgs(URL, MODERN);
    assert.equal(valueAfter(args, '-frames:v'), '1');
    assert.equal(valueAfter(args, '-c:v'), 'mjpeg');
    assert.equal(args.at(-1), 'pipe:1');
  });

  it('capture at a fixed size, never upscaled beyond the source', () => {
    assert.equal(valueAfter(snapshotArgs(URL, MODERN), '-vf'), 'scale=\'min(1920,iw)\':\'min(1080,ih)\':force_original_aspect_ratio=decrease');
  });
});
