import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { BambuCamera } from './camera.js';
import { readPrinters } from './config.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

/** One HomeKit camera per configured printer. The plugin writes nothing to the Homebridge log. */
export class BambuPlatform implements DynamicPlatformPlugin {
  private readonly cachedAccessories = new Map<string, PlatformAccessory>();
  private readonly cameras: BambuCamera[] = [];

  constructor(
    _log: Logging,
    private readonly config: PlatformConfig,
    private readonly api: API,
  ) {
    api.on('didFinishLaunching', () => this.publishCameras());
    api.on('shutdown', () => this.cameras.forEach((camera) => camera.shutdown()));
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  private publishCameras(): void {
    const storagePath = join(this.api.user.storagePath(), PLUGIN_NAME);
    mkdirSync(storagePath, { recursive: true });

    const published = new Set<string>();

    for (const printer of readPrinters(this.config)) {
      try {
        // Same UUID as 1.x, so the camera already paired in HomeKit is kept.
        const uuid = this.api.hap.uuid.generate(`${printer.serialNumber}-camera`);
        const cached = this.cachedAccessories.get(uuid);
        const accessory = cached
          ?? new this.api.platformAccessory(printer.cameraName, uuid, this.api.hap.Categories.IP_CAMERA);

        accessory.displayName = printer.cameraName;
        accessory.category = this.api.hap.Categories.IP_CAMERA;
        this.cameras.push(new BambuCamera(this.api, accessory, printer, storagePath));

        if (cached) {
          this.api.updatePlatformAccessories([accessory]);
        } else {
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
        published.add(uuid);
      } catch {
        // printer skipped
      }
    }

    // Removes accessories of 1.x (chamber light, print switch, speed) and of removed printers.
    const stale = [...this.cachedAccessories.values()].filter((accessory) => !published.has(accessory.UUID));
    if (stale.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }
  }
}
