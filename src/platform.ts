import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { BambuCamera } from './camera.js';
import { readPrinters } from './config.js';
import { redactUrls } from './redact.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

/**
 * One HomeKit camera per configured printer. Quiet in normal operation: only configuration
 * problems are logged at startup, everything else at debug level.
 */
export class BambuPlatform implements DynamicPlatformPlugin {
  private readonly cachedAccessories = new Map<string, PlatformAccessory>();
  private readonly cameras: BambuCamera[] = [];

  constructor(
    private readonly log: Logging,
    private readonly config: PlatformConfig,
    private readonly api: API,
  ) {
    api.on('didFinishLaunching', () => this.publishCameras());
    api.on('shutdown', () => this.cameras.forEach((camera) => camera.shutdown()));
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  /** Same UUID as 1.x, so the camera already paired in HomeKit is kept. Never change it. */
  private cameraUuid(serialNumber: string): string {
    return this.api.hap.uuid.generate(`${serialNumber}-camera`);
  }

  private publishCameras(): void {
    const storagePath = join(this.api.user.storagePath(), PLUGIN_NAME);
    mkdirSync(storagePath, { recursive: true });

    const { printers, skipped } = readPrinters(this.config);
    if (printers.length === 0 && skipped.length === 0) {
      this.log.warn('No printer configured: add one in the plugin settings.');
    }

    // Cameras of printers still in the config but not usable right now: their accessory, with its
    // room and automations in HomeKit, is kept until the config is fixed.
    const kept = new Set<string>();
    // An entry without serial number cannot be matched to its camera: keep every cached accessory.
    let keepAll = false;
    for (const printer of skipped) {
      this.log.warn(`Printer ${printer.label} skipped: ${printer.reason}.`);
      if (printer.serialNumber) {
        kept.add(this.cameraUuid(printer.serialNumber));
      } else {
        keepAll = true;
      }
    }

    const published = new Set<string>();
    for (const printer of printers) {
      const uuid = this.cameraUuid(printer.serialNumber);
      try {
        const cached = this.cachedAccessories.get(uuid);
        const accessory = cached
          ?? new this.api.platformAccessory(printer.cameraName, uuid, this.api.hap.Categories.IP_CAMERA);

        accessory.displayName = printer.cameraName;
        accessory.category = this.api.hap.Categories.IP_CAMERA;
        this.cameras.push(new BambuCamera(this.api, accessory, printer, storagePath, this.log));

        if (cached) {
          this.api.updatePlatformAccessories([accessory]);
        } else {
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
        published.add(uuid);
      } catch (error) {
        kept.add(uuid);
        this.log.error(`Printer "${printer.name}" skipped: ${redactUrls(error instanceof Error ? error.message : String(error))}`);
      }
    }

    // Removes accessories of 1.x (chamber light, print switch, speed) and of printers removed from the config.
    const stale = keepAll
      ? []
      : [...this.cachedAccessories.values()].filter((accessory) => !published.has(accessory.UUID) && !kept.has(accessory.UUID));
    if (stale.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }
  }
}
