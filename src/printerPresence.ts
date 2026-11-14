import { connect } from 'node:net';

/** Background check interval. Requests from HomeKit also probe on demand. */
const PROBE_INTERVAL_MS = 30_000;
/** A probe result younger than this answers HomeKit requests without a new connection. */
const MAX_RESULT_AGE_MS = 10_000;
/** Shorter while the printer is off, so the camera comes back soon after it is switched on. */
const MAX_OFFLINE_RESULT_AGE_MS = 3_000;
/** A powered printer accepts the connection within a few milliseconds on a LAN. */
const CONNECT_TIMEOUT_MS = 1_500;

/** Host and port of an RTSP(S) URL. */
export function rtspEndpoint(url: string): { host: string; port: number } {
  const parsed = new URL(url);
  const defaultPort = parsed.protocol === 'rtsps:' ? 322 : 554;
  return {
    host: parsed.hostname.replace(/^\[(.*)\]$/, '$1'),
    port: parsed.port ? Number(parsed.port) : defaultPort,
  };
}

/**
 * Knows whether the printer is powered on, by opening (and closing at once) a TCP connection to
 * its RTSP port. A printer switched off at the plug is a normal state, not an error: no ffmpeg
 * is started for it and nothing is logged.
 */
export class PrinterPresence {
  private online?: boolean;
  private checkedAt = 0;
  private inFlight?: Promise<boolean>;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly onChange: (online: boolean) => void,
    /** True while ffmpeg holds an RTSP connection: it proves the printer is on, and probing would open a second one. */
    private readonly isBusy: () => boolean,
  ) {}

  start(): void {
    void this.check(0);
    this.timer = setInterval(() => void this.check(0), PROBE_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Resolves to the printer's state, probing when the last result is older than `maxAgeMs`. */
  check(maxAgeMs?: number): Promise<boolean> {
    if (this.isBusy()) {
      return Promise.resolve(true);
    }
    const maxAge = maxAgeMs ?? (this.online ? MAX_RESULT_AGE_MS : MAX_OFFLINE_RESULT_AGE_MS);
    if (this.online !== undefined && Date.now() - this.checkedAt < maxAge) {
      return Promise.resolve(this.online);
    }
    this.inFlight ??= this.probe().then((online) => {
      this.inFlight = undefined;
      this.checkedAt = Date.now();
      if (online !== this.online) {
        this.online = online;
        this.onChange(online);
      }
      return online;
    });
    return this.inFlight;
  }

  private probe(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = connect({ host: this.host, port: this.port, timeout: CONNECT_TIMEOUT_MS });
      const done = (online: boolean) => {
        socket.destroy();
        resolve(online);
      };
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
    });
  }
}
