import { readFile, rename, stat, writeFile } from 'node:fs/promises';

/** A cached snapshot older than this is still served, and a fresh one is captured in the background. */
const MAX_AGE_MS = 60_000;
/** After a failed capture (printer off or unreachable), wait before spawning ffmpeg again. */
const RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

export type FrameCapture = (width: number, height: number) => Promise<Buffer>;

/**
 * Snapshots for the Home app tiles. The cached JPEG is answered at once (capturing a frame
 * takes longer than the 5 s HomeKit allows), one capture runs at a time, and failures back off.
 */
export class SnapshotCache {
  private inFlight?: Promise<Buffer>;
  private failures = 0;
  private retryAt = 0;
  private lastWidth = 1280;
  private lastHeight = 720;

  constructor(
    private readonly filePath: string,
    private readonly capture: FrameCapture,
    /** True while a live stream holds the printer's RTSP connection. */
    private readonly isStreaming: () => boolean,
  ) {}

  async get(width: number, height: number): Promise<Buffer> {
    this.lastWidth = width;
    this.lastHeight = height;
    const cached = await this.readCached();
    if (cached) {
      if (cached.ageMs >= MAX_AGE_MS) {
        this.refresh(width, height).catch(() => {
          // keep serving the cached snapshot
        });
      }
      return cached.image;
    }
    return this.refresh(width, height);
  }

  /** The printer was switched back on: forget past failures and capture a fresh image. */
  refreshAfterReconnect(): void {
    this.failures = 0;
    this.retryAt = 0;
    this.refresh(this.lastWidth, this.lastHeight).catch(() => {
      // retried on the next request
    });
  }

  private refresh(width: number, height: number): Promise<Buffer> {
    if (this.inFlight) {
      return this.inFlight;
    }
    if (this.isStreaming()) {
      return Promise.reject(new Error('Live stream in progress.'));
    }
    if (Date.now() < this.retryAt) {
      return Promise.reject(new Error('Printer camera unreachable, retrying later.'));
    }

    this.inFlight = this.capture(width, height)
      .then(async (image) => {
        this.failures = 0;
        this.retryAt = 0;
        await this.writeCached(image);
        return image;
      }, (error: unknown) => {
        this.failures += 1;
        this.retryAt = Date.now() + Math.min(RETRY_DELAY_MS * 2 ** (this.failures - 1), MAX_RETRY_DELAY_MS);
        throw error;
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    return this.inFlight;
  }

  private async readCached(): Promise<{ image: Buffer; ageMs: number } | undefined> {
    try {
      const [info, image] = await Promise.all([stat(this.filePath), readFile(this.filePath)]);
      return image.length > 0 ? { image, ageMs: Date.now() - info.mtimeMs } : undefined;
    } catch {
      return undefined;
    }
  }

  private async writeCached(image: Buffer): Promise<void> {
    const tmpPath = `${this.filePath}.tmp`;
    try {
      await writeFile(tmpPath, image);
      await rename(tmpPath, this.filePath);
    } catch {
      // the cache is best effort
    }
  }
}
