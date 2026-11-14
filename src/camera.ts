import { createSocket, type Socket } from 'node:dgram';
import { randomInt } from 'node:crypto';
import { join } from 'node:path';

import type {
  API,
  CameraController,
  CameraStreamingDelegate,
  PlatformAccessory,
  PrepareStreamCallback,
  PrepareStreamRequest,
  SnapshotRequest,
  SnapshotRequestCallback,
  StartStreamRequest,
  StreamRequestCallback,
  StreamingRequest,
} from 'homebridge';

import type { PrinterConfig } from './config.js';
import { passthroughArgs, snapshotArgs, transcodeArgs, type SrtpTarget, type TranscodeOptions } from './ffmpegArgs.js';
import { probeCapabilities } from './ffmpegCapabilities.js';
import { FfmpegProcess, runForOutput } from './ffmpegProcess.js';
import { SnapshotCache } from './snapshotCache.js';

function closeSocket(socket: Socket): void {
  try {
    socket.close();
  } catch {
    // already closed
  }
}

/** From this width on, the printer's own H.264 is forwarded without re-encoding. */
const PASSTHROUGH_MIN_WIDTH = 1280;
const SNAPSHOT_TIMEOUT_MS = 10_000;
/** A session whose viewer stopped sending RTCP reports for this long is considered gone. */
const MIN_RTCP_SILENCE_MS = 5_000;

interface PreparedSession {
  socket: Socket;
  target: Omit<SrtpTarget, 'payloadType' | 'mtu'>;
}

interface ActiveSession {
  id: string;
  socket: Socket;
  ffmpeg: FfmpegProcess;
  watchdog?: NodeJS.Timeout;
}

/**
 * HomeKit camera of one printer. One live session at a time: printers accept few RTSP
 * connections, so a new viewer takes over the stream of the previous one.
 */
export class BambuCamera implements CameraStreamingDelegate {
  private readonly controller: CameraController;
  private readonly snapshots: SnapshotCache;
  private readonly prepared = new Map<string, PreparedSession>();
  private active?: ActiveSession;
  private killSnapshot?: () => void;

  constructor(
    private readonly api: API,
    accessory: PlatformAccessory,
    private readonly printer: PrinterConfig,
    storagePath: string,
  ) {
    const { hap } = api;

    accessory.getService(hap.Service.AccessoryInformation)!
      .setCharacteristic(hap.Characteristic.Manufacturer, 'Bambu Lab')
      .setCharacteristic(hap.Characteristic.Model, printer.model)
      .setCharacteristic(hap.Characteristic.SerialNumber, printer.serialNumber);

    this.snapshots = new SnapshotCache(
      join(storagePath, `bambu-${printer.serialNumber}-snapshot.jpg`),
      (width, height) => this.captureFrame(width, height),
      () => this.active !== undefined,
    );

    this.controller = new hap.CameraController({
      // Two so that a second viewer can take over; the first session is then stopped.
      cameraStreamCount: 2,
      delegate: this,
      streamingOptions: {
        supportedCryptoSuites: [hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: {
          codec: {
            profiles: [hap.H264Profile.BASELINE, hap.H264Profile.MAIN, hap.H264Profile.HIGH],
            levels: [hap.H264Level.LEVEL3_1, hap.H264Level.LEVEL3_2, hap.H264Level.LEVEL4_0],
          },
          resolutions: [
            // forwarded as is
            [1920, 1080, 30],
            [1280, 720, 30],
            // re-encoded
            [640, 360, 30],
            [480, 270, 30],
            [320, 180, 30],
            [320, 240, 15], // required by Apple Watch
          ],
        },
      },
    });
    accessory.configureController(this.controller);

    // Warm the cache so the first stream does not wait for it.
    void probeCapabilities(printer.ffmpegPath);
  }

  handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): void {
    const width = request.width > 0 ? request.width : 1280;
    const height = request.height > 0 ? request.height : 720;
    this.snapshots.get(width, height).then(
      (image) => callback(undefined, image),
      (error: Error) => callback(error),
    );
  }

  prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): void {
    const socket = createSocket(request.addressVersion === 'ipv6' ? 'udp6' : 'udp4');
    socket.once('error', (error) => {
      socket.close();
      callback(error);
    });
    socket.bind(0, () => {
      const ssrc = randomInt(1, 0x7fffffff);
      this.prepared.set(request.sessionID, {
        socket,
        target: {
          address: request.targetAddress,
          port: request.video.port,
          ssrc,
          srtpParams: Buffer.concat([request.video.srtp_key, request.video.srtp_salt]).toString('base64'),
        },
      });
      callback(undefined, {
        video: {
          port: socket.address().port,
          ssrc,
          srtp_key: request.video.srtp_key,
          srtp_salt: request.video.srtp_salt,
        },
      });
    });
  }

  handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void {
    switch (request.type) {
    case this.api.hap.StreamRequestTypes.START:
      this.startStream(request).then(() => callback(), (error: Error) => callback(error));
      return;
    case this.api.hap.StreamRequestTypes.STOP:
      this.stopSession(request.sessionID);
      callback();
      return;
    default:
      // RECONFIGURE: the passthrough stream has no settings to change.
      callback();
    }
  }

  /** Homebridge is shutting down: no ffmpeg may outlive it. */
  shutdown(): void {
    this.killSnapshot?.();
    if (this.active) {
      clearTimeout(this.active.watchdog);
      this.active.ffmpeg.kill();
      closeSocket(this.active.socket);
      this.active = undefined;
    }
    for (const sessionId of [...this.prepared.keys()]) {
      this.stopSession(sessionId);
    }
  }

  private async startStream(request: StartStreamRequest): Promise<void> {
    const sessionId = request.sessionID;
    const prepared = this.prepared.get(sessionId);
    if (!prepared) {
      throw new Error(`Unknown streaming session ${sessionId}.`);
    }
    this.prepared.delete(sessionId);

    for (const otherId of [...this.prepared.keys()]) {
      this.stopSession(otherId);
    }
    if (this.active) {
      this.stopSession(this.active.id);
    }
    this.killSnapshot?.();

    const caps = await probeCapabilities(this.printer.ffmpegPath);
    const target: SrtpTarget = { ...prepared.target, payloadType: request.video.pt, mtu: request.video.mtu };
    const args = request.video.width >= PASSTHROUGH_MIN_WIDTH
      ? passthroughArgs(this.printer.streamUrl, caps, target)
      : transcodeArgs(this.printer.streamUrl, caps, this.transcodeOptions(request), target);

    const ffmpeg = new FfmpegProcess(this.printer.ffmpegPath, args, () => {
      // ffmpeg ended on its own (printer unreachable, stream dropped): tell HomeKit.
      if (this.active?.id === sessionId) {
        this.stopSession(sessionId);
        this.controller.forceStopStreamingSession(sessionId);
      }
    });
    const session: ActiveSession = { id: sessionId, socket: prepared.socket, ffmpeg };
    this.active = session;

    // HomeKit sends RTCP reports while the viewer is watching. If they stop without a STOP
    // request (app killed, network lost), release the printer's RTSP connection.
    const silenceMs = Math.max(MIN_RTCP_SILENCE_MS, request.video.rtcp_interval * 10 * 1000);
    prepared.socket.on('message', () => {
      clearTimeout(session.watchdog);
      session.watchdog = setTimeout(() => {
        if (this.active === session) {
          this.stopSession(sessionId);
          this.controller.forceStopStreamingSession(sessionId);
        }
      }, silenceMs);
    });
  }

  private stopSession(sessionId: string): void {
    const prepared = this.prepared.get(sessionId);
    if (prepared) {
      this.prepared.delete(sessionId);
      closeSocket(prepared.socket);
    }

    if (this.active?.id === sessionId) {
      const session = this.active;
      this.active = undefined;
      clearTimeout(session.watchdog);
      session.ffmpeg.stop();
      closeSocket(session.socket);
    }
  }

  private transcodeOptions(request: StartStreamRequest): TranscodeOptions {
    const { hap } = this.api;
    const { video } = request;
    return {
      width: video.width,
      height: video.height,
      fps: Math.max(1, Math.min(30, video.fps)),
      bitrateKbps: Math.max(100, video.max_bit_rate),
      profile: video.profile === hap.H264Profile.BASELINE ? 'baseline' : video.profile === hap.H264Profile.HIGH ? 'high' : 'main',
      level: video.level === hap.H264Level.LEVEL4_0 ? '4.0' : video.level === hap.H264Level.LEVEL3_2 ? '3.2' : '3.1',
    };
  }

  private async captureFrame(width: number, height: number): Promise<Buffer> {
    const caps = await probeCapabilities(this.printer.ffmpegPath);
    const run = runForOutput(this.printer.ffmpegPath, snapshotArgs(this.printer.streamUrl, caps, width, height), SNAPSHOT_TIMEOUT_MS);
    this.killSnapshot = run.kill;
    try {
      return await run.result;
    } finally {
      if (this.killSnapshot === run.kill) {
        this.killSnapshot = undefined;
      }
    }
  }
}
