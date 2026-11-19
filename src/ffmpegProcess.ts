import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';

const STOP_GRACE_MS = 2_000;
/** Lines of ffmpeg's stderr kept to explain why it ended. ffmpeg runs with `-loglevel error`. */
const STDERR_LINES = 10;
const STDERR_LINE_LENGTH = 500;

/** Keeps the last lines written by ffmpeg on stderr, always reading it so ffmpeg never blocks. */
export class StderrTail {
  private readonly lines: string[] = [];
  private partial = '';

  constructor(stream: Readable | null) {
    stream?.setEncoding('utf8');
    stream?.on('data', (chunk: string) => this.push(chunk));
  }

  push(chunk: string): void {
    const parts = (this.partial + chunk).split(/\r?\n/);
    this.partial = parts.pop()!.slice(-STDERR_LINE_LENGTH);
    for (const line of parts) {
      const trimmed = line.trim();
      if (trimmed) {
        this.lines.push(trimmed.slice(0, STDERR_LINE_LENGTH));
      }
    }
    this.lines.splice(0, Math.max(0, this.lines.length - STDERR_LINES));
  }

  text(): string {
    return [...this.lines, this.partial.trim()].filter(Boolean).join('\n');
  }
}

/** Why ffmpeg ended: exit code or signal, a spawn error, and its last stderr lines. */
export function describeExit(code: number | null, signal: NodeJS.Signals | null, stderr: string, error?: Error): string {
  const status = error ? error.message : signal ? `killed by ${signal}` : `exit code ${code}`;
  return stderr ? `${status}\n${stderr}` : status;
}

/** A long-running ffmpeg (live stream). */
export class FfmpegProcess {
  private readonly child: ChildProcess;
  private readonly stderr: StderrTail;
  private exited = false;
  private stopping = false;

  /** `onUnexpectedExit` runs when ffmpeg ends without `stop()` or `kill()` having been called. */
  constructor(ffmpegPath: string, args: string[], onUnexpectedExit: (reason: string) => void) {
    this.child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.stderr = new StderrTail(this.child.stderr);

    const handleExit = (code: number | null, signal: NodeJS.Signals | null, error?: Error) => {
      if (this.exited) {
        return;
      }
      this.exited = true;
      if (!this.stopping) {
        onUnexpectedExit(describeExit(code, signal, this.stderr.text(), error));
      }
    };
    this.child.on('error', (error) => handleExit(null, null, error));
    // `close` rather than `exit`: stderr has been read to the end.
    this.child.on('close', (code, signal) => handleExit(code, signal));
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

/**
 * Runs ffmpeg to completion and returns its stdout, killing it after `timeoutMs`. On failure the
 * error message says why, with ffmpeg's last stderr lines.
 */
export function runForOutput(ffmpegPath: string, args: string[], timeoutMs: number): { result: Promise<Buffer>; kill: () => void } {
  const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const stderr = new StderrTail(child.stderr);
  const kill = () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  };

  const result = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(describeExit(null, null, stderr.text(), error)));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
      } else {
        const status = timedOut ? `no frame within ${timeoutMs / 1000} s` : describeExit(code, signal, '');
        reject(new Error(stderr.text() ? `${status}\n${stderr.text()}` : status));
      }
    });
  });

  return { result, kill };
}
