import { spawn, type ChildProcess } from 'node:child_process';

const STOP_GRACE_MS = 2_000;

/** A long-running ffmpeg (live stream). stderr is discarded: the plugin never logs. */
export class FfmpegProcess {
  private readonly child: ChildProcess;
  private exited = false;
  private stopping = false;

  /** `onUnexpectedExit` runs when ffmpeg ends without `stop()` or `kill()` having been called. */
  constructor(ffmpegPath: string, args: string[], onUnexpectedExit: () => void) {
    this.child = spawn(ffmpegPath, args, { stdio: 'ignore' });

    const handleExit = () => {
      if (this.exited) {
        return;
      }
      this.exited = true;
      if (!this.stopping) {
        onUnexpectedExit();
      }
    };
    this.child.on('error', handleExit);
    this.child.on('exit', handleExit);
  }

  /** SIGTERM, then SIGKILL if ffmpeg is still alive after a grace period. */
  stop(): void {
    if (this.exited || this.stopping) {
      return;
    }
    this.stopping = true;
    this.child.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (!this.exited) {
        this.child.kill('SIGKILL');
      }
    }, STOP_GRACE_MS);
    timer.unref();
    this.child.once('exit', () => clearTimeout(timer));
  }

  /** Immediate kill, used when Homebridge shuts down. */
  kill(): void {
    if (this.exited) {
      return;
    }
    this.stopping = true;
    this.child.kill('SIGKILL');
  }
}

/** Runs ffmpeg to completion and returns its stdout, killing it after `timeoutMs`. */
export function runForOutput(ffmpegPath: string, args: string[], timeoutMs: number): { result: Promise<Buffer>; kill: () => void } {
  const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'ignore'] });
  const kill = () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  };

  const result = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(kill, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });

  return { result, kill };
}
