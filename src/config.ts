import { isIP } from 'node:net';

import type { PlatformConfig } from 'homebridge';

/** Camera settings of one printer, as read from the Homebridge config. */
export interface PrinterConfig {
  name: string;
  model: string;
  serialNumber: string;
  /** RTSP(S) URL of the printer's live camera stream. Contains the access code: never log it. */
  streamUrl: string;
  /** HomeKit name of the camera accessory. */
  cameraName: string;
  ffmpegPath: string;
  /** Name of the cached snapshot file, safe to join to a directory. */
  snapshotFile: string;
}

/** A configured printer that cannot be used. */
export interface SkippedPrinter {
  /** How the printer is named in the log: its name and position, never a credential. */
  label: string;
  /** Present when the entry has one: the camera paired with it in HomeKit must be kept. */
  serialNumber?: string;
  reason: string;
}

export interface PrintersConfig {
  printers: PrinterConfig[];
  skipped: SkippedPrinter[];
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
const HOST_NAME = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?$/;

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

/** The host as it goes in a URL (IPv6 between brackets), or undefined if it is neither an IP address nor a host name. */
function urlHost(ipAddress: string): string | undefined {
  const unbracketed = ipAddress.replace(/^\[(.*)\]$/, '$1');
  if (isIP(unbracketed) === 6) {
    return `[${unbracketed}]`;
  }
  if (isIP(unbracketed) === 4 || HOST_NAME.test(unbracketed)) {
    return unbracketed;
  }
  return undefined;
}

function isRtspUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'rtsp:' || url.protocol === 'rtsps:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** The serial number, reduced to characters that are safe in a file name. */
function fileSafe(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

function readRawPrinters(config: PlatformConfig): unknown[] {
  if (Array.isArray(config.printers) && config.printers.length > 0) {
    return config.printers as unknown[];
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
    } satisfies RawPrinterConfig];
  }

  return [];
}

/** The stream URL of a printer entry, or the reason it cannot be built. */
function streamUrl(raw: RawPrinterConfig): { url: string } | { reason: string } {
  const customUrl = text(raw.cameraRtspUrl);
  if (customUrl) {
    return isRtspUrl(customUrl) ? { url: customUrl } : { reason: 'the camera stream URL must be an rtsp:// or rtsps:// URL' };
  }

  const ipAddress = text(raw.ipAddress);
  const lanAccessCode = text(raw.lanAccessCode);
  if (!ipAddress) {
    return { reason: 'the IP address is missing (or set a camera stream URL)' };
  }
  const host = urlHost(ipAddress);
  if (!host) {
    return { reason: 'the IP address must be an IPv4 or IPv6 address or a host name' };
  }
  if (!lanAccessCode) {
    return { reason: 'the LAN access code is missing (or set a camera stream URL)' };
  }
  const url = `rtsps://${RTSP_USERNAME}:${encodeURIComponent(lanAccessCode)}@${host}:${RTSP_PORT}${RTSP_PATH}`;
  return isRtspUrl(url) ? { url } : { reason: 'the IP address cannot be used in a URL' };
}

/**
 * Reads and checks the configured printers before anything is built from them. Supports the
 * `printers` array and the older flat configuration at the platform root. Unknown keys (options
 * removed in 2.0) are ignored. Entries that cannot be used are returned in `skipped` with the
 * reason, never with the access code or the stream URL.
 */
export function readPrinters(config: PlatformConfig): PrintersConfig {
  const printers: PrinterConfig[] = [];
  const skipped: SkippedPrinter[] = [];
  const seenSerials = new Set<string>();

  readRawPrinters(config).forEach((entry, index) => {
    const position = `printer #${index + 1}`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      skipped.push({ label: position, reason: 'the entry is not a printer object' });
      return;
    }
    const raw = entry as RawPrinterConfig;
    const configuredName = text(raw.name);
    const label = configuredName ? `"${configuredName}" (${position})` : position;

    const serialNumber = text(raw.serialNumber);
    if (!serialNumber) {
      skipped.push({ label, reason: 'the serial number is missing' });
      return;
    }
    if (seenSerials.has(serialNumber)) {
      skipped.push({ label, serialNumber, reason: 'another printer has the same serial number' });
      return;
    }
    seenSerials.add(serialNumber);

    const stream = streamUrl(raw);
    if ('reason' in stream) {
      skipped.push({ label, serialNumber, reason: stream.reason });
      return;
    }

    const model = text(raw.model) ?? DEFAULT_PRINTER_MODEL;
    const name = configuredName ?? defaultPrinterName(model, serialNumber, index);

    printers.push({
      name,
      model,
      serialNumber,
      streamUrl: stream.url,
      cameraName: text(raw.cameraName) ?? `${name} Camera`,
      ffmpegPath: text(raw.ffmpegPath) ?? 'ffmpeg',
      snapshotFile: `bambu-${fileSafe(serialNumber)}-snapshot.jpg`,
    });
  });

  return { printers, skipped };
}
