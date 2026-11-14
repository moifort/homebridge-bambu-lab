import { execFile } from 'node:child_process';

/** RTSP demuxer options that differ between the ffmpeg versions found on Homebridge hosts. */
export interface FfmpegCapabilities {
  /**
   * The RTSP demuxer exposes `-tls_verify`. Recent ffmpeg releases verify the server
   * certificate by default, which rejects the printer's self-signed certificate.
   */
  tlsVerifyOption: boolean;
  /** Socket I/O timeout option: `-timeout` (ffmpeg ≥ 5), `-stimeout` (ffmpeg 4), or none. */
  socketTimeoutOption?: '-timeout' | '-stimeout';
}

export function parseRtspHelp(help: string): FfmpegCapabilities {
  const hasOption = (name: string) => new RegExp(`^\\s+-${name}\\s`, 'm').test(help);
  return {
    tlsVerifyOption: hasOption('tls_verify'),
    // ffmpeg 4 used `-timeout` for the listen timeout; `-listen_timeout` appeared when it was renamed.
    socketTimeoutOption: hasOption('listen_timeout') ? '-timeout' : hasOption('stimeout') ? '-stimeout' : undefined,
  };
}

const probes = new Map<string, Promise<FfmpegCapabilities>>();

/** Reads the RTSP demuxer options of the given ffmpeg binary once and caches the result. */
export function probeCapabilities(ffmpegPath: string): Promise<FfmpegCapabilities> {
  let probe = probes.get(ffmpegPath);
  if (!probe) {
    probe = new Promise((resolve) => {
      execFile(ffmpegPath, ['-hide_banner', '-h', 'demuxer=rtsp'], { timeout: 15_000 }, (_error, stdout) => {
        const help = typeof stdout === 'string' ? stdout : '';
        if (!help.includes('-rtsp_transport')) {
          // ffmpeg missing or too slow to answer: probe again on the next stream.
          probes.delete(ffmpegPath);
        }
        resolve(parseRtspHelp(help));
      });
    });
    probes.set(ffmpegPath, probe);
  }
  return probe;
}
