# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.3] - 2026-08-18

### Changed

- The plugin no longer writes anything to the Homebridge log. All `info`, `debug`, `warn`, and `error` output has been removed from the platform, printer accessories, and camera accessory. ffmpeg stderr is redirected to `/dev/null` instead of being piped and logged.

## [1.2.2] - 2026-07-02

### Changed

- Reduced Homebridge log noise on printer disconnect/reconnect: only a single `MQTT connected` and a single `MQTT disconnected` line are now logged. The repeated reconnection warnings, connection-issue warnings, and per-transition camera pipeline messages were moved to debug level.

## [1.2.1] - 2026-06-05

### Fixed

- The camera accessory no longer spawns ffmpeg snapshot/pipeline processes while the printer is offline, eliminating the looping "Host is unreachable" errors when the printer is powered off. Cached snapshots are served instead, and the pipeline resumes automatically when the printer reconnects.
- Camera ffmpeg failures are now logged as warnings instead of errors, and verbose snapshot logs were moved to debug level.

## [1.2.0] - 2026-06-05

### Added

- X2D printer model option.

### Removed

- Removed the custom configuration UI in favor of the standard schema-generated Homebridge UI form. The custom UI lost input focus on every keystroke and was missing the new accessory visibility toggles.

## [1.1.0] - 2026-06-05

### Added

- New per-printer option `enablePrintSwitch` to hide the print switch accessory from HomeKit (enabled by default).
- New per-printer option `enableChamberLight` to hide the chamber light accessory from HomeKit (enabled by default).
- GitHub Actions workflow to publish the plugin to npm automatically on `v*` tags (OIDC Trusted Publishing).

### Changed

- MQTT reconnection now uses exponential backoff (5s → 10s → 20s → … capped at 5 minutes) instead of a fixed 5-second loop, and resets as soon as the printer reconnects.
- Connection-loss messages are now logged as warnings instead of errors, so powering off the printer no longer floods the Homebridge log with errors.
- Package renamed to `@moifort/homebridge-bambu-lab` and repository moved to [moifort/homebridge-bambu-lab](https://github.com/moifort/homebridge-bambu-lab).

## [1.0.2] - 2026-05-20

### Fixed

- Improved camera configuration and error handling.

## [1.0.1] - 2026-03-09

### Fixed

- Updated platform name and improved error handling.
- Corrected event triggers in GitHub Actions workflow.

## [1.0.0] - 2026-03-06

### Added

- Initial release: Bambu printer platform with MQTT support (chamber light, print switch, optional speed control and camera with HKSV).
