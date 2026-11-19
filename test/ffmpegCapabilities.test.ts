/* eslint-disable max-len -- verbatim ffmpeg output */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseRtspHelp } from '../src/ffmpegCapabilities.js';

/** Excerpts of `ffmpeg -h demuxer=rtsp` from the versions found on Homebridge hosts. */
const FFMPEG_8 = `Demuxer rtsp [RTSP input]:
RTSP demuxer AVOptions:
  -rtsp_transport    <flags>      .D......... set RTSP transport protocols (default 0)
  -listen_timeout    <int>        .D......... set maximum timeout (in seconds) to wait for incoming connections (from -1 to INT_MAX) (default -1)
  -timeout           <int64>      .D......... set timeout (in microseconds) of socket I/O operations (from INT_MIN to I64_MAX) (default 0)
  -tls_verify        <boolean>    .D......... verify the peer certificate (default true)
`;

const FFMPEG_4 = `Demuxer rtsp [RTSP input]:
rtsp demuxer AVOptions:
  -rtsp_transport    <flags>      .D........ set RTSP transport protocols (default 0)
  -timeout           <int>        .D........ set maximum timeout (in seconds) to wait for incoming connections (-1 is infinite, imply flag listen) (from INT_MIN to INT_MAX) (default -1)
  -stimeout          <int>        .D........ set timeout (in microseconds) of socket TCP I/O operations (from INT_MIN to INT_MAX) (default 0)
`;

describe('parseRtspHelp', () => {
  it('detects -tls_verify and the -timeout socket option of ffmpeg 5 and later', () => {
    assert.deepEqual(parseRtspHelp(FFMPEG_8), { tlsVerifyOption: true, socketTimeoutOption: '-timeout' });
  });

  it('uses -stimeout on ffmpeg 4, whose -timeout is the listen timeout', () => {
    assert.deepEqual(parseRtspHelp(FFMPEG_4), { tlsVerifyOption: false, socketTimeoutOption: '-stimeout' });
  });

  it('finds no option in an empty help (ffmpeg missing)', () => {
    assert.deepEqual(parseRtspHelp(''), { tlsVerifyOption: false, socketTimeoutOption: undefined });
  });

  it('does not match an option name inside a description', () => {
    assert.equal(parseRtspHelp('  -other   <int>  mentions -tls_verify here\n').tlsVerifyOption, false);
  });
});
