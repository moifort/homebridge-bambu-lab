/**
 * Closes a live session whose viewer is gone. HomeKit sends RTCP reports while the viewer is
 * watching; when they stop without a STOP request (app killed, network lost), or never come at
 * all, the printer's RTSP connection must not stay open.
 *
 * Armed when the session starts, with a longer first delay: the viewer only reports once video
 * reaches it, which waits for the printer's first keyframe. Every report re-arms it with the
 * regular delay. It fires at most once.
 */
export class RtcpWatchdog {
  private timer?: NodeJS.Timeout;
  private done = false;

  constructor(
    private readonly firstReportMs: number,
    private readonly silenceMs: number,
    private readonly onSilence: () => void,
  ) {}

  start(): void {
    this.arm(this.firstReportMs);
  }

  /** An RTCP report arrived. */
  feed(): void {
    this.arm(this.silenceMs);
  }

  stop(): void {
    this.done = true;
    clearTimeout(this.timer);
  }

  private arm(delayMs: number): void {
    if (this.done) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.done = true;
      this.onSilence();
    }, delayMs);
  }
}
