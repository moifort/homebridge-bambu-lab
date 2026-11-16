import { createSocket, type Socket } from 'node:dgram';
import { randomInt } from 'node:crypto';
import { join } from 'node:path';

import type {
  API,
  Characteristic,
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
import { PrinterPresence, rtspEndpoint } from './printerPresence.js';
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
/**
 * Live views that can run at the same time, each with its own ffmpeg and its own RTSP connection
 * to the printer. Three covers a Mac, an iPhone and a third screen (iPad, Apple TV). The limit
 * is the printer rather than the Homebridge host: every viewer costs it one more RTSP connection
 * and how many it accepts is not documented, while a forwarded stream costs ffmpeg about 2 % of
 * one core (a re-encoded small one about 20 %, measured on an Apple Silicon Mac).
 */
const MAX_LIVE_VIEWS = 3;

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
 * HomeKit camera of one printer. Several devices can watch at once: each live session has its own
 * ffmpeg and its own RTSP connection to the printer, and starting, stopping or losing one never
 * touches the others. If the printer refuses an extra connection, only that session is closed.
 *
 * A printer switched off is shown as "No Response" in the Home app: the streaming status
 * characteristics answer with a communication failure, snapshots and stream setups are refused
 * at once. HAP-NodeJS reports these errors at debug level only, so nothing reaches the log.
 */
export class BambuCamera implements CameraStreamingDelegate {
  private readonly controller: CameraController;
  private readonly snapshots: SnapshotCache;
  private readonly presence: PrinterPresence;
  private readonly streamingStatuses: Characteristic[];
  private printerOn = true;
  private readonly prepared = new Map<string, PreparedSession>();
  private readonly sessions = new Map<string, ActiveSession>();
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
      () => this.sessions.size > 0,
    );

    this.controller = new hap.CameraController({
      cameraStreamCount: MAX_LIVE_VIEWS,
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
    this.streamingStatuses = accessory.services
      .filter((service) => service.UUID === hap.Service.CameraRTPStreamManagement.UUID)
      .map((service) => service.getCharacteristic(hap.Characteristic.StreamingStatus));

    const { host, port } = rtspEndpoint(printer.streamUrl);
    this.presence = new PrinterPresence(
      host,
      port,
      (online) => this.handlePresenceChange(online),
      () => this.sessions.size > 0 || this.killSnapshot !== undefined,
    );
    this.presence.start();

    // Warm the cache so the first stream does not wait for it.
    void probeCapabilities(printer.ffmpegPath);
  }

  handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): void {
    const width = request.width > 0 ? request.width : 1280;
    const height = request.height > 0 ? request.height : 720;
    this.presence.check()
      .then((online) => {
        if (!online) {
          throw new Error('Printer is switched off.');
        }
        return this.snapshots.get(width, height);
      })
      .then(
        (image) => callback(undefined, image),
        (error: Error) => callback(error),
      );
  }

  prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): void {
    this.presence.check().then((online) => {
      if (online) {
        this.prepareSession(request, callback);
      } else {
        callback(new Error('Printer is switched off.'));
      }
    });
  }

  private prepareSession(request: PrepareStreamRequest, callback: PrepareStreamCallback): void {
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
    this.presence.stop();
    this.killSnapshot?.();
    for (const session of this.sessions.values()) {
      clearTimeout(session.watchdog);
      session.ffmpeg.kill();
      closeSocket(session.socket);
    }
    this.sessions.clear();
    for (const prepared of this.prepared.values()) {
      closeSocket(prepared.socket);
    }
    this.prepared.clear();
  }

  private async startStream(request: StartStreamRequest): Promise<void> {
    const sessionId = request.sessionID;
    const prepared = this.prepared.get(sessionId);
    if (!prepared) {
      throw new Error(`Unknown streaming session ${sessionId}.`);
    }
    // A snapshot capture holds an RTSP connection too: free it for the live view.
    this.killSnapshot?.();

    const caps = await probeCapabilities(this.printer.ffmpegPath);
    if (this.prepared.get(sessionId) !== prepared) {
      // Stopped (or Homebridge shut down) while the capabilities were probed.
      throw new Error(`Streaming session ${sessionId} was stopped.`);
    }
    this.prepared.delete(sessionId);

    const target: SrtpTarget = { ...prepared.target, payloadType: request.video.pt, mtu: request.video.mtu };
    const args = request.video.width >= PASSTHROUGH_MIN_WIDTH
      ? passthroughArgs(this.printer.streamUrl, caps, target)
      : transcodeArgs(this.printer.streamUrl, caps, this.transcodeOptions(request), target);

    const ffmpeg = new FfmpegProcess(this.printer.ffmpegPath, args, () => {
      // ffmpeg ended on its own (printer switched off, stream dropped, extra connection
      // refused): close this session in HomeKit, then check whether the printer is still
      // there and still serves its stream. While other sessions run, they prove it is on and
      // no probe is made.
      // (A session stopped from our side never gets here: `stop()` silences this callback.)
      if (this.sessions.has(sessionId)) {
        this.forceStop(sessionId);
        void this.presence.recheck();
      }
    });
    const session: ActiveSession = { id: sessionId, socket: prepared.socket, ffmpeg };
    this.sessions.set(sessionId, session);

    // HomeKit sends RTCP reports while the viewer is watching. If they stop without a STOP
    // request (app killed, network lost), release the printer's RTSP connection.
    const silenceMs = Math.max(MIN_RTCP_SILENCE_MS, request.video.rtcp_interval * 10 * 1000);
    prepared.socket.on('message', () => {
      clearTimeout(session.watchdog);
      session.watchdog = setTimeout(() => {
        if (this.sessions.get(sessionId) === session) {
          this.forceStop(sessionId);
        }
      }, silenceMs);
    });
  }

  /** Ends a session from our side and closes it in HomeKit. */
  private forceStop(sessionId: string): void {
    this.stopSession(sessionId);
    this.controller.forceStopStreamingSession(sessionId);
    // HAP resets the streaming status when it closes the session.
    this.applyReachability();
  }

  private handlePresenceChange(online: boolean): void {
    const wasOff = !this.printerOn;
    this.printerOn = online;
    this.applyReachability();
    if (online && wasOff) {
      this.snapshots.refreshAfterReconnect();
    }
  }

  /** "No Response" in the Home app while the printer is off; normal status again when it is back. */
  private applyReachability(): void {
    for (const status of this.streamingStatuses) {
      if (this.printerOn) {
        status.updateValue(status.value);
      } else {
        status.updateValue(new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE));
      }
    }
  }

  private stopSession(sessionId: string): void {
    const prepared = this.prepared.get(sessionId);
    if (prepared) {
      this.prepared.delete(sessionId);
      closeSocket(prepared.socket);
    }

    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
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
    let killedByUs = false;
    const kill = () => {
      killedByUs = true;
      run.kill();
    };
    this.killSnapshot = kill;
    const release = () => {
      if (this.killSnapshot === kill) {
        this.killSnapshot = undefined;
      }
    };
    try {
      const image = await run.result;
      release();
      return image;
    } catch (error) {
      release();
      if (!killedByUs) {
        // The stream could not be read (LAN live view turned off, printer switched off).
        void this.presence.recheck();
      }
      throw error;
    }
  }
}
