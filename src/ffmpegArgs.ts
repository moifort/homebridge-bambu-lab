import type { FfmpegCapabilities } from './ffmpegCapabilities.js';

/** Where and how to send the SRTP video negotiated with HomeKit. */
export interface SrtpTarget {
  address: string;
  port: number;
  ssrc: number;
  payloadType: number;
  /** base64(SRTP master key ‖ master salt). */
  srtpParams: string;
  mtu: number;
}

export interface TranscodeOptions {
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
  profile: 'baseline' | 'main' | 'high';
  level: '3.1' | '3.2' | '4.0';
}

/** Gives up when the printer stops answering, instead of keeping a dead session or capture open. */
const SOCKET_TIMEOUT_US = 5_000_000;
/** Largest RTP packet that fits HomeKit's MTU once SRTP and IP/UDP headers are added. */
const MAX_PACKET_SIZE = 1316;

/**
 * Input side, shared by every command.
 * - RTSP over TCP: the printer serves RTSPS over TCP and TCP avoids UDP losses on Wi-Fi.
 * - `-probesize 32 -analyzeduration 0`: start as soon as the first packets arrive. With the
 *   defaults ffmpeg spends about one second probing before the first frame. The SDP already
 *   describes the H.264 stream, so nothing is lost.
 * - No `-fflags nobuffer`: it drops the packets read while probing, and when the keyframe was
 *   among them the stream starts one GOP later.
 */
function inputArgs(url: string, caps: FfmpegCapabilities, decoderArgs: string[] = []): string[] {
  return [
    '-hide_banner',
    '-nostats',
    '-loglevel', 'error',
    '-rtsp_transport', 'tcp',
    ...(caps.tlsVerifyOption ? ['-tls_verify', '0'] : []),
    ...(caps.socketTimeoutOption ? [caps.socketTimeoutOption, `${SOCKET_TIMEOUT_US}`] : []),
    '-probesize', '32',
    '-analyzeduration', '0',
    ...decoderArgs,
    '-i', url,
  ];
}

function srtpOutputArgs(target: SrtpTarget): string[] {
  const host = target.address.includes(':') ? `[${target.address}]` : target.address;
  const packetSize = Number.isFinite(target.mtu) && target.mtu > 0
    ? Math.max(400, Math.min(MAX_PACKET_SIZE, Math.floor(target.mtu)))
    : MAX_PACKET_SIZE;

  return [
    '-payload_type', `${target.payloadType}`,
    '-ssrc', `${target.ssrc}`,
    '-f', 'rtp',
    '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
    '-srtp_out_params', target.srtpParams,
    `srtp://${host}:${target.port}?rtcpport=${target.port}&pkt_size=${packetSize}`,
  ];
}

/**
 * Live view at full resolution: the printer's H.264 is forwarded untouched.
 * `dump_extra` puts SPS/PPS in front of every keyframe, for printers that only announce
 * them in the SDP: without them HomeKit cannot decode the stream.
 */
export function passthroughArgs(url: string, caps: FfmpegCapabilities, target: SrtpTarget): string[] {
  return [
    ...inputArgs(url, caps),
    '-map', '0:v:0',
    '-c:v', 'copy',
    '-bsf:v', 'dump_extra',
    ...srtpOutputArgs(target),
  ];
}

/**
 * Small resolutions (Apple Watch, remote viewing): re-encoded to what HomeKit asked for.
 * - Decoder `-threads 2`: frame threading delays output by (threads − 1) frames; the default
 *   (one thread per core + 1) added about 300 ms, two threads add one frame and keep the
 *   decoding throughput needed on a Raspberry Pi.
 * - libx264 `ultrafast` + `zerolatency` on every OS: at these sizes it is cheap, and
 *   h264_videotoolbox (macOS) added about 300 ms of latency even without B-frames.
 * - `fps` before `scale`, so dropped frames are never scaled.
 * - One-second GOP and one-second VBV buffer: quick recovery, no bursts.
 */
export function transcodeArgs(url: string, caps: FfmpegCapabilities, video: TranscodeOptions, target: SrtpTarget): string[] {
  const { width, height, fps, bitrateKbps } = video;

  return [
    ...inputArgs(url, caps, ['-threads', '2']),
    '-map', '0:v:0',
    '-vf', `fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:-1:-1`,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-profile:v', video.profile,
    '-level:v', video.level,
    '-pix_fmt', 'yuv420p',
    '-g', `${fps}`,
    '-b:v', `${bitrateKbps}k`,
    '-maxrate', `${bitrateKbps}k`,
    '-bufsize', `${bitrateKbps}k`,
    ...srtpOutputArgs(target),
  ];
}

/** Snapshot size: the largest resolution HomeKit asks for. */
const SNAPSHOT_MAX_WIDTH = 1920;
const SNAPSHOT_MAX_HEIGHT = 1080;

/**
 * One JPEG frame on stdout, decoded from the first keyframe received. Always captured at the same
 * size, as large as HomeKit ever asks for (smaller if the source is): the cached frame answers every
 * request, from a small tile to full screen.
 */
export function snapshotArgs(url: string, caps: FfmpegCapabilities): string[] {
  return [
    ...inputArgs(url, caps),
    '-map', '0:v:0',
    '-frames:v', '1',
    '-vf', `scale='min(${SNAPSHOT_MAX_WIDTH},iw)':'min(${SNAPSHOT_MAX_HEIGHT},ih)':force_original_aspect_ratio=decrease`,
    '-f', 'image2',
    '-c:v', 'mjpeg',
    'pipe:1',
  ];
}
