import { connect } from 'node:net';

/** Background check interval. Requests from HomeKit also probe on demand. */
const PROBE_INTERVAL_MS = 30_000;
/** A probe result younger than this answers HomeKit requests without a new connection. */
const MAX_RESULT_AGE_MS = 10_000;
/** Shorter while the printer is off, so the camera comes back soon after it is switched on. */
const MAX_OFFLINE_RESULT_AGE_MS = 3_000;
/** A powered printer answers within a few milliseconds on a LAN. */
const CONNECT_TIMEOUT_MS = 1_500;
/**
 * A port no printer listens on (discard). A powered printer refuses the connection at once, and
 * since no server accepts it, asking costs the printer nothing.
 */
const IDLE_PORT = 9;

/** `open`: accepted. `refused`: the host is up but nothing listens. `silent`: no answer at all. */
export type PortState = 'open' | 'refused' | 'silent';
export type PortProbe = (host: string, port: number) => Promise<PortState>;

/** Host and port of an RTSP(S) URL. */
export function rtspEndpoint(url: string): { host: string; port: number } {
  const parsed = new URL(url);
  const defaultPort = parsed.protocol === 'rtsps:' ? 322 : 554;
  return {
    host: parsed.hostname.replace(/^\[(.*)\]$/, '$1'),
    port: parsed.port ? Number(parsed.port) : defaultPort,
  };
}

/** Opens a TCP connection and closes it at once. */
export function tcpPortState(host: string, port: number): Promise<PortState> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: CONNECT_TIMEOUT_MS });
    const done = (state: PortState) => {
      socket.destroy();
      resolve(state);
    };
    socket.once('connect', () => done('open'));
    socket.once('timeout', () => done('silent'));
    socket.once('error', (error: NodeJS.ErrnoException) => {
      done(error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET' ? 'refused' : 'silent');
    });
  });
}

/**
 * Knows whether the printer is powered on with its camera stream available. A printer switched
 * off at the plug is a normal state, not an error: no ffmpeg is started for it and it is only
 * logged at debug level.
 *
 * The stream port is asked as rarely as possible. Every connection accepted by the printer's
 * RTSP server slows it down until the printer is restarted, even a connection closed at once:
 * on an X2D, each one adds about 0.6 ms to every later RTSP request. A probe of that port every
 * 30 s made each request take 1.5 s after 20 hours, so a live view needed 16 s to start and
 * showed one frame every 2 s.
 *
 * So the stream port is asked once when the printer appears. After that, a port nobody listens
 * on tells whether the printer is still powered: it refuses the connection at once, which no
 * server ever sees. The stream port is asked again when the printer comes back, and when ffmpeg
 * could not read the stream (`recheck`).
 */
export class PrinterPresence {
  private online?: boolean;
  private checkedAt = 0;
  private inFlight?: Promise<boolean>;
  private timer?: NodeJS.Timeout;
  /** The stream port accepted a connection and the printer has answered ever since. */
  private streamPortOpen = false;
  /** The host refuses the idle port. False for a host that drops such connections (firewall). */
  private answersIdlePort = false;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly onChange: (online: boolean) => void,
    /** True while ffmpeg holds an RTSP connection: it proves the printer is on. */
    private readonly isBusy: () => boolean,
    private readonly portState: PortProbe = tcpPortState,
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

  /** ffmpeg could not read the stream: ask the stream port again instead of trusting its last answer. */
  recheck(): Promise<boolean> {
    this.streamPortOpen = false;
    return this.check(0);
  }

  private async probe(): Promise<boolean> {
    if (this.streamPortOpen && this.answersIdlePort) {
      if (await this.portState(this.host, IDLE_PORT) !== 'silent') {
        return true;
      }
      // No answer any more: switched off. The stream port is asked again when it is back.
      this.streamPortOpen = false;
      return false;
    }

    // The idle port is not awaited: a host that drops the connection would delay every answer by
    // the connect timeout. Its state is known by the next probe.
    void this.portState(this.host, IDLE_PORT).then((state) => {
      this.answersIdlePort = state !== 'silent';
    });
    this.streamPortOpen = await this.portState(this.host, this.port) === 'open';
    return this.streamPortOpen;
  }
}
