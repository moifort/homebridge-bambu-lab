import type { PlatformConfig } from 'homebridge';

/** Camera settings of one printer, as read from the Homebridge config. */
export interface PrinterConfig {
  name: string;
  model: string;
  serialNumber: string;
  /** RTSP(S) URL of the printer's live camera stream. */
  streamUrl: string;
  /** HomeKit name of the camera accessory. */
  cameraName: string;
  ffmpegPath: string;
}

interface RawPrinterConfig {
  name?: unknown;
  model?: unknown;
  ipAddress?: unknown;
  serialNumber?: unknown;
  lanAccessCode?: unknown;
  cameraName?: unknown;
  cameraRtspUrl?: unknown;
  ffmpegPath?: unknown;
}

const DEFAULT_PRINTER_NAME = 'Bambu Printer';
const DEFAULT_PRINTER_MODEL = 'Bambu Printer';
const RTSP_USERNAME = 'bblp';
const RTSP_PORT = 322;
const RTSP_PATH = '/streaming/live/1';

function defaultPrinterName(model: string, serialNumber: string, index: number): string {
  const prefix = model === DEFAULT_PRINTER_MODEL ? DEFAULT_PRINTER_NAME : model;
  const suffix = serialNumber.length >= 4 ? serialNumber.slice(-4) : `${index + 1}`;
  return `${prefix} ${suffix}`;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readRawPrinters(config: PlatformConfig): RawPrinterConfig[] {
  if (Array.isArray(config.printers) && config.printers.length > 0) {
    return config.printers as RawPrinterConfig[];
  }

  if (text(config.ipAddress) || text(config.serialNumber) || text(config.lanAccessCode)) {
    return [{
      name: text(config.name) ?? DEFAULT_PRINTER_NAME,
      model: DEFAULT_PRINTER_MODEL,
      ipAddress: config.ipAddress,
      serialNumber: config.serialNumber,
      lanAccessCode: config.lanAccessCode,
      cameraName: config.cameraName,
      cameraRtspUrl: config.cameraRtspUrl,
      ffmpegPath: config.ffmpegPath,
    }];
  }

  return [];
}

/**
 * Reads the configured printers. Supports the `printers` array and the older flat
 * configuration at the platform root. Unknown keys (options removed in 2.0) are ignored.
 */
export function readPrinters(config: PlatformConfig): PrinterConfig[] {
  const printers: PrinterConfig[] = [];
  const seenSerials = new Set<string>();

  readRawPrinters(config).forEach((raw, index) => {
    const ipAddress = text(raw.ipAddress);
    const serialNumber = text(raw.serialNumber);
    const lanAccessCode = text(raw.lanAccessCode);
    if (!ipAddress || !serialNumber || !lanAccessCode || seenSerials.has(serialNumber)) {
      return;
    }
    seenSerials.add(serialNumber);

    const model = text(raw.model) ?? DEFAULT_PRINTER_MODEL;
    const name = text(raw.name) ?? defaultPrinterName(model, serialNumber, index);

    printers.push({
      name,
      model,
      serialNumber,
      streamUrl: text(raw.cameraRtspUrl)
        ?? `rtsps://${RTSP_USERNAME}:${encodeURIComponent(lanAccessCode)}@${ipAddress}:${RTSP_PORT}${RTSP_PATH}`,
      cameraName: text(raw.cameraName) ?? `${name} Camera`,
      ffmpegPath: text(raw.ffmpegPath) ?? 'ffmpeg',
    });
  });

  return printers;
}
